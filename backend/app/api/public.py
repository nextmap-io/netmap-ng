"""Public API endpoints for unauthenticated access to shared maps."""

from __future__ import annotations

import hashlib
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.maps import _serialize_link, _serialize_node
from app.config import get_settings
from app.datasources import observium
from app.models import Link, Map, get_db

router = APIRouter(prefix="/api/public", tags=["public"])


# Allow-list of fields we are willing to expose in the public payload.
# Anything not listed here is dropped — adding a new sensitive field to the
# model can never accidentally leak.
_PUBLIC_NODE_FIELDS: frozenset[str] = frozenset(
    {
        "id",
        "name",
        "label",
        "node_type",
        "x",
        "y",
        "z_order",
        "parent_id",
        "width",
        "height",
        "icon",
        "style",
        "locked",
    }
)

_PUBLIC_LINK_FIELDS: frozenset[str] = frozenset(
    {
        "id",
        "name",
        "link_type",
        "source_id",
        "target_id",
        "source_anchor",
        "target_anchor",
        "bandwidth",
        "bandwidth_label",
        "via_points",
        "via_style",
        "width",
        "arrow_style",
        "duplex",
        "z_order",
        "extra",
    }
)

# Visual-only sub-keys allowed inside `node.style` / `link.extra` for public maps.
_PUBLIC_NODE_STYLE_KEYS: frozenset[str] = frozenset(
    {"bg_color", "border_color", "text_color", "font_size", "opacity", "rotation"}
)

_PUBLIC_LINK_EXTRA_KEYS: frozenset[str] = frozenset(
    {"routing", "line_style", "color_override", "label_position"}
)


def _redact_name(value: str) -> str:
    """Stable opaque label, used when public_settings.show_node_names is false."""
    if not value:
        return ""
    digest = hashlib.sha256(value.encode("utf-8")).hexdigest()[:6]
    return f"node-{digest}"


def _filter_node(node_dict: dict[str, Any], settings: dict[str, Any]) -> dict[str, Any]:
    """Project node fields through the allow-list and redact based on settings."""
    out: dict[str, Any] = {
        k: v for k, v in node_dict.items() if k in _PUBLIC_NODE_FIELDS
    }

    style = out.get("style") or {}
    out["style"] = {k: v for k, v in style.items() if k in _PUBLIC_NODE_STYLE_KEYS}

    show_names = bool(settings.get("show_node_names", False))
    if not show_names:
        # Replace the human-readable name; expose only the visual label.
        original_name = out.get("name", "")
        out["name"] = _redact_name(original_name)
        # Label is purely visual — preserve unless explicitly stripped later.
    return out


def _filter_link(link_dict: dict[str, Any], settings: dict[str, Any]) -> dict[str, Any]:
    """Project link fields through the allow-list and apply public_settings toggles."""
    out: dict[str, Any] = {
        k: v for k, v in link_dict.items() if k in _PUBLIC_LINK_FIELDS
    }

    extra = out.get("extra") or {}
    out["extra"] = {k: v for k, v in extra.items() if k in _PUBLIC_LINK_EXTRA_KEYS}

    if not settings.get("show_bandwidth", True):
        out.pop("bandwidth", None)
        out.pop("bandwidth_label", None)
    return out


@router.get("/config")
async def public_config() -> dict[str, Any]:
    """Public configuration (no auth). Tells the frontend if public index is enabled."""
    settings = get_settings()
    return {"public_index": settings.public_index}


@router.get("/maps")
async def list_public_maps(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    """List all public maps (no auth). Only if PUBLIC_INDEX is enabled."""
    settings = get_settings()
    if not settings.public_index:
        raise HTTPException(403, "Public index is disabled")
    result = await db.execute(
        select(Map)
        .where(Map.visibility == "public", Map.public_token.isnot(None))
        .order_by(Map.updated_at.desc())
        .limit(limit)
        .offset(offset)
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


@router.get("/maps/{token}")
async def get_public_map(
    token: str, db: AsyncSession = Depends(get_db)
) -> dict[str, Any]:
    m = await _get_public_map(token, db)
    ps: dict[str, Any] = m.public_settings or {}

    # Map-level fields gated by show_description.
    show_description = bool(ps.get("show_description", False))
    settings_obj = m.settings or {}
    return {
        "id": m.id,
        "name": m.name,
        "description": m.description if show_description else "",
        "width": m.width,
        "height": m.height,
        "scales": m.scales,
        "settings": {
            "kilo": settings_obj.get("kilo", 1000),
            "refresh_interval": settings_obj.get("refresh_interval", 300),
            "default_link_width": settings_obj.get("default_link_width", 4),
            "scale_mode": settings_obj.get("scale_mode"),
        },
        "nodes": [_filter_node(_serialize_node(n), ps) for n in m.nodes],
        "links": [_filter_link(_serialize_link(lnk), ps) for lnk in m.links],
    }


@router.get("/maps/{token}/traffic")
async def get_public_traffic(
    token: str, db: AsyncSession = Depends(get_db)
) -> dict[str, dict[str, Any]]:
    m = await _get_public_map(token, db)
    ps: dict[str, Any] = m.public_settings or {}

    if not ps.get("show_traffic", True):
        return {}

    result = await db.execute(select(Link).where(Link.map_id == m.id))
    links = result.scalars().all()

    traffic_data: dict[str, dict[str, Any]] = {}
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

                entry: dict[str, Any] = {
                    "in_pct": round(in_pct, 1),
                    "out_pct": round(out_pct, 1),
                }
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
