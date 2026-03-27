from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel, Field

from app.models import Link, get_db
from app.models.link import LinkType
from app.auth.oauth import get_current_user

router = APIRouter(prefix="/api/maps/{map_id}/links", tags=["links"])


class LinkCreate(BaseModel):
    name: str = Field(..., max_length=255)
    link_type: LinkType = LinkType.INTERNAL
    source_id: str
    target_id: str
    source_anchor: str | None = Field(None, max_length=50)
    target_anchor: str | None = Field(None, max_length=50)
    bandwidth: float = 1_000_000_000
    bandwidth_label: str = Field("1G", max_length=20)
    via_points: list[dict] = Field(default_factory=list)
    via_style: str = "curved"
    width: int = Field(4, ge=1, le=50)
    datasource: dict = Field(default_factory=lambda: {"type": "static", "in": 0, "out": 0})
    observium_port_id_a: int | None = None
    observium_port_id_b: int | None = None
    info_url_in: str | None = Field(None, max_length=512)
    info_url_out: str | None = Field(None, max_length=512)
    extra: dict = Field(default_factory=dict)


class LinkUpdate(BaseModel):
    name: str | None = Field(None, max_length=255)
    link_type: LinkType | None = None
    source_anchor: str | None = Field(None, max_length=50)
    target_anchor: str | None = Field(None, max_length=50)
    bandwidth: float | None = None
    bandwidth_label: str | None = Field(None, max_length=20)
    via_points: list[dict] | None = None
    via_style: str | None = None
    width: int | None = Field(None, ge=1, le=50)
    datasource: dict | None = None
    observium_port_id_a: int | None = None
    observium_port_id_b: int | None = None
    info_url_in: str | None = Field(None, max_length=512)
    info_url_out: str | None = Field(None, max_length=512)
    extra: dict | None = None


@router.post("")
async def create_link(map_id: str, data: LinkCreate, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    link = Link(map_id=map_id, **data.model_dump())
    db.add(link)
    await db.commit()
    await db.refresh(link)
    return {"id": link.id}


@router.put("/{link_id}")
async def update_link(map_id: str, link_id: str, data: LinkUpdate, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    result = await db.execute(select(Link).where(Link.id == link_id, Link.map_id == map_id))
    link = result.scalar_one_or_none()
    if not link:
        raise HTTPException(404, "Link not found")
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(link, field, value)
    await db.commit()
    return {"ok": True}


@router.delete("/{link_id}")
async def delete_link(map_id: str, link_id: str, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    result = await db.execute(select(Link).where(Link.id == link_id, Link.map_id == map_id))
    link = result.scalar_one_or_none()
    if not link:
        raise HTTPException(404, "Link not found")
    await db.delete(link)
    await db.commit()
    return {"ok": True}
