from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from app.core.config import settings
from app.core.logging import setup_logging
from app.db.database import init_db
from app.api import (
    routes_sources,
    routes_workflows,
    routes_events,
    routes_models,
    routes_datasets,
    routes_training,
    routes_mqtt,
    routes_satellite,
    routes_ws,
)
from app.services import mqtt_service, training_service, workflow_service


@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging()
    await init_db()
    await workflow_service.migrate_zone_coordinates()
    await training_service.start_worker()
    await workflow_service.restart_enabled_workflows()
    try:
        yield
    finally:
        await training_service.stop_worker()
        mqtt_service.shutdown_all()


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
app.include_router(routes_datasets.router, prefix="/api")
app.include_router(routes_training.router, prefix="/api")
app.include_router(routes_mqtt.router, prefix="/api")
app.include_router(routes_satellite.router, prefix="/api")
app.include_router(routes_ws.router)


@app.get("/api/health")
async def health():
    from app.core.device import get_device_info
    from app.runtime import stream_manager
    from app.services import training_service

    stats = stream_manager.all_running_stats()
    return {
        "status": "ok",
        "device": get_device_info(),
        "workflows": {
            "running_count": len(stats),
            "ids": sorted(stats.keys()),
            "stats": stats,                       # last_frame_at, fps_smoothed, …
        },
        "training": {
            "current_job_id": training_service.current_job_id(),
        },
    }
