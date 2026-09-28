"""Link/node status, B-side swap, graph authorization, public history,
RRD async/null gaps, Observium cache, batch delete, map visibility."""

import asyncio
import os
import time
from types import SimpleNamespace

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
    resp = await client.post("/api/maps", json={"name": "Status Map"})
    assert resp.status_code == 200
    return resp.json()["id"]


async def _make_node(client: AsyncClient, map_id: str, name: str, **extra) -> str:
    resp = await client.post(
        f"/api/maps/{map_id}/nodes",
        json={"name": name, "node_type": "router", **extra},
    )
    assert resp.status_code == 200
    return resp.json()["id"]


async def _make_link(client: AsyncClient, map_id: str, a: str, b: str, **extra) -> str:
    resp = await client.post(
        f"/api/maps/{map_id}/links",
        json={"name": "l", "source_id": a, "target_id": b, **extra},
    )
    assert resp.status_code == 200
    return resp.json()["id"]


def _link(**kw):
    base = {
        "id": "l1",
        "observium_port_id_a": None,
        "observium_port_id_b": None,
        "bandwidth": 1e9,
    }
    base.update(kw)
    return SimpleNamespace(**base)


NOW = 1_700_000_000


# ── compute_link_traffic (unit) ─────────────────────────────────────────


def test_status_unbound_and_nodata():
    from app.services.traffic import compute_link_traffic

    entry = compute_link_traffic(_link(), {}, NOW)
    assert entry["status"] == "unbound"
    assert entry["updated_at"] is None
    assert entry["in_bps"] == 0 and entry["out_pct"] == 0

    entry = compute_link_traffic(_link(observium_port_id_a=1), {}, NOW)
    assert entry["status"] == "nodata"
    assert entry["updated_at"] is None


@pytest.mark.parametrize(
    ("row", "expected"),
    [
        ({"ifOperStatus": "up", "ifAdminStatus": "up", "poll_time": NOW - 60}, "ok"),
        ({"ifOperStatus": "down", "ifAdminStatus": "down"}, "admin_down"),
        ({"ifOperStatus": "down", "ifAdminStatus": "up"}, "down"),
        ({"ifOperStatus": "lowerLayerDown"}, "down"),
        ({"ifOperStatus": "up", "poll_time": NOW - 16 * 60}, "stale"),
        ({"ifOperStatus": None, "ifAdminStatus": None, "poll_time": None}, "ok"),
        ({"ifOperStatus": "unknown"}, "ok"),
        ({}, "ok"),
    ],
)
def test_status_from_port_row(row, expected):
    from app.services.traffic import compute_link_traffic

    port = {"port_id": 1, "ifInOctets_rate": 125, "ifOutOctets_rate": 250, **row}
    entry = compute_link_traffic(_link(observium_port_id_a=1), {1: port}, NOW)
    assert entry["status"] == expected
    # Numbers are unchanged for down links.
    assert entry["in_bps"] == 1000.0
    assert entry["out_bps"] == 2000.0


def test_updated_at_is_chosen_port_poll_time():
    from app.services.traffic import compute_link_traffic

    ports = {
        2: {"ifInOctets_rate": 0, "ifOutOctets_rate": 0, "poll_time": NOW - 5},
    }
    link = _link(observium_port_id_a=1, observium_port_id_b=2)
    entry = compute_link_traffic(link, ports, NOW)
    assert entry["updated_at"] == NOW - 5
    assert entry["status"] == "ok"


def test_b_side_swaps_in_out():
    from app.services.traffic import compute_link_traffic

    ports = {2: {"ifInOctets_rate": 1000, "ifOutOctets_rate": 10}}
    link = _link(observium_port_id_a=1, observium_port_id_b=2)
    entry = compute_link_traffic(link, ports, NOW)
    assert entry["in_bps"] == 80.0
    assert entry["out_bps"] == 8000.0


@pytest.mark.parametrize(
    ("bandwidth", "row", "expected_pct"),
    [
        # Explicit link bandwidth wins.
        (1e9, {"ifHighSpeed": 100_000, "ifSpeed": 4_294_967_295}, 10.0),
        # ifHighSpeed (Mbps) preferred over the 32-bit capped ifSpeed.
        (0, {"ifHighSpeed": 10_000, "ifSpeed": 4_294_967_295}, 1.0),
        (None, {"ifHighSpeed": 0, "ifSpeed": 1_000_000_000}, 10.0),
        (0, {"ifHighSpeed": None, "ifSpeed": None}, 10.0),
    ],
)
def test_bandwidth_fallback(bandwidth, row, expected_pct):
    from app.services.traffic import compute_link_traffic

    # 12_500_000 B/s = 100 Mbit/s
    port = {"ifInOctets_rate": 12_500_000, "ifOutOctets_rate": 0, **row}
    link = _link(observium_port_id_a=1, bandwidth=bandwidth)
    entry = compute_link_traffic(link, {1: port}, NOW)
    assert entry["in_pct"] == expected_pct


@pytest.mark.parametrize(
    ("row", "expected"),
    [
        (None, "unknown"),
        ({"status": 1, "disabled": 0, "ignore": 0}, "up"),
        ({"status": 0, "disabled": 0, "ignore": 0}, "down"),
        ({"status": 1, "disabled": 1, "ignore": 0}, "unknown"),
        ({"status": 0, "disabled": 0, "ignore": 1}, "unknown"),
        ({"status": None}, "unknown"),
    ],
)
def test_node_status(row, expected):
    from app.services.traffic import compute_node_status

    assert compute_node_status(row) == expected


# ── Live traffic / node status endpoints ────────────────────────────────


@pytest.mark.anyio
async def test_private_and_public_live_traffic_status(client, monkeypatch):
    import app.datasources.observium as observium_mod

    map_id = await _make_map(client)
    a = await _make_node(client, map_id, "A")
    b = await _make_node(client, map_id, "B")
    bound = await _make_link(
        client, map_id, a, b, observium_port_id_a=100, observium_port_id_b=200
    )
    unbound = await _make_link(client, map_id, a, b)
    poll = int(time.time()) - 30

    async def fake_batch(port_ids):
        return {
            200: {
                "port_id": 200,
                "ifInOctets_rate": 12_500_000,
                "ifOutOctets_rate": 0,
                "ifOperStatus": "down",
                "ifAdminStatus": "up",
                "poll_time": poll,
            }
        }

    monkeypatch.setattr(observium_mod, "get_ports_traffic", fake_batch)

    data = (await client.get(f"/api/datasources/traffic/live?map_id={map_id}")).json()
    assert data[bound]["status"] == "down"
    assert data[bound]["updated_at"] == poll
    assert data[bound]["out_pct"] == 10.0  # B side swapped
    assert data[unbound]["status"] == "unbound"

    token = (await client.post(f"/api/maps/{map_id}/share")).json()["public_token"]
    resp = await client.get(f"/api/public/maps/{token}/traffic")
    assert resp.status_code == 200
    public = resp.json()
    assert public[bound] == {
        "in_pct": 0.0,
        "out_pct": 10.0,
        "status": "down",
        "updated_at": poll,
    }
    assert public[unbound]["status"] == "unbound"

    await client.put(
        f"/api/maps/{map_id}", json={"public_settings": {"show_bps": True}}
    )
    public = (await client.get(f"/api/public/maps/{token}/traffic")).json()
    assert public[bound]["out_bps"] == 100_000_000.0
    assert public[bound]["in_bps"] == 0.0


@pytest.mark.anyio
async def test_nodes_status_private_and_public(client, monkeypatch):
    import app.datasources.observium as observium_mod

    map_id = await _make_map(client)
    up = await _make_node(client, map_id, "up", observium_device_id=4242)
    down = await _make_node(client, map_id, "down", observium_device_id=4343)
    ignored = await _make_node(client, map_id, "ign", observium_device_id=4444)
    gone = await _make_node(client, map_id, "gone", observium_device_id=4545)
    unbound = await _make_node(client, map_id, "plain")
    calls: list[list[int]] = []

    async def fake_devices(device_ids):
        calls.append(sorted(device_ids))
        return {
            4242: {"device_id": 4242, "status": 1, "disabled": 0, "ignore": 0},
            4343: {"device_id": 4343, "status": 0, "disabled": 0, "ignore": 0},
            4444: {"device_id": 4444, "status": 1, "disabled": 0, "ignore": 1},
        }

    monkeypatch.setattr(observium_mod, "get_devices_status", fake_devices)

    resp = await client.get(f"/api/datasources/traffic/nodes?map_id={map_id}")
    assert resp.status_code == 200
    expected = {
        up: {"status": "up"},
        down: {"status": "down"},
        ignored: {"status": "unknown"},
        gone: {"status": "unknown"},
    }
    assert resp.json() == expected
    assert unbound not in resp.json()
    # One batched query for all bound devices.
    assert calls == [[4242, 4343, 4444, 4545]]

    token = (await client.post(f"/api/maps/{map_id}/share")).json()["public_token"]
    resp = await client.get(f"/api/public/maps/{token}/nodes-status")
    assert resp.status_code == 200
    assert resp.json() == expected
    for device_id in ("4242", "4343", "4444", "4545", "device"):
        assert device_id not in resp.text

    resp = await client.get("/api/public/maps/not-a-token/nodes-status")
    assert resp.status_code == 404


# ── Graph authorization (private history) ───────────────────────────────


@pytest.mark.anyio
async def test_viewer_can_read_history_without_show_graph(client, monkeypatch):
    import app.datasources.observium as observium_mod
    import app.datasources.rrd as rrd_mod
    from app.auth.oauth import get_current_user
    from app.config import get_settings
    from app.main import app

    map_id = await _make_map(client)  # internal by default, owned by local user
    a = await _make_node(client, map_id, "A")
    b = await _make_node(client, map_id, "B")
    await _make_link(
        client,
        map_id,
        a,
        b,
        observium_port_id_a=100,
        extra={"hostname": "rtr1", "port_identifier": "7"},
    )
    private_map = await _make_map(client)
    c = await _make_node(client, private_map, "C")
    d = await _make_node(client, private_map, "D")
    await _make_link(client, private_map, c, d, observium_port_id_a=100)
    resp = await client.put(f"/api/maps/{private_map}", json={"visibility": "private"})
    assert resp.status_code == 200

    async def fake_info(port_id):
        return {"hostname": "rtr1", "port_id": port_id, "ifIndex": 7}

    async def fake_history(hostname, port_identifier, start, end, resolution):
        return {"timestamps": [1], "in_bps": [1.0], "out_bps": [None]}

    monkeypatch.setattr(observium_mod, "get_port_rrd_info", fake_info)
    monkeypatch.setattr(rrd_mod, "fetch_history", fake_history)

    settings = get_settings()
    monkeypatch.setattr(settings, "oauth_editor_role", "netmap-editor")
    monkeypatch.setattr(settings, "oauth_admin_role", "netmap-admin")
    app.dependency_overrides[get_current_user] = lambda: {
        "email": "viewer@example.com",
        "roles": [],
    }

    resp = await client.get(
        f"/api/datasources/traffic/history/by-port?port_id=100&map_id={map_id}"
    )
    assert resp.status_code == 200
    assert resp.json()["out_bps"] == [None]
    resp = await client.get(
        "/api/datasources/traffic/history"
        f"?hostname=rtr1&port_identifier=7&map_id={map_id}"
    )
    assert resp.status_code == 200

    # A viewer still cannot read a private map's history.
    resp = await client.get(
        f"/api/datasources/traffic/history/by-port?port_id=100&map_id={private_map}"
    )
    assert resp.status_code == 403


# ── Public history ──────────────────────────────────────────────────────


@pytest.mark.anyio
async def test_public_link_history(client, monkeypatch):
    import app.datasources.observium as observium_mod
    import app.datasources.rrd as rrd_mod

    map_id = await _make_map(client)
    a = await _make_node(client, map_id, "A")
    b = await _make_node(client, map_id, "B")
    link_id = await _make_link(
        client, map_id, a, b, observium_port_id_a=100, observium_port_id_b=200
    )
    other_map = await _make_map(client)
    c = await _make_node(client, other_map, "C")
    d = await _make_node(client, other_map, "D")
    foreign_link = await _make_link(client, other_map, c, d, observium_port_id_a=1)

    async def fake_info(port_id):
        # Port A is unknown to Observium -> fall back to port B.
        if port_id == 200:
            return {"hostname": "rtr-b", "port_id": 200, "ifIndex": 12}
        return None

    seen = {}

    async def fake_history(hostname, port_identifier, start, end, resolution):
        seen.update(host=hostname, port=port_identifier, start=start, res=resolution)
        return {"timestamps": [1, 2], "in_bps": [10.0, None], "out_bps": [20.0, 30.0]}

    monkeypatch.setattr(observium_mod, "get_port_rrd_info", fake_info)
    monkeypatch.setattr(rrd_mod, "fetch_history", fake_history)

    token = (await client.post(f"/api/maps/{map_id}/share")).json()["public_token"]
    url = f"/api/public/maps/{token}/links/{link_id}/history"

    # show_graph off (default) -> 404
    assert (await client.get(url)).status_code == 404

    await client.put(
        f"/api/maps/{map_id}", json={"public_settings": {"show_graph": True}}
    )
    resp = await client.get(url, params={"start": "-7d", "resolution": 3600})
    assert resp.status_code == 200
    # B side -> swapped to A's point of view
    assert resp.json() == {
        "timestamps": [1, 2],
        "in_bps": [20.0, 30.0],
        "out_bps": [10.0, None],
    }
    assert seen == {"host": "rtr-b", "port": "12", "start": "-7d", "res": 3600}

    # Link from another map -> 404
    resp = await client.get(f"/api/public/maps/{token}/links/{foreign_link}/history")
    assert resp.status_code == 404
    # Resolution bounds validated
    resp = await client.get(url, params={"resolution": 5})
    assert resp.status_code == 422


# ── RRD: async subprocess + null gaps ───────────────────────────────────


class _FakeProc:
    def __init__(self, stdout: bytes = b"", returncode: int = 0, hang: bool = False):
        self._stdout = stdout
        self.returncode = returncode
        self._hang = hang
        self.killed = False

    async def communicate(self):
        if self._hang:
            await asyncio.sleep(10)
        return self._stdout, b""

    def kill(self):
        self.killed = True

    async def wait(self):
        return -9


@pytest.fixture
def rrd_file(tmp_path, monkeypatch):
    import app.datasources.rrd as rrd_mod

    (tmp_path / "rtr1").mkdir()
    (tmp_path / "rtr1" / "port-7.rrd").write_bytes(b"")
    monkeypatch.setattr(
        rrd_mod,
        "get_settings",
        lambda: SimpleNamespace(observium_rrd_path=str(tmp_path)),
    )
    return rrd_mod


@pytest.mark.anyio
async def test_rrd_history_gaps_are_null(rrd_file, monkeypatch):
    output = (
        b'{"meta": {"start": 1000, "step": 300}, '
        b'"data": [[8.0, null], [NaN, 16.0], ["NaN", "1e3"]]}'
    )
    captured = {}

    async def fake_exec(*cmd, **kwargs):
        captured["cmd"] = cmd
        return _FakeProc(output)

    monkeypatch.setattr(rrd_file.asyncio, "create_subprocess_exec", fake_exec)
    data = await rrd_file.fetch_history("rtr1", "7", "-1h", "now", 300)
    assert data == {
        "timestamps": [1000, 1300, 1600],
        "in_bps": [8.0, None, None],
        "out_bps": [None, 16.0, 1000.0],
    }
    assert captured["cmd"][:2] == ("rrdtool", "xport")


@pytest.mark.anyio
async def test_rrd_history_timeout_kills_process(rrd_file, monkeypatch):
    proc = _FakeProc(hang=True)

    async def fake_exec(*cmd, **kwargs):
        return proc

    monkeypatch.setattr(rrd_file.asyncio, "create_subprocess_exec", fake_exec)
    monkeypatch.setattr(rrd_file, "RRD_TIMEOUT_SECONDS", 0.05)
    data = await rrd_file.fetch_history("rtr1", "7")
    assert data == {"timestamps": [], "in_bps": [], "out_bps": []}
    assert proc.killed


@pytest.mark.anyio
async def test_rrd_history_keeps_validation(rrd_file):
    from fastapi import HTTPException

    with pytest.raises(HTTPException):
        await rrd_file.fetch_history("../etc", "7")
    with pytest.raises(HTTPException):
        await rrd_file.fetch_history("rtr1", "7", start="; rm -rf /")
    with pytest.raises(HTTPException):
        await rrd_file.fetch_history("rtr1", "7", resolution=10)


# ── Observium TTL cache ─────────────────────────────────────────────────


@pytest.mark.anyio
async def test_observium_ports_cache(monkeypatch):
    import app.datasources.observium as obs

    obs.clear_cache()
    clock = {"t": 1000.0}
    calls: list[list[int]] = []

    async def fake_query(port_ids):
        calls.append(port_ids)
        return {pid: {"port_id": pid} for pid in port_ids}

    monkeypatch.setattr(obs, "_now", lambda: clock["t"])
    monkeypatch.setattr(obs, "_query_ports_traffic", fake_query)

    assert await obs.get_ports_traffic([]) == {}
    first = await obs.get_ports_traffic([2, 1, 2, None])
    assert set(first) == {1, 2}
    # Same id set in a different order -> cache hit
    await obs.get_ports_traffic([1, 2])
    assert calls == [[1, 2]]
    # Different set -> miss
    await obs.get_ports_traffic([1])
    assert len(calls) == 2
    # Expiry
    clock["t"] += obs.CACHE_TTL_SECONDS + 1
    await obs.get_ports_traffic([1, 2])
    assert len(calls) == 3
    obs.clear_cache()


@pytest.mark.anyio
async def test_observium_cache_is_bounded(monkeypatch):
    import app.datasources.observium as obs

    obs.clear_cache()
    monkeypatch.setattr(obs, "CACHE_MAX_ENTRIES", 3)

    async def fake_query(device_ids):
        return {}

    monkeypatch.setattr(obs, "_query_devices_status", fake_query)
    for i in range(1, 10):
        await obs.get_devices_status([i])
    assert len(obs._cache) <= 3
    obs.clear_cache()


# ── Batch delete ────────────────────────────────────────────────────────


@pytest.mark.anyio
async def test_batch_delete(client):
    map_id = await _make_map(client)
    group = await _make_node(client, map_id, "g", node_type="group")
    child = await _make_node(client, map_id, "c", parent_id=group)
    a = await _make_node(client, map_id, "a")
    b = await _make_node(client, map_id, "b")
    keep = await _make_node(client, map_id, "keep")
    l_group = await _make_link(client, map_id, group, keep)  # attached to group
    l_ab = await _make_link(client, map_id, a, b)  # requested explicitly
    l_keep = await _make_link(client, map_id, keep, child)  # survives

    resp = await client.post(
        f"/api/maps/{map_id}/nodes/batch-delete",
        json={"node_ids": [group, group], "link_ids": [l_ab]},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["deleted_node_ids"] == [group]
    assert set(body["deleted_link_ids"]) == {l_group, l_ab}

    data = (await client.get(f"/api/maps/{map_id}")).json()
    nodes = {n["id"]: n for n in data["nodes"]}
    assert set(nodes) == {child, a, b, keep}
    assert nodes[child]["parent_id"] is None  # detached, like single delete
    assert [lnk["id"] for lnk in data["links"]] == [l_keep]


@pytest.mark.anyio
async def test_batch_delete_nested_groups_and_empty(client):
    map_id = await _make_map(client)
    outer = await _make_node(client, map_id, "outer", node_type="group")
    inner = await _make_node(
        client, map_id, "inner", node_type="group", parent_id=outer
    )
    leaf = await _make_node(client, map_id, "leaf", parent_id=inner)

    resp = await client.post(
        f"/api/maps/{map_id}/nodes/batch-delete", json={"node_ids": [outer, inner]}
    )
    assert resp.status_code == 200
    data = (await client.get(f"/api/maps/{map_id}")).json()
    assert [(n["id"], n["parent_id"]) for n in data["nodes"]] == [(leaf, None)]

    resp = await client.post(f"/api/maps/{map_id}/nodes/batch-delete", json={})
    assert resp.status_code == 200
    assert resp.json() == {"deleted_node_ids": [], "deleted_link_ids": []}


@pytest.mark.anyio
async def test_batch_delete_rejects_foreign_ids_atomically(client):
    map_id = await _make_map(client)
    other = await _make_map(client)
    a = await _make_node(client, map_id, "a")
    b = await _make_node(client, map_id, "b")
    link = await _make_link(client, map_id, a, b)
    x = await _make_node(client, other, "x")
    y = await _make_node(client, other, "y")
    foreign_link = await _make_link(client, other, x, y)

    for payload in (
        {"node_ids": [a, x]},
        {"node_ids": [a], "link_ids": [foreign_link]},
        {"link_ids": [link, "ghost"]},
    ):
        resp = await client.post(f"/api/maps/{map_id}/nodes/batch-delete", json=payload)
        assert resp.status_code == 404

    data = (await client.get(f"/api/maps/{map_id}")).json()
    assert {n["id"] for n in data["nodes"]} == {a, b}
    assert [lnk["id"] for lnk in data["links"]] == [link]

    resp = await client.post(
        f"/api/maps/{map_id}/nodes/batch-delete",
        json={"node_ids": ["n"] * 1001},
    )
    assert resp.status_code == 422


# ── Map visibility validation ───────────────────────────────────────────


@pytest.mark.anyio
async def test_map_visibility_is_validated(client):
    map_id = await _make_map(client)
    resp = await client.put(f"/api/maps/{map_id}", json={"visibility": "everyone"})
    assert resp.status_code == 422
    for value in ("private", "internal", "public"):
        resp = await client.put(f"/api/maps/{map_id}", json={"visibility": value})
        assert resp.status_code == 200
