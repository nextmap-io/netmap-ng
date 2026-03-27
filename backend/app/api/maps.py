from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from pydantic import BaseModel, Field

from app.models import Map, Node, Link, get_db
from app.auth.oauth import get_current_user

router = APIRouter(prefix="/api/maps", tags=["maps"])


class MapCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    description: str = Field("", max_length=2000)
    width: int = Field(1920, ge=100, le=10000)
    height: int = Field(1080, ge=100, le=10000)


class MapUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=255)
    description: str | None = Field(None, max_length=2000)
    width: int | None = Field(None, ge=100, le=10000)
    height: int | None = Field(None, ge=100, le=10000)
    scales: dict | None = None
    settings: dict | None = None


@router.get("")
async def list_maps(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    result = await db.execute(
        select(Map).order_by(Map.updated_at.desc()).limit(limit).offset(offset)
    )
    maps = result.scalars().all()
    return [{"id": m.id, "name": m.name, "description": m.description, "updated_at": m.updated_at} for m in maps]


@router.post("")
async def create_map(data: MapCreate, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    m = Map(name=data.name, description=data.description, width=data.width, height=data.height, owner=user.get("email", ""))
    db.add(m)
    await db.commit()
    await db.refresh(m)
    return {"id": m.id, "name": m.name}


@router.get("/{map_id}")
async def get_map(map_id: str, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    result = await db.execute(
        select(Map)
        .options(selectinload(Map.nodes), selectinload(Map.links))
        .where(Map.id == map_id)
    )
    m = result.scalar_one_or_none()
    if not m:
        raise HTTPException(404, "Map not found")
    return {
        "id": m.id,
        "name": m.name,
        "description": m.description,
        "width": m.width,
        "height": m.height,
        "scales": m.scales,
        "settings": m.settings,
        "nodes": [_serialize_node(n) for n in m.nodes],
        "links": [_serialize_link(l) for l in m.links],
    }


@router.put("/{map_id}")
async def update_map(map_id: str, data: MapUpdate, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    result = await db.execute(select(Map).where(Map.id == map_id))
    m = result.scalar_one_or_none()
    if not m:
        raise HTTPException(404, "Map not found")
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(m, field, value)
    await db.commit()
    return {"ok": True}


@router.delete("/{map_id}")
async def delete_map(map_id: str, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    result = await db.execute(select(Map).where(Map.id == map_id))
    m = result.scalar_one_or_none()
    if not m:
        raise HTTPException(404, "Map not found")
    await db.delete(m)
    await db.commit()
    return {"ok": True}


def _serialize_node(n: Node) -> dict:
    return {
        "id": n.id, "name": n.name, "label": n.label, "node_type": n.node_type.value,
        "x": n.x, "y": n.y, "z_order": n.z_order, "parent_id": n.parent_id,
        "width": n.width, "height": n.height,
        "observium_device_id": n.observium_device_id,
        "icon": n.icon, "style": n.style, "info_url": n.info_url, "metadata": n.metadata,
    }


def _serialize_link(l: Link) -> dict:
    return {
        "id": l.id, "name": l.name, "link_type": l.link_type.value,
        "source_id": l.source_id, "target_id": l.target_id,
        "source_anchor": l.source_anchor, "target_anchor": l.target_anchor,
        "bandwidth": l.bandwidth, "bandwidth_label": l.bandwidth_label,
        "via_points": l.via_points, "via_style": l.via_style,
        "width": l.width, "arrow_style": l.arrow_style, "duplex": l.duplex,
        "datasource": l.datasource,
        "observium_port_id_a": l.observium_port_id_a, "observium_port_id_b": l.observium_port_id_b,
        "info_url_in": l.info_url_in, "info_url_out": l.info_url_out,
        "metadata": l.metadata, "z_order": l.z_order,
    }
