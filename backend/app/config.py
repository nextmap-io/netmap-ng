import logging
import re
import secrets
from functools import lru_cache
from urllib.parse import urlparse

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings

logger = logging.getLogger("netmap")

DEFAULT_CSP_POLICY = (
    "default-src 'self'; "
    "img-src 'self' data:; "
    "style-src 'self' 'unsafe-inline'; "
    "script-src 'self'; "
    "connect-src 'self'; "
    "font-src 'self' data:; "
    "frame-ancestors 'none'; "
    "base-uri 'self'"
)

_CORS_ORIGIN_RE = re.compile(r"^https?://[a-zA-Z0-9.-]+(:\d+)?$")


class Settings(BaseSettings):
    app_secret_key: SecretStr = SecretStr("")
    app_base_url: str = "http://localhost:8000"

    # AUTH_DISABLED requires DEV_ALLOW_NO_AUTH=true and a localhost APP_BASE_URL.
    auth_disabled: bool = False
    dev_allow_no_auth: bool = False

    # Expose Swagger /docs, /redoc, /openapi.json. Default false.
    expose_docs: bool = False

    # Public landing page: list public maps without auth
    public_index: bool = False

    # OAuth2
    oauth_client_id: str = ""
    oauth_client_secret: SecretStr = SecretStr("")
    oauth_authorize_url: str = ""
    oauth_token_url: str = ""
    oauth_userinfo_url: str = ""
    oauth_scopes: str = "openid profile email"

    # OIDC discovery (preferred) or manual JWKS verification.
    oauth_discovery_url: str = ""
    oauth_jwks_url: str = ""
    oauth_issuer: str = ""
    oauth_audience: str = ""

    # OIDC roles
    oauth_editor_role: str = ""
    oauth_admin_role: str = ""
    oauth_roles_claim: str = "roles"

    # CORS
    cors_origins: str = "http://localhost:5173,http://localhost:3000"

    # CSP (overridable)
    csp_policy: str = DEFAULT_CSP_POLICY

    # Sessions (server-side, Redis-backed via starsessions)
    session_redis_url: str = "redis://localhost:6379/0"
    session_idle_seconds: int = Field(default=1800, ge=60, le=86400)
    session_absolute_seconds: int = Field(default=8 * 3600, ge=300, le=86400)

    # CSRF
    csrf_cookie_name: str = "csrf_token"
    csrf_header_name: str = "X-CSRF-Token"

    # Observium MySQL (read-only)
    observium_db_host: str = "localhost"
    observium_db_port: int = 3306
    observium_db_user: str = "netmap_ro"
    observium_db_password: SecretStr = SecretStr("")
    observium_db_name: str = "observium"

    # Observium RRD
    observium_rrd_path: str = "/opt/observium/rrd"

    # App DB
    app_db_url: str = "sqlite+aiosqlite:///./data/netmap.db"

    # Body size + rate limit
    max_body_size_bytes: int = 1_048_576
    rate_limit_public_per_min: int = 60
    rate_limit_api_per_min: int = 600

    @field_validator("app_secret_key", mode="before")
    @classmethod
    def validate_secret_key(cls, v: object) -> SecretStr:
        raw = v.get_secret_value() if isinstance(v, SecretStr) else (v or "")
        if not raw or raw == "change-me":
            generated = secrets.token_urlsafe(32)
            logger.warning(
                "APP_SECRET_KEY not set — generated a random key for this session. "
                "Set APP_SECRET_KEY in .env for persistent sessions."
            )
            return SecretStr(generated)
        if len(raw) < 16:
            raise ValueError("APP_SECRET_KEY must be at least 16 characters")
        return SecretStr(raw)

    @field_validator("cors_origins")
    @classmethod
    def validate_cors_origins(cls, v: str) -> str:
        """Reject '*' (credentialed CORS) and require https in production."""
        import os

        base_url = os.environ.get("APP_BASE_URL", "http://localhost:8000")
        base_host = urlparse(base_url).hostname or ""
        is_local = base_host in {"localhost", "127.0.0.1", "::1"} or base_host.endswith(
            ".localhost"
        )

        origins = [o.strip() for o in (v or "").split(",") if o.strip()]
        for origin in origins:
            if origin == "*":
                raise ValueError(
                    "CORS_ORIGINS cannot contain '*' when credentials are allowed"
                )
            parsed = urlparse(origin)
            if parsed.scheme not in {"http", "https"}:
                raise ValueError(f"CORS origin {origin!r} must use http(s) scheme")
            if not parsed.hostname:
                raise ValueError(f"CORS origin {origin!r} must include a host")
            if parsed.scheme == "http" and not is_local:
                host = parsed.hostname
                http_local = host in {"localhost", "127.0.0.1", "::1"} or (
                    host or ""
                ).endswith(".localhost")
                if not http_local:
                    raise ValueError(
                        f"CORS origin {origin!r} must use https in production"
                    )
            if not _CORS_ORIGIN_RE.match(origin):
                raise ValueError(
                    f"CORS_ORIGINS entry {origin!r} is malformed; "
                    "expected http(s)://host[:port]"
                )
        return ",".join(origins)

    model_config = {"env_file": ".env", "extra": "ignore"}


@lru_cache
def get_settings() -> Settings:
    return Settings()
