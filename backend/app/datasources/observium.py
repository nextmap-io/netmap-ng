"""
Read-only access to Observium's MySQL database.
Provides topology discovery (CDP/LLDP neighbours), device info, port rates.
"""

from contextlib import asynccontextmanager
from typing import Any

import asyncmy
from app.config import get_settings


@asynccontextmanager
async def get_observium_db():
    settings = get_settings()
    conn = await asyncmy.connect(
        host=settings.observium_db_host,
        port=settings.observium_db_port,
        user=settings.observium_db_user,
        password=settings.observium_db_password,
        db=settings.observium_db_name,
    )
    try:
        yield conn
    finally:
        await conn.ensure_closed()


async def get_devices(device_ids: list[int] | None = None) -> list[dict[str, Any]]:
    """Fetch devices from Observium."""
    async with get_observium_db() as conn:
        async with conn.cursor(asyncmy.cursors.DictCursor) as cur:
            sql = """
                SELECT device_id, hostname, sysName, os, hardware,
                       location, status, type, version
                FROM devices
                WHERE disabled = 0 AND ignore = 0
            """
            params = []
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
            await cur.execute("""
                SELECT p.port_id, p.ifIndex, p.ifName, p.ifDescr, p.ifAlias,
                       p.ifSpeed, p.ifHighSpeed, p.ifOperStatus, p.ifAdminStatus,
                       p.ifType, p.port_label, p.port_label_short,
                       s.ifInOctets_rate, s.ifOutOctets_rate,
                       s.ifInOctets_perc, s.ifOutOctets_perc
                FROM ports p
                LEFT JOIN `ports-state` s ON p.port_id = s.port_id
                WHERE p.device_id = %s AND p.deleted = 0
                ORDER BY p.ifIndex
            """, (device_id,))
            return await cur.fetchall()


async def get_neighbours(device_ids: list[int] | None = None) -> list[dict[str, Any]]:
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
                    s.ifInOctets_rate AS local_in_rate,
                    s.ifOutOctets_rate AS local_out_rate,
                    s.ifInOctets_perc AS local_in_perc,
                    s.ifOutOctets_perc AS local_out_perc,
                    l.remote_port_id,
                    rp.ifName AS remote_port,
                    rp.ifSpeed AS remote_port_speed,
                    rd.device_id AS remote_device_id,
                    rd.hostname AS remote_hostname,
                    rd.hardware AS remote_hardware
                FROM neighbours AS l
                JOIN ports AS p ON p.port_id = l.port_id
                JOIN devices AS d ON p.device_id = d.device_id
                LEFT JOIN `ports-state` AS s ON p.port_id = s.port_id
                LEFT JOIN ports AS rp ON rp.port_id = l.remote_port_id
                LEFT JOIN devices AS rd ON rp.device_id = rd.device_id
                WHERE l.active = 1 AND l.remote_port_id > 0
            """
            params = []
            if device_ids:
                placeholders = ",".join(["%s"] * len(device_ids))
                sql += f" AND d.device_id IN ({placeholders})"
                params = device_ids
            await cur.execute(sql, params)
            return await cur.fetchall()


async def get_port_traffic(port_id: int) -> dict[str, Any] | None:
    """Get current traffic rates for a single port."""
    async with get_observium_db() as conn:
        async with conn.cursor(asyncmy.cursors.DictCursor) as cur:
            await cur.execute("""
                SELECT p.port_id, p.ifName, p.ifSpeed,
                       s.ifInOctets_rate, s.ifOutOctets_rate,
                       s.ifInOctets_perc, s.ifOutOctets_perc,
                       s.ifInErrors_rate, s.ifOutErrors_rate
                FROM ports p
                JOIN `ports-state` s ON p.port_id = s.port_id
                WHERE p.port_id = %s
            """, (port_id,))
            return await cur.fetchone()
