import logging

from authlib.integrations.starlette_client import OAuth
from starlette.requests import Request
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse

from app.config import Settings, get_settings

logger = logging.getLogger("netmap.auth")
router = APIRouter(prefix="/auth", tags=["auth"])
oauth = OAuth()


def setup_oauth(settings: Settings):
    if not settings.oauth_client_id:
        if settings.auth_disabled:
            logger.warning(
                "AUTH_DISABLED=true — all endpoints are unauthenticated. "
                "Do NOT use this in production."
            )
        else:
            logger.warning(
                "OAUTH_CLIENT_ID not set and AUTH_DISABLED is false. "
                "All API requests will return 401. Set AUTH_DISABLED=true for local dev."
            )
        return
    oauth.register(
        name="provider",
        client_id=settings.oauth_client_id,
        client_secret=settings.oauth_client_secret,
        authorize_url=settings.oauth_authorize_url,
        access_token_url=settings.oauth_token_url,
        userinfo_endpoint=settings.oauth_userinfo_url,
        client_kwargs={"scope": settings.oauth_scopes},
    )


async def get_current_user(request: Request):
    """Extract user from session. Requires explicit AUTH_DISABLED=true to skip."""
    settings = get_settings()
    if settings.auth_disabled and not settings.oauth_client_id:
        return {
            "sub": "local",
            "name": "Local User",
            "email": "local@localhost",
            "roles": [],
        }
    if not settings.oauth_client_id:
        raise HTTPException(status_code=401, detail="Authentication not configured")
    user = request.session.get("user")
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user


async def get_optional_user(request: Request):
    """Like get_current_user but returns None instead of 401."""
    settings = get_settings()
    if settings.auth_disabled and not settings.oauth_client_id:
        return {
            "sub": "local",
            "name": "Local User",
            "email": "local@localhost",
            "roles": [],
        }
    user = request.session.get("user")
    return user  # None if not logged in


@router.get("/login")
async def login(request: Request):
    settings = get_settings()
    if not settings.oauth_client_id:
        return RedirectResponse(url="/")
    redirect_uri = f"{settings.app_base_url}/auth/callback"
    return await oauth.provider.authorize_redirect(request, redirect_uri)


@router.get("/callback")
async def callback(request: Request):
    logger.info("OAuth callback - session keys: %s", list(request.session.keys()))
    try:
        token = await oauth.provider.authorize_access_token(request)
    except Exception as e:
        logger.error("OAuth callback error: %s - session has %d keys", e, len(request.session))
        raise
    userinfo = token.get("userinfo")
    if not userinfo:
        userinfo = await oauth.provider.userinfo(token=token)

    # Extract roles from ID token or userinfo
    id_token_claims = (
        token.get("id_token", {}) if isinstance(token.get("id_token"), dict) else {}
    )
    settings = get_settings()
    roles = _extract_roles(userinfo, settings.oauth_roles_claim)
    if not roles:
        roles = _extract_roles(id_token_claims, settings.oauth_roles_claim)

    request.session["user"] = {
        "sub": userinfo.get("sub", ""),
        "name": userinfo.get("name", ""),
        "email": userinfo.get("email", ""),
        "roles": roles,
    }
    return RedirectResponse(url="/")


@router.get("/logout")
async def logout(request: Request):
    request.session.clear()
    return RedirectResponse(url="/")


@router.get("/me")
async def me(user=Depends(get_current_user)):
    settings = get_settings()
    return {
        **user,
        "is_editor": _has_role(user, settings.oauth_editor_role),
        "is_admin": _has_role(user, settings.oauth_admin_role),
    }


def _extract_roles(data: dict, claim_path: str) -> list[str]:
    """Extract roles from token claims using dot-notation path.
    Supports: 'roles', 'realm_access.roles', 'resource_access.client.roles'
    """
    obj = data
    for key in claim_path.split("."):
        if isinstance(obj, dict):
            obj = obj.get(key)
        else:
            return []
    if isinstance(obj, list):
        return [str(r) for r in obj]
    if isinstance(obj, str):
        return [obj]
    return []


def _has_role(user: dict, role: str) -> bool:
    """Check if user has a specific role. Empty role = everyone has it."""
    if not role:
        return True
    return role in user.get("roles", [])
