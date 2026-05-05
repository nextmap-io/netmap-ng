import os

import pytest
from httpx import ASGITransport, AsyncClient

os.environ.setdefault("APP_SECRET_KEY", "test-secret-key-for-tests")
os.environ.setdefault("AUTH_DISABLED", "true")
os.environ.setdefault("DEV_ALLOW_NO_AUTH", "true")
os.environ.setdefault("APP_BASE_URL", "http://localhost:8000")
os.environ.setdefault("APP_DB_URL", "sqlite+aiosqlite:///:memory:")
os.environ.setdefault("SESSION_REDIS_URL", "")


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


@pytest.mark.anyio
async def test_health(client: AsyncClient):
    resp = await client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"


@pytest.mark.anyio
async def test_auth_me_local(client: AsyncClient):
    """With AUTH_DISABLED=true, /auth/me should return local user."""
    resp = await client.get("/auth/me")
    assert resp.status_code == 200
    data = resp.json()
    assert data["sub"] == "local"


async def _csrf(client: AsyncClient) -> dict[str, str]:
    """Prime the CSRF cookie via a safe request, return matching header."""
    resp = await client.get("/health")
    token = resp.cookies.get("csrf_token", "")
    assert token, "CSRF cookie not issued"
    return {"X-CSRF-Token": token}


@pytest.mark.anyio
async def test_maps_crud(client: AsyncClient):
    """Create, get, and delete a map."""
    headers = await _csrf(client)

    resp = await client.post("/api/maps", json={"name": "Test Map"}, headers=headers)
    assert resp.status_code == 200
    map_id = resp.json()["id"]

    resp = await client.get(f"/api/maps/{map_id}")
    assert resp.status_code == 200
    assert resp.json()["name"] == "Test Map"
    assert resp.json()["nodes"] == []
    assert resp.json()["links"] == []

    resp = await client.delete(f"/api/maps/{map_id}", headers=headers)
    assert resp.status_code == 200

    resp = await client.get(f"/api/maps/{map_id}")
    assert resp.status_code == 404


@pytest.mark.anyio
async def test_maps_post_without_csrf_is_forbidden(client: AsyncClient):
    """POST without CSRF token must be refused."""
    resp = await client.post("/api/maps", json={"name": "Hacker Map"})
    assert resp.status_code == 403
