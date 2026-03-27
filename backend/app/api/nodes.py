from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel, Field

from app.models import Node, get_db
from app.models.node import NodeType
from app.auth.oauth import get_current_user

router = APIRouter(prefix="/api/maps/{map_id}/nodes", tags=["nodes"])


class NodeCreate(BaseModel):
    name: str = Field(..., max_length=255)
    label: str = Field("", max_length=255)
    node_type: NodeType = NodeType.SWITCH_L2
    x: float = 0
    y: float = 0
    parent_id: str | None = None
    width: float | None = None
    height: float | None = None
    observium_device_id: int | None = None
    style: dict = Field(default_factory=dict)
    info_url: str | None = Field(None, max_length=512)
    extra: dict = Field(default_factory=dict)


class NodeUpdate(BaseModel):
    name: str | None = Field(None, max_length=255)
    label: str | None = Field(None, max_length=255)
    node_type: NodeType | None = None
    x: float | None = None
    y: float | None = None
    parent_id: str | None = None
    width: float | None = None
    height: float | None = None
    observium_device_id: int | None = None
    style: dict | None = None
    info_url: str | None = Field(None, max_length=512)
    extra: dict | None = None


class NodeMove(BaseModel):
    id: str
    x: float
    y: float


class NodeBatchMove(BaseModel):
    moves: list[NodeMove] = Field(..., max_length=500)


@router.post("")
async def create_node(
    map_id: str,
    data: NodeCreate,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    node = Node(map_id=map_id, **data.model_dump())
    db.add(node)
    await db.commit()
    await db.refresh(node)
    return {"id": node.id}


@router.put("/{node_id}")
async def update_node(
    map_id: str,
    node_id: str,
    data: NodeUpdate,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    result = await db.execute(
        select(Node).where(Node.id == node_id, Node.map_id == map_id)
    )
    node = result.scalar_one_or_none()
    if not node:
        raise HTTPException(404, "Node not found")
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(node, field, value)
    await db.commit()
    return {"ok": True}


@router.delete("/{node_id}")
async def delete_node(
    map_id: str,
    node_id: str,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    result = await db.execute(
        select(Node).where(Node.id == node_id, Node.map_id == map_id)
    )
    node = result.scalar_one_or_none()
    if not node:
        raise HTTPException(404, "Node not found")
    await db.delete(node)
    await db.commit()
    return {"ok": True}


@router.post("/batch-move")
async def batch_move_nodes(
    map_id: str,
    data: NodeBatchMove,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    """Move multiple nodes at once (for drag-and-drop editor)."""
    for move in data.moves:
        result = await db.execute(
            select(Node).where(Node.id == move.id, Node.map_id == map_id)
        )
        node = result.scalar_one_or_none()
        if node:
            node.x = move.x
            node.y = move.y
    await db.commit()
    return {"ok": True}
