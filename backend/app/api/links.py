from __future__ import annotations

from typing import Annotated, Any, Literal, Union

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.guards import require_map_owner
from app.auth.oauth import get_current_user
from app.models import Link, get_db
from app.models.link import LinkType

router = APIRouter(prefix="/api/maps/{map_id}/links", tags=["links"])


_HTTP_URL_PATTERN = r"^https?://"


class ViaPoint(BaseModel):
    model_config = ConfigDict(extra="forbid")

    x: float
    y: float


class StaticDatasource(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["static"]
    in_: float = Field(default=0, alias="in", ge=0)
    out: float = Field(default=0, ge=0)


class ObserviumDatasource(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["observium_port", "observium"]
    port_id: int | None = Field(default=None, ge=0)


class RrdDatasource(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["rrd"]
    file: str = Field(default="", max_length=512)
    ds_in: str = Field(default="INOCTETS", max_length=64)
    ds_out: str = Field(default="OUTOCTETS", max_length=64)


LinkDatasource = Annotated[
    Union[StaticDatasource, ObserviumDatasource, RrdDatasource],
    Field(discriminator="type"),
]


class LinkExtra(BaseModel):
    """Visual / metadata extras for links."""

    model_config = ConfigDict(extra="forbid")

    routing: Literal["curved", "angled", "straight"] | None = None
    line_style: Literal["solid", "dashed", "dotted"] | None = None
    color_override: str | None = Field(default=None, max_length=64)
    label_position: float | None = Field(default=None, ge=0, le=1)
    interface_a: str | None = Field(default=None, max_length=128)
    interface_b: str | None = Field(default=None, max_length=128)
    provider: str | None = Field(default=None, max_length=128)
    description: str | None = Field(default=None, max_length=512)
    notes: str | None = Field(default=None, max_length=2000)


class LinkCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(..., max_length=255)
    link_type: LinkType = LinkType.INTERNAL
    source_id: str = Field(..., max_length=36)
    target_id: str = Field(..., max_length=36)
    source_anchor: str | None = Field(None, max_length=50)
    target_anchor: str | None = Field(None, max_length=50)
    bandwidth: float = Field(1_000_000_000, ge=0)
    bandwidth_label: str = Field("1G", max_length=20)
    via_points: list[ViaPoint] = Field(default_factory=list, max_length=64)
    via_style: Literal["curved", "angled", "straight"] = "curved"
    width: int = Field(4, ge=1, le=50)
    arrow_style: str = Field(default="classic", max_length=32)
    duplex: Literal["full", "half"] = "full"
    z_order: int = Field(300, ge=0, le=10_000)
    datasource: LinkDatasource = Field(
        default_factory=lambda: StaticDatasource(type="static")
    )
    observium_port_id_a: int | None = Field(default=None, ge=0)
    observium_port_id_b: int | None = Field(default=None, ge=0)
    info_url_in: str | None = Field(None, max_length=512, pattern=_HTTP_URL_PATTERN)
    info_url_out: str | None = Field(None, max_length=512, pattern=_HTTP_URL_PATTERN)
    extra: LinkExtra = Field(default_factory=LinkExtra)


class LinkUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(None, max_length=255)
    link_type: LinkType | None = None
    source_anchor: str | None = Field(None, max_length=50)
    target_anchor: str | None = Field(None, max_length=50)
    bandwidth: float | None = Field(None, ge=0)
    bandwidth_label: str | None = Field(None, max_length=20)
    via_points: list[ViaPoint] | None = Field(default=None, max_length=64)
    via_style: Literal["curved", "angled", "straight"] | None = None
    width: int | None = Field(None, ge=1, le=50)
    arrow_style: str | None = Field(default=None, max_length=32)
    duplex: Literal["full", "half"] | None = None
    z_order: int | None = Field(default=None, ge=0, le=10_000)
    datasource: LinkDatasource | None = None
    observium_port_id_a: int | None = Field(default=None, ge=0)
    observium_port_id_b: int | None = Field(default=None, ge=0)
    info_url_in: str | None = Field(None, max_length=512, pattern=_HTTP_URL_PATTERN)
    info_url_out: str | None = Field(None, max_length=512, pattern=_HTTP_URL_PATTERN)
    extra: LinkExtra | None = None


class LinkCreatedOut(BaseModel):
    id: str


class OkOut(BaseModel):
    ok: Literal[True] = True


def _datasource_to_dict(ds: Any) -> dict[str, Any]:
    """Pydantic Datasource model → flat dict matching legacy storage shape."""
    return ds.model_dump(by_alias=True)


def _via_points_to_list(points: list[ViaPoint]) -> list[dict[str, Any]]:
    return [p.model_dump() for p in points]


@router.post("", response_model=LinkCreatedOut)
async def create_link(
    map_id: str,
    data: LinkCreate,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
) -> LinkCreatedOut:
    await require_map_owner(map_id, user, db)
    payload: dict[str, Any] = data.model_dump(
        exclude={"datasource", "via_points", "extra"}
    )
    payload["datasource"] = _datasource_to_dict(data.datasource)
    payload["via_points"] = _via_points_to_list(data.via_points)
    payload["extra"] = data.extra.model_dump(exclude_none=True)
    link = Link(map_id=map_id, **payload)
    db.add(link)
    await db.commit()
    await db.refresh(link)
    return LinkCreatedOut(id=link.id)


@router.put("/{link_id}", response_model=OkOut)
async def update_link(
    map_id: str,
    link_id: str,
    data: LinkUpdate,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
) -> OkOut:
    await require_map_owner(map_id, user, db)
    result = await db.execute(
        select(Link).where(Link.id == link_id, Link.map_id == map_id)
    )
    link = result.scalar_one_or_none()
    if not link:
        raise HTTPException(404, "Link not found")

    payload = data.model_dump(exclude_unset=True)
    if "datasource" in payload and data.datasource is not None:
        payload["datasource"] = _datasource_to_dict(data.datasource)
    if "via_points" in payload and data.via_points is not None:
        payload["via_points"] = _via_points_to_list(data.via_points)
    if "extra" in payload and data.extra is not None:
        payload["extra"] = data.extra.model_dump(exclude_none=True)
    for field, value in payload.items():
        setattr(link, field, value)
    await db.commit()
    return OkOut()


@router.delete("/{link_id}", response_model=OkOut)
async def delete_link(
    map_id: str,
    link_id: str,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
) -> OkOut:
    await require_map_owner(map_id, user, db)
    result = await db.execute(
        select(Link).where(Link.id == link_id, Link.map_id == map_id)
    )
    link = result.scalar_one_or_none()
    if not link:
        raise HTTPException(404, "Link not found")
    await db.delete(link)
    await db.commit()
    return OkOut()
