from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.guards import require_map_owner
from app.auth.oauth import get_current_user
from app.models import Node, get_db
from app.models.node import NodeType

router = APIRouter(prefix="/api/maps/{map_id}/nodes", tags=["nodes"])


# Allow http(s) URLs only — rejects javascript:, data:, file:, etc.
_HTTP_URL_PATTERN = r"^https?://"


class NodeStyle(BaseModel):
    """Visual styling overrides; all keys are optional."""

    model_config = ConfigDict(extra="forbid")

    bg_color: str | None = Field(default=None, max_length=64)
    border_color: str | None = Field(default=None, max_length=64)
    text_color: str | None = Field(default=None, max_length=64)
    font_size: int | None = Field(default=None, ge=6, le=72)
    opacity: float | None = Field(default=None, ge=0, le=1)
    badge_override: str | None = Field(default=None, max_length=16)
    locked: bool | None = None  # legacy: stored at column level too
    rotation: float | None = Field(default=None, ge=-360, le=360)


class NodeExtra(BaseModel):
    """Loose metadata for nodes — every key must be opted in here."""

    model_config = ConfigDict(extra="forbid")

    site: str | None = Field(default=None, max_length=128)
    rack: str | None = Field(default=None, max_length=64)
    asn: int | None = Field(default=None, ge=0, le=4_294_967_295)
    role: str | None = Field(default=None, max_length=64)
    notes: str | None = Field(default=None, max_length=2000)
    hostname: str | None = Field(default=None, max_length=255)
    description: str | None = Field(default=None, max_length=512)


class NodeCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(..., max_length=255)
    label: str = Field("", max_length=255)
    node_type: NodeType = NodeType.SWITCH_L2
    x: float = 0
    y: float = 0
    z_order: int = Field(600, ge=0, le=10_000)
    parent_id: str | None = Field(default=None, max_length=36)
    width: float | None = Field(default=None, ge=0, le=10_000)
    height: float | None = Field(default=None, ge=0, le=10_000)
    locked: bool = False
    observium_device_id: int | None = Field(default=None, ge=0)
    icon: str | None = Field(default=None, max_length=512)
    style: NodeStyle = Field(default_factory=NodeStyle)
    info_url: str | None = Field(
        default=None, max_length=512, pattern=_HTTP_URL_PATTERN
    )
    extra: NodeExtra = Field(default_factory=NodeExtra)


class NodeUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(None, max_length=255)
    label: str | None = Field(None, max_length=255)
    node_type: NodeType | None = None
    x: float | None = None
    y: float | None = None
    z_order: int | None = Field(default=None, ge=0, le=10_000)
    parent_id: str | None = Field(default=None, max_length=36)
    width: float | None = Field(default=None, ge=0, le=10_000)
    height: float | None = Field(default=None, ge=0, le=10_000)
    locked: bool | None = None
    observium_device_id: int | None = Field(default=None, ge=0)
    icon: str | None = Field(default=None, max_length=512)
    style: NodeStyle | None = None
    info_url: str | None = Field(
        default=None, max_length=512, pattern=_HTTP_URL_PATTERN
    )
    extra: NodeExtra | None = None


class NodeMove(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(..., max_length=36)
    x: float
    y: float


class NodeBatchMove(BaseModel):
    model_config = ConfigDict(extra="forbid")

    moves: list[NodeMove] = Field(..., max_length=500)


class NodeCreatedOut(BaseModel):
    id: str


class OkOut(BaseModel):
    ok: Literal[True] = True


async def _validate_parent_id(
    db: AsyncSession,
    map_id: str,
    parent_id: str | None,
    self_id: str | None = None,
) -> None:
    """Ensure parent_id (if set) refers to an existing node in the same map."""
    if not parent_id:
        return
    if self_id and parent_id == self_id:
        raise HTTPException(422, "parent_id must not reference the node itself")
    result = await db.execute(select(Node.id, Node.map_id).where(Node.id == parent_id))
    row = result.first()
    if row is None:
        raise HTTPException(422, "parent_id does not reference an existing node")
    if row[1] != map_id:
        raise HTTPException(422, "parent_id must belong to the same map")


@router.post("", response_model=NodeCreatedOut)
async def create_node(
    map_id: str,
    data: NodeCreate,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
) -> NodeCreatedOut:
    await require_map_owner(map_id, user, db)
    await _validate_parent_id(db, map_id, data.parent_id)
    payload: dict[str, Any] = data.model_dump()
    # Pydantic models for nested fields → store as plain dicts.
    payload["style"] = data.style.model_dump(exclude_none=True)
    payload["extra"] = data.extra.model_dump(exclude_none=True)
    node = Node(map_id=map_id, **payload)
    db.add(node)
    await db.commit()
    await db.refresh(node)
    return NodeCreatedOut(id=node.id)


@router.put("/{node_id}", response_model=OkOut)
async def update_node(
    map_id: str,
    node_id: str,
    data: NodeUpdate,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
) -> OkOut:
    await require_map_owner(map_id, user, db)
    result = await db.execute(
        select(Node).where(Node.id == node_id, Node.map_id == map_id)
    )
    node = result.scalar_one_or_none()
    if not node:
        raise HTTPException(404, "Node not found")

    payload = data.model_dump(exclude_unset=True)
    if "parent_id" in payload:
        await _validate_parent_id(db, map_id, payload["parent_id"], self_id=node_id)
    # Nested models: re-flatten so we don't store Pydantic objects in JSON columns.
    if "style" in payload and data.style is not None:
        payload["style"] = data.style.model_dump(exclude_none=True)
    if "extra" in payload and data.extra is not None:
        payload["extra"] = data.extra.model_dump(exclude_none=True)
    for field, value in payload.items():
        setattr(node, field, value)
    await db.commit()
    return OkOut()


@router.delete("/{node_id}", response_model=OkOut)
async def delete_node(
    map_id: str,
    node_id: str,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
) -> OkOut:
    await require_map_owner(map_id, user, db)
    result = await db.execute(
        select(Node).where(Node.id == node_id, Node.map_id == map_id)
    )
    node = result.scalar_one_or_none()
    if not node:
        raise HTTPException(404, "Node not found")
    await db.delete(node)
    await db.commit()
    return OkOut()


@router.post("/batch-move", response_model=OkOut)
async def batch_move_nodes(
    map_id: str,
    data: NodeBatchMove,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
) -> OkOut:
    """Move multiple nodes at once (for drag-and-drop editor)."""
    await require_map_owner(map_id, user, db)
    for move in data.moves:
        result = await db.execute(
            select(Node).where(Node.id == move.id, Node.map_id == map_id)
        )
        node = result.scalar_one_or_none()
        if node:
            node.x = move.x
            node.y = move.y
    await db.commit()
    return OkOut()
