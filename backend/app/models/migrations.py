"""Idempotent data migrations run at startup (after create_all)."""

import logging
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .map import DEFAULT_SCALE, LEGACY_DEFAULT_SCALE, Map

logger = logging.getLogger("netmap.migrations")


def _band_key(band: Any) -> tuple[float, float, str] | None:
    if not isinstance(band, dict):
        return None
    try:
        return (float(band["min"]), float(band["max"]), str(band["color"]).lower())
    except (KeyError, TypeError, ValueError):
        return None


def is_legacy_default_scale(bands: Any) -> bool:
    """True when ``bands`` is exactly the pre-Ledger default (labels ignored)."""
    if not isinstance(bands, list) or len(bands) != len(LEGACY_DEFAULT_SCALE):
        return False
    return [_band_key(b) for b in bands] == [_band_key(b) for b in LEGACY_DEFAULT_SCALE]


async def migrate_default_scales(session: AsyncSession) -> int:
    """Move maps still on the legacy default scale to the Ledger default.

    Safe to run on every start and from several workers at once: it only
    rewrites maps that still hold the exact legacy bands, to the same value.
    """
    maps = (await session.execute(select(Map))).scalars().all()
    migrated = 0
    for m in maps:
        scales = m.scales if isinstance(m.scales, dict) else {}
        if is_legacy_default_scale(scales.get("default")):
            m.scales = {**scales, "default": [dict(b) for b in DEFAULT_SCALE]}
            migrated += 1
    if migrated:
        await session.commit()
        logger.info("Migrated %d map(s) to the Ledger default scale", migrated)
    return migrated
