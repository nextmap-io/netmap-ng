#!/usr/bin/env python3
"""
Seed the first Netmap NG map for AS35426 - LeKloud Network.
Reads live data from the Observium API and creates a complete topology.

Usage:
    python3 scripts/seed_map.py https://weathermap.lekloud.net
"""

import json
import sys
import urllib.request

BASE = sys.argv[1].rstrip("/") if len(sys.argv) > 1 else "https://weathermap.lekloud.net"


def api(method, path, data=None):
    body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(
        f"{BASE}{path}",
        data=body,
        headers={"Content-Type": "application/json"} if body else {},
        method=method,
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


# ── Create map ──────────────────────────────────────────────
print("Creating map...")
maps = api("GET", "/api/maps")
existing = [m for m in maps if m["name"] == "AS35426 - LeKloud Network"]
if existing:
    map_id = existing[0]["id"]
    print(f"  Map already exists: {map_id}")
else:
    result = api("POST", "/api/maps", {
        "name": "AS35426 - LeKloud Network",
        "description": "LeKloud / Nextmap production network - Equinix PA6 & PA3, NXT1",
        "width": 1920,
        "height": 1080,
    })
    map_id = result["id"]
    print(f"  Created: {map_id}")

# ── Fetch Observium data ────────────────────────────────────
print("Fetching Observium data...")
devices_raw = api("GET", "/api/datasources/observium/devices")
neighbours = api("GET", "/api/datasources/observium/neighbours")
devices_by_id = {d["device_id"]: d for d in devices_raw}

# Fetch ports for key network devices
key_device_ids = [261, 262, 283, 359, 358, 299, 360, 241]
device_ports = {}
for did in key_device_ids:
    device_ports[did] = api("GET", f"/api/datasources/observium/devices/{did}/ports")

print(f"  {len(devices_raw)} devices, {len(neighbours)} neighbours")

# ── Helper ──────────────────────────────────────────────────
node_ids = {}


def add_node(name, label, node_type, x, y, parent_id=None, observium_device_id=None,
             width=None, height=None, extra=None):
    data = {
        "name": name, "label": label, "node_type": node_type,
        "x": x, "y": y,
        "observium_device_id": observium_device_id,
        "extra": extra or {},
    }
    if parent_id and parent_id in node_ids:
        data["parent_id"] = node_ids[parent_id]
    if width:
        data["width"] = width
    if height:
        data["height"] = height
    result = api("POST", f"/api/maps/{map_id}/nodes", data)
    node_ids[name] = result["id"]
    return result["id"]


def add_link(name, source, target, link_type="internal", bandwidth=10e9, bandwidth_label="10G",
             source_anchor=None, target_anchor=None, obs_port_a=None, obs_port_b=None,
             width=4, extra=None):
    if source not in node_ids or target not in node_ids:
        print(f"  SKIP link {name}: missing node {source} or {target}")
        return
    data = {
        "name": name, "link_type": link_type,
        "source_id": node_ids[source], "target_id": node_ids[target],
        "bandwidth": bandwidth, "bandwidth_label": bandwidth_label,
        "width": width,
        "extra": extra or {},
    }
    if source_anchor:
        data["source_anchor"] = source_anchor
    if target_anchor:
        data["target_anchor"] = target_anchor
    if obs_port_a:
        data["observium_port_id_a"] = obs_port_a
    if obs_port_b:
        data["observium_port_id_b"] = obs_port_b
    api("POST", f"/api/maps/{map_id}/links", data)


def find_port(device_id, ifname_pattern):
    """Find port_id by interface name pattern."""
    for p in device_ports.get(device_id, []):
        if p.get("ifName", "").lower() == ifname_pattern.lower():
            return p["port_id"]
    return None


# ══════════════════════════════════════════════════════════════
# BUILD THE MAP
# ══════════════════════════════════════════════════════════════

print("Creating nodes...")

# ── GROUPS ──────────────────────────────────────────────────
add_node("grp-eqx6", "Equinix PA6 - Aubervilliers", "group", 20, 20, width=1100, height=950)
add_node("grp-eqx3", "Equinix PA3 - Saint-Denis", "group", 1160, 20, width=380, height=450)
add_node("grp-nxt1", "NXT1 - Paris 13e", "group", 1160, 500, width=380, height=250)
add_node("grp-ext", "External / Transit / IX", "group", 1560, 20, width=340, height=450)

# ── ROUTERS / EDGE (top of PA6 group) ──────────────────────
add_node("er04", "er04.eqx6-par", "router", 400, 60, "grp-eqx6", 359,
         extra={"hw": "MX204"})
add_node("er03", "er03.eqx3-par", "router", 160, 60, "grp-eqx3", 358,
         extra={"hw": "ASR1002"})
add_node("ccr2k4-nxt1", "ccr2k4.nxt1-par", "router", 160, 60, "grp-nxt1", 299,
         extra={"hw": "CCR2004-1G-12S+2XS"})

# ── CORE SWITCHES (middle of PA6 group) ────────────────────
add_node("ss01", "ss01.eqx6-par", "switch_l3", 220, 250, "grp-eqx6", 261,
         extra={"hw": "DCS-7050SX-64"})
add_node("ss02", "ss02.eqx6-par", "switch_l3", 620, 250, "grp-eqx6", 262,
         extra={"hw": "DCS-7050SX-64"})

# ── ACCESS ROUTERS ──────────────────────────────────────────
add_node("ccr1k9-vrc", "ccr1k9-01.vrc", "router", 60, 450, "grp-eqx6", 283,
         extra={"hw": "CCR1009"})
add_node("rb4k11", "rb4k11-col-01", "switch_l2", 620, 450, "grp-eqx6", 241,
         extra={"hw": "RB4011iGS+"})
add_node("sr02-eqx3", "sr02.eqx3-par", "router", 160, 200, "grp-eqx3", 360,
         extra={"hw": "CCR1009"})

# ── HYPERVISORS (bottom of PA6 group) ──────────────────────
y_base = 550
servers = [
    ("cn01", "cn01.eqx6-par", 288, 100),
    ("cn02", "cn02.eqx6-par", 294, 220),
    ("cn03", "cn03.eqx6-par", 293, 340),
    ("cn04", "cn04.eqx6-par", 295, 460),
    ("cn05", "cn05.eqx6-par", 292, 580),
    ("cn06", "cn06.eqx6-par", 291, 700),
    ("tn01", "tn01.eqx6-par", 287, 820),
    ("sn01", "sn01.eqx6-par", 289, 940),
]
for name, label, dev_id, x in servers:
    add_node(name, label, "server", x, y_base, "grp-eqx6", dev_id)

y_base2 = 680
hdn_servers = [
    ("hdn-cn07", "hdn01-cn07", 327, 200),
    ("hdn-cn08", "hdn01-cn08", 326, 400),
    ("hdn-cn09", "hdn01-cn09", 325, 600),
    ("hdn-cn10", "hdn01-cn10", 324, 800),
]
for name, label, dev_id, x in hdn_servers:
    add_node(name, label, "server", x, y_base2, "grp-eqx6", dev_id)

# ── STORAGE ─────────────────────────────────────────────────
add_node("sy01", "sy01.eqx6-par", "server", 940, y_base, "grp-eqx6", 285,
         extra={"hw": "RS1619xs+"})
add_node("bn01-eqx6", "bn01.eqx6-par", "server", 940, y_base2, "grp-eqx6", 301)
add_node("bn01-nxt1", "bn01.nxt1-par", "server", 280, 60, "grp-nxt1", 300)
add_node("sy03-nxt1", "sy03.nxt1-par", "server", 280, 140, "grp-nxt1", 365,
         extra={"hw": "DS1823xs+"})

# ── EXTERNAL / TRANSIT / IX ─────────────────────────────────
add_node("franceix", "FranceIX", "cloud", 80, 60, "grp-ext",
         extra={"provider": "FranceIX"})
add_node("equinixix", "Equinix IX", "cloud", 220, 60, "grp-ext",
         extra={"provider": "Equinix IX"})
add_node("kissgroup-pa3", "KG Transit PA3", "internet", 80, 170, "grp-ext",
         extra={"provider": "KissGroup"})
add_node("oti-transit", "OTI Transit", "internet", 220, 170, "grp-ext",
         extra={"provider": "OTI via FranceIX"})
add_node("appliwave", "Appliwave", "cloud", 150, 280, "grp-ext",
         extra={"provider": "Appliwave", "capacity": "10G"})

# ── FIREWALLS ───────────────────────────────────────────────
add_node("vpn-nextmap", "vpn.nextmap.io", "firewall", 420, 820, "grp-eqx6", 144)

print(f"  {len(node_ids)} nodes created")

# ══════════════════════════════════════════════════════════════
# LINKS
# ══════════════════════════════════════════════════════════════

print("Creating links...")

# ── CORE: er04 <-> ss01/ss02 (40G each) ────────────────────
add_link("er04-ss01", "er04", "ss01", "internal", 40e9, "40G",
         "S", "N", find_port(359, "et-0/0/0"), find_port(261, "Ethernet52/1"), width=6)
add_link("er04-ss02", "er04", "ss02", "internal", 40e9, "40G",
         "S:75", "N", find_port(359, "et-0/0/1"), find_port(262, "Ethernet52/1"), width=6)

# ── CORE: ss01 <-> ss02 (40G inter-switch) ─────────────────
add_link("ss01-ss02", "ss01", "ss02", "trunk", 40e9, "40G",
         "E", "W", find_port(261, "Ethernet49/1"), find_port(262, "Ethernet49/1"), width=6)

# ── ss01/ss02 -> hypervisors (10G each) ────────────────────
# ss01 connections
for name, port_name in [("cn01", "Ethernet11"), ("cn02", "Ethernet19"),
                         ("cn03", "Ethernet12"), ("cn04", "Ethernet18"),
                         ("cn05", "Ethernet10"), ("cn06", "Ethernet9"),
                         ("tn01", "Ethernet13"), ("sn01", "Ethernet16")]:
    pid = find_port(261, port_name)
    add_link(f"ss01-{name}", "ss01", name, "internal", 10e9, "10G",
             "S:25", "N", pid, width=3)

# ss01 -> HDN servers
for name, port_name in [("hdn-cn07", "Ethernet15"), ("hdn-cn08", "Ethernet17"),
                         ("hdn-cn09", "Ethernet20"), ("hdn-cn10", "Ethernet21")]:
    pid = find_port(261, port_name)
    add_link(f"ss01-{name}", "ss01", name, "internal", 10e9, "10G",
             "S:75", "N", pid, width=3)

# ss02 connections
for name, port_name in [("cn01", "Ethernet11"), ("cn02", "Ethernet19"),
                         ("cn03", "Ethernet12"), ("cn04", "Ethernet18"),
                         ("cn05", "Ethernet10"), ("cn06", "Ethernet9"),
                         ("tn01", "Ethernet13"), ("sn01", "Ethernet16")]:
    pid = find_port(262, port_name)
    add_link(f"ss02-{name}", "ss02", name, "internal", 10e9, "10G",
             "S:25", "N:75", pid, width=3)

# ss02 -> HDN servers
for name, port_name in [("hdn-cn07", "Ethernet15"), ("hdn-cn08", "Ethernet17"),
                         ("hdn-cn09", "Ethernet20"), ("hdn-cn10", "Ethernet21")]:
    pid = find_port(262, port_name)
    add_link(f"ss02-{name}", "ss02", name, "internal", 10e9, "10G",
             "S:75", "N:75", pid, width=3)

# ── ss02 -> storage ────────────────────────────────────────
add_link("ss02-sy01", "ss02", "sy01", "internal", 1e9, "1G",
         "S", "N", find_port(262, "Ethernet44"), width=2)
add_link("ss02-bn01", "ss02", "bn01-eqx6", "internal", 10e9, "10G",
         "S", "N", find_port(262, "Ethernet14"), width=3)

# ── ss01 -> ccr1k9-vrc (10G) ──────────────────────────────
add_link("ss01-ccr1k9", "ss01", "ccr1k9-vrc", "internal", 10e9, "10G",
         "W", "E", find_port(261, "Ethernet36"), find_port(283, "sfp-sfpplus1"), width=4)

# ── ss02 -> rb4k11 ─────────────────────────────────────────
add_link("ss02-rb4k11", "ss02", "rb4k11", "internal", 10e9, "10G",
         "S", "N", find_port(262, "Ethernet34"), width=3)

# ── TRANSIT / PEERING from er04 ────────────────────────────
add_link("er04-franceix", "er04", "franceix", "peering_ix", 10e9, "10G",
         "E", "W", find_port(359, "xe-0/1/7.4"), width=4,
         extra={"provider": "FranceIX Paris", "capacity": "200M"})
add_link("er04-oti", "er04", "oti-transit", "transit", 1e9, "1G",
         "E:75", "W", find_port(359, "xe-0/1/7.791"), width=3,
         extra={"provider": "OTI via FranceIX"})
add_link("er04-kissgroup", "er04", "kissgroup-pa3", "transit", 1e9, "1G",
         "E:25", "W", find_port(359, "et-0/0/1.3"), width=3,
         extra={"provider": "KissGroup PA3"})
add_link("er04-appliwave", "er04", "appliwave", "peering_pni", 10e9, "10G",
         "N:75", "W", find_port(359, "et-0/0/0.3138"), width=4,
         extra={"provider": "Appliwave"})

# ── TRANSIT from er03 (EQX3) ──────────────────────────────
add_link("er03-equinixix", "er03", "equinixix", "peering_ix", 10e9, "10G",
         "E", "W", find_port(358, "Te0/2/0.99"), width=4,
         extra={"provider": "Equinix IX Paris"})
add_link("er03-kissgroup-pa3", "er03", "kissgroup-pa3", "transit", 1e9, "1G",
         "E:75", "W:75", find_port(358, "Te0/1/0.3"), width=3,
         extra={"provider": "KissGroup PA3"})

# ── Inter-site: ss01 -> EQX3 (10G) ─────────────────────────
add_link("ss01-eqx3", "ss01", "er03", "internal", 10e9, "10G",
         "N:75", "W", find_port(261, "Ethernet48"), width=4,
         extra={"circuit": "EQX6-EQX3 cross-connect"})
add_link("ss02-eqx3", "ss02", "er03", "internal", 10e9, "10G",
         "N:25", "W:75", find_port(262, "Ethernet48"), width=4)

# ── Inter-site: er04 -> er03 ──────────────────────────────
add_link("er04-er03", "er04", "er03", "internal", 10e9, "10G",
         "N", "S", find_port(359, "et-0/0/0.5"), find_port(358, "Te0/1/0.5"), width=4)

# ── ss01 -> Appliwave transit (10G) ────────────────────────
add_link("ss01-appliwave", "ss01", "appliwave", "peering_pni", 10e9, "10G",
         "N:25", "S", find_port(261, "Ethernet43"), width=4,
         extra={"provider": "Appliwave", "circuit": "21677789-A"})

# ── NXT1 site ──────────────────────────────────────────────
add_link("ccr2k4-appliwave", "ccr2k4-nxt1", "appliwave", "internal", 10e9, "10G",
         "N", "S:75", find_port(299, "sfp-sfpplus1"), width=4,
         extra={"provider": "Appliwave NXT1"})

# ── sr02 EQX3 ──────────────────────────────────────────────
add_link("sr02-er03", "sr02-eqx3", "er03", "internal", 10e9, "10G",
         "N", "S:75", width=3)

print("Done!")
print(f"\nMap URL: {BASE}/map/{map_id}")
