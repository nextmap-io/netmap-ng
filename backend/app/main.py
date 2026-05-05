import json
import logging
import time
from contextlib import asynccontextmanager
from urllib.parse import urlparse

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from app.api.datasources import router as datasources_router
from app.api.links import router as links_router
from app.api.maps import router as maps_router
from app.api.nodes import router as nodes_router
from app.api.public import router as public_router
from app.auth.csrf import CSRFMiddleware
from app.auth.oauth import router as auth_router, setup_oauth
from app.config import get_settings
from app.models.database import init_db

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s"
)
logger = logging.getLogger("netmap")
audit_logger = logging.getLogger("netmap.audit")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield


_settings = get_settings()
_is_https = _settings.app_base_url.startswith("https://")
_base_host = (urlparse(_settings.app_base_url).hostname or "").lower()
_is_local = _base_host in {"localhost", "127.0.0.1", "::1"} or _base_host.endswith(
    ".localhost"
)

# Documentation endpoints are gated behind EXPOSE_DOCS (default: false).
_docs_url = "/docs" if _settings.expose_docs else None
_redoc_url = "/redoc" if _settings.expose_docs else None
_openapi_url = "/openapi.json" if _settings.expose_docs else None


app = FastAPI(
    title="Netmap NG",
    description="Modern network weathermap with Observium integration",
    version="0.1.0",
    lifespan=lifespan,
    docs_url=_docs_url,
    redoc_url=_redoc_url,
    openapi_url=_openapi_url,
)


def _build_session_middleware():
    """Configure server-side sessions backed by Redis when possible.

    When the app runs without a reachable Redis (tests, local dev without the
    docker-compose Redis service), we fall back to an in-memory store. The
    fallback is process-local and lost on restart; that's acceptable for tests
    and local development.
    """
    from starsessions import InMemoryStore, SessionAutoloadMiddleware, SessionMiddleware

    store = None
    redis_url = _settings.session_redis_url or ""
    if redis_url:
        try:
            from starsessions.stores.redis import RedisStore

            store = RedisStore(url=redis_url, prefix="netmap.sess.")
        except Exception as exc:
            logger.warning(
                "Redis session store unavailable (%s); falling back to in-memory store.",
                exc,
            )

    if store is None:
        store = InMemoryStore()

    cookie_name = "__Host-session" if _is_https else "session"
    return (
        SessionAutoloadMiddleware,
        SessionMiddleware,
        {
            "store": store,
            "lifetime": _settings.session_absolute_seconds,
            "rolling": True,
            "cookie_name": cookie_name,
            "cookie_same_site": "strict",
            "cookie_https_only": _is_https,
            "cookie_path": "/",
        },
    )


_autoload_mw, _session_mw, _session_kwargs = _build_session_middleware()
app.add_middleware(_autoload_mw)
app.add_middleware(_session_mw, **_session_kwargs)

# CSRF (double-submit cookie). Must run AFTER sessions so that the cookie is
# attached to responses that already have session state.
app.add_middleware(
    CSRFMiddleware,
    cookie_name=_settings.csrf_cookie_name,
    header_name=_settings.csrf_header_name,
    secure=_is_https,
)

cors_origins = [o.strip() for o in _settings.cors_origins.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", _settings.csrf_header_name],
)


_CSP = (
    "default-src 'self'; "
    "img-src 'self' data:; "
    "style-src 'self' 'unsafe-inline'; "
    "connect-src 'self'; "
    "font-src 'self'; "
    "object-src 'none'; "
    "base-uri 'self'; "
    "form-action 'self'"
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response: Response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Content-Security-Policy"] = _CSP
    response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
    response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
    response.headers["Cross-Origin-Resource-Policy"] = "same-origin"
    if _is_https:
        response.headers["Strict-Transport-Security"] = (
            "max-age=31536000; includeSubDomains"
        )
    return response


def _sanitize(value: str) -> str:
    """Strip CR/LF to prevent log injection / line-splitting."""
    return value.replace("\r", " ").replace("\n", " ")


@app.middleware("http")
async def audit_log(request: Request, call_next):
    start = time.monotonic()
    method = request.method
    path = _sanitize(request.url.path)
    status: int | None = None
    error: str | None = None
    try:
        response = await call_next(request)
        status = response.status_code
        return response
    except Exception as exc:
        error = type(exc).__name__
        raise
    finally:
        if method in ("POST", "PUT", "PATCH", "DELETE"):
            try:
                user = (
                    request.session.get("user", {})
                    if hasattr(request, "session")
                    else {}
                )
            except Exception:
                user = {}
            email = _sanitize(str((user or {}).get("email", "anonymous")))
            payload: dict[str, object] = {
                "event": "audit",
                "method": method,
                "path": path,
                "user": email,
                "status": status,
                "duration_ms": round((time.monotonic() - start) * 1000, 1),
            }
            if error:
                payload["error"] = error
            audit_logger.info(json.dumps(payload, separators=(",", ":")))


setup_oauth(_settings)

app.include_router(auth_router)
app.include_router(maps_router)
app.include_router(nodes_router)
app.include_router(links_router)
app.include_router(datasources_router)
app.include_router(public_router)


@app.get("/health")
async def health():
    return {"status": "ok"}
