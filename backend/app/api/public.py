"""Public API endpoints for unauthenticated access to shared maps."""

from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import Map, Link, get_db
from app.api.maps import _serialize_node, _serialize_link
from app.datasources import observium

from app.config import get_settings

router = APIRouter(prefix="/api/public", tags=["public"])


@router.get("/config")
async def public_config():
    """Public configuration (no auth). Tells the frontend if public index is enabled."""
    settings = get_settings()
    return {"public_index": settings.public_index}


@router.get("/maps")
async def list_public_maps(db: AsyncSession = Depends(get_db)):
    """List all public maps (no auth required). Only if PUBLIC_INDEX is enabled."""
    settings = get_settings()
    if not settings.public_index:
        raise HTTPException(403, "Public index is disabled")
    result = await db.execute(
        select(Map)
        .where(Map.visibility == "public", Map.public_token.isnot(None))
        .order_by(Map.updated_at.desc())
    )
    maps = result.scalars().all()
    return [
        {
            "id": m.id,
            "name": m.name,
            "description": m.description,
            "public_token": m.public_token,
        }
        for m in maps
    ]


async def _get_public_map(token: str, db: AsyncSession) -> Map:
    """Get a map by its public token."""
    result = await db.execute(
        select(Map)
        .options(selectinload(Map.nodes), selectinload(Map.links))
        .where(Map.public_token == token, Map.visibility == "public")
    )
    m = result.scalar_one_or_none()
    if not m:
        raise HTTPException(404, "Map not found or not public")
    return m


def _filter_node(node_dict: dict) -> dict:
    """Remove sensitive fields from node for public view."""
    for key in ["observium_device_id", "extra", "info_url"]:
        node_dict.pop(key, None)
    # Filter style: keep visual settings only
    style = node_dict.get("style") or {}
    safe_style_keys = {"bg_color", "locked"}
    node_dict["style"] = {k: v for k, v in style.items() if k in safe_style_keys}
    return node_dict


def _filter_link(link_dict: dict, settings: dict) -> dict:
    """Remove sensitive fields from link based on public_settings."""
    # Always remove internal bindings
    for key in [
        "observium_port_id_a",
        "observium_port_id_b",
        "datasource",
        "info_url_in",
        "info_url_out",
    ]:
        link_dict.pop(key, None)
    # Filter extra: keep visual settings, remove sensitive data (RRD paths)
    extra = link_dict.get("extra") or {}
    safe_keys = {"routing", "line_style", "color_override", "label_position"}
    link_dict["extra"] = {k: v for k, v in extra.items() if k in safe_keys}
    if not settings.get("show_bandwidth", True):
        link_dict.pop("bandwidth", None)
        link_dict.pop("bandwidth_label", None)
    return link_dict


@router.get("/maps/{token}")
async def get_public_map(token: str, db: AsyncSession = Depends(get_db)):
    m = await _get_public_map(token, db)
    ps = m.public_settings or {}
    return {
        "id": m.id,
        "name": m.name,
        "description": m.description,
        "width": m.width,
        "height": m.height,
        "scales": m.scales,
        "settings": {
            "kilo": m.settings.get("kilo", 1000),
            "refresh_interval": m.settings.get("refresh_interval", 300),
            "default_link_width": m.settings.get("default_link_width", 4),
            "scale_mode": m.settings.get("scale_mode"),
        },
        "nodes": [_filter_node(_serialize_node(n)) for n in m.nodes],
        "links": [_filter_link(_serialize_link(lnk), ps) for lnk in m.links],
    }


@router.get("/maps/{token}/traffic")
async def get_public_traffic(token: str, db: AsyncSession = Depends(get_db)):
    m = await _get_public_map(token, db)
    ps = m.public_settings or {}

    # Fetch live traffic
    result = await db.execute(select(Link).where(Link.map_id == m.id))
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

                entry = {"in_pct": round(in_pct, 1), "out_pct": round(out_pct, 1)}
                if ps.get("show_bps", False):
                    entry["in_bps"] = in_bps
                    entry["out_bps"] = out_bps
                traffic_data[link.id] = entry
        if link.id not in traffic_data:
            entry = {"in_pct": 0, "out_pct": 0}
            if ps.get("show_bps", False):
                entry["in_bps"] = 0
                entry["out_bps"] = 0
            traffic_data[link.id] = entry

    return traffic_data
