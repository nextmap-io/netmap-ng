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


@pytest.mark.anyio
async def test_health(client: AsyncClient):
    resp = await client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert "version" in data


@pytest.mark.anyio
async def test_auth_me_local(client: AsyncClient):
    """With AUTH_DISABLED=true, /auth/me should return local user."""
    resp = await client.get("/auth/me")
    assert resp.status_code == 200
    data = resp.json()
    assert data["sub"] == "local"


@pytest.mark.anyio
async def test_maps_crud(client: AsyncClient):
    """Create, get, and delete a map."""
    # Create
    resp = await client.post("/api/maps", json={"name": "Test Map"})
    assert resp.status_code == 200
    map_id = resp.json()["id"]

    # Get
    resp = await client.get(f"/api/maps/{map_id}")
    assert resp.status_code == 200
    assert resp.json()["name"] == "Test Map"
    assert resp.json()["nodes"] == []
    assert resp.json()["links"] == []

    # Delete
    resp = await client.delete(f"/api/maps/{map_id}")
    assert resp.status_code == 200

    # Verify deleted
    resp = await client.get(f"/api/maps/{map_id}")
    assert resp.status_code == 404
