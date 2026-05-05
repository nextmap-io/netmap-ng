import os

os.environ.setdefault("APP_SECRET_KEY", "test-secret-key-for-tests")
os.environ.setdefault("AUTH_DISABLED", "true")
os.environ.setdefault("DEV_ALLOW_NO_AUTH", "true")
os.environ.setdefault("APP_BASE_URL", "http://localhost:8000")
os.environ.setdefault("APP_DB_URL", "sqlite+aiosqlite:///:memory:")
os.environ.setdefault("SESSION_REDIS_URL", "")
