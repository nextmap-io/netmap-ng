"""
Read RRD files (Observium format) for historical traffic data.
Uses rrdtool Python bindings or falls back to subprocess.
"""

import asyncio
import json
import logging
import math
import os
import re
import subprocess
from typing import Any

from fastapi import HTTPException
from app.config import get_settings

logger = logging.getLogger("netmap.rrd")

# Max wall time for one `rrdtool xport` run; the process is killed past this.
RRD_TIMEOUT_SECONDS = 30.0

try:
    import rrdtool as _rrdtool

    HAS_RRDTOOL = True
except ImportError:
    HAS_RRDTOOL = False

# Strict validation patterns
_HOSTNAME_RE = re.compile(r"^[a-zA-Z0-9._-]+$")
_PORT_ID_RE = re.compile(r"^[a-zA-Z0-9_-]+$")
_TIME_RE = re.compile(r"^(-\d{1,5}[smhdwMy]|now|\d{9,10})$")


def _validate_hostname(hostname: str) -> str:
    if not _HOSTNAME_RE.match(hostname):
        raise HTTPException(400, "Invalid hostname format")
    return hostname


def _validate_port_identifier(port_id: str | int) -> str:
    pid = str(port_id)
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


def fetch_current(hostname: str, port_identifier: str | int) -> dict[str, float]:
    """Fetch the latest data point from an RRD file."""
    path = _safe_rrd_path(hostname, port_identifier)
    if not os.path.exists(path):
        return {"in_bps": 0.0, "out_bps": 0.0}

    if HAS_RRDTOOL:
        info = _rrdtool.lastupdate(path)
        ds = info.get("ds", {})
        in_bytes = ds.get("INOCTETS", 0) or 0
        out_bytes = ds.get("OUTOCTETS", 0) or 0
    else:
        result = subprocess.run(
            ["rrdtool", "lastupdate", path],
            capture_output=True,
            text=True,
            timeout=10,
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

    return {"in_bps": in_bytes * 8, "out_bps": out_bytes * 8}


def _empty_history() -> dict[str, list[Any]]:
    return {"timestamps": [], "in_bps": [], "out_bps": []}


def _point(value: Any) -> float | None:
    """RRD gaps (null / NaN / non-numeric) become None, not 0."""
    if value is None:
        return None
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


# Cap concurrent rrdtool processes: history is reachable from public maps
# (show_graph), and each xport can run for up to RRD_TIMEOUT_SECONDS.
_RRDTOOL_CONCURRENCY = asyncio.Semaphore(4)


async def _run_rrdtool(cmd: list[str]) -> str | None:
    """Run rrdtool without blocking the event loop; None on failure/timeout."""
    async with _RRDTOOL_CONCURRENCY:
        return await _run_rrdtool_unbounded(cmd)


async def _run_rrdtool_unbounded(cmd: list[str]) -> str | None:
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    except OSError:
        logger.exception("Failed to start rrdtool")
        return None
    try:
        stdout, stderr = await asyncio.wait_for(
            proc.communicate(), timeout=RRD_TIMEOUT_SECONDS
        )
    except asyncio.TimeoutError:
        logger.warning("rrdtool xport timed out after %ss", RRD_TIMEOUT_SECONDS)
        try:
            proc.kill()
        except ProcessLookupError:
            pass
        await proc.wait()
        return None
    if proc.returncode != 0:
        logger.warning(
            "rrdtool xport failed (%s): %s",
            proc.returncode,
            stderr.decode(errors="replace")[:500],
        )
        return None
    return stdout.decode(errors="replace")


async def fetch_history(
    hostname: str,
    port_identifier: str | int,
    start: str = "-24h",
    end: str = "now",
    resolution: int = 300,
) -> dict[str, Any]:
    """
    Fetch historical data from an RRD file.
    Returns time series suitable for charting; gaps are ``None``.
    """
    path = _safe_rrd_path(hostname, port_identifier)
    start = _validate_time(start, "start")
    end = _validate_time(end, "end")
    if not (60 <= resolution <= 86400):
        raise HTTPException(400, "resolution must be between 60 and 86400")

    if not os.path.exists(path):
        return _empty_history()

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

    output = await _run_rrdtool(cmd)
    if output is None:
        return _empty_history()
    try:
        # json.loads accepts the bare NaN literals some rrdtool builds emit.
        data = json.loads(output)
    except ValueError:
        logger.warning("rrdtool xport returned invalid JSON")
        return _empty_history()

    meta = data.get("meta", {})
    start_ts = meta.get("start", 0)
    step = meta.get("step", 300)
    rows = data.get("data", [])

    timestamps: list[int] = []
    in_bps: list[float | None] = []
    out_bps: list[float | None] = []

    for i, row in enumerate(rows):
        row = row if isinstance(row, list) else []
        timestamps.append(start_ts + i * step)
        in_bps.append(_point(row[0]) if len(row) > 0 else None)
        out_bps.append(_point(row[1]) if len(row) > 1 else None)

    return {"timestamps": timestamps, "in_bps": in_bps, "out_bps": out_bps}
