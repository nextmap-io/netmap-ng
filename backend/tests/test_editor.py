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
            "fields": {"node_type": "firewall", "locked": True, "width": 120},
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
        json={"node_ids": [n1], "fields": {"node_type": "not-a-type"}},
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
            "fields": {
                "link_type": "transit",
                "width": 8,
                "extra": {"color_override": "#ff0000"},
            },
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


# ── Editor integrity and persistence regressions ───────────────────────


@pytest.mark.anyio
async def test_node_nullable_and_layer_fields_persist(client: AsyncClient):
    map_id = await _make_map(client)
    resp = await client.post(
        f"/api/maps/{map_id}/nodes",
        json={
            "name": "editable",
            "node_type": "router",
            "width": 120,
            "observium_device_id": 42,
            "info_url": "https://example.net/device/42",
        },
    )
    node_id = resp.json()["id"]

    resp = await client.put(
        f"/api/maps/{map_id}/nodes/{node_id}",
        json={
            "locked": True,
            "z_order": 999,
            "icon": "RTR",
            "width": None,
            "observium_device_id": None,
            "info_url": None,
        },
    )
    assert resp.status_code == 200

    data = (await client.get(f"/api/maps/{map_id}")).json()
    node = next(node for node in data["nodes"] if node["id"] == node_id)
    assert node["locked"] is True
    assert node["z_order"] == 999
    assert node["icon"] == "RTR"
    assert node["width"] is None
    assert node["observium_device_id"] is None
    assert node["info_url"] is None


@pytest.mark.anyio
async def test_link_nullable_and_visual_fields_persist(client: AsyncClient):
    map_id = await _make_map(client)
    node_a = await _make_node(client, map_id, "A")
    node_b = await _make_node(client, map_id, "B")
    resp = await client.post(
        f"/api/maps/{map_id}/links",
        json={
            "name": "editable",
            "source_id": node_a,
            "target_id": node_b,
            "source_anchor": "E",
            "observium_port_id_a": 100,
            "info_url_in": "https://example.net/graph",
        },
    )
    link_id = resp.json()["id"]

    resp = await client.put(
        f"/api/maps/{map_id}/links/{link_id}",
        json={
            "source_anchor": None,
            "observium_port_id_a": None,
            "info_url_in": None,
            "duplex": "half",
            "z_order": 777,
            "arrow_style": "none",
            "via_style": "angled",
            "via_points": [{"x": 10, "y": 20}],
        },
    )
    assert resp.status_code == 200

    data = (await client.get(f"/api/maps/{map_id}")).json()
    link = next(link for link in data["links"] if link["id"] == link_id)
    assert link["source_anchor"] is None
    assert link["observium_port_id_a"] is None
    assert link["info_url_in"] is None
    assert link["duplex"] == "half"
    assert link["z_order"] == 777
    assert link["arrow_style"] == "none"
    assert link["via_style"] == "angled"
    assert link["via_points"] == [{"x": 10, "y": 20}]


@pytest.mark.anyio
async def test_editor_urls_reject_unsafe_schemes(client: AsyncClient):
    map_id = await _make_map(client)
    resp = await client.post(
        f"/api/maps/{map_id}/nodes",
        json={"name": "unsafe", "info_url": "javascript:alert(1)"},
    )
    assert resp.status_code == 422

    node_a = await _make_node(client, map_id, "A")
    node_b = await _make_node(client, map_id, "B")
    resp = await client.post(
        f"/api/maps/{map_id}/links",
        json={
            "name": "unsafe",
            "source_id": node_a,
            "target_id": node_b,
            "info_url_out": "data:text/html,unsafe",
        },
    )
    assert resp.status_code == 422

    resp = await client.post(
        f"/api/maps/{map_id}/links",
        json={
            "name": "bad point",
            "source_id": node_a,
            "target_id": node_b,
            "via_points": [{"x": 10}],
        },
    )
    assert resp.status_code == 422


@pytest.mark.anyio
async def test_parent_must_be_group_in_same_map_and_acyclic(client: AsyncClient):
    map_a = await _make_map(client)
    map_b = await _make_map(client)
    child = await _make_node(client, map_a, "child")
    non_group = await _make_node(client, map_a, "router")
    foreign_group_resp = await client.post(
        f"/api/maps/{map_b}/nodes",
        json={"name": "foreign", "node_type": "group"},
    )
    foreign_group = foreign_group_resp.json()["id"]

    resp = await client.put(
        f"/api/maps/{map_a}/nodes/{child}", json={"parent_id": non_group}
    )
    assert resp.status_code == 422
    resp = await client.put(
        f"/api/maps/{map_a}/nodes/{child}", json={"parent_id": foreign_group}
    )
    assert resp.status_code == 422

    group_1_resp = await client.post(
        f"/api/maps/{map_a}/nodes", json={"name": "g1", "node_type": "group"}
    )
    group_2_resp = await client.post(
        f"/api/maps/{map_a}/nodes", json={"name": "g2", "node_type": "group"}
    )
    group_1 = group_1_resp.json()["id"]
    group_2 = group_2_resp.json()["id"]

    resp = await client.put(
        f"/api/maps/{map_a}/nodes/{group_2}", json={"parent_id": group_1}
    )
    assert resp.status_code == 200
    resp = await client.put(
        f"/api/maps/{map_a}/nodes/{group_1}", json={"parent_id": group_2}
    )
    assert resp.status_code == 422
    assert "cycle" in resp.json()["detail"].lower()

    resp = await client.put(
        f"/api/maps/{map_a}/nodes/{group_1}", json={"node_type": "router"}
    )
    assert resp.status_code == 422
    resp = await client.patch(
        f"/api/maps/{map_a}/nodes/batch",
        json={"node_ids": [group_1], "fields": {"node_type": "router"}},
    )
    assert resp.status_code == 422

    resp = await client.put(
        f"/api/maps/{map_a}/nodes/{child}", json={"parent_id": group_1}
    )
    assert resp.status_code == 200
    resp = await client.put(
        f"/api/maps/{map_a}/nodes/{child}", json={"parent_id": None}
    )
    assert resp.status_code == 200
    data = (await client.get(f"/api/maps/{map_a}")).json()
    saved_child = next(node for node in data["nodes"] if node["id"] == child)
    assert saved_child["parent_id"] is None


@pytest.mark.anyio
async def test_delete_node_removes_links_and_detaches_children(client: AsyncClient):
    map_id = await _make_map(client)
    group_resp = await client.post(
        f"/api/maps/{map_id}/nodes", json={"name": "group", "node_type": "group"}
    )
    group_id = group_resp.json()["id"]
    child_resp = await client.post(
        f"/api/maps/{map_id}/nodes",
        json={"name": "child", "node_type": "router", "parent_id": group_id},
    )
    child_id = child_resp.json()["id"]
    link_resp = await client.post(
        f"/api/maps/{map_id}/links",
        json={"name": "link", "source_id": group_id, "target_id": child_id},
    )
    assert link_resp.status_code == 200

    resp = await client.delete(f"/api/maps/{map_id}/nodes/{group_id}")
    assert resp.status_code == 200
    data = (await client.get(f"/api/maps/{map_id}")).json()
    saved_child = next(node for node in data["nodes"] if node["id"] == child_id)
    assert saved_child["parent_id"] is None
    assert data["links"] == []
