"""Security regressions for unauthenticated public map payloads."""

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
async def test_public_map_uses_explicit_allow_lists(client: AsyncClient):
    map_response = await client.post("/api/maps", json={"name": "Public map"})
    map_id = map_response.json()["id"]

    node_a_response = await client.post(
        f"/api/maps/{map_id}/nodes",
        json={
            "name": "router-a",
            "node_type": "router",
            "observium_device_id": 42,
            "style": {"bg_color": "#123456", "locked": True, "secret": "hidden"},
            "info_url": "https://internal.example/device/42",
            "extra": {"api_token": "node-secret"},
        },
    )
    node_a = node_a_response.json()["id"]
    node_b_response = await client.post(
        f"/api/maps/{map_id}/nodes",
        json={"name": "router-b", "node_type": "router"},
    )
    node_b = node_b_response.json()["id"]

    link_response = await client.post(
        f"/api/maps/{map_id}/links",
        json={
            "name": "private binding",
            "source_id": node_a,
            "target_id": node_b,
            "datasource": {"type": "rrd", "file": "/rrd/private.rrd"},
            "observium_port_id_a": 100,
            "observium_port_id_b": 200,
            "info_url_in": "https://internal.example/in",
            "info_url_out": "https://internal.example/out",
            "extra": {
                "routing": "direct",
                "color_override": "#abcdef",
                "hostname": "internal-router",
                "port_identifier": "99",
                "api_token": "link-secret",
            },
        },
    )
    link_id = link_response.json()["id"]

    token = (await client.post(f"/api/maps/{map_id}/share")).json()["public_token"]
    response = await client.get(f"/api/public/maps/{token}")

    assert response.status_code == 200
    payload = response.json()
    assert set(payload) == {
        "id",
        "name",
        "description",
        "width",
        "height",
        "scales",
        "settings",
        "nodes",
        "links",
    }

    public_node = next(node for node in payload["nodes"] if node["id"] == node_a)
    assert set(public_node) == {
        "id",
        "name",
        "label",
        "node_type",
        "x",
        "y",
        "z_order",
        "parent_id",
        "width",
        "height",
        "icon",
        "style",
        "locked",
    }
    assert public_node["style"] == {"bg_color": "#123456", "locked": True}

    public_link = next(link for link in payload["links"] if link["id"] == link_id)
    assert set(public_link) == {
        "id",
        "name",
        "link_type",
        "source_id",
        "target_id",
        "source_anchor",
        "target_anchor",
        "bandwidth",
        "bandwidth_label",
        "via_points",
        "via_style",
        "width",
        "arrow_style",
        "duplex",
        "extra",
        "z_order",
    }
    assert public_link["extra"] == {
        "routing": "direct",
        "color_override": "#abcdef",
    }

    serialized = response.text
    for secret in (
        "observium_device_id",
        "datasource",
        "observium_port_id_a",
        "observium_port_id_b",
        "info_url",
        "hostname",
        "port_identifier",
        "api_token",
        "node-secret",
        "link-secret",
    ):
        assert secret not in serialized


@pytest.mark.anyio
async def test_public_map_can_hide_bandwidth(client: AsyncClient):
    map_response = await client.post("/api/maps", json={"name": "No bandwidth"})
    map_id = map_response.json()["id"]
    node_ids = []
    for name in ("a", "b"):
        response = await client.post(
            f"/api/maps/{map_id}/nodes",
            json={"name": name, "node_type": "router"},
        )
        node_ids.append(response.json()["id"])
    await client.post(
        f"/api/maps/{map_id}/links",
        json={"name": "link", "source_id": node_ids[0], "target_id": node_ids[1]},
    )
    await client.put(
        f"/api/maps/{map_id}",
        json={"public_settings": {"show_bandwidth": False}},
    )
    token = (await client.post(f"/api/maps/{map_id}/share")).json()["public_token"]

    payload = (await client.get(f"/api/public/maps/{token}")).json()

    assert "bandwidth" not in payload["links"][0]
    assert "bandwidth_label" not in payload["links"][0]
