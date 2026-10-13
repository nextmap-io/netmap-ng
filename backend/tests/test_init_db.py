"""init_db must tolerate another worker creating tables concurrently."""

import os

import pytest
from sqlalchemy.exc import OperationalError

os.environ.setdefault("APP_SECRET_KEY", "test-secret-key-for-tests")
os.environ.setdefault("AUTH_DISABLED", "true")
os.environ.setdefault("APP_DB_URL", "sqlite+aiosqlite:///:memory:")

from app.models.database import Base, init_db


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
async def test_init_db_retries_when_another_worker_created_a_table(monkeypatch):
    original = Base.metadata.create_all
    calls = {"n": 0}

    def racing_create_all(bind, **kw):
        calls["n"] += 1
        if calls["n"] == 1:
            raise OperationalError(
                "CREATE TABLE maps", {}, Exception("table maps already exists")
            )
        return original(bind, **kw)

    monkeypatch.setattr(Base.metadata, "create_all", racing_create_all)
    await init_db()
    assert calls["n"] == 2


@pytest.mark.anyio
async def test_init_db_does_not_swallow_other_errors(monkeypatch):
    def broken_create_all(bind, **kw):
        raise OperationalError("CREATE TABLE maps", {}, Exception("disk I/O error"))

    monkeypatch.setattr(Base.metadata, "create_all", broken_create_all)
    with pytest.raises(OperationalError):
        await init_db()
