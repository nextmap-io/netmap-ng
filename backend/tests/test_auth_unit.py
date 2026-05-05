"""Unit tests for the auth helpers (no FastAPI app needed)."""

import os

os.environ.setdefault("APP_SECRET_KEY", "test-secret-key-for-tests")
os.environ.setdefault("APP_BASE_URL", "http://localhost:8000")
os.environ.setdefault("APP_DB_URL", "sqlite+aiosqlite:///:memory:")
os.environ.setdefault("SESSION_REDIS_URL", "")

import pytest

from app.auth.oauth import _extract_roles, _has_role


def test_has_role_empty_role_returns_false():
    """An unset role name must never grant access."""
    user = {"roles": []}
    assert _has_role(user, "") is False
    assert _has_role(user, "admin") is False
    user_admin = {"roles": ["admin"]}
    assert _has_role(user_admin, "") is False
    assert _has_role(user_admin, "admin") is True


def test_extract_roles_rejects_scalar_string():
    """A scalar string `roles` claim is rejected (forced to list)."""
    assert _extract_roles({"roles": "admin"}, "roles") == []
    assert _extract_roles({"roles": ["admin", "user"]}, "roles") == ["admin", "user"]
    assert _extract_roles({"realm_access": {"roles": ["a"]}}, "realm_access.roles") == [
        "a"
    ]
    assert _extract_roles({"missing": {}}, "realm_access.roles") == []


@pytest.mark.anyio
async def test_verify_id_token_rejects_unsigned_garbage():
    from app.auth.oauth import _verify_id_token
    from app.config import Settings
    from fastapi import HTTPException

    s = Settings(
        app_secret_key="test-secret-key-for-tests",
        oauth_client_id="dummy",
        oauth_jwks_url="https://example.invalid/jwks",
        oauth_issuer="https://example.invalid/",
        oauth_audience="dummy",
    )
    with pytest.raises(HTTPException) as ei:
        await _verify_id_token({"id_token": "not.a.jwt"}, s)
    assert ei.value.status_code == 401


@pytest.mark.anyio
async def test_verify_id_token_refuses_when_not_configured():
    from app.auth.oauth import _verify_id_token
    from app.config import Settings
    from fastapi import HTTPException

    s = Settings(app_secret_key="test-secret-key-for-tests")
    with pytest.raises(HTTPException) as ei:
        await _verify_id_token({"id_token": "x.y.z"}, s)
    assert ei.value.status_code == 401


@pytest.fixture
def anyio_backend():
    return "asyncio"
