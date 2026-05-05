from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.guards import is_admin, is_editor, require_map_owner, require_map_read
from app.auth.oauth import get_current_user
from app.models import Link, Map, Node, get_db

router = APIRouter(prefix="/api/maps", tags=["maps"])


# ──────────────────────────── Request schemas ────────────────────────────


class Scale(BaseModel):
    """A single band of the traffic colour scale."""

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, max_length=64)
    label: str | None = Field(default=None, max_length=64)
    min: float = Field(..., ge=0, le=1000)
    max: float = Field(..., ge=0, le=1000)
    color: str = Field(..., pattern=r"^#[0-9a-fA-F]{6}$")


class PublicSettings(BaseModel):
    """Filtering toggles applied when serving a map publicly."""

    model_config = ConfigDict(extra="forbid")

    show_bps: bool = False
    show_bandwidth: bool = True
    show_percentage: bool = True
    show_traffic: bool = True
    show_graph: bool = False
    show_node_names: bool = False
    show_description: bool = False


class MapSettingsModel(BaseModel):
    """Generic per-map settings — kept loose because it grows over time."""

    model_config = ConfigDict(extra="forbid")

    kilo: int | None = Field(default=None, ge=1)
    refresh_interval: int | None = Field(default=None, ge=10, le=86400)
    default_link_width: int | None = Field(default=None, ge=1, le=50)
    scale_mode: Literal["steps", "gradient"] | None = None


class MapCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(..., min_length=1, max_length=255)
    description: str = Field("", max_length=2000)
    width: int = Field(1920, ge=100, le=10000)
    height: int = Field(1080, ge=100, le=10000)


class MapUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(None, min_length=1, max_length=255)
    description: str | None = Field(None, max_length=2000)
    width: int | None = Field(None, ge=100, le=10000)
    height: int | None = Field(None, ge=100, le=10000)
    scales: dict[str, list[Scale]] | None = None
    settings: MapSettingsModel | None = None
    visibility: Literal["private", "internal"] | None = None
    public_settings: PublicSettings | None = None


# ──────────────────────────── Response schemas ────────────────────────────


class NodeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    label: str
    node_type: str
    x: float
    y: float
    z_order: int
    parent_id: str | None
    width: float | None
    height: float | None
    locked: bool
    observium_device_id: int | None
    icon: str | None
    style: dict[str, Any]
    info_url: str | None
    extra: dict[str, Any]


class LinkOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    link_type: str
    source_id: str
    target_id: str
    source_anchor: str | None
    target_anchor: str | None
    bandwidth: float
    bandwidth_label: str
    via_points: list[dict[str, Any]]
    via_style: str
    width: int
    arrow_style: str
    duplex: str
    datasource: dict[str, Any]
    observium_port_id_a: int | None
    observium_port_id_b: int | None
    info_url_in: str | None
    info_url_out: str | None
    extra: dict[str, Any]
    z_order: int


class MapOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    description: str
    width: int
    height: int
    scales: dict[str, Any]
    settings: dict[str, Any]
    visibility: str
    public_token: str | None
    public_settings: dict[str, Any]
    owner: str
    nodes: list[NodeOut]
    links: list[LinkOut]


class MapListItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    description: str
    updated_at: Any
    visibility: str
    owner: str | None = None


class MapCreatedOut(BaseModel):
    id: str
    name: str


class OkOut(BaseModel):
    ok: bool = True


class ShareOut(BaseModel):
    public_token: str
    share_url: str


# ──────────────────────────── Endpoints ────────────────────────────


@router.get("", response_model=list[MapListItemOut])
async def list_maps(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
) -> list[MapListItemOut]:
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
    show_owner = is_admin(user)
    user_email = user.get("email", "")
    out: list[MapListItemOut] = []
    for m in maps:
        owner: str | None = None
        if show_owner or m.owner == user_email:
            owner = m.owner
        out.append(
            MapListItemOut(
                id=m.id,
                name=m.name,
                description=m.description,
                updated_at=m.updated_at,
                visibility=m.visibility,
                owner=owner,
            )
        )
    return out


@router.post("", response_model=MapCreatedOut)
async def create_map(
    data: MapCreate,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
) -> MapCreatedOut:
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
    return MapCreatedOut(id=m.id, name=m.name)


@router.get("/{map_id}", response_model=MapOut)
async def get_map(
    map_id: str,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
) -> MapOut:
    await require_map_read(map_id, user, db)
    result = await db.execute(
        select(Map)
        .options(selectinload(Map.nodes), selectinload(Map.links))
        .where(Map.id == map_id)
    )
    m = result.scalar_one_or_none()
    if not m:
        raise HTTPException(404, "Map not found")
    return MapOut(
        id=m.id,
        name=m.name,
        description=m.description,
        width=m.width,
        height=m.height,
        scales=m.scales or {},
        settings=m.settings or {},
        visibility=m.visibility,
        public_token=m.public_token,
        public_settings=m.public_settings or {},
        owner=m.owner,
        nodes=[NodeOut.model_validate(_serialize_node(n)) for n in m.nodes],
        links=[LinkOut.model_validate(_serialize_link(lnk)) for lnk in m.links],
    )


@router.put("/{map_id}", response_model=OkOut)
async def update_map(
    map_id: str,
    data: MapUpdate,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
) -> OkOut:
    await require_map_owner(map_id, user, db)
    result = await db.execute(select(Map).where(Map.id == map_id))
    m = result.scalar_one_or_none()
    if not m:
        raise HTTPException(404, "Map not found")
    payload = data.model_dump(exclude_unset=True)
    # Promotion to public must go through /share to mint a token.
    if payload.get("visibility") == "public":
        raise HTTPException(
            422,
            "Use POST /share to publish a map; visibility=public is not allowed here",
        )
    for field, value in payload.items():
        setattr(m, field, value)
    await db.commit()
    return OkOut()


@router.delete("/{map_id}", response_model=OkOut)
async def delete_map(
    map_id: str,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
) -> OkOut:
    await require_map_owner(map_id, user, db)
    result = await db.execute(select(Map).where(Map.id == map_id))
    m = result.scalar_one_or_none()
    if not m:
        raise HTTPException(404, "Map not found")
    await db.delete(m)
    await db.commit()
    return OkOut()


@router.post("/{map_id}/share", response_model=ShareOut)
async def share_map(
    map_id: str,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
) -> ShareOut:
    m = await require_map_owner(map_id, user, db)
    import uuid

    m.visibility = "public"
    if not m.public_token:
        m.public_token = str(uuid.uuid4())
    await db.commit()
    return ShareOut(public_token=m.public_token, share_url=f"/public/{m.public_token}")


@router.delete("/{map_id}/share", response_model=OkOut)
async def unshare_map(
    map_id: str,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
) -> OkOut:
    m = await require_map_owner(map_id, user, db)
    m.visibility = "private"
    m.public_token = None
    await db.commit()
    return OkOut()


@router.post("/{map_id}/duplicate", response_model=MapCreatedOut)
async def duplicate_map(
    map_id: str,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
) -> MapCreatedOut:
    """Duplicate a map with all its nodes and links. Requires editor role + read access."""
    if not is_editor(user):
        raise HTTPException(403, "Editor role required to duplicate maps")

    await require_map_read(map_id, user, db)

    result = await db.execute(
        select(Map)
        .options(selectinload(Map.nodes), selectinload(Map.links))
        .where(Map.id == map_id)
    )
    source = result.scalar_one_or_none()
    if not source:
        raise HTTPException(404, "Map not found")

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
    await db.flush()

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
            parent_id=None,
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

    for node in source.nodes:
        if node.parent_id and node.parent_id in node_id_map:
            result2 = await db.execute(
                select(Node).where(Node.id == node_id_map[node.id])
            )
            new_node = result2.scalar_one()
            new_node.parent_id = node_id_map[node.parent_id]

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
    return MapCreatedOut(id=new_map.id, name=new_map.name)


# ──────────────────────────── Serializers ────────────────────────────


def _serialize_node(n: Node) -> dict[str, Any]:
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
        "locked": bool(n.locked),
        "observium_device_id": n.observium_device_id,
        "icon": n.icon,
        "style": n.style or {},
        "info_url": n.info_url,
        "extra": n.extra or {},
    }


def _serialize_link(lnk: Link) -> dict[str, Any]:
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
        "via_points": lnk.via_points or [],
        "via_style": lnk.via_style,
        "width": lnk.width,
        "arrow_style": lnk.arrow_style,
        "duplex": lnk.duplex,
        "datasource": lnk.datasource or {},
        "observium_port_id_a": lnk.observium_port_id_a,
        "observium_port_id_b": lnk.observium_port_id_b,
        "info_url_in": lnk.info_url_in,
        "info_url_out": lnk.info_url_out,
        "extra": lnk.extra or {},
        "z_order": lnk.z_order,
    }
