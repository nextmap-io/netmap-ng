"""
API endpoints for fetching live traffic data and Observium topology.
"""

import logging
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.oauth import get_current_user
from app.models import Link, get_db
from app.datasources import observium, rrd

logger = logging.getLogger("netmap.datasources")
router = APIRouter(prefix="/api/datasources", tags=["datasources"])


@router.get("/observium/devices")
async def list_observium_devices(user=Depends(get_current_user)):
    """List all devices from Observium."""
    devices = await observium.get_devices()
    return devices


@router.get("/observium/devices/{device_id}/ports")
async def list_device_ports(device_id: int, user=Depends(get_current_user)):
    """List ports with current rates for a device."""
    ports = await observium.get_device_ports(device_id)
    return ports


@router.get("/observium/neighbours")
async def list_neighbours(
    device_ids: str | None = Query(None, description="Comma-separated device IDs"),
    user=Depends(get_current_user),
):
    """Fetch CDP/LLDP topology links from Observium."""
    ids = None
    if device_ids:
        try:
            ids = [int(x.strip()) for x in device_ids.split(",")]
        except ValueError:
            raise HTTPException(422, "device_ids must be comma-separated integers")
    neighbours = await observium.get_neighbours(ids)
    return neighbours


@router.get("/observium/port/{port_id}/traffic")
async def get_port_traffic(port_id: int, user=Depends(get_current_user)):
    """Get current traffic for a specific port."""
    traffic = await observium.get_port_traffic(port_id)
    return traffic or {"error": "Port not found"}


@router.get("/traffic/live")
async def get_live_traffic(
    map_id: str,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    """
    Fetch current traffic for all links in a map.
    Returns {link_id: {in_bps, out_bps, in_pct, out_pct}}.
    """
    result = await db.execute(select(Link).where(Link.map_id == map_id))
    links = result.scalars().all()

    traffic_data = {}
    for link in links:
        if link.observium_port_id_a:
            port_data = await observium.get_port_traffic(link.observium_port_id_a)
            if port_data:
                in_rate = port_data.get("ifInOctets_rate", 0) or 0
                out_rate = port_data.get("ifOutOctets_rate", 0) or 0
                in_pct = port_data.get("ifInOctets_perc", 0) or 0
                out_pct = port_data.get("ifOutOctets_perc", 0) or 0
                traffic_data[link.id] = {
                    "in_bps": float(in_rate) * 8,
                    "out_bps": float(out_rate) * 8,
                    "in_pct": float(in_pct),
                    "out_pct": float(out_pct),
                }
        if link.id not in traffic_data:
            traffic_data[link.id] = {"in_bps": 0, "out_bps": 0, "in_pct": 0, "out_pct": 0}

    return traffic_data


@router.get("/traffic/history")
async def get_traffic_history(
    hostname: str,
    port_identifier: str,
    start: str = "-24h",
    end: str = "now",
    resolution: int = Query(300, ge=60, le=86400),
    user=Depends(get_current_user),
):
    """Fetch historical traffic from RRD file for graphing."""
    data = rrd.fetch_history(hostname, port_identifier, start, end, resolution)
    return data
