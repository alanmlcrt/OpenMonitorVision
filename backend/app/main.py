from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from app.core.config import settings
from app.core.logging import setup_logging
from app.db.database import init_db
from app.api import routes_sources, routes_workflows, routes_events, routes_models, routes_ws


@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging()
    await init_db()
    yield


app = FastAPI(
    title=settings.app_name,
    version=settings.version,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(routes_sources.router, prefix="/api")
app.include_router(routes_workflows.router, prefix="/api")
app.include_router(routes_events.router, prefix="/api")
app.include_router(routes_models.router, prefix="/api")
app.include_router(routes_ws.router)


@app.get("/api/health")
async def health():
    from app.core.device import get_device_info
    return {"status": "ok", "device": get_device_info()}
