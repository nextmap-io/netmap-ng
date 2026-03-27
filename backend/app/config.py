import logging
import secrets

from pydantic import field_validator
from pydantic_settings import BaseSettings
from functools import lru_cache

logger = logging.getLogger("netmap")


class Settings(BaseSettings):
    app_secret_key: str = ""
    app_base_url: str = "http://localhost:8000"

    # Explicitly opt-in to disable auth (never in production)
    auth_disabled: bool = False

    # OAuth2
    oauth_client_id: str = ""
    oauth_client_secret: str = ""
    oauth_authorize_url: str = ""
    oauth_token_url: str = ""
    oauth_userinfo_url: str = ""
    oauth_scopes: str = "openid profile email"

    # CORS
    cors_origins: str = "http://localhost:5173,http://localhost:3000"

    # Observium MySQL (read-only)
    observium_db_host: str = "localhost"
    observium_db_port: int = 3306
    observium_db_user: str = "netmap_ro"
    observium_db_password: str = ""
    observium_db_name: str = "observium"

    # Observium RRD
    observium_rrd_path: str = "/opt/observium/rrd"

    # Observium API (optional)
    observium_api_url: str = ""
    observium_api_user: str = ""
    observium_api_password: str = ""

    # Claude API
    anthropic_api_key: str = ""

    # App DB
    app_db_url: str = "sqlite+aiosqlite:///./data/netmap.db"

    @field_validator("app_secret_key", mode="before")
    @classmethod
    def validate_secret_key(cls, v: str) -> str:
        if not v or v == "change-me":
            generated = secrets.token_urlsafe(32)
            logger.warning(
                "APP_SECRET_KEY not set — generated a random key for this session. "
                "Set APP_SECRET_KEY in .env for persistent sessions."
            )
            return generated
        if len(v) < 16:
            raise ValueError("APP_SECRET_KEY must be at least 16 characters")
        return v

    model_config = {"env_file": ".env", "extra": "ignore"}


@lru_cache
def get_settings() -> Settings:
    return Settings()
