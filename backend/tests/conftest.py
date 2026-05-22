"""
Shared test fixtures.

Provides a `client` fixture (session-scoped) that wires a FastAPI TestClient
against an isolated SQLite test database so production data is never touched.
"""
import asyncio
import os
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

# File-based test DB (easier than in-memory for session-scoped fixtures)
_TEST_DB_PATH = os.path.join(os.path.dirname(__file__), "_test.db")
_TEST_DB_URL = f"sqlite+aiosqlite:///{_TEST_DB_PATH}"


def _run(coro):
    """Run a coroutine synchronously (only safe outside an active event loop)."""
    return asyncio.run(coro)


@pytest.fixture(scope="session")
def client():
    from app.db.database import get_db, Base
    from app.main import app

    test_engine = create_async_engine(_TEST_DB_URL)
    TestSession = async_sessionmaker(test_engine, expire_on_commit=False)

    # Initialise the test schema before starting the app
    async def _create_tables():
        async with test_engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    _run(_create_tables())

    async def _override_get_db():
        async with TestSession() as session:
            yield session

    app.dependency_overrides[get_db] = _override_get_db

    with TestClient(app) as c:
        yield c

    app.dependency_overrides.clear()

    async def _cleanup():
        await test_engine.dispose()

    _run(_cleanup())

    if os.path.exists(_TEST_DB_PATH):
        os.remove(_TEST_DB_PATH)
