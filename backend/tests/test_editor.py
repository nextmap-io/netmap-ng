"""Tests for editor/production backend features:

- B1: bidirectional traffic (port A primary, port B fallback)
- B5: batched Observium port traffic query (no N+1)
- B6: link endpoint validation (existence, same map, no self-link)
- F3: batch update endpoints for nodes and links
"""

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


async def _make_map(client: AsyncClient) -> str:
    resp = await client.post("/api/maps", json={"name": "Editor Map"})
    assert resp.status_code == 200
    return resp.json()["id"]


async def _make_node(client: AsyncClient, map_id: str, name: str) -> str:
    resp = await client.post(
        f"/api/maps/{map_id}/nodes",
        json={"name": name, "node_type": "router"},
    )
    assert resp.status_code == 200
    return resp.json()["id"]


# ── B6: link validation ───────────────────────────────────────────────


@pytest.mark.anyio
async def test_create_link_rejects_self_link(client: AsyncClient):
    map_id = await _make_map(client)
    node_id = await _make_node(client, map_id, "A")
    resp = await client.post(
        f"/api/maps/{map_id}/links",
        json={"name": "loop", "source_id": node_id, "target_id": node_id},
    )
    assert resp.status_code == 422
    assert "itself" in resp.json()["detail"]


@pytest.mark.anyio
async def test_create_link_rejects_unknown_node(client: AsyncClient):
    map_id = await _make_map(client)
    node_id = await _make_node(client, map_id, "A")
    resp = await client.post(
        f"/api/maps/{map_id}/links",
        json={"name": "x", "source_id": node_id, "target_id": "does-not-exist"},
    )
    assert resp.status_code == 422
    assert "target_id" in resp.json()["detail"]


@pytest.mark.anyio
async def test_create_link_rejects_node_from_other_map(client: AsyncClient):
    map_a = await _make_map(client)
    map_b = await _make_map(client)
    node_a = await _make_node(client, map_a, "A")
    node_b = await _make_node(client, map_b, "B")  # belongs to a different map
    resp = await client.post(
        f"/api/maps/{map_a}/links",
        json={"name": "x", "source_id": node_a, "target_id": node_b},
    )
    assert resp.status_code == 422


@pytest.mark.anyio
async def test_create_link_valid(client: AsyncClient):
    map_id = await _make_map(client)
    node_a = await _make_node(client, map_id, "A")
    node_b = await _make_node(client, map_id, "B")
    resp = await client.post(
        f"/api/maps/{map_id}/links",
        json={"name": "ok", "source_id": node_a, "target_id": node_b},
    )
    assert resp.status_code == 200
    assert resp.json()["id"]


# ── F3: batch node update ──────────────────────────────────────────────


@pytest.mark.anyio
async def test_batch_update_nodes(client: AsyncClient):
    map_id = await _make_map(client)
    n1 = await _make_node(client, map_id, "n1")
    n2 = await _make_node(client, map_id, "n2")

    resp = await client.patch(
        f"/api/maps/{map_id}/nodes/batch",
        json={
            "node_ids": [n1, n2, "ghost"],  # ghost is ignored
            "fields": {"type": "firewall", "locked": True, "width": 120},
        },
    )
    assert resp.status_code == 200
    nodes = resp.json()["nodes"]
    assert len(nodes) == 2
    for node in nodes:
        assert node["node_type"] == "firewall"
        assert node["width"] == 120

    # Persisted
    resp = await client.get(f"/api/maps/{map_id}")
    by_id = {n["id"]: n for n in resp.json()["nodes"]}
    assert by_id[n1]["node_type"] == "firewall"
    assert by_id[n2]["node_type"] == "firewall"


@pytest.mark.anyio
async def test_batch_update_nodes_rejects_bad_enum(client: AsyncClient):
    map_id = await _make_map(client)
    n1 = await _make_node(client, map_id, "n1")
    resp = await client.patch(
        f"/api/maps/{map_id}/nodes/batch",
        json={"node_ids": [n1], "fields": {"type": "not-a-type"}},
    )
    assert resp.status_code == 422


# ── F3: batch link update ──────────────────────────────────────────────


@pytest.mark.anyio
async def test_batch_update_links(client: AsyncClient):
    map_id = await _make_map(client)
    node_a = await _make_node(client, map_id, "A")
    node_b = await _make_node(client, map_id, "B")
    resp = await client.post(
        f"/api/maps/{map_id}/links",
        json={"name": "l1", "source_id": node_a, "target_id": node_b},
    )
    link_id = resp.json()["id"]

    resp = await client.patch(
        f"/api/maps/{map_id}/links/batch",
        json={
            "link_ids": [link_id, "ghost"],
            "fields": {"type": "transit", "width": 8, "color_override": "#ff0000"},
        },
    )
    assert resp.status_code == 200
    links = resp.json()["links"]
    assert len(links) == 1
    assert links[0]["link_type"] == "transit"
    assert links[0]["width"] == 8
    assert links[0]["extra"]["color_override"] == "#ff0000"


# ── B1 + B5: bidirectional traffic + batched fetch ─────────────────────


@pytest.mark.anyio
async def test_live_traffic_a_primary_b_fallback(client: AsyncClient, monkeypatch):
    import app.datasources.observium as observium_mod

    map_id = await _make_map(client)
    node_a = await _make_node(client, map_id, "A")
    node_b = await _make_node(client, map_id, "B")

    # Link bound to both ports; A has no data, B does -> fall back to B.
    resp = await client.post(
        f"/api/maps/{map_id}/links",
        json={
            "name": "l1",
            "source_id": node_a,
            "target_id": node_b,
            "bandwidth": 1_000_000_000,
            "observium_port_id_a": 100,
            "observium_port_id_b": 200,
        },
    )
    link_id = resp.json()["id"]

    calls = {"count": 0, "ids": None}

    async def fake_batch(port_ids):
        calls["count"] += 1
        calls["ids"] = list(port_ids)
        # Only port B (200) yields data; port A (100) is absent.
        return {
            200: {
                "port_id": 200,
                "ifInOctets_rate": 12_500_000,  # *8 = 100 Mbit/s = 10% of 1G
                "ifOutOctets_rate": 0,
            }
        }

    monkeypatch.setattr(observium_mod, "get_ports_traffic", fake_batch)

    resp = await client.get(f"/api/datasources/traffic/live?map_id={map_id}")
    assert resp.status_code == 200
    data = resp.json()
    # Single batched call (B5), both port ids collected.
    assert calls["count"] == 1
    assert set(calls["ids"]) == {100, 200}
    # Fallback to B (B1): non-zero traffic from port 200.
    assert data[link_id]["in_pct"] == 10.0
    assert data[link_id]["in_bps"] == 100_000_000.0


@pytest.mark.anyio
async def test_live_traffic_a_wins_over_b(client: AsyncClient, monkeypatch):
    import app.datasources.observium as observium_mod

    map_id = await _make_map(client)
    node_a = await _make_node(client, map_id, "A")
    node_b = await _make_node(client, map_id, "B")
    resp = await client.post(
        f"/api/maps/{map_id}/links",
        json={
            "name": "l1",
            "source_id": node_a,
            "target_id": node_b,
            "bandwidth": 1_000_000_000,
            "observium_port_id_a": 100,
            "observium_port_id_b": 200,
        },
    )
    link_id = resp.json()["id"]

    async def fake_batch(port_ids):
        # Both ports yield data; A must win and B must NOT be added.
        return {
            100: {"port_id": 100, "ifInOctets_rate": 1_250_000, "ifOutOctets_rate": 0},
            200: {
                "port_id": 200,
                "ifInOctets_rate": 99_000_000,
                "ifOutOctets_rate": 99_000_000,
            },
        }

    monkeypatch.setattr(observium_mod, "get_ports_traffic", fake_batch)

    resp = await client.get(f"/api/datasources/traffic/live?map_id={map_id}")
    data = resp.json()
    # A: 1_250_000 * 8 = 10 Mbit/s = 1% of 1G (not B's 99M).
    assert data[link_id]["in_pct"] == 1.0
    assert data[link_id]["in_bps"] == 10_000_000.0


@pytest.mark.anyio
async def test_live_traffic_zero_when_no_data(client: AsyncClient, monkeypatch):
    import app.datasources.observium as observium_mod

    map_id = await _make_map(client)
    node_a = await _make_node(client, map_id, "A")
    node_b = await _make_node(client, map_id, "B")
    resp = await client.post(
        f"/api/maps/{map_id}/links",
        json={
            "name": "l1",
            "source_id": node_a,
            "target_id": node_b,
            "observium_port_id_a": 100,
            "observium_port_id_b": 200,
        },
    )
    link_id = resp.json()["id"]

    async def fake_batch(port_ids):
        return {}

    monkeypatch.setattr(observium_mod, "get_ports_traffic", fake_batch)

    resp = await client.get(f"/api/datasources/traffic/live?map_id={map_id}")
    data = resp.json()
    assert data[link_id] == {"in_bps": 0, "out_bps": 0, "in_pct": 0, "out_pct": 0}
