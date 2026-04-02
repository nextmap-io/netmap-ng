"""Authorization guards for map access control."""

import logging
from fastapi import Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.oauth import get_current_user, _has_role
from app.config import get_settings
from app.models import Map, get_db

logger = logging.getLogger("netmap.auth")


def is_editor(user: dict) -> bool:
    """Check if user has the editor role."""
    return _has_role(user, get_settings().oauth_editor_role)


def is_admin(user: dict) -> bool:
    """Check if user has the admin role."""
    return _has_role(user, get_settings().oauth_admin_role)


async def require_editor(user=Depends(get_current_user)):
    """Dependency: user must have the editor role."""
    if not is_editor(user):
        raise HTTPException(403, "Editor role required")
    return user


async def require_map_owner(
    map_id: str,
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Map:
    """Dependency: user must own the map or be admin. Returns the Map."""
    result = await db.execute(select(Map).where(Map.id == map_id))
    m = result.scalar_one_or_none()
    if not m:
        raise HTTPException(404, "Map not found")
    if is_admin(user):
        return m
    if not is_editor(user):
        raise HTTPException(403, "Editor role required")
    if m.owner != user.get("email"):
        raise HTTPException(403, "Not authorized to modify this map")
    return m


async def require_map_read(
    map_id: str,
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Map:
    """Dependency: user can read the map based on visibility.
    - private: owner or admin only
    - internal: any authenticated user
    - public: any authenticated user (unauthenticated uses /api/public/)
    """
    result = await db.execute(select(Map).where(Map.id == map_id))
    m = result.scalar_one_or_none()
    if not m:
        raise HTTPException(404, "Map not found")
    # Admins and owners can always read
    if is_admin(user) or m.owner == user.get("email"):
        return m
    # Internal and public maps readable by any authenticated user
    if m.visibility in ("internal", "public"):
        return m
    raise HTTPException(403, "Not authorized to access this map")
