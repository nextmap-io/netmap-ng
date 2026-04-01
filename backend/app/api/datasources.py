"""
API endpoints for fetching live traffic data and Observium topology.
Observium endpoints require editor role (not exposed to viewers).
Traffic endpoints require map read access.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.oauth import get_current_user
from app.auth.guards import require_editor, require_map_read
from app.models import Link, get_db
from app.datasources import observium, rrd

logger = logging.getLogger("netmap.datasources")
router = APIRouter(prefix="/api/datasources", tags=["datasources"])


# ── Observium endpoints (editor-only, not exposed to viewers) ──


@router.get("/observium/devices")
async def list_observium_devices(user=Depends(require_editor)):
    """List all devices from Observium. Requires editor role."""
    devices = await observium.get_devices()
    return devices


@router.get("/observium/devices/{device_id}/ports")
async def list_device_ports(device_id: int, user=Depends(require_editor)):
    """List ports with current rates for a device. Requires editor role."""
    ports = await observium.get_device_ports(device_id)
    return ports


@router.get("/observium/neighbours")
async def list_neighbours(
    device_ids: str | None = Query(None, description="Comma-separated device IDs"),
    user=Depends(require_editor),
):
    """Fetch CDP/LLDP topology links from Observium. Requires editor role."""
    ids = None
    if device_ids:
        try:
            ids = [int(x.strip()) for x in device_ids.split(",")]
        except ValueError:
            raise HTTPException(422, "device_ids must be comma-separated integers")
    neighbours = await observium.get_neighbours(ids)
    return neighbours


@router.get("/observium/port/{port_id}/traffic")
async def get_port_traffic(port_id: int, user=Depends(require_editor)):
    """Get current traffic for a specific port. Requires editor role."""
    traffic = await observium.get_port_traffic(port_id)
    return traffic or {"error": "Port not found"}


# ── Traffic endpoints (map-scoped, read access required) ──


@router.get("/traffic/live")
async def get_live_traffic(
    map_id: str,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    """
    Fetch current traffic for all links in a map.
    Requires read access to the map.
    """
    await require_map_read(map_id, user, db)
    result = await db.execute(select(Link).where(Link.map_id == map_id))
    links = result.scalars().all()

    traffic_data = {}
    for link in links:
        if link.observium_port_id_a:
            port_data = await observium.get_port_traffic(link.observium_port_id_a)
            if port_data:
                in_rate = port_data.get("ifInOctets_rate", 0) or 0
                out_rate = port_data.get("ifOutOctets_rate", 0) or 0
                in_bps = float(in_rate) * 8
                out_bps = float(out_rate) * 8
                bw = link.bandwidth if link.bandwidth and link.bandwidth > 0 else 1e9
                in_pct = min(100.0, (in_bps / bw) * 100)
                out_pct = min(100.0, (out_bps / bw) * 100)
                traffic_data[link.id] = {
                    "in_bps": in_bps,
                    "out_bps": out_bps,
                    "in_pct": round(in_pct, 1),
                    "out_pct": round(out_pct, 1),
                }
        if link.id not in traffic_data:
            traffic_data[link.id] = {
                "in_bps": 0,
                "out_bps": 0,
                "in_pct": 0,
                "out_pct": 0,
            }

    return traffic_data


@router.get("/traffic/history")
async def get_traffic_history(
    hostname: str,
    port_identifier: str,
    map_id: str = Query(..., description="Map ID for authorization"),
    start: str = "-24h",
    end: str = "now",
    resolution: int = Query(300, ge=60, le=86400),
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    """Fetch historical traffic from RRD file. Requires map read access."""
    # Verify user has access to this map
    m = await require_map_read(map_id, user, db)

    # Verify the hostname/port actually belongs to a link in this map
    result = await db.execute(select(Link).where(Link.map_id == map_id))
    links = result.scalars().all()
    link_found = False
    for link in links:
        extra = link.extra or {}
        if extra.get("hostname") == hostname and str(
            extra.get("port_identifier")
        ) == str(port_identifier):
            link_found = True
            break
    if not link_found:
        raise HTTPException(403, "This data source is not part of the specified map")

    # Admins and editors always have graph access
    # Only restrict for viewers who are not the owner
    from app.auth.guards import is_admin, is_editor

    if not is_admin(user) and not is_editor(user) and m.owner != user.get("email"):
        ps = m.public_settings or {}
        if not ps.get("show_graph", False):
            raise HTTPException(403, "Traffic history is not available for this map")

    data = rrd.fetch_history(hostname, port_identifier, start, end, resolution)
    return data
