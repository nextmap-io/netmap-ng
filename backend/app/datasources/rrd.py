"""
Read RRD files (Observium format) for historical traffic data.

Uses rrdtool Python bindings or falls back to a `subprocess.run` invocation
that is dispatched onto a worker thread (asyncio.to_thread) so it never blocks
the event loop. A semaphore caps concurrent rrdtool subprocesses, and a tiny
TTL cache memoises xport results to absorb burst polling.

All subprocess errors are caught and surfaced as empty series so the API can
return 200 with empty data instead of bubbling 500 to clients.
"""

import asyncio
import json
import logging
import os
import re
import subprocess
import time
from typing import Any

from fastapi import HTTPException

from app.config import get_settings

try:
    import rrdtool as _rrdtool

    HAS_RRDTOOL = True
except ImportError:
    HAS_RRDTOOL = False

logger = logging.getLogger("netmap.rrd")

# Strict validation patterns
_HOSTNAME_RE = re.compile(r"^[a-zA-Z0-9._-]+$")
_PORT_ID_RE = re.compile(r"^[a-zA-Z0-9_-]+$")
_TIME_RE = re.compile(r"^(-\d{1,5}[smhdwMy]|now|\d{9,10})$")

# Cap concurrent rrdtool subprocesses so a burst of poll requests cannot fork
# hundreds of processes at once.
_rrd_semaphore = asyncio.Semaphore(8)

# Tiny TTL cache for xport results: key -> (timestamp, value).
_XPORT_CACHE_TTL = 10.0  # seconds
_XPORT_CACHE_MAX = 200
_xport_cache: dict[tuple[str, str, str, int], tuple[float, dict[str, Any]]] = {}


def _get_cached(
    key: tuple[str, str, str, int],
) -> dict[str, Any] | None:
    entry = _xport_cache.get(key)
    if entry is None:
        return None
    ts, value = entry
    if time.monotonic() - ts > _XPORT_CACHE_TTL:
        _xport_cache.pop(key, None)
        return None
    return value


def _set_cached(key: tuple[str, str, str, int], value: dict[str, Any]) -> None:
    _xport_cache[key] = (time.monotonic(), value)
    # Periodic cleanup: when the cache outgrows the cap, drop expired entries.
    if len(_xport_cache) > _XPORT_CACHE_MAX:
        now = time.monotonic()
        expired = [
            k for k, (t, _) in _xport_cache.items() if now - t > _XPORT_CACHE_TTL
        ]
        for k in expired:
            _xport_cache.pop(k, None)
        # If still over the limit, drop oldest entries deterministically.
        if len(_xport_cache) > _XPORT_CACHE_MAX:
            for k, _ in sorted(_xport_cache.items(), key=lambda kv: kv[1][0])[
                : len(_xport_cache) - _XPORT_CACHE_MAX
            ]:
                _xport_cache.pop(k, None)


def _validate_hostname(hostname: str) -> str:
    # Defense-in-depth: refuse any hostname that could be parsed as a CLI flag.
    if hostname.startswith("-"):
        raise ValueError("hostname must not start with '-'")
    if not _HOSTNAME_RE.match(hostname):
        raise HTTPException(400, "Invalid hostname format")
    return hostname


def _validate_port_identifier(port_id: str | int) -> str:
    pid = str(port_id)
    if pid.startswith("-"):
        raise ValueError("port identifier must not start with '-'")
    if not _PORT_ID_RE.match(pid):
        raise HTTPException(400, "Invalid port identifier format")
    return pid


def _validate_time(value: str, param_name: str) -> str:
    if not _TIME_RE.match(value):
        raise HTTPException(
            400,
            f"Invalid {param_name} format. Use -Ns/-Nm/-Nh/-Nd, 'now', or Unix timestamp.",
        )
    return value


def _safe_rrd_path(hostname: str, port_identifier: str | int) -> str:
    """Build RRD path with path traversal protection."""
    hostname = _validate_hostname(hostname)
    pid = _validate_port_identifier(port_identifier)
    settings = get_settings()
    base = os.path.realpath(settings.observium_rrd_path)
    path = os.path.realpath(os.path.join(base, hostname, f"port-{pid}.rrd"))
    # Ensure the resolved path is still under the RRD base directory
    if not path.startswith(base + os.sep):
        raise HTTPException(400, "Invalid path")
    return path


def _empty_series() -> dict[str, Any]:
    return {"timestamps": [], "in_bps": [], "out_bps": []}


async def _run_subprocess(cmd: list[str], timeout: int) -> subprocess.CompletedProcess:
    """Run a subprocess off-thread, gated by the concurrency semaphore."""
    async with _rrd_semaphore:
        return await asyncio.to_thread(
            subprocess.run,
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
        )


async def fetch_current(
    hostname: str, port_identifier: str | int
) -> dict[str, float]:
    """Fetch the latest data point from an RRD file."""
    path = _safe_rrd_path(hostname, port_identifier)
    if not os.path.exists(path):
        return {"in_bps": 0.0, "out_bps": 0.0}

    try:
        if HAS_RRDTOOL:
            info = await asyncio.to_thread(_rrdtool.lastupdate, path)
            ds = info.get("ds", {})
            in_bytes = float(ds.get("INOCTETS", 0) or 0)
            out_bytes = float(ds.get("OUTOCTETS", 0) or 0)
        else:
            result = await _run_subprocess(
                ["rrdtool", "lastupdate", path], timeout=10
            )
            lines = result.stdout.strip().split("\n")
            if len(lines) >= 2:
                headers = lines[0].split()
                values = lines[-1].split(":")[-1].strip().split()
                ds = dict(zip(headers, values))
                in_bytes = float(ds.get("INOCTETS", 0))
                out_bytes = float(ds.get("OUTOCTETS", 0))
            else:
                in_bytes = out_bytes = 0.0
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError) as e:
        logger.warning("rrdtool lastupdate failed for %s: %s", path, e)
        return {"in_bps": 0.0, "out_bps": 0.0}

    return {"in_bps": in_bytes * 8, "out_bps": out_bytes * 8}


async def read_xport(
    hostname: str,
    port_identifier: str | int,
    start: str = "-24h",
    end: str = "now",
    resolution: int = 300,
) -> dict[str, Any]:
    """
    Fetch historical data from an RRD file via `rrdtool xport --json`.

    Returns time series suitable for charting. On any error (timeout, missing
    binary, malformed output, OS error) returns an empty series so callers can
    render an empty graph rather than a 500.
    """
    path = _safe_rrd_path(hostname, port_identifier)
    start = _validate_time(start, "start")
    end = _validate_time(end, "end")
    if not (60 <= resolution <= 86400):
        raise HTTPException(400, "resolution must be between 60 and 86400")

    if not os.path.exists(path):
        return _empty_series()

    cache_key = (path, start, end, resolution)
    cached = _get_cached(cache_key)
    if cached is not None:
        return cached

    cmd = [
        "rrdtool",
        "xport",
        "--json",
        "--start",
        start,
        "--end",
        end,
        "--step",
        str(resolution),
        f"DEF:in={path}:INOCTETS:AVERAGE",
        f"DEF:out={path}:OUTOCTETS:AVERAGE",
        "CDEF:in_bps=in,8,*",
        "CDEF:out_bps=out,8,*",
        "XPORT:in_bps:in_bps",
        "XPORT:out_bps:out_bps",
    ]

    try:
        result = await _run_subprocess(cmd, timeout=30)
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError) as e:
        logger.warning("rrdtool xport failed for %s: %s", path, e)
        return _empty_series()

    if result.returncode != 0:
        logger.warning(
            "rrdtool xport non-zero exit for %s: %s", path, result.stderr.strip()
        )
        return _empty_series()

    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError as e:
        logger.warning("rrdtool xport produced invalid JSON for %s: %s", path, e)
        return _empty_series()

    meta = data.get("meta", {})
    start_ts = meta.get("start", 0)
    step = meta.get("step", 300)
    rows = data.get("data", [])

    timestamps: list[int] = []
    in_bps: list[float] = []
    out_bps: list[float] = []

    for i, row in enumerate(rows):
        timestamps.append(start_ts + i * step)
        in_bps.append(row[0] if row[0] is not None else 0)
        out_bps.append(row[1] if row[1] is not None else 0)

    payload = {"timestamps": timestamps, "in_bps": in_bps, "out_bps": out_bps}
    _set_cached(cache_key, payload)
    return payload


# Back-compat alias: existing callers import `fetch_history`.
fetch_history = read_xport
