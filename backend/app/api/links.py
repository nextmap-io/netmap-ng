from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel, Field

from app.models import Link, Node, get_db
from app.models.link import LinkType
from app.auth.oauth import get_current_user
from app.auth.guards import require_map_owner
from app.api.maps import _serialize_link
from app.api.validation import SafeHttpUrl

router = APIRouter(prefix="/api/maps/{map_id}/links", tags=["links"])


async def _validate_endpoints(
    db: AsyncSession, map_id: str, source_id: str, target_id: str
) -> None:
    """Ensure both endpoints exist in this map and are not the same node.

    Raises HTTP 422 with a clear message on any violation.
    """
    if source_id == target_id:
        raise HTTPException(422, "A link cannot connect a node to itself")
    result = await db.execute(
        select(Node.id).where(
            Node.id.in_([source_id, target_id]), Node.map_id == map_id
        )
    )
    found = set(result.scalars().all())
    if source_id not in found:
        raise HTTPException(422, "source_id does not reference a node in this map")
    if target_id not in found:
        raise HTTPException(422, "target_id does not reference a node in this map")


class ViaPoint(BaseModel):
    x: float = Field(..., ge=-10_000_000, le=10_000_000, allow_inf_nan=False)
    y: float = Field(..., ge=-10_000_000, le=10_000_000, allow_inf_nan=False)


class LinkCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    link_type: LinkType = LinkType.INTERNAL
    source_id: str
    target_id: str
    source_anchor: str | None = Field(None, max_length=50)
    target_anchor: str | None = Field(None, max_length=50)
    bandwidth: float = Field(
        1_000_000_000, gt=0, le=1_000_000_000_000_000, allow_inf_nan=False
    )
    bandwidth_label: str = Field("1G", max_length=20)
    via_points: list[ViaPoint] = Field(default_factory=list, max_length=100)
    via_style: Literal["curved", "angled"] = "curved"
    width: int = Field(4, ge=1, le=50)
    arrow_style: Literal["classic", "standard", "none"] = "classic"
    duplex: Literal["full", "half"] = "full"
    datasource: dict = Field(
        default_factory=lambda: {"type": "static", "in": 0, "out": 0}
    )
    observium_port_id_a: int | None = None
    observium_port_id_b: int | None = None
    info_url_in: SafeHttpUrl | None = Field(None, max_length=512)
    info_url_out: SafeHttpUrl | None = Field(None, max_length=512)
    extra: dict = Field(default_factory=dict)


class LinkUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=255)
    link_type: LinkType | None = None
    source_anchor: str | None = Field(None, max_length=50)
    target_anchor: str | None = Field(None, max_length=50)
    bandwidth: float | None = Field(
        None, gt=0, le=1_000_000_000_000_000, allow_inf_nan=False
    )
    bandwidth_label: str | None = Field(None, max_length=20)
    via_points: list[ViaPoint] | None = Field(None, max_length=100)
    via_style: Literal["curved", "angled"] | None = None
    arrow_style: Literal["classic", "standard", "none"] | None = None
    duplex: Literal["full", "half"] | None = None
    width: int | None = Field(None, ge=1, le=50)
    datasource: dict | None = None
    observium_port_id_a: int | None = None
    observium_port_id_b: int | None = None
    info_url_in: SafeHttpUrl | None = Field(None, max_length=512)
    info_url_out: SafeHttpUrl | None = Field(None, max_length=512)
    extra: dict | None = None
    z_order: int | None = Field(None, ge=-100_000, le=100_000)


class LinkBatchFields(BaseModel):
    link_type: LinkType | None = None
    extra: dict | None = None
    width: int | None = Field(None, ge=1, le=50)


class LinkBatchUpdate(BaseModel):
    link_ids: list[str] = Field(..., max_length=1000)
    fields: LinkBatchFields


_NULLABLE_UPDATE_FIELDS = {
    "source_anchor",
    "target_anchor",
    "observium_port_id_a",
    "observium_port_id_b",
    "info_url_in",
    "info_url_out",
}


def _link_updates(data: LinkUpdate) -> dict:
    """Keep explicit nulls for nullable columns while ignoring nulls elsewhere."""
    updates = data.model_dump(exclude_none=True)
    for field in data.model_fields_set & _NULLABLE_UPDATE_FIELDS:
        updates[field] = getattr(data, field)
    return updates


@router.post("")
async def create_link(
    map_id: str,
    data: LinkCreate,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    await require_map_owner(map_id, user, db)
    await _validate_endpoints(db, map_id, data.source_id, data.target_id)
    link = Link(map_id=map_id, **data.model_dump())
    db.add(link)
    await db.commit()
    await db.refresh(link)
    return {"id": link.id}


@router.put("/{link_id}")
async def update_link(
    map_id: str,
    link_id: str,
    data: LinkUpdate,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    await require_map_owner(map_id, user, db)
    result = await db.execute(
        select(Link).where(Link.id == link_id, Link.map_id == map_id)
    )
    link = result.scalar_one_or_none()
    if not link:
        raise HTTPException(404, "Link not found")
    # Endpoints are not mutable via LinkUpdate; validate the effective endpoints
    # to guarantee the link stays consistent (both ends in this map, no self-link).
    await _validate_endpoints(db, map_id, link.source_id, link.target_id)
    for field, value in _link_updates(data).items():
        setattr(link, field, value)
    await db.commit()
    return {"ok": True}


@router.patch("/batch")
async def batch_update_links(
    map_id: str,
    data: LinkBatchUpdate,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    """Apply the same whitelisted fields to many links at once (bulk edit).

    Ids not belonging to this map are silently ignored. Returns the links that
    were updated.
    """
    await require_map_owner(map_id, user, db)
    result = await db.execute(
        select(Link).where(Link.id.in_(data.link_ids), Link.map_id == map_id)
    )
    links = result.scalars().all()
    f = data.fields
    for link in links:
        if f.link_type is not None:
            link.link_type = f.link_type
        if f.width is not None:
            link.width = f.width
        if f.extra is not None:
            link.extra = {**(link.extra or {}), **f.extra}
    await db.commit()
    for link in links:
        await db.refresh(link)
    return {"links": [_serialize_link(lnk) for lnk in links]}


@router.delete("/{link_id}")
async def delete_link(
    map_id: str,
    link_id: str,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    await require_map_owner(map_id, user, db)
    result = await db.execute(
        select(Link).where(Link.id == link_id, Link.map_id == map_id)
    )
    link = result.scalar_one_or_none()
    if not link:
        raise HTTPException(404, "Link not found")
    await db.delete(link)
    await db.commit()
    return {"ok": True}
