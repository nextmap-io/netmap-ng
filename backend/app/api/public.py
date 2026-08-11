"""Public API endpoints for unauthenticated access to shared maps."""

from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import Map, Link, Node, get_db
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
    payload = {
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


@router.get("/maps/{token}/traffic")
async def get_public_traffic(token: str, db: AsyncSession = Depends(get_db)):
    m = await _get_public_map(token, db)
    ps = m.public_settings or {}

    # Fetch live traffic
    result = await db.execute(select(Link).where(Link.map_id == m.id))
    links = result.scalars().all()

    # Collect every port id needed (primary A + fallback B) and fetch in one
    # batched query instead of one round-trip per link (avoids N+1).
    port_ids: list[int] = []
    for link in links:
        if link.observium_port_id_a:
            port_ids.append(link.observium_port_id_a)
        if link.observium_port_id_b:
            port_ids.append(link.observium_port_id_b)
    ports_traffic = await observium.get_ports_traffic(port_ids)

    show_bps = ps.get("show_bps", False)
    traffic_data: dict[str, dict[str, float]] = {}
    for link in links:
        entry: dict[str, float] | None = None
        # Primary side A wins; only fall back to side B when A yields no data.
        for port_id in (link.observium_port_id_a, link.observium_port_id_b):
            if not port_id:
                continue
            port_data = ports_traffic.get(port_id)
            if not port_data:
                continue
            in_rate = port_data.get("ifInOctets_rate", 0) or 0
            out_rate = port_data.get("ifOutOctets_rate", 0) or 0
            in_bps = float(in_rate) * 8
            out_bps = float(out_rate) * 8
            bw = link.bandwidth if link.bandwidth and link.bandwidth > 0 else 1e9
            in_pct = min(100.0, (in_bps / bw) * 100)
            out_pct = min(100.0, (out_bps / bw) * 100)
            entry = {"in_pct": round(in_pct, 1), "out_pct": round(out_pct, 1)}
            if show_bps:
                entry["in_bps"] = in_bps
                entry["out_bps"] = out_bps
            break
        if entry is None:
            entry = {"in_pct": 0, "out_pct": 0}
            if show_bps:
                entry["in_bps"] = 0
                entry["out_bps"] = 0
        traffic_data[link.id] = entry

    return traffic_data
