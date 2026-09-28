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
from app.models import Link, Node, get_db
from app.datasources import observium, rrd
from app.services import traffic

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
    Fetch current traffic and status for all links in a map.
    Requires read access to the map.
    """
    await require_map_read(map_id, user, db)
    result = await db.execute(select(Link).where(Link.map_id == map_id))
    return await traffic.live_traffic(result.scalars().all())


@router.get("/traffic/nodes")
async def get_nodes_status(
    map_id: str,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    """
    Up/down status of every node bound to an Observium device.
    Requires read access to the map.
    """
    await require_map_read(map_id, user, db)
    result = await db.execute(select(Node).where(Node.map_id == map_id))
    return await traffic.node_statuses(result.scalars().all())


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
    """Fetch historical traffic from RRD file. Requires map read access.

    ``public_settings.show_graph`` only gates the public (unauthenticated)
    endpoint; anyone who can read the map may read its links' history.
    """
    await require_map_read(map_id, user, db)

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

    return await rrd.fetch_history(hostname, port_identifier, start, end, resolution)


@router.get("/traffic/history/by-port")
async def get_traffic_history_by_port(
    port_id: int,
    map_id: str = Query(..., description="Map ID for authorization"),
    start: str = "-24h",
    end: str = "now",
    resolution: int = Query(300, ge=60, le=86400),
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    """
    Fetch historical traffic from RRD file using an Observium port ID.
    Resolves hostname and port_identifier automatically from Observium.
    Requires map read access (``show_graph`` only gates the public endpoint).
    """
    await require_map_read(map_id, user, db)

    # Verify this port_id belongs to a link in this map
    result = await db.execute(select(Link).where(Link.map_id == map_id))
    links = result.scalars().all()
    link_found = any(
        link.observium_port_id_a == port_id or link.observium_port_id_b == port_id
        for link in links
    )
    if not link_found:
        raise HTTPException(
            403, "This port is not bound to any link in the specified map"
        )

    data = await traffic.port_history(port_id, start, end, resolution)
    return data if data is not None else traffic.empty_history()
