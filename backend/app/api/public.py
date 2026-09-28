"""Public API endpoints for unauthenticated access to shared maps."""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import Map, Link, Node, get_db
from app.config import get_settings
from app.services import traffic

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


_PUBLIC_NODE_STYLE_KEYS = {"bg_color", "locked"}
_PUBLIC_LINK_EXTRA_KEYS = {
    "routing",
    "line_style",
    "color_override",
    "label_position",
}


def _serialize_public_node(node: Node) -> dict:
    """Build a node payload containing only explicitly public fields."""
    style = node.style or {}
    return {
        "id": node.id,
        "name": node.name,
        "label": node.label,
        "node_type": node.node_type.value,
        "x": node.x,
        "y": node.y,
        "z_order": node.z_order,
        "parent_id": node.parent_id,
        "width": node.width,
        "height": node.height,
        "icon": node.icon,
        "style": {
            key: value for key, value in style.items() if key in _PUBLIC_NODE_STYLE_KEYS
        },
        "locked": bool(node.locked),
    }


def _serialize_public_link(link: Link, settings: dict) -> dict:
    """Build a link payload containing only explicitly public fields."""
    extra = link.extra or {}
    payload: dict[str, object] = {
        "id": link.id,
        "name": link.name,
        "link_type": link.link_type.value,
        "source_id": link.source_id,
        "target_id": link.target_id,
        "source_anchor": link.source_anchor,
        "target_anchor": link.target_anchor,
        "via_points": link.via_points,
        "via_style": link.via_style,
        "width": link.width,
        "arrow_style": link.arrow_style,
        "duplex": link.duplex,
        "extra": {
            key: value for key, value in extra.items() if key in _PUBLIC_LINK_EXTRA_KEYS
        },
        "z_order": link.z_order,
    }
    if not settings.get("show_bandwidth", True):
        return payload
    payload["bandwidth"] = link.bandwidth
    payload["bandwidth_label"] = link.bandwidth_label
    return payload


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
        "nodes": [_serialize_public_node(node) for node in m.nodes],
        "links": [_serialize_public_link(link, ps) for link in m.links],
    }


# Fields of a live-traffic entry that are always safe to expose publicly.
_PUBLIC_TRAFFIC_KEYS = ("in_pct", "out_pct", "status", "updated_at")


@router.get("/maps/{token}/traffic")
async def get_public_traffic(token: str, db: AsyncSession = Depends(get_db)):
    m = await _get_public_map(token, db)
    ps = m.public_settings or {}
    show_bps = ps.get("show_bps", False)

    live = await traffic.live_traffic(m.links)
    traffic_data: dict[str, dict[str, Any]] = {}
    for link_id, entry in live.items():
        public_entry = {key: entry[key] for key in _PUBLIC_TRAFFIC_KEYS}
        if show_bps:
            public_entry["in_bps"] = entry["in_bps"]
            public_entry["out_bps"] = entry["out_bps"]
        traffic_data[link_id] = public_entry
    return traffic_data


@router.get("/maps/{token}/nodes-status")
async def get_public_nodes_status(token: str, db: AsyncSession = Depends(get_db)):
    """Node up/down status keyed by node id (no Observium device ids)."""
    m = await _get_public_map(token, db)
    return await traffic.node_statuses(m.nodes)


@router.get("/maps/{token}/links/{link_id}/history")
async def get_public_link_history(
    token: str,
    link_id: str,
    start: str = "-24h",
    end: str = "now",
    resolution: int = Query(300, ge=60, le=86400),
    db: AsyncSession = Depends(get_db),
):
    """RRD history for one link of a public map, only if show_graph is enabled.

    Same query params and response shape as the private traffic history.
    Returns 404 when graphs are disabled or the link is not on this map, so
    the endpoint does not reveal which links exist.
    """
    m = await _get_public_map(token, db)
    ps = m.public_settings or {}
    if not ps.get("show_graph", False):
        raise HTTPException(404, "Traffic history not available")
    link = next((lnk for lnk in m.links if lnk.id == link_id), None)
    if link is None:
        raise HTTPException(404, "Traffic history not available")
    return await traffic.link_history(link, start, end, resolution)
