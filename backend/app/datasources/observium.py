"""
Read-only access to Observium's MySQL database.
Provides topology discovery (CDP/LLDP neighbours), device info, port rates.

Compatible with Observium CE where rate columns are in the `ports` table
directly (no separate `ports-state` table).

Uses a module-level connection pool (lazily created) for efficiency. All public
functions degrade gracefully on connection / query errors — they log a warning
and return an empty list/dict/None so callers do not raise 500 to the client.
"""

import logging
from typing import Any

import asyncmy
import asyncmy.errors
from app.config import get_settings

logger = logging.getLogger("netmap.observium")

_pool: asyncmy.Pool | None = None


async def _get_pool() -> asyncmy.Pool:
    """Lazily create and cache the module-level Observium MySQL pool."""
    global _pool
    if _pool is None:
        settings = get_settings()
        _pool = await asyncmy.create_pool(
            host=settings.observium_db_host,
            port=settings.observium_db_port,
            user=settings.observium_db_user,
            password=settings.observium_db_password,
            db=settings.observium_db_name,
            minsize=2,
            maxsize=10,
            connect_timeout=5,
        )
    return _pool


async def close_pool() -> None:
    """Close the Observium MySQL pool. Call this from app shutdown.

    NOTE: main.py should invoke `await close_pool()` from its lifespan
    shutdown phase to release MySQL connections cleanly.
    """
    global _pool
    if _pool is not None:
        _pool.close()
        await _pool.wait_closed()
        _pool = None


async def get_devices(device_ids: list[int] | None = None) -> list[dict[str, Any]]:
    """Fetch devices from Observium. Returns [] on connection / query error."""
    try:
        pool = await _get_pool()
        async with pool.acquire() as conn, conn.cursor(asyncmy.cursors.DictCursor) as cur:
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
    except (asyncmy.errors.Error, OSError) as e:
        logger.warning("get_devices failed: %s", e)
        return []


async def get_device_ports(device_id: int) -> list[dict[str, Any]]:
    """Fetch ports with current rates for a device. Returns [] on error."""
    try:
        pool = await _get_pool()
        async with pool.acquire() as conn, conn.cursor(asyncmy.cursors.DictCursor) as cur:
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
    except (asyncmy.errors.Error, OSError) as e:
        logger.warning("get_device_ports(device_id=%s) failed: %s", device_id, e)
        return []


async def get_neighbours(
    device_ids: list[int] | None = None,
) -> list[dict[str, Any]]:
    """
    Fetch CDP/LLDP neighbour links. This is the core topology query.
    Returns links where both ends are monitored (remote_port_id > 0).
    Returns [] on error.
    """
    try:
        pool = await _get_pool()
        async with pool.acquire() as conn, conn.cursor(asyncmy.cursors.DictCursor) as cur:
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
    except (asyncmy.errors.Error, OSError) as e:
        logger.warning("get_neighbours failed: %s", e)
        return []


async def get_port_rrd_info(port_id: int) -> dict[str, Any] | None:
    """Resolve hostname and port_id for RRD path construction. None on error."""
    try:
        pool = await _get_pool()
        async with pool.acquire() as conn, conn.cursor(asyncmy.cursors.DictCursor) as cur:
            await cur.execute(
                """
                SELECT d.hostname, p.port_id
                FROM ports p
                JOIN devices d ON d.device_id = p.device_id
                WHERE p.port_id = %s
            """,
                (port_id,),
            )
            return await cur.fetchone()
    except (asyncmy.errors.Error, OSError) as e:
        logger.warning("get_port_rrd_info(port_id=%s) failed: %s", port_id, e)
        return None


async def get_port_traffic(port_id: int) -> dict[str, Any] | None:
    """Get current traffic rates for a single port. None on error."""
    try:
        pool = await _get_pool()
        async with pool.acquire() as conn, conn.cursor(asyncmy.cursors.DictCursor) as cur:
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
    except (asyncmy.errors.Error, OSError) as e:
        logger.warning("get_port_traffic(port_id=%s) failed: %s", port_id, e)
        return None


async def get_ports_traffic_bulk(port_ids: list[int]) -> dict[int, dict[str, Any]]:
    """Batch-fetch current traffic rates for many ports in a single query.

    Returns a {port_id: row} mapping. Missing ports are absent from the dict.
    Returns {} on connection / query error.
    """
    if not port_ids:
        return {}
    try:
        pool = await _get_pool()
        async with pool.acquire() as conn, conn.cursor(asyncmy.cursors.DictCursor) as cur:
            placeholders = ",".join(["%s"] * len(port_ids))
            sql = f"""
                SELECT port_id, ifName, ifSpeed,
                       ifInOctets_rate, ifOutOctets_rate,
                       ifInOctets_perc, ifOutOctets_perc,
                       ifInErrors_rate, ifOutErrors_rate
                FROM ports
                WHERE port_id IN ({placeholders})
            """
            await cur.execute(sql, list(port_ids))
            rows = await cur.fetchall()
            return {int(r["port_id"]): r for r in rows}
    except (asyncmy.errors.Error, OSError) as e:
        logger.warning("get_ports_traffic_bulk failed: %s", e)
        return {}
