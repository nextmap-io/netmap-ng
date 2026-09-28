"""Live traffic / status computation shared by private and public endpoints.

A link is bound to up to two Observium ports: side A (primary) and side B
(fallback, the far end of the same circuit). Rates are always expressed from
side A's point of view, so when only side B has data its in/out are swapped
(what B receives is what A sends).
"""

import time
from collections.abc import Iterable, Mapping
from typing import Any, Literal

from app.datasources import observium, rrd
from app.models import Link, Node

LinkStatus = Literal["ok", "down", "admin_down", "nodata", "unbound", "stale"]
NodeStatus = Literal["up", "down", "unknown"]

# A port whose last poll is older than this is reported as "stale".
STALE_AFTER_SECONDS = 15 * 60
DEFAULT_BANDWIDTH_BPS = 1e9

# ifOperStatus values that do not mean "down" (unknown is treated as not-down).
_NOT_DOWN_OPER = {"up", "unknown"}


def link_port_ids(links: Iterable[Link]) -> list[int]:
    """All Observium port ids (A and B) bound to the given links."""
    ids: list[int] = []
    for link in links:
        if link.observium_port_id_a:
            ids.append(link.observium_port_id_a)
        if link.observium_port_id_b:
            ids.append(link.observium_port_id_b)
    return ids


def _num(value: Any) -> float:
    """Coerce a DB value to a finite float, treating junk/None as 0."""
    try:
        f = float(value)
    except (TypeError, ValueError):
        return 0.0
    if f != f or f in (float("inf"), float("-inf")):
        return 0.0
    return f


def _poll_time(row: Mapping[str, Any]) -> int | None:
    try:
        ts = int(row.get("poll_time") or 0)
    except (TypeError, ValueError):
        return None
    return ts if ts > 0 else None


def _status_str(value: Any) -> str:
    return str(value).strip().lower() if value is not None else ""


def _link_bandwidth(link: Link, row: Mapping[str, Any]) -> float:
    if link.bandwidth and link.bandwidth > 0:
        return float(link.bandwidth)
    high_speed = _num(row.get("ifHighSpeed"))
    if high_speed > 0:
        return high_speed * 1e6
    speed = _num(row.get("ifSpeed"))
    if speed > 0:
        return speed
    return DEFAULT_BANDWIDTH_BPS


def _port_status(row: Mapping[str, Any], now: float) -> LinkStatus:
    if _status_str(row.get("ifAdminStatus")) == "down":
        return "admin_down"
    oper = _status_str(row.get("ifOperStatus"))
    if oper and oper not in _NOT_DOWN_OPER:
        return "down"
    polled = _poll_time(row)
    if polled is not None and now - polled > STALE_AFTER_SECONDS:
        return "stale"
    return "ok"


def compute_link_traffic(
    link: Link,
    ports: Mapping[int, Mapping[str, Any]],
    now: float | None = None,
) -> dict[str, Any]:
    """Build the live-traffic entry for one link.

    Returns ``in_bps``, ``out_bps``, ``in_pct``, ``out_pct`` (from side A's
    point of view), ``status`` and ``updated_at`` (unix seconds of the chosen
    port's last poll, or ``None``).
    """
    if now is None:
        now = time.time()
    entry: dict[str, Any] = {
        "in_bps": 0,
        "out_bps": 0,
        "in_pct": 0,
        "out_pct": 0,
        "status": "unbound",
        "updated_at": None,
    }
    port_a = link.observium_port_id_a
    port_b = link.observium_port_id_b
    if not port_a and not port_b:
        return entry

    row: Mapping[str, Any] | None = None
    swap = False
    if port_a and ports.get(port_a):
        row = ports[port_a]
    elif port_b and ports.get(port_b):
        row = ports[port_b]
        swap = True
    if row is None:
        entry["status"] = "nodata"
        return entry

    in_bps = _num(row.get("ifInOctets_rate")) * 8
    out_bps = _num(row.get("ifOutOctets_rate")) * 8
    if swap:
        in_bps, out_bps = out_bps, in_bps
    bw = _link_bandwidth(link, row)
    entry.update(
        {
            "in_bps": in_bps,
            "out_bps": out_bps,
            "in_pct": round(min(100.0, (in_bps / bw) * 100), 1),
            "out_pct": round(min(100.0, (out_bps / bw) * 100), 1),
            "status": _port_status(row, now),
            "updated_at": _poll_time(row),
        }
    )
    return entry


async def live_traffic(links: Iterable[Link]) -> dict[str, dict[str, Any]]:
    """Live traffic entries for many links with one (cached) Observium query."""
    links = list(links)
    ports = await observium.get_ports_traffic(link_port_ids(links))
    now = time.time()
    return {link.id: compute_link_traffic(link, ports, now) for link in links}


def compute_node_status(row: Mapping[str, Any] | None) -> NodeStatus:
    """Map an Observium ``devices`` row to up/down/unknown."""
    if not row:
        return "unknown"
    if _num(row.get("disabled")) or _num(row.get("ignore")):
        return "unknown"
    status = row.get("status")
    if status is None:
        return "unknown"
    try:
        value = int(status)
    except (TypeError, ValueError):
        return "unknown"
    if value == 1:
        return "up"
    if value == 0:
        return "down"
    return "unknown"


async def node_statuses(nodes: Iterable[Node]) -> dict[str, dict[str, NodeStatus]]:
    """Status of every node bound to an Observium device (one batched query)."""
    bound = [node for node in nodes if node.observium_device_id]
    devices = await observium.get_devices_status(
        [node.observium_device_id for node in bound if node.observium_device_id]
    )
    return {
        node.id: {"status": compute_node_status(devices.get(node.observium_device_id))}
        for node in bound
        if node.observium_device_id
    }


def empty_history() -> dict[str, list[Any]]:
    return {"timestamps": [], "in_bps": [], "out_bps": []}


async def port_history(
    port_id: int, start: str, end: str, resolution: int
) -> dict[str, Any] | None:
    """RRD history for one Observium port, or ``None`` if the port is unknown."""
    port_info = await observium.get_port_rrd_info(port_id)
    if not port_info:
        return None
    # Observium names port RRD files `port-{ifIndex}.rrd` per device.
    hostname = port_info["hostname"]
    port_identifier = str(port_info.get("ifIndex") or port_info["port_id"])
    return await rrd.fetch_history(hostname, port_identifier, start, end, resolution)


async def link_history(
    link: Link, start: str, end: str, resolution: int
) -> dict[str, Any]:
    """RRD history for a link: side A first, falling back to side B.

    Side B's series are swapped so the result is always from A's viewpoint.
    """
    for port_id, swap in (
        (link.observium_port_id_a, False),
        (link.observium_port_id_b, True),
    ):
        if not port_id:
            continue
        data = await port_history(port_id, start, end, resolution)
        if not data or not data.get("timestamps"):
            continue
        if swap:
            data = {**data, "in_bps": data["out_bps"], "out_bps": data["in_bps"]}
        return data
    return empty_history()
