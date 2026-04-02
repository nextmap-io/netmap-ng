from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from pydantic import BaseModel, Field

from app.models import Map, Node, Link, get_db
from app.auth.oauth import get_current_user
from app.auth.guards import require_map_owner, require_map_read, is_editor

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
    visibility: str | None = None
    public_settings: dict | None = None


@router.get("")
async def list_maps(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    from sqlalchemy import or_

    result = await db.execute(
        select(Map)
        .where(
            or_(
                Map.owner == user.get("email", ""),
                Map.visibility.in_(["internal", "public"]),
            )
        )
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
            "updated_at": m.updated_at,
            "visibility": m.visibility,
            "owner": m.owner,
        }
        for m in maps
    ]


@router.post("")
async def create_map(
    data: MapCreate, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)
):
    if not is_editor(user):
        raise HTTPException(403, "Editor role required to create maps")
    m = Map(
        name=data.name,
        description=data.description,
        width=data.width,
        height=data.height,
        owner=user.get("email", ""),
    )
    db.add(m)
    await db.commit()
    await db.refresh(m)
    return {"id": m.id, "name": m.name}


@router.get("/{map_id}")
async def get_map(
    map_id: str, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)
):
    # Authorization check
    await require_map_read(map_id, user, db)
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
        "visibility": m.visibility,
        "public_token": m.public_token,
        "public_settings": m.public_settings,
        "owner": m.owner,
        "nodes": [_serialize_node(n) for n in m.nodes],
        "links": [_serialize_link(lnk) for lnk in m.links],
    }


@router.put("/{map_id}")
async def update_map(
    map_id: str,
    data: MapUpdate,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    # Authorization check
    await require_map_owner(map_id, user, db)
    result = await db.execute(select(Map).where(Map.id == map_id))
    m = result.scalar_one_or_none()
    if not m:
        raise HTTPException(404, "Map not found")
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(m, field, value)
    await db.commit()
    return {"ok": True}


@router.delete("/{map_id}")
async def delete_map(
    map_id: str, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)
):
    # Authorization check
    await require_map_owner(map_id, user, db)
    result = await db.execute(select(Map).where(Map.id == map_id))
    m = result.scalar_one_or_none()
    if not m:
        raise HTTPException(404, "Map not found")
    await db.delete(m)
    await db.commit()
    return {"ok": True}


@router.post("/{map_id}/share")
async def share_map(
    map_id: str, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)
):
    m = await require_map_owner(map_id, user, db)
    import uuid

    m.visibility = "public"
    if not m.public_token:
        m.public_token = str(uuid.uuid4())
    await db.commit()
    return {"public_token": m.public_token, "share_url": f"/public/{m.public_token}"}


@router.delete("/{map_id}/share")
async def unshare_map(
    map_id: str, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)
):
    m = await require_map_owner(map_id, user, db)
    m.visibility = "private"
    m.public_token = None
    await db.commit()
    return {"ok": True}


@router.post("/{map_id}/duplicate")
async def duplicate_map(
    map_id: str, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)
):
    """Duplicate a map with all its nodes and links. Requires editor role."""
    if not is_editor(user):
        raise HTTPException(403, "Editor role required to duplicate maps")

    # Load source map with nodes and links
    result = await db.execute(
        select(Map)
        .options(selectinload(Map.nodes), selectinload(Map.links))
        .where(Map.id == map_id)
    )
    source = result.scalar_one_or_none()
    if not source:
        raise HTTPException(404, "Map not found")

    # Create new map
    new_map = Map(
        name=f"{source.name} (copy)",
        description=source.description,
        width=source.width,
        height=source.height,
        scales=source.scales,
        settings=source.settings,
        owner=user.get("email", ""),
    )
    db.add(new_map)
    await db.flush()  # get new_map.id

    # Map old node IDs to new node IDs
    node_id_map: dict[str, str] = {}
    for node in source.nodes:
        new_node = Node(
            map_id=new_map.id,
            name=node.name,
            label=node.label,
            node_type=node.node_type,
            x=node.x,
            y=node.y,
            z_order=node.z_order,
            parent_id=None,  # will fix after all nodes created
            width=node.width,
            height=node.height,
            locked=node.locked,
            observium_device_id=node.observium_device_id,
            icon=node.icon,
            style=node.style,
            info_url=node.info_url,
            extra=node.extra,
        )
        db.add(new_node)
        await db.flush()
        node_id_map[node.id] = new_node.id

    # Fix parent_id references
    for node in source.nodes:
        if node.parent_id and node.parent_id in node_id_map:
            result2 = await db.execute(
                select(Node).where(Node.id == node_id_map[node.id])
            )
            new_node = result2.scalar_one()
            new_node.parent_id = node_id_map[node.parent_id]

    # Duplicate links with remapped node IDs
    for link in source.links:
        new_source_id = node_id_map.get(link.source_id)
        new_target_id = node_id_map.get(link.target_id)
        if not new_source_id or not new_target_id:
            continue
        new_link = Link(
            map_id=new_map.id,
            name=link.name,
            link_type=link.link_type,
            source_id=new_source_id,
            target_id=new_target_id,
            source_anchor=link.source_anchor,
            target_anchor=link.target_anchor,
            bandwidth=link.bandwidth,
            bandwidth_label=link.bandwidth_label,
            via_points=link.via_points,
            via_style=link.via_style,
            width=link.width,
            arrow_style=link.arrow_style,
            duplex=link.duplex,
            datasource=link.datasource,
            observium_port_id_a=link.observium_port_id_a,
            observium_port_id_b=link.observium_port_id_b,
            info_url_in=link.info_url_in,
            info_url_out=link.info_url_out,
            extra=link.extra,
            z_order=link.z_order,
        )
        db.add(new_link)

    await db.commit()
    return {"id": new_map.id, "name": new_map.name}


def _serialize_node(n: Node) -> dict:
    return {
        "id": n.id,
        "name": n.name,
        "label": n.label,
        "node_type": n.node_type.value,
        "x": n.x,
        "y": n.y,
        "z_order": n.z_order,
        "parent_id": n.parent_id,
        "width": n.width,
        "height": n.height,
        "observium_device_id": n.observium_device_id,
        "icon": n.icon,
        "style": n.style,
        "info_url": n.info_url,
        "extra": n.extra,
    }


def _serialize_link(lnk: Link) -> dict:
    return {
        "id": lnk.id,
        "name": lnk.name,
        "link_type": lnk.link_type.value,
        "source_id": lnk.source_id,
        "target_id": lnk.target_id,
        "source_anchor": lnk.source_anchor,
        "target_anchor": lnk.target_anchor,
        "bandwidth": lnk.bandwidth,
        "bandwidth_label": lnk.bandwidth_label,
        "via_points": lnk.via_points,
        "via_style": lnk.via_style,
        "width": lnk.width,
        "arrow_style": lnk.arrow_style,
        "duplex": lnk.duplex,
        "datasource": lnk.datasource,
        "observium_port_id_a": lnk.observium_port_id_a,
        "observium_port_id_b": lnk.observium_port_id_b,
        "info_url_in": lnk.info_url_in,
        "info_url_out": lnk.info_url_out,
        "extra": lnk.extra,
        "z_order": lnk.z_order,
    }
