"""Legacy default scale -> Ledger default migration."""

import os

import pytest

os.environ.setdefault("APP_SECRET_KEY", "test-secret-key-for-tests")
os.environ.setdefault("AUTH_DISABLED", "true")
os.environ.setdefault("APP_DB_URL", "sqlite+aiosqlite:///:memory:")

from app.models.database import async_session, init_db  # noqa: E402
from app.models.map import DEFAULT_SCALE, Map  # noqa: E402
from app.models.migrations import (  # noqa: E402
    is_legacy_default_scale,
    migrate_default_scales,
)

LEGACY = [
    {"min": 0, "max": 0, "color": "#c0c0c0", "label": "0%"},
    {"min": 0, "max": 10, "color": "#3366FF", "label": "0-10%"},
    {"min": 10, "max": 50, "color": "#66ccff", "label": "10-50%"},
    {"min": 50, "max": 90, "color": "#ffaa00", "label": "50-90%"},
    {"min": 90, "max": 100, "color": "#ff3300", "label": "90-100%"},
]


@pytest.fixture
def anyio_backend():
    return "asyncio"


def test_detects_only_the_exact_legacy_default():
    assert is_legacy_default_scale(LEGACY)
    tweaked = [dict(b) for b in LEGACY]
    tweaked[3]["color"] = "#ff8800"
    assert not is_legacy_default_scale(tweaked)
    assert not is_legacy_default_scale(LEGACY[1:])
    assert not is_legacy_default_scale(DEFAULT_SCALE)
    assert not is_legacy_default_scale(None)
    assert not is_legacy_default_scale([{"min": "x"}] * 5)


@pytest.mark.anyio
async def test_migrates_legacy_maps_and_keeps_custom_ones():
    await init_db()
    custom = [{"min": 0, "max": 100, "color": "#123456", "label": "all"}]
    async with async_session() as s:
        legacy_map = Map(name="legacy", scales={"default": LEGACY, "alt": custom})
        custom_map = Map(name="custom", scales={"default": custom})
        new_map = Map(name="new")
        s.add_all([legacy_map, custom_map, new_map])
        await s.commit()
        ids = (legacy_map.id, custom_map.id, new_map.id)

    async with async_session() as s:
        assert await migrate_default_scales(s) == 1
    async with async_session() as s:
        assert await migrate_default_scales(s) == 0  # idempotent

    async with async_session() as s:
        legacy_map, custom_map, new_map = [await s.get(Map, i) for i in ids]
        assert legacy_map.scales["default"] == DEFAULT_SCALE
        assert legacy_map.scales["alt"] == custom  # other scales untouched
        assert custom_map.scales["default"] == custom
        assert new_map.scales["default"] == DEFAULT_SCALE
