"""Regression tests for the 2026-11 security audit fixes."""

import asyncio
import os

import pytest
from httpx import ASGITransport, AsyncClient

os.environ.setdefault("APP_SECRET_KEY", "test-secret-key-for-tests")
os.environ.setdefault("AUTH_DISABLED", "true")
os.environ.setdefault("APP_DB_URL", "sqlite+aiosqlite:///:memory:")


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
async def client():
    from app.main import app
    from app.models.database import init_db

    await init_db()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


async def _make_map(client: AsyncClient) -> str:
    resp = await client.post("/api/maps", json={"name": "Audit Map"})
    assert resp.status_code == 200
    return resp.json()["id"]


def _as(user: dict) -> None:
    from app.auth.oauth import get_current_user
    from app.main import app

    app.dependency_overrides[get_current_user] = lambda: user


# ── Admin role fails closed ─────────────────────────────────────────────


def test_empty_admin_role_makes_nobody_admin(monkeypatch):
    from app.auth.guards import is_admin, is_editor
    from app.config import get_settings

    settings = get_settings()
    monkeypatch.setattr(settings, "oauth_admin_role", "")
    monkeypatch.setattr(settings, "oauth_editor_role", "")
    user = {"email": "someone@example.com", "roles": []}
    assert is_admin(user) is False
    assert is_editor(user) is True  # documented: empty editor role = everyone


@pytest.mark.anyio
async def test_private_map_hidden_from_others_without_admin_role(client, monkeypatch):
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "oauth_admin_role", "")
    map_id = await _make_map(client)
    resp = await client.put(f"/api/maps/{map_id}", json={"visibility": "private"})
    assert resp.status_code == 200

    _as({"email": "other@example.com", "roles": []})
    assert (await client.get(f"/api/maps/{map_id}")).status_code == 403
    assert (await client.delete(f"/api/maps/{map_id}")).status_code == 403
    me = await client.get("/auth/me")
    assert me.json()["is_admin"] is False


# ── Public token lifecycle ──────────────────────────────────────────────


@pytest.mark.anyio
async def test_leaving_public_by_put_revokes_token(client):
    map_id = await _make_map(client)
    token = (await client.post(f"/api/maps/{map_id}/share")).json()["public_token"]
    assert (await client.get(f"/api/public/maps/{token}")).status_code == 200

    await client.put(f"/api/maps/{map_id}", json={"visibility": "internal"})
    await client.put(f"/api/maps/{map_id}", json={"visibility": "public"})
    assert (await client.get(f"/api/public/maps/{token}")).status_code == 404
    assert (await client.get(f"/api/maps/{map_id}")).json()["public_token"] is None


@pytest.mark.anyio
async def test_public_token_only_shown_to_owner(client):
    map_id = await _make_map(client)
    token = (await client.post(f"/api/maps/{map_id}/share")).json()["public_token"]
    assert (await client.get(f"/api/maps/{map_id}")).json()["public_token"] == token

    _as({"email": "viewer@example.com", "roles": []})
    resp = await client.get(f"/api/maps/{map_id}")
    assert resp.status_code == 200
    assert resp.json()["public_token"] is None


# ── Logout and request size ─────────────────────────────────────────────


@pytest.mark.anyio
async def test_logout_is_post_only(client):
    assert (await client.get("/auth/logout")).status_code == 405
    resp = await client.post("/auth/logout")
    assert resp.status_code == 303
    assert resp.headers["location"] == "/"


@pytest.mark.anyio
async def test_oversized_body_rejected(client):
    map_id = await _make_map(client)
    blob = "x" * (1024 * 1024 + 1)
    resp = await client.put(f"/api/maps/{map_id}", json={"settings": {"blob": blob}})
    assert resp.status_code == 413


# ── Cache: concurrent misses share one load ─────────────────────────────


@pytest.mark.anyio
async def test_cached_coalesces_concurrent_loads():
    from app.datasources import observium

    calls = 0

    async def loader():
        nonlocal calls
        calls += 1
        await asyncio.sleep(0.01)
        return {"ok": calls}

    results = await asyncio.gather(
        *(observium.cached(("k",), loader) for _ in range(10))
    )
    assert calls == 1
    assert all(r == {"ok": 1} for r in results)


@pytest.mark.anyio
async def test_cached_failure_is_shared_then_retried():
    from app.datasources import observium

    calls = 0

    async def failing():
        nonlocal calls
        calls += 1
        await asyncio.sleep(0.01)
        raise RuntimeError("db down")

    results = await asyncio.gather(
        *(observium.cached(("f",), failing) for _ in range(3)),
        return_exceptions=True,
    )
    assert calls == 1
    assert all(isinstance(r, RuntimeError) for r in results)

    async def ok():
        return 42

    assert await observium.cached(("f",), ok) == 42  # failures are not cached
