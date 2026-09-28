import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel, Field

from app.models import Link, Node, get_db
from app.models.node import NodeType
from app.auth.oauth import get_current_user
from app.auth.guards import require_map_owner
from app.api.maps import _serialize_node
from app.api.validation import SafeHttpUrl

logger = logging.getLogger("netmap.audit")
router = APIRouter(prefix="/api/maps/{map_id}/nodes", tags=["nodes"])


class NodeCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    label: str = Field("", max_length=255)
    node_type: NodeType = NodeType.SWITCH_L2
    x: float = Field(0, ge=-10_000_000, le=10_000_000, allow_inf_nan=False)
    y: float = Field(0, ge=-10_000_000, le=10_000_000, allow_inf_nan=False)
    parent_id: str | None = None
    width: float | None = Field(None, ge=1, le=10_000, allow_inf_nan=False)
    height: float | None = Field(None, ge=1, le=10_000, allow_inf_nan=False)
    observium_device_id: int | None = None
    style: dict = Field(default_factory=dict)
    info_url: SafeHttpUrl | None = Field(None, max_length=512)
    extra: dict = Field(default_factory=dict)


class NodeUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=255)
    label: str | None = Field(None, max_length=255)
    node_type: NodeType | None = None
    x: float | None = Field(None, ge=-10_000_000, le=10_000_000, allow_inf_nan=False)
    y: float | None = Field(None, ge=-10_000_000, le=10_000_000, allow_inf_nan=False)
    z_order: int | None = Field(None, ge=-100_000, le=100_000)
    parent_id: str | None = None
    width: float | None = Field(None, ge=1, le=10_000, allow_inf_nan=False)
    height: float | None = Field(None, ge=1, le=10_000, allow_inf_nan=False)
    observium_device_id: int | None = None
    icon: str | None = Field(None, max_length=512)
    locked: bool | None = None
    style: dict | None = None
    info_url: SafeHttpUrl | None = Field(None, max_length=512)
    extra: dict | None = None


class NodeMove(BaseModel):
    id: str
    x: float = Field(..., ge=-10_000_000, le=10_000_000, allow_inf_nan=False)
    y: float = Field(..., ge=-10_000_000, le=10_000_000, allow_inf_nan=False)


class NodeBatchMove(BaseModel):
    moves: list[NodeMove] = Field(..., max_length=500)


class NodeBatchFields(BaseModel):
    node_type: NodeType | None = None
    style: dict | None = None
    width: int | None = Field(None, ge=1, le=10000)
    height: int | None = Field(None, ge=1, le=10000)
    locked: bool | None = None


class NodeBatchUpdate(BaseModel):
    node_ids: list[str] = Field(..., max_length=1000)
    fields: NodeBatchFields


class NodeBatchDelete(BaseModel):
    node_ids: list[str] = Field(default_factory=list, max_length=1000)
    link_ids: list[str] = Field(default_factory=list, max_length=1000)


# Keep IN (...) lists well under SQLite's bound-parameter limit.
_IN_CHUNK = 500


def _chunks(ids: list[str]) -> list[list[str]]:
    return [ids[i : i + _IN_CHUNK] for i in range(0, len(ids), _IN_CHUNK)]


_NULLABLE_UPDATE_FIELDS = {
    "parent_id",
    "width",
    "height",
    "observium_device_id",
    "icon",
    "info_url",
}


def _node_updates(data: NodeUpdate) -> dict:
    """Keep explicit nulls for nullable columns while ignoring nulls elsewhere."""
    updates = data.model_dump(exclude_none=True)
    for field in data.model_fields_set & _NULLABLE_UPDATE_FIELDS:
        updates[field] = getattr(data, field)
    return updates


async def _detach_children(db: AsyncSession, map_id: str, parent_ids: set[str]) -> None:
    """Move children of ``parent_ids`` to the top level, keeping them in place.

    Child positions are relative to their parent, so the parent chain's
    absolute offset is added when clearing ``parent_id``; otherwise detached
    children would jump on screen by their old group's position.
    """
    if not parent_ids:
        return
    rows = (
        await db.execute(
            select(Node.id, Node.parent_id, Node.x, Node.y).where(Node.map_id == map_id)
        )
    ).all()
    by_id = {row.id: row for row in rows}

    def absolute(node_id: str) -> tuple[float, float]:
        ax = ay = 0.0
        seen: set[str] = set()
        current = by_id.get(node_id)
        while current is not None and current.id not in seen:
            seen.add(current.id)
            ax += current.x or 0
            ay += current.y or 0
            current = by_id.get(current.parent_id) if current.parent_id else None
        return ax, ay

    for row in rows:
        if row.parent_id in parent_ids:
            px, py = absolute(row.parent_id)
            await db.execute(
                update(Node)
                .where(Node.map_id == map_id, Node.id == row.id)
                .values(parent_id=None, x=(row.x or 0) + px, y=(row.y or 0) + py)
            )


async def _validate_parent(
    db: AsyncSession,
    map_id: str,
    parent_id: str | None,
    node_id: str | None = None,
) -> None:
    """Ensure containment stays map-local, targets a group, and is acyclic."""
    if parent_id is None:
        return
    if parent_id == node_id:
        raise HTTPException(422, "A node cannot be its own parent")

    result = await db.execute(
        select(Node.id, Node.parent_id, Node.node_type).where(Node.map_id == map_id)
    )
    rows = result.all()
    nodes = {row.id: row for row in rows}
    parent = nodes.get(parent_id)
    if parent is None:
        raise HTTPException(422, "parent_id does not reference a node in this map")
    if parent.node_type != NodeType.GROUP:
        raise HTTPException(422, "parent_id must reference a group node")

    seen: set[str] = set()
    current_id: str | None = parent_id
    while current_id is not None:
        if current_id == node_id:
            raise HTTPException(422, "Parent assignment would create a cycle")
        if current_id in seen:
            raise HTTPException(422, "The existing parent hierarchy contains a cycle")
        seen.add(current_id)
        current = nodes.get(current_id)
        current_id = current.parent_id if current else None


@router.post("")
async def create_node(
    map_id: str,
    data: NodeCreate,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    await require_map_owner(map_id, user, db)
    await _validate_parent(db, map_id, data.parent_id)
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
    await require_map_owner(map_id, user, db)
    result = await db.execute(
        select(Node).where(Node.id == node_id, Node.map_id == map_id)
    )
    node = result.scalar_one_or_none()
    if not node:
        raise HTTPException(404, "Node not found")
    updates = _node_updates(data)
    if "parent_id" in updates:
        await _validate_parent(db, map_id, updates["parent_id"], node_id)
    if (
        node.node_type == NodeType.GROUP
        and updates.get("node_type", NodeType.GROUP) != NodeType.GROUP
    ):
        child = await db.scalar(
            select(Node.id)
            .where(Node.map_id == map_id, Node.parent_id == node_id)
            .limit(1)
        )
        if child is not None:
            raise HTTPException(422, "A group with children cannot change node type")
    for field, value in updates.items():
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
    await require_map_owner(map_id, user, db)
    result = await db.execute(
        select(Node).where(Node.id == node_id, Node.map_id == map_id)
    )
    node = result.scalar_one_or_none()
    if not node:
        raise HTTPException(404, "Node not found")
    # Do not rely on database-level cascades: older SQLite deployments may
    # otherwise retain orphaned links or children.
    await db.execute(
        delete(Link).where(
            Link.map_id == map_id,
            (Link.source_id == node_id) | (Link.target_id == node_id),
        )
    )
    await _detach_children(db, map_id, {node_id})
    await db.delete(node)
    await db.commit()
    return {"ok": True}


@router.patch("/batch")
async def batch_update_nodes(
    map_id: str,
    data: NodeBatchUpdate,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    """Apply the same whitelisted fields to many nodes at once (bulk edit).

    Ids not belonging to this map are silently ignored. Returns the nodes that
    were updated.
    """
    await require_map_owner(map_id, user, db)
    result = await db.execute(
        select(Node).where(Node.id.in_(data.node_ids), Node.map_id == map_id)
    )
    nodes = result.scalars().all()
    f = data.fields
    if f.node_type is not None and f.node_type != NodeType.GROUP:
        group_ids = [node.id for node in nodes if node.node_type == NodeType.GROUP]
        if group_ids:
            child = await db.scalar(
                select(Node.id)
                .where(Node.map_id == map_id, Node.parent_id.in_(group_ids))
                .limit(1)
            )
            if child is not None:
                raise HTTPException(
                    422, "A group with children cannot change node type"
                )
    for node in nodes:
        if f.node_type is not None:
            node.node_type = f.node_type
        if f.style is not None:
            node.style = {**(node.style or {}), **f.style}
        if f.width is not None:
            node.width = f.width
        if f.height is not None:
            node.height = f.height
        if f.locked is not None:
            node.locked = f.locked
    await db.commit()
    for node in nodes:
        await db.refresh(node)
    return {"nodes": [_serialize_node(n) for n in nodes]}


@router.post("/batch-move")
async def batch_move_nodes(
    map_id: str,
    data: NodeBatchMove,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    """Move multiple nodes at once (for drag-and-drop editor)."""
    await require_map_owner(map_id, user, db)
    move_by_id = {move.id: move for move in data.moves}
    result = await db.execute(
        select(Node).where(Node.id.in_(move_by_id), Node.map_id == map_id)
    )
    nodes = result.scalars().all()
    for node in nodes:
        move = move_by_id[node.id]
        node.x = move.x
        node.y = move.y
    await db.commit()
    return {"ok": True}


@router.post("/batch-delete")
async def batch_delete(
    map_id: str,
    data: NodeBatchDelete,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    """Delete many nodes and links in one transaction.

    Same semantics as the single-node delete: links attached to a deleted node
    are deleted too and children of a deleted group are detached (moved to the
    top level), not deleted. Any id not belonging to this map -> 404 before
    anything is deleted.
    """
    await require_map_owner(map_id, user, db)
    node_ids = list(dict.fromkeys(data.node_ids))
    link_ids = list(dict.fromkeys(data.link_ids))

    map_node_ids = set(
        (await db.execute(select(Node.id).where(Node.map_id == map_id))).scalars()
    )
    if any(node_id not in map_node_ids for node_id in node_ids):
        raise HTTPException(404, "Node not found")
    map_links = (
        await db.execute(
            select(Link.id, Link.source_id, Link.target_id).where(Link.map_id == map_id)
        )
    ).all()
    map_link_ids = {row.id for row in map_links}
    if any(link_id not in map_link_ids for link_id in link_ids):
        raise HTTPException(404, "Link not found")

    deleted_nodes = set(node_ids)
    requested_links = set(link_ids)
    deleted_link_ids = [
        row.id
        for row in map_links
        if row.id in requested_links
        or row.source_id in deleted_nodes
        or row.target_id in deleted_nodes
    ]

    for chunk in _chunks(deleted_link_ids):
        await db.execute(delete(Link).where(Link.map_id == map_id, Link.id.in_(chunk)))
    # Detach children first (including ones deleted in this batch, so no
    # parent_id ever points at a removed row), keeping their on-screen position.
    await _detach_children(db, map_id, deleted_nodes)
    for chunk in _chunks(node_ids):
        await db.execute(delete(Node).where(Node.map_id == map_id, Node.id.in_(chunk)))
    await db.commit()
    logger.info(
        "AUDIT %s batch-delete map=%s nodes=%d links=%d",
        user.get("email", "anonymous"),
        map_id,
        len(node_ids),
        len(deleted_link_ids),
    )
    return {"deleted_node_ids": node_ids, "deleted_link_ids": deleted_link_ids}
