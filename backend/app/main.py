import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.sessions import SessionMiddleware

from app.config import get_settings
from app.models.database import init_db
from app.auth.oauth import router as auth_router, setup_oauth
from app.api.maps import router as maps_router
from app.api.nodes import router as nodes_router
from app.api.links import router as links_router
from app.api.datasources import router as datasources_router
from app.api.public import router as public_router

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s"
)
logger = logging.getLogger("netmap")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield


app = FastAPI(
    title="Netmap NG",
    description="Modern network weathermap with Observium integration",
    version="0.1.0",
    lifespan=lifespan,
    # Disable docs in production (can be re-enabled with env var)
    docs_url="/docs" if get_settings().auth_disabled else None,
    redoc_url=None,
)

settings = get_settings()

# Middleware
is_https = settings.app_base_url.startswith("https://")
app.add_middleware(
    SessionMiddleware,
    secret_key=settings.app_secret_key,
    https_only=is_https,
    same_site="lax",
    max_age=86400,  # 24h
)

cors_origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)


# Security headers middleware
@app.middleware("http")
async def security_headers(request: Request, call_next):
    response: Response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    if is_https:
        response.headers["Strict-Transport-Security"] = (
            "max-age=31536000; includeSubDomains"
        )
    return response


# Audit logging middleware
@app.middleware("http")
async def audit_log(request: Request, call_next):
    response = await call_next(request)
    # Log write operations
    if request.method in ("POST", "PUT", "DELETE"):
        user = request.session.get("user", {}) if hasattr(request, "session") else {}
        email = user.get("email", "anonymous")
        logger.info(
            "AUDIT %s %s %s -> %s",
            email,
            request.method,
            request.url.path,
            response.status_code,
        )
    return response


# OAuth setup
setup_oauth(settings)

# Routes
app.include_router(auth_router)
app.include_router(maps_router)
app.include_router(nodes_router)
app.include_router(links_router)
app.include_router(datasources_router)
app.include_router(public_router)
# AI router removed for security (no uncontrolled third-party API access)


@app.get("/health")
async def health():
    return {"status": "ok"}
