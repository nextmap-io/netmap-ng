"""OIDC authentication: login flow, callback, session management.

ID tokens are validated against signed JWKS — we either rely on the OIDC
discovery document (preferred) or require a fully populated JWKS+issuer+audience
configuration. Roles are extracted only from claims that have been verified.
"""

import logging
import secrets
from typing import Any
from urllib.parse import urlparse

from authlib.integrations.starlette_client import OAuth
from authlib.jose import JsonWebKey, jwt
from authlib.jose.errors import JoseError
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse
from starlette.requests import Request

from app.config import Settings, get_settings

logger = logging.getLogger("netmap.auth")
router = APIRouter(prefix="/auth", tags=["auth"])
oauth = OAuth()


def _is_localhost_url(url: str) -> bool:
    host = (urlparse(url).hostname or "").lower()
    return host in {"localhost", "127.0.0.1", "::1"} or host.endswith(".localhost")


def _auth_disabled_active(settings: Settings) -> bool:
    """Return True only when AUTH_DISABLED is enabled with the explicit dev flag
    AND the app is running on localhost. Otherwise auth bypass is refused.
    """
    if not settings.auth_disabled:
        return False
    if not settings.dev_allow_no_auth:
        return False
    if not _is_localhost_url(settings.app_base_url):
        return False
    return True


def setup_oauth(settings: Settings):
    if settings.auth_disabled and not _auth_disabled_active(settings):
        logger.error(
            "*** AUTH_DISABLED=true but DEV_ALLOW_NO_AUTH is not set or APP_BASE_URL "
            "is not localhost. Auth bypass is refused. Set DEV_ALLOW_NO_AUTH=1 and "
            "APP_BASE_URL=http://localhost:... for local development."
        )
    elif _auth_disabled_active(settings):
        logger.warning(
            "*** AUTH_DISABLED=true and DEV_ALLOW_NO_AUTH=1 — all endpoints are "
            "unauthenticated. Do NOT use this in production."
        )

    if not settings.oauth_client_id:
        if not _auth_disabled_active(settings):
            logger.warning(
                "OAUTH_CLIENT_ID not set. All API requests will return 401 unless "
                "AUTH_DISABLED=true and DEV_ALLOW_NO_AUTH=1 (local dev only)."
            )
        return

    server_metadata = settings.oauth_discovery_url or None
    if (
        not server_metadata
        and "login.microsoftonline.com" in settings.oauth_authorize_url
    ):
        parts = settings.oauth_authorize_url.split("/")
        try:
            tenant_idx = parts.index("login.microsoftonline.com") + 1
        except ValueError:
            tenant_idx = -1
        if 0 < tenant_idx < len(parts):
            tenant = parts[tenant_idx]
            server_metadata = (
                f"https://login.microsoftonline.com/{tenant}/v2.0/"
                ".well-known/openid-configuration"
            )
            logger.info("Using Entra ID OIDC discovery: %s", server_metadata)

    if not server_metadata:
        missing = [
            name
            for name, value in (
                ("OAUTH_JWKS_URL", settings.oauth_jwks_url),
                ("OAUTH_ISSUER", settings.oauth_issuer),
                ("OAUTH_AUDIENCE", settings.oauth_audience),
            )
            if not value
        ]
        if missing:
            logger.error(
                "OIDC misconfigured: set OAUTH_DISCOVERY_URL, or all of "
                "OAUTH_JWKS_URL, OAUTH_ISSUER, OAUTH_AUDIENCE. Missing: %s",
                ", ".join(missing),
            )
            return

    oauth.register(
        name="provider",
        client_id=settings.oauth_client_id,
        client_secret=settings.oauth_client_secret.get_secret_value(),
        server_metadata_url=server_metadata,
        authorize_url=settings.oauth_authorize_url if not server_metadata else None,
        access_token_url=settings.oauth_token_url if not server_metadata else None,
        userinfo_endpoint=settings.oauth_userinfo_url,
        client_kwargs={"scope": settings.oauth_scopes},
    )


async def get_current_user(request: Request):
    """Extract user from session. Requires AUTH_DISABLED + DEV_ALLOW_NO_AUTH on
    localhost to skip the session check."""
    settings = get_settings()
    if _auth_disabled_active(settings) and not settings.oauth_client_id:
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
    if _auth_disabled_active(settings) and not settings.oauth_client_id:
        return {
            "sub": "local",
            "name": "Local User",
            "email": "local@localhost",
            "roles": [],
        }
    user = request.session.get("user")
    return user


@router.get("/login")
async def login(request: Request):
    settings = get_settings()
    if not settings.oauth_client_id:
        return RedirectResponse(url="/")
    redirect_uri = f"{settings.app_base_url}/auth/callback"
    return await oauth.provider.authorize_redirect(request, redirect_uri)


async def _verify_id_token(token: dict, settings: Settings) -> dict[str, Any]:
    """Verify an ID token's signature, issuer and audience.

    Uses the OIDC discovery metadata when available, otherwise falls back to
    the manually-configured JWKS/issuer/audience.
    Returns the decoded claims dict, or raises HTTPException(401).
    """
    raw = token.get("id_token")
    if not isinstance(raw, str) or not raw:
        raise HTTPException(401, "OIDC: id_token missing from token response")

    jwks_uri = ""
    expected_issuer = settings.oauth_issuer
    expected_audience = settings.oauth_audience or settings.oauth_client_id

    metadata = getattr(getattr(oauth, "provider", None), "server_metadata", None)
    if isinstance(metadata, dict):
        jwks_uri = metadata.get("jwks_uri", "") or ""
        expected_issuer = expected_issuer or metadata.get("issuer", "")

    if not jwks_uri:
        jwks_uri = settings.oauth_jwks_url

    if not jwks_uri or not expected_issuer or not expected_audience:
        raise HTTPException(
            401, "OIDC: cannot verify id_token (missing JWKS, issuer or audience)"
        )

    try:
        import httpx

        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(jwks_uri)
            resp.raise_for_status()
            jwks_data = resp.json()
        key_set = JsonWebKey.import_key_set(jwks_data)
        claims = jwt.decode(
            raw,
            key_set,
            claims_options={
                "iss": {"essential": True, "value": expected_issuer},
                "aud": {"essential": True, "value": expected_audience},
                "exp": {"essential": True},
            },
        )
        claims.validate()
    except JoseError as exc:
        logger.warning("OIDC id_token validation failed: %s", exc)
        raise HTTPException(401, "OIDC: invalid id_token") from exc
    except Exception as exc:
        logger.warning("OIDC id_token verification error: %s", exc)
        raise HTTPException(401, "OIDC: id_token verification failed") from exc

    return dict(claims)


@router.get("/callback")
async def callback(request: Request):
    try:
        token = await oauth.provider.authorize_access_token(request)
    except Exception as exc:
        logger.error("OAuth callback error: %s", exc)
        raise HTTPException(401, "OAuth callback failed") from exc

    settings = get_settings()
    verified_claims = await _verify_id_token(token, settings)

    userinfo = token.get("userinfo")
    if not userinfo:
        try:
            userinfo = await oauth.provider.userinfo(token=token)
        except Exception:
            userinfo = {}

    # Roles must come from the verified id_token claims, not from raw userinfo.
    roles = _extract_roles(verified_claims, settings.oauth_roles_claim)

    sub = verified_claims.get("sub") or (userinfo or {}).get("sub", "")
    email = verified_claims.get("email") or (userinfo or {}).get("email", "")
    name = verified_claims.get("name") or (userinfo or {}).get("name", "")

    # Rotate the session id on successful login (anti session-fixation).
    _rotate_session(request)

    request.session["user"] = {
        "sub": sub,
        "name": name,
        "email": email,
        "roles": roles,
    }
    return RedirectResponse(url="/")


def _rotate_session(request: Request) -> None:
    """Rotate the server-side session id to mitigate session fixation."""
    sess = request.scope.get("session")
    if isinstance(sess, dict):
        sess["__rotate__"] = secrets.token_urlsafe(8)


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
    Supports: 'roles', 'realm_access.roles', 'resource_access.client.roles'.
    A scalar string claim is rejected (must be a list).
    """
    obj: Any = data
    for key in claim_path.split("."):
        if isinstance(obj, dict):
            obj = obj.get(key)
        else:
            return []
    if isinstance(obj, list):
        return [str(r) for r in obj if isinstance(r, (str, int))]
    return []


def _has_role(user: dict, role: str) -> bool:
    """Check if user has a specific role.

    An empty/unset role name never grants access — never accord an unconfigured
    role implicitly.
    """
    if not role:
        return False
    return role in (user.get("roles") or [])
