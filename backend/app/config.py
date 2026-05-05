import logging
import secrets
from functools import lru_cache
from urllib.parse import urlparse

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings

logger = logging.getLogger("netmap")


class Settings(BaseSettings):
    app_secret_key: SecretStr = SecretStr("")
    app_base_url: str = "http://localhost:8000"

    # Explicitly opt-in to disable auth (never in production)
    auth_disabled: bool = False
    # Required additional flag to actually allow AUTH_DISABLED to take effect.
    # Without this, AUTH_DISABLED is ignored and a startup warning is emitted.
    dev_allow_no_auth: bool = False

    # Expose API docs (Swagger / Redoc / OpenAPI). Default: false.
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

    # OIDC discovery (preferred): server metadata URL
    oauth_discovery_url: str = ""

    # OIDC manual JWT verification (used only when discovery is not configured)
    oauth_jwks_url: str = ""
    oauth_issuer: str = ""
    oauth_audience: str = ""

    # OIDC roles (optional, compatible O365 + Keycloak)
    oauth_editor_role: str = ""  # role required to edit maps
    oauth_admin_role: str = ""  # role for full admin access
    oauth_roles_claim: str = (
        "roles"  # claim path in token (O365: "roles", Keycloak: "realm_access.roles")
    )

    # CORS
    cors_origins: str = "http://localhost:5173,http://localhost:3000"

    # Sessions
    # Server-side sessions are stored in Redis and referenced by an opaque cookie.
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

    # Observium API (optional)
    observium_api_url: str = ""
    observium_api_user: str = ""
    observium_api_password: str = ""

    # App DB
    app_db_url: str = "sqlite+aiosqlite:///./data/netmap.db"

    @field_validator("app_secret_key", mode="before")
    @classmethod
    def validate_secret_key(cls, v: str | SecretStr) -> SecretStr:
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
        """Validate CORS origins.

        - Each entry must be a valid http(s) URL with a host.
        - '*' is forbidden (we use credentialed CORS).
        - In production (APP_BASE_URL not on localhost), only https origins are allowed.
        """
        # APP_BASE_URL is needed to know if we run in production. Reading the env
        # var directly avoids ordering issues with field validation.
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
                # Allow http only when host is localhost (dev mode) or when the
                # app itself is served on localhost. Refuse in production.
                host = parsed.hostname
                http_local = host in {"localhost", "127.0.0.1", "::1"} or (
                    host or ""
                ).endswith(".localhost")
                if not http_local:
                    raise ValueError(
                        f"CORS origin {origin!r} must use https in production"
                    )
        return v

    model_config = {"env_file": ".env", "extra": "ignore"}


@lru_cache
def get_settings() -> Settings:
    return Settings()
