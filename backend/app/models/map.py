from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING
from sqlalchemy import String, DateTime, Integer, JSON, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base

if TYPE_CHECKING:
    from .node import Node
    from .link import Link


class Map(Base):
    __tablename__ = "maps"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    width: Mapped[int] = mapped_column(Integer, default=1920)
    height: Mapped[int] = mapped_column(Integer, default=1080)
    background_image: Mapped[str | None] = mapped_column(String(512), nullable=True)

    # Scale definitions: list of {min, max, color1, color2?, label?}
    scales: Mapped[dict] = mapped_column(JSON, default=lambda: {
        "default": [
            {"min": 0, "max": 0, "color": "#c0c0c0", "label": "0%"},
            {"min": 0, "max": 10, "color": "#3366ff", "label": "0-10%"},
            {"min": 10, "max": 50, "color": "#66ccff", "label": "10-50%"},
            {"min": 50, "max": 90, "color": "#ffaa00", "label": "50-90%"},
            {"min": 90, "max": 100, "color": "#ff3300", "label": "90-100%"},
        ]
    })

    # Global settings
    settings: Mapped[dict] = mapped_column(JSON, default=lambda: {
        "kilo": 1000,
        "refresh_interval": 300,
        "default_link_width": 4,
    })

    owner: Mapped[str] = mapped_column(String(255), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    nodes: Mapped[list["Node"]] = relationship("Node", back_populates="map", cascade="all, delete-orphan")
    links: Mapped[list["Link"]] = relationship("Link", back_populates="map", cascade="all, delete-orphan")
