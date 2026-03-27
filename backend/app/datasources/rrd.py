"""
Read RRD files (Observium format) for historical traffic data.
Uses rrdtool Python bindings or falls back to subprocess.
"""

import os
import re
import subprocess
import json
from typing import Any
from fastapi import HTTPException
from app.config import get_settings

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
        raise HTTPException(400, f"Invalid {param_name} format. Use -Ns/-Nm/-Nh/-Nd, 'now', or Unix timestamp.")
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
            capture_output=True, text=True, timeout=10,
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


def fetch_history(
    hostname: str,
    port_identifier: str | int,
    start: str = "-24h",
    end: str = "now",
    resolution: int = 300,
) -> dict[str, Any]:
    """
    Fetch historical data from an RRD file.
    Returns time series suitable for charting.
    """
    path = _safe_rrd_path(hostname, port_identifier)
    start = _validate_time(start, "start")
    end = _validate_time(end, "end")
    if not (60 <= resolution <= 86400):
        raise HTTPException(400, "resolution must be between 60 and 86400")

    if not os.path.exists(path):
        return {"timestamps": [], "in_bps": [], "out_bps": []}

    cmd = [
        "rrdtool", "xport", "--json",
        "--start", start,
        "--end", end,
        "--step", str(resolution),
        f"DEF:in={path}:INOCTETS:AVERAGE",
        f"DEF:out={path}:OUTOCTETS:AVERAGE",
        "CDEF:in_bps=in,8,*",
        "CDEF:out_bps=out,8,*",
        "XPORT:in_bps:in_bps",
        "XPORT:out_bps:out_bps",
    ]

    result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    if result.returncode != 0:
        return {"timestamps": [], "in_bps": [], "out_bps": []}

    data = json.loads(result.stdout)
    meta = data.get("meta", {})
    start_ts = meta.get("start", 0)
    step = meta.get("step", 300)
    rows = data.get("data", [])

    timestamps = []
    in_bps = []
    out_bps = []

    for i, row in enumerate(rows):
        timestamps.append(start_ts + i * step)
        in_bps.append(row[0] if row[0] is not None else 0)
        out_bps.append(row[1] if row[1] is not None else 0)

    return {"timestamps": timestamps, "in_bps": in_bps, "out_bps": out_bps}
