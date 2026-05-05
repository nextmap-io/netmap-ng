"""Round-trip + validation tests for the typed Map / Node / Link API."""

from __future__ import annotations

import os

import pytest
from httpx import ASGITransport, AsyncClient

os.environ.setdefault("APP_SECRET_KEY", "test-secret-key-for-tests")
os.environ.setdefault("AUTH_DISABLED", "true")
os.environ.setdefault("APP_DB_URL", "sqlite+aiosqlite:///:memory:")


@pytest.fixture
def anyio_backend() -> str:
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
    resp = await client.post("/api/maps", json={"name": "T"})
    assert resp.status_code == 200
    return resp.json()["id"]


# ──────────────────────────── Map schema ────────────────────────────


@pytest.mark.anyio
async def test_map_create_rejects_unknown_field(client: AsyncClient):
    resp = await client.post("/api/maps", json={"name": "X", "trojan": 1})
    assert resp.status_code == 422


@pytest.mark.anyio
async def test_map_update_rejects_visibility_public(client: AsyncClient):
    map_id = await _make_map(client)
    resp = await client.put(f"/api/maps/{map_id}", json={"visibility": "public"})
    assert resp.status_code == 422


@pytest.mark.anyio
async def test_map_update_accepts_internal_visibility(client: AsyncClient):
    map_id = await _make_map(client)
    resp = await client.put(f"/api/maps/{map_id}", json={"visibility": "internal"})
    assert resp.status_code == 200


@pytest.mark.anyio
async def test_map_update_public_settings_strict(client: AsyncClient):
    map_id = await _make_map(client)
    # Unknown key in public_settings → 422
    resp = await client.put(
        f"/api/maps/{map_id}",
        json={"public_settings": {"show_bps": True, "evil": True}},
    )
    assert resp.status_code == 422
    # Allowed booleans → 200
    resp = await client.put(
        f"/api/maps/{map_id}",
        json={
            "public_settings": {
                "show_bps": True,
                "show_traffic": False,
                "show_node_names": False,
                "show_description": True,
            }
        },
    )
    assert resp.status_code == 200


@pytest.mark.anyio
async def test_map_update_scales_color_validated(client: AsyncClient):
    map_id = await _make_map(client)
    bad = {
        "scales": {
            "default": [
                {"min": 0, "max": 50, "color": "javascript:alert(1)"},
            ]
        }
    }
    resp = await client.put(f"/api/maps/{map_id}", json=bad)
    assert resp.status_code == 422

    ok = {
        "scales": {
            "default": [
                {"min": 0, "max": 50, "color": "#aabbcc"},
            ]
        }
    }
    resp = await client.put(f"/api/maps/{map_id}", json=ok)
    assert resp.status_code == 200


@pytest.mark.anyio
async def test_map_share_then_unshare(client: AsyncClient):
    map_id = await _make_map(client)
    resp = await client.post(f"/api/maps/{map_id}/share")
    assert resp.status_code == 200
    body = resp.json()
    assert body["public_token"]
    assert body["share_url"].startswith("/public/")

    resp = await client.delete(f"/api/maps/{map_id}/share")
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}


# ──────────────────────────── Node schema ────────────────────────────


@pytest.mark.anyio
async def test_node_create_rejects_javascript_url(client: AsyncClient):
    map_id = await _make_map(client)
    resp = await client.post(
        f"/api/maps/{map_id}/nodes",
        json={"name": "n", "info_url": "javascript:alert(1)"},
    )
    assert resp.status_code == 422


@pytest.mark.anyio
async def test_node_create_rejects_unknown_extra_key(client: AsyncClient):
    map_id = await _make_map(client)
    resp = await client.post(
        f"/api/maps/{map_id}/nodes",
        json={"name": "n", "extra": {"unexpected": "bad"}},
    )
    assert resp.status_code == 422


@pytest.mark.anyio
async def test_node_create_round_trip_locked_zorder_icon(client: AsyncClient):
    map_id = await _make_map(client)
    resp = await client.post(
        f"/api/maps/{map_id}/nodes",
        json={
            "name": "n",
            "label": "Server",
            "node_type": "server",
            "z_order": 700,
            "locked": True,
            "icon": "srv",
        },
    )
    assert resp.status_code == 200
    node_id = resp.json()["id"]

    resp = await client.get(f"/api/maps/{map_id}")
    assert resp.status_code == 200
    nodes = resp.json()["nodes"]
    target = next(n for n in nodes if n["id"] == node_id)
    assert target["locked"] is True
    assert target["z_order"] == 700
    assert target["icon"] == "srv"


@pytest.mark.anyio
async def test_node_update_can_clear_parent_id_with_null(client: AsyncClient):
    map_id = await _make_map(client)
    parent = await client.post(
        f"/api/maps/{map_id}/nodes", json={"name": "p", "node_type": "group"}
    )
    parent_id = parent.json()["id"]
    child = await client.post(
        f"/api/maps/{map_id}/nodes",
        json={"name": "c", "parent_id": parent_id},
    )
    child_id = child.json()["id"]

    # PATCH with parent_id explicitly null clears it.
    resp = await client.put(
        f"/api/maps/{map_id}/nodes/{child_id}", json={"parent_id": None}
    )
    assert resp.status_code == 200

    snap = await client.get(f"/api/maps/{map_id}")
    nodes = {n["id"]: n for n in snap.json()["nodes"]}
    assert nodes[child_id]["parent_id"] is None


@pytest.mark.anyio
async def test_node_parent_id_must_belong_to_same_map(client: AsyncClient):
    map_a = await _make_map(client)
    map_b = await _make_map(client)
    resp = await client.post(
        f"/api/maps/{map_b}/nodes", json={"name": "p", "node_type": "group"}
    )
    other_parent = resp.json()["id"]

    bad = await client.post(
        f"/api/maps/{map_a}/nodes",
        json={"name": "c", "parent_id": other_parent},
    )
    assert bad.status_code == 422


# ──────────────────────────── Link schema ────────────────────────────


async def _two_nodes(client: AsyncClient, map_id: str) -> tuple[str, str]:
    a = (await client.post(f"/api/maps/{map_id}/nodes", json={"name": "a"})).json()[
        "id"
    ]
    b = (await client.post(f"/api/maps/{map_id}/nodes", json={"name": "b"})).json()[
        "id"
    ]
    return a, b


@pytest.mark.anyio
async def test_link_create_rejects_data_url(client: AsyncClient):
    map_id = await _make_map(client)
    a, b = await _two_nodes(client, map_id)
    resp = await client.post(
        f"/api/maps/{map_id}/links",
        json={
            "name": "l",
            "source_id": a,
            "target_id": b,
            "info_url_in": "data:text/html,<script>",
        },
    )
    assert resp.status_code == 422


@pytest.mark.anyio
async def test_link_round_trip_arrow_style_duplex_zorder(client: AsyncClient):
    map_id = await _make_map(client)
    a, b = await _two_nodes(client, map_id)
    resp = await client.post(
        f"/api/maps/{map_id}/links",
        json={
            "name": "l",
            "source_id": a,
            "target_id": b,
            "arrow_style": "thin",
            "duplex": "half",
            "z_order": 555,
        },
    )
    assert resp.status_code == 200, resp.text
    link_id = resp.json()["id"]

    snap = await client.get(f"/api/maps/{map_id}")
    link = next(lnk for lnk in snap.json()["links"] if lnk["id"] == link_id)
    assert link["arrow_style"] == "thin"
    assert link["duplex"] == "half"
    assert link["z_order"] == 555


@pytest.mark.anyio
async def test_link_datasource_discriminated_union(client: AsyncClient):
    map_id = await _make_map(client)
    a, b = await _two_nodes(client, map_id)

    # Static OK
    resp = await client.post(
        f"/api/maps/{map_id}/links",
        json={
            "name": "l1",
            "source_id": a,
            "target_id": b,
            "datasource": {"type": "static", "in": 0, "out": 0},
        },
    )
    assert resp.status_code == 200

    # Unknown datasource type rejected
    bad = await client.post(
        f"/api/maps/{map_id}/links",
        json={
            "name": "l2",
            "source_id": a,
            "target_id": b,
            "datasource": {"type": "wormhole"},
        },
    )
    assert bad.status_code == 422


@pytest.mark.anyio
async def test_link_update_can_clear_observium_with_null(client: AsyncClient):
    map_id = await _make_map(client)
    a, b = await _two_nodes(client, map_id)
    create = await client.post(
        f"/api/maps/{map_id}/links",
        json={"name": "l", "source_id": a, "target_id": b, "observium_port_id_a": 42},
    )
    link_id = create.json()["id"]

    resp = await client.put(
        f"/api/maps/{map_id}/links/{link_id}", json={"observium_port_id_a": None}
    )
    assert resp.status_code == 200

    snap = await client.get(f"/api/maps/{map_id}")
    link = next(lnk for lnk in snap.json()["links"] if lnk["id"] == link_id)
    assert link["observium_port_id_a"] is None


# ──────────────────────────── Public filter ────────────────────────────


@pytest.mark.anyio
async def test_public_filter_redacts_node_name_when_show_node_names_false(
    client: AsyncClient,
):
    map_id = await _make_map(client)
    a = (
        await client.post(
            f"/api/maps/{map_id}/nodes", json={"name": "secret-host", "label": "Edge"}
        )
    ).json()["id"]
    b = (
        await client.post(f"/api/maps/{map_id}/nodes", json={"name": "core-1"})
    ).json()["id"]
    await client.post(
        f"/api/maps/{map_id}/links",
        json={
            "name": "internal",
            "source_id": a,
            "target_id": b,
            "info_url_in": "https://example.invalid/g",
            "extra": {"interface_a": "Eth0", "provider": "Acme"},
        },
    )

    share = await client.post(f"/api/maps/{map_id}/share")
    token = share.json()["public_token"]

    pub = await client.get(f"/api/public/maps/{token}")
    assert pub.status_code == 200
    body = pub.json()

    nodes = body["nodes"]
    assert all(n["name"].startswith("node-") for n in nodes)
    # Sensitive fields stripped
    for n in nodes:
        assert "observium_device_id" not in n
        assert "info_url" not in n
        assert "extra" not in n

    links = body["links"]
    for lnk in links:
        assert "info_url_in" not in lnk
        assert "info_url_out" not in lnk
        assert "datasource" not in lnk
        assert "observium_port_id_a" not in lnk
        assert "observium_port_id_b" not in lnk
        # extra projected to the visual-only allow-list
        assert set(lnk["extra"].keys()) <= {
            "routing",
            "line_style",
            "color_override",
            "label_position",
        }


@pytest.mark.anyio
async def test_public_filter_show_node_names_true_preserves_name(
    client: AsyncClient,
):
    map_id = await _make_map(client)
    a = (
        await client.post(f"/api/maps/{map_id}/nodes", json={"name": "switch-A"})
    ).json()["id"]
    assert a
    await client.put(
        f"/api/maps/{map_id}",
        json={
            "public_settings": {
                "show_bps": False,
                "show_bandwidth": True,
                "show_percentage": True,
                "show_traffic": True,
                "show_graph": False,
                "show_node_names": True,
                "show_description": False,
            }
        },
    )
    share = await client.post(f"/api/maps/{map_id}/share")
    token = share.json()["public_token"]
    pub = await client.get(f"/api/public/maps/{token}")
    names = {n["name"] for n in pub.json()["nodes"]}
    assert "switch-A" in names


@pytest.mark.anyio
async def test_public_listing_supports_pagination(client: AsyncClient):
    # No assertion on specific count — just ensures the params are accepted
    # and respected when the endpoint is enabled at runtime.
    resp = await client.get("/api/public/maps?limit=10&offset=0")
    # may return 403 if PUBLIC_INDEX disabled, which is fine — we just need
    # to confirm validation does not 422 the params.
    assert resp.status_code in (200, 403)


# ──────────────────────────── Datasources ────────────────────────────


@pytest.mark.anyio
async def test_traffic_history_by_hostname_route_removed(client: AsyncClient):
    resp = await client.get(
        "/api/datasources/traffic/history",
        params={"hostname": "x", "port_identifier": "y", "map_id": "z"},
    )
    assert resp.status_code == 404
