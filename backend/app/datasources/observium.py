"""
Read-only access to Observium's MySQL database.
Provides topology discovery (CDP/LLDP neighbours), device info, port rates.

Compatible with Observium CE where rate columns are in the `ports` table
directly (no separate `ports-state` table).

Connections come from a lazily-created asyncmy pool (closed on app shutdown),
and the hot polling queries (port traffic, device status) go through a short
in-process TTL cache so many wallboards / public viewers polling the same map
do not each hit Observium.
"""

import asyncio
import time
from collections.abc import AsyncIterator, Awaitable, Callable, Hashable
from contextlib import asynccontextmanager
from typing import Any

import asyncmy
from asyncmy.pool import Pool

from app.config import get_settings

POOL_MINSIZE = 1
POOL_MAXSIZE = 10
# Recycle connections before a typical MySQL wait_timeout can kill them.
POOL_RECYCLE_SECONDS = 300

CACHE_TTL_SECONDS = 30.0
CACHE_MAX_ENTRIES = 256

_pool: Pool | None = None
_pool_lock: asyncio.Lock | None = None


async def _get_pool() -> Pool:
    global _pool, _pool_lock
    if _pool is not None:
        return _pool
    if _pool_lock is None:
        _pool_lock = asyncio.Lock()
    async with _pool_lock:
        if _pool is None:
            settings = get_settings()
            _pool = await asyncmy.create_pool(
                minsize=POOL_MINSIZE,
                maxsize=POOL_MAXSIZE,
                pool_recycle=POOL_RECYCLE_SECONDS,
                host=settings.observium_db_host,
                port=settings.observium_db_port,
                user=settings.observium_db_user,
                password=settings.observium_db_password,
                db=settings.observium_db_name,
                # Autocommit: a pooled connection must not keep a REPEATABLE
                # READ snapshot open between polls (stale rates), and the pool
                # would otherwise discard connections left "in transaction".
                autocommit=True,
            )
    return _pool


async def close_pool() -> None:
    """Close the Observium pool (called from the FastAPI lifespan)."""
    global _pool
    pool = _pool
    _pool = None
    if pool is not None:
        pool.close()
        await pool.wait_closed()
    clear_cache()


@asynccontextmanager
async def get_observium_db() -> AsyncIterator[Any]:
    pool = await _get_pool()
    async with pool.acquire() as conn:
        yield conn


# ── TTL cache ──

_cache: dict[Hashable, tuple[float, Any]] = {}


def _now() -> float:
    return time.monotonic()


def clear_cache() -> None:
    _cache.clear()


async def _cached(key: Hashable, loader: Callable[[], Awaitable[Any]]) -> Any:
    """Return a cached value younger than CACHE_TTL_SECONDS, else load it."""
    now = _now()
    hit = _cache.get(key)
    if hit is not None and hit[0] > now:
        return hit[1]
    value = await loader()
    if len(_cache) >= CACHE_MAX_ENTRIES:
        # Drop expired entries first, then the oldest ones (dict keeps
        # insertion order) until there is room.
        for k in [k for k, (exp, _) in _cache.items() if exp <= now]:
            del _cache[k]
        while len(_cache) >= CACHE_MAX_ENTRIES:
            del _cache[next(iter(_cache))]
    _cache.pop(key, None)
    _cache[key] = (now + CACHE_TTL_SECONDS, value)
    return value


async def get_devices(device_ids: list[int] | None = None) -> list[dict[str, Any]]:
    """Fetch devices from Observium."""
    async with get_observium_db() as conn:
        async with conn.cursor(asyncmy.cursors.DictCursor) as cur:
            sql = """
                SELECT device_id, hostname, sysName, os, hardware,
                       location, status, type, version
                FROM devices
                WHERE disabled = 0 AND `ignore` = 0
            """
            params: list[int] = []
            if device_ids:
                placeholders = ",".join(["%s"] * len(device_ids))
                sql += f" AND device_id IN ({placeholders})"
                params = device_ids
            await cur.execute(sql, params)
            return await cur.fetchall()


async def get_device_ports(device_id: int) -> list[dict[str, Any]]:
    """Fetch ports with current rates for a device."""
    async with get_observium_db() as conn:
        async with conn.cursor(asyncmy.cursors.DictCursor) as cur:
            await cur.execute(
                """
                SELECT port_id, ifIndex, ifName, ifDescr, ifAlias,
                       ifSpeed, ifHighSpeed, ifOperStatus, ifAdminStatus,
                       ifType, port_label, port_label_short,
                       ifInOctets_rate, ifOutOctets_rate,
                       ifInOctets_perc, ifOutOctets_perc
                FROM ports
                WHERE device_id = %s AND deleted = 0
                ORDER BY ifIndex
            """,
                (device_id,),
            )
            return await cur.fetchall()


async def get_neighbours(
    device_ids: list[int] | None = None,
) -> list[dict[str, Any]]:
    """
    Fetch CDP/LLDP neighbour links. This is the core topology query.
    Returns links where both ends are monitored (remote_port_id > 0).
    """
    async with get_observium_db() as conn:
        async with conn.cursor(asyncmy.cursors.DictCursor) as cur:
            sql = """
                SELECT
                    l.neighbour_id,
                    l.protocol,
                    d.device_id AS local_device_id,
                    d.hostname AS local_hostname,
                    d.hardware AS local_hardware,
                    p.port_id AS local_port_id,
                    p.ifName AS local_port,
                    p.ifSpeed AS local_port_speed,
                    p.ifInOctets_rate AS local_in_rate,
                    p.ifOutOctets_rate AS local_out_rate,
                    p.ifInOctets_perc AS local_in_perc,
                    p.ifOutOctets_perc AS local_out_perc,
                    l.remote_port_id,
                    rp.ifName AS remote_port,
                    rp.ifSpeed AS remote_port_speed,
                    rd.device_id AS remote_device_id,
                    rd.hostname AS remote_hostname,
                    rd.hardware AS remote_hardware
                FROM neighbours AS l
                JOIN ports AS p ON p.port_id = l.port_id
                JOIN devices AS d ON p.device_id = d.device_id
                LEFT JOIN ports AS rp ON rp.port_id = l.remote_port_id
                LEFT JOIN devices AS rd ON rp.device_id = rd.device_id
                WHERE l.active = 1 AND l.remote_port_id > 0
            """
            params: list[int] = []
            if device_ids:
                placeholders = ",".join(["%s"] * len(device_ids))
                sql += f" AND d.device_id IN ({placeholders})"
                params = device_ids
            await cur.execute(sql, params)
            return await cur.fetchall()


async def get_port_rrd_info(port_id: int) -> dict[str, Any] | None:
    """Resolve hostname and ifIndex for RRD path construction from a port ID.

    Observium names port RRD files as `port-{ifIndex}.rrd` per device, not
    `port-{port_id}.rrd` (port_id is the global Observium identifier).
    """
    async with get_observium_db() as conn:
        async with conn.cursor(asyncmy.cursors.DictCursor) as cur:
            await cur.execute(
                """
                SELECT d.hostname, p.port_id, p.ifIndex
                FROM ports p
                JOIN devices d ON d.device_id = p.device_id
                WHERE p.port_id = %s
            """,
                (port_id,),
            )
            return await cur.fetchone()


async def get_port_traffic(port_id: int) -> dict[str, Any] | None:
    """Get current traffic rates for a single port."""
    async with get_observium_db() as conn:
        async with conn.cursor(asyncmy.cursors.DictCursor) as cur:
            await cur.execute(
                """
                SELECT port_id, ifName, ifSpeed,
                       ifInOctets_rate, ifOutOctets_rate,
                       ifInOctets_perc, ifOutOctets_perc,
                       ifInErrors_rate, ifOutErrors_rate
                FROM ports
                WHERE port_id = %s
            """,
                (port_id,),
            )
            return await cur.fetchone()


async def get_ports_traffic(port_ids: list[int]) -> dict[int, dict[str, Any]]:
    """Get current traffic rates and status for many ports in a single query.

    Avoids the N+1 pattern of calling ``get_port_traffic`` per link. Returns a
    mapping of ``port_id -> row``. Port ids with no matching Observium row are
    simply absent from the result. Duplicate ids are de-duplicated. Results
    are cached for ``CACHE_TTL_SECONDS`` keyed by the set of ids.
    """
    unique_ids = frozenset(pid for pid in port_ids if pid)
    if not unique_ids:
        return {}
    return await _cached(
        ("ports_traffic", unique_ids),
        lambda: _query_ports_traffic(sorted(unique_ids)),
    )


async def _query_ports_traffic(port_ids: list[int]) -> dict[int, dict[str, Any]]:
    async with get_observium_db() as conn:
        async with conn.cursor(asyncmy.cursors.DictCursor) as cur:
            placeholders = ",".join(["%s"] * len(port_ids))
            sql = (
                "SELECT port_id, ifName, ifSpeed, ifHighSpeed, "
                "ifOperStatus, ifAdminStatus, poll_time, "
                "ifInOctets_rate, ifOutOctets_rate, "
                "ifInOctets_perc, ifOutOctets_perc, "
                "ifInErrors_rate, ifOutErrors_rate "
                "FROM ports "
                f"WHERE port_id IN ({placeholders})"
            )
            await cur.execute(sql, port_ids)
            rows = await cur.fetchall()
            return {row["port_id"]: row for row in rows}


async def get_devices_status(device_ids: list[int]) -> dict[int, dict[str, Any]]:
    """Get up/down status for many devices in a single (cached) query.

    Returns ``device_id -> {device_id, status, disabled, ignore}``. Unknown
    ids are absent from the result.
    """
    unique_ids = frozenset(did for did in device_ids if did)
    if not unique_ids:
        return {}
    return await _cached(
        ("devices_status", unique_ids),
        lambda: _query_devices_status(sorted(unique_ids)),
    )


async def _query_devices_status(device_ids: list[int]) -> dict[int, dict[str, Any]]:
    async with get_observium_db() as conn:
        async with conn.cursor(asyncmy.cursors.DictCursor) as cur:
            placeholders = ",".join(["%s"] * len(device_ids))
            sql = (
                "SELECT device_id, status, disabled, `ignore` "
                "FROM devices "
                f"WHERE device_id IN ({placeholders})"
            )
            await cur.execute(sql, device_ids)
            rows = await cur.fetchall()
            return {row["device_id"]: row for row in rows}
