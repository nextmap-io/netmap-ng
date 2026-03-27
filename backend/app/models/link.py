from __future__ import annotations

import uuid
from typing import TYPE_CHECKING
from sqlalchemy import String, Float, Integer, JSON, ForeignKey, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship
import enum

from .database import Base

if TYPE_CHECKING:
    from .map import Map
    from .node import Node


class LinkType(str, enum.Enum):
    INTERNAL = "internal"      # Internal backbone link
    TRANSIT = "transit"        # Transit provider
    PEERING_IX = "peering_ix"  # IX peering
    PEERING_PNI = "peering_pni"  # Private peering (PNI)
    CUSTOMER = "customer"      # Customer link
    TRUNK = "trunk"            # L2 trunk
    LAG = "lag"                # LAG / Port-Channel
    CUSTOM = "custom"


class Link(Base):
    __tablename__ = "links"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    map_id: Mapped[str] = mapped_column(String(36), ForeignKey("maps.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    link_type: Mapped[LinkType] = mapped_column(SAEnum(LinkType), default=LinkType.INTERNAL)

    # Endpoints
    source_id: Mapped[str] = mapped_column(String(36), ForeignKey("nodes.id", ondelete="CASCADE"))
    target_id: Mapped[str] = mapped_column(String(36), ForeignKey("nodes.id", ondelete="CASCADE"))

    # Endpoint anchors: compass point or offset for distributing arrows on nodes
    source_anchor: Mapped[str | None] = mapped_column(String(50), nullable=True)  # e.g. "E", "E:25", "45r20"
    target_anchor: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # Bandwidth capacity (bits/sec)
    bandwidth: Mapped[float] = mapped_column(Float, default=1_000_000_000)  # 1G default
    bandwidth_label: Mapped[str] = mapped_column(String(20), default="1G")

    # Intermediate routing points: [{x, y}]
    via_points: Mapped[list] = mapped_column(JSON, default=lambda: [])
    via_style: Mapped[str] = mapped_column(String(20), default="curved")  # curved | angled

    # Visual
    width: Mapped[int] = mapped_column(Integer, default=4)
    arrow_style: Mapped[str] = mapped_column(String(20), default="classic")
    duplex: Mapped[str] = mapped_column(String(10), default="full")  # full | half

    # Data source binding
    # RRD: {"type": "rrd", "file": "...", "ds_in": "INOCTETS", "ds_out": "OUTOCTETS"}
    # Observium port: {"type": "observium_port", "port_id": 123}
    # Static: {"type": "static", "in": 0, "out": 0}
    datasource: Mapped[dict] = mapped_column(JSON, default=lambda: {"type": "static", "in": 0, "out": 0})

    # Observium binding
    observium_port_id_a: Mapped[int | None] = mapped_column(Integer, nullable=True)
    observium_port_id_b: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Info URLs per direction
    info_url_in: Mapped[str | None] = mapped_column(String(512), nullable=True)
    info_url_out: Mapped[str | None] = mapped_column(String(512), nullable=True)

    # Extra data (e.g., provider name for transit links)
    extra: Mapped[dict] = mapped_column(JSON, default=lambda: {})

    z_order: Mapped[int] = mapped_column(Integer, default=300)

    map: Mapped["Map"] = relationship("Map", back_populates="links")
    source: Mapped["Node"] = relationship("Node", foreign_keys=[source_id])
    target: Mapped["Node"] = relationship("Node", foreign_keys=[target_id])
