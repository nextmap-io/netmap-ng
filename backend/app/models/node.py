from __future__ import annotations

import uuid
from typing import TYPE_CHECKING
from sqlalchemy import String, Float, Integer, JSON, ForeignKey, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship
import enum

from .database import Base

if TYPE_CHECKING:
    from .map import Map


class NodeType(str, enum.Enum):
    ROUTER = "router"
    SWITCH_L2 = "switch_l2"
    SWITCH_L3 = "switch_l3"
    SERVER = "server"
    FIREWALL = "firewall"
    CLOUD = "cloud"  # IX / Transit / PNI
    INTERNET = "internet"  # External connectivity
    GROUP = "group"  # Site / rack / logical group
    CUSTOM = "custom"


class Node(Base):
    __tablename__ = "nodes"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    map_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("maps.id", ondelete="CASCADE")
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    label: Mapped[str] = mapped_column(String(255), default="")
    node_type: Mapped[NodeType] = mapped_column(
        SAEnum(NodeType), default=NodeType.SWITCH_L2
    )

    # Position
    x: Mapped[float] = mapped_column(Float, default=0.0)
    y: Mapped[float] = mapped_column(Float, default=0.0)
    z_order: Mapped[int] = mapped_column(Integer, default=600)

    # Grouping: parent node ID for site/rack containment
    parent_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("nodes.id"), nullable=True
    )

    # Dimensions (for group nodes)
    width: Mapped[float | None] = mapped_column(Float, nullable=True)
    height: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Observium binding
    observium_device_id: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Visual
    icon: Mapped[str | None] = mapped_column(String(512), nullable=True)
    style: Mapped[dict] = mapped_column(JSON, default=lambda: {})

    # Info URL (click-through)
    info_url: Mapped[str | None] = mapped_column(String(512), nullable=True)

    # Extra data
    extra: Mapped[dict] = mapped_column(JSON, default=lambda: {})

    map: Mapped["Map"] = relationship("Map", back_populates="nodes")
    children: Mapped[list["Node"]] = relationship(
        "Node", back_populates="parent", remote_side=[id]
    )
    parent: Mapped["Node | None"] = relationship(
        "Node", back_populates="children", remote_side=[parent_id]
    )
