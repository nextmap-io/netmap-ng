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
        return {"sub": "local", "name": "Local User", "email": "local@localhost"}
    if not settings.oauth_client_id:
        raise HTTPException(status_code=401, detail="Authentication not configured")
    user = request.session.get("user")
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user


@router.get("/login")
async def login(request: Request):
    settings = get_settings()
    if not settings.oauth_client_id:
        return RedirectResponse(url="/")
    redirect_uri = f"{settings.app_base_url}/auth/callback"
    return await oauth.provider.authorize_redirect(request, redirect_uri)


@router.get("/callback")
async def callback(request: Request):
    token = await oauth.provider.authorize_access_token(request)
    userinfo = token.get("userinfo")
    if not userinfo:
        userinfo = await oauth.provider.userinfo(token=token)
    # Store only essential fields in session
    request.session["user"] = {
        "sub": userinfo.get("sub", ""),
        "name": userinfo.get("name", ""),
        "email": userinfo.get("email", ""),
    }
    return RedirectResponse(url="/")


@router.get("/logout")
async def logout(request: Request):
    request.session.clear()
    return RedirectResponse(url="/")


@router.get("/me")
async def me(user=Depends(get_current_user)):
    return user
