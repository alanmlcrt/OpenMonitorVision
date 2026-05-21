from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from app.core.config import settings
import os

for directory in (
    os.path.dirname(settings.db_path),
    settings.models_dir,
    settings.uploads_dir,
    settings.exports_dir,
    settings.ultralytics_config_dir,
):
    os.makedirs(directory, exist_ok=True)

DATABASE_URL = f"sqlite+aiosqlite:///{settings.db_path}"

engine = create_async_engine(DATABASE_URL, echo=False)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        yield session


async def init_db() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
