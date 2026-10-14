"""Idempotent data migrations run at startup (after create_all)."""

import logging
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .map import DEFAULT_SCALE, SUPERSEDED_DEFAULT_SCALES, Map

logger = logging.getLogger("netmap.migrations")


def _band_key(band: Any) -> tuple[float, float, str] | None:
    if not isinstance(band, dict):
        return None
    try:
        return (float(band["min"]), float(band["max"]), str(band["color"]).lower())
    except (KeyError, TypeError, ValueError):
        return None


def is_legacy_default_scale(bands: Any) -> bool:
    """True when ``bands`` is exactly a former default scale (labels ignored)."""
    if not isinstance(bands, list):
        return False
    keys = [_band_key(b) for b in bands]
    return any(keys == [_band_key(b) for b in old] for old in SUPERSEDED_DEFAULT_SCALES)


async def migrate_default_scales(session: AsyncSession) -> int:
    """Move maps still on a former default scale to the current Ledger default.

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
