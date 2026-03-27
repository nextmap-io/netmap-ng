import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.sessions import SessionMiddleware

from app.config import get_settings
from app.models.database import init_db
from app.auth.oauth import router as auth_router, setup_oauth
from app.api.maps import router as maps_router
from app.api.nodes import router as nodes_router
from app.api.links import router as links_router
from app.api.datasources import router as datasources_router
from app.api.ai import router as ai_router

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

# OAuth setup
setup_oauth(settings)

# Routes
app.include_router(auth_router)
app.include_router(maps_router)
app.include_router(nodes_router)
app.include_router(links_router)
app.include_router(datasources_router)
app.include_router(ai_router)


@app.get("/health")
async def health():
    return {"status": "ok", "version": "0.1.0"}
