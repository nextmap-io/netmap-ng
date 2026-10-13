import asyncio

from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import get_settings

engine = create_async_engine(get_settings().app_db_url, echo=False)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def init_db(attempts: int = 5) -> None:
    """Create missing tables.

    With several uvicorn workers, each one runs this at startup: two workers can
    both see a table as missing and the slower CREATE fails with "already
    exists", aborting startup. Retrying is safe because create_all skips tables
    that now exist.
    """
    for attempt in range(1, attempts + 1):
        try:
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
            return
        except OperationalError as exc:
            if "already exists" not in str(exc) or attempt == attempts:
                raise
            await asyncio.sleep(0.05 * attempt)


async def get_db():
    async with async_session() as session:
        yield session
