import logging
import re
import secrets

from pydantic import SecretStr, field_validator
from pydantic_settings import BaseSettings
from functools import lru_cache

logger = logging.getLogger("netmap")

# Default Content Security Policy. Tight default; override via CSP_POLICY if you
# need to relax (e.g., to whitelist a CDN). frame-ancestors 'none' replaces
# X-Frame-Options for clickjacking protection.
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

    # Explicitly opt-in to disable auth (never in production)
    auth_disabled: bool = False

    # Public landing page: list public maps without auth
    public_index: bool = False

    # Expose Swagger /docs, /redoc, /openapi.json. Default False — must be
    # explicitly set to true to expose API surface to anonymous callers.
    expose_docs: bool = False

    # OAuth2
    oauth_client_id: str = ""
    oauth_client_secret: SecretStr = SecretStr("")
    oauth_authorize_url: str = ""
    oauth_token_url: str = ""
    oauth_userinfo_url: str = ""
    oauth_scopes: str = "openid profile email"

    # OIDC discovery / token verification (P0-3).
    # Either provide oauth_discovery_url (preferred, server_metadata_url),
    # or all of oauth_jwks_url + oauth_issuer + oauth_audience for manual
    # JWKS-based verification of id_token.
    oauth_discovery_url: str = ""
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

    # Content Security Policy (overridable)
    csp_policy: str = DEFAULT_CSP_POLICY

    # Observium MySQL (read-only)
    observium_db_host: str = "localhost"
    observium_db_port: int = 3306
    observium_db_user: str = "netmap_ro"
    observium_db_password: str = ""
    observium_db_name: str = "observium"

    # Observium RRD
    observium_rrd_path: str = "/opt/observium/rrd"

    # App DB
    app_db_url: str = "sqlite+aiosqlite:///./data/netmap.db"

    # Body size + rate limit (per-process, defense-in-depth — production
    # deployments should also enforce these at the reverse proxy).
    max_body_size_bytes: int = 1_048_576  # 1 MiB
    rate_limit_public_per_min: int = 60
    rate_limit_api_per_min: int = 600

    @field_validator("app_secret_key", mode="before")
    @classmethod
    def validate_secret_key(cls, v: object) -> str:
        # Accept SecretStr or str (env vars come in as str)
        if isinstance(v, SecretStr):
            raw = v.get_secret_value()
        else:
            raw = v or ""
        if not raw or raw == "change-me":
            generated = secrets.token_urlsafe(32)
            logger.warning(
                "APP_SECRET_KEY not set — generated a random key for this session. "
                "Set APP_SECRET_KEY in .env for persistent sessions."
            )
            return generated
        if len(raw) < 16:
            raise ValueError("APP_SECRET_KEY must be at least 16 characters")
        return raw

    @field_validator("cors_origins")
    @classmethod
    def validate_cors_origins(cls, v: str) -> str:
        """Validate CORS origins: must be valid http(s) origins; reject '*'.

        Wildcard origins are forbidden because the application uses
        allow_credentials=True, where '*' is unsafe (browsers reject it and
        a permissive setup would risk token leakage).
        """
        if not v:
            return v
        entries = [e.strip() for e in v.split(",") if e.strip()]
        for entry in entries:
            if entry == "*":
                raise ValueError(
                    "CORS_ORIGINS cannot contain '*' when credentials are enabled"
                )
            if not _CORS_ORIGIN_RE.match(entry):
                raise ValueError(
                    f"CORS_ORIGINS entry {entry!r} is malformed; "
                    "expected http(s)://host[:port]"
                )
        return ",".join(entries)

    model_config = {"env_file": ".env", "extra": "ignore"}


@lru_cache
def get_settings() -> Settings:
    return Settings()
