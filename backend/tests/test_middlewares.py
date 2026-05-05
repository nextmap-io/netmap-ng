"""Tests for body size limit + rate limit middlewares."""

import os

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

os.environ.setdefault("APP_SECRET_KEY", "test-secret-key-for-tests")
os.environ.setdefault("AUTH_DISABLED", "true")
os.environ.setdefault("APP_DB_URL", "sqlite+aiosqlite:///:memory:")


@pytest.fixture
def anyio_backend():
    return "asyncio"


def _make_app() -> FastAPI:
    """Build a tiny FastAPI app with just the middlewares wired in.

    We avoid importing the full app to keep the test focused and to bypass
    auth / OAuth wiring.
    """
    from app.middlewares import BodySizeLimitMiddleware

    app = FastAPI()
    app.add_middleware(BodySizeLimitMiddleware)

    @app.post("/echo")
    async def echo(payload: dict) -> dict:
        return payload

    return app


@pytest.mark.anyio
async def test_body_size_within_limit_passes():
    app = _make_app()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        resp = await c.post("/echo", json={"hello": "world"})
        assert resp.status_code == 200
        assert resp.json() == {"hello": "world"}


@pytest.mark.anyio
async def test_body_size_exceeds_limit_returns_413():
    from app.config import get_settings

    settings = get_settings()
    oversize = settings.max_body_size_bytes + 1024

    app = _make_app()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        # Send oversized raw body with a Content-Length header.
        body = b"x" * oversize
        resp = await c.post(
            "/echo",
            content=body,
            headers={"content-type": "application/json"},
        )
        assert resp.status_code == 413
        assert "too large" in resp.json()["detail"].lower()


@pytest.mark.anyio
async def test_body_size_invalid_content_length_returns_400():
    app = _make_app()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        resp = await c.post(
            "/echo",
            content=b"{}",
            headers={
                "content-type": "application/json",
                "content-length": "not-a-number",
            },
        )
        assert resp.status_code == 400
