import os
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.device import get_device_info, get_best_device
from app.db.database import get_db
from app.db.models import YoloModel
from app.schemas.training import (
    BaseModelOption,
    DeviceInfo,
    TrainingJobCreate,
    TrainingJobRead,
)
from app.services import training_service

router = APIRouter(prefix="/training", tags=["training"])


# Curated list of base weights ultralytics will lazily download on first use
_BASE_MODELS: list[BaseModelOption] = [
    BaseModelOption(value="yolov8n.pt", label="YOLOv8 Nano (3.2M)"),
    BaseModelOption(value="yolov8s.pt", label="YOLOv8 Small (11.2M)"),
    BaseModelOption(value="yolov8m.pt", label="YOLOv8 Medium (25.9M)"),
    BaseModelOption(value="yolov8l.pt", label="YOLOv8 Large (43.7M)"),
    BaseModelOption(value="yolov8x.pt", label="YOLOv8 X-Large (68.2M)"),
    BaseModelOption(value="yolo11n.pt", label="YOLO11 Nano (2.6M)"),
    BaseModelOption(value="yolo11s.pt", label="YOLO11 Small (9.4M)"),
    BaseModelOption(value="yolo11m.pt", label="YOLO11 Medium (20.1M)"),
]


@router.get("/base-models", response_model=list[BaseModelOption])
async def base_models():
    return _BASE_MODELS


@router.get("/user-models", response_model=list[BaseModelOption])
async def user_models(db: AsyncSession = Depends(get_db)):
    """Registered YOLO weights the user can pick as a starting point
    (transfer learning / resume from a previous training)."""
    result = await db.execute(select(YoloModel).order_by(YoloModel.created_at.desc()))
    return [
        BaseModelOption(value=m.path, label=m.name)
        for m in result.scalars().all()
    ]


@router.get("/device-info", response_model=DeviceInfo)
async def device_info():
    info = get_device_info()
    devices: list[dict] = []
    if info["cuda_available"]:
        for i in range(int(info.get("gpu_count", 0) or 0)):
            devices.append({"id": f"cuda:{i}", "name": info["gpu_name"]})
    devices.append({"id": "cpu", "name": "CPU"})
    return DeviceInfo(
        cuda_available=bool(info["cuda_available"]),
        devices=devices,
        recommended=get_best_device(),
    )


@router.get("", response_model=list[TrainingJobRead])
async def list_jobs(db: AsyncSession = Depends(get_db)):
    return await training_service.list_jobs(db)


@router.post("", response_model=TrainingJobRead, status_code=201)
async def create_job(payload: TrainingJobCreate, db: AsyncSession = Depends(get_db)):
    try:
        return await training_service.enqueue(db, payload)
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@router.get("/{job_id}", response_model=TrainingJobRead)
async def get_job(job_id: int, db: AsyncSession = Depends(get_db)):
    job = await training_service.get_job(db, job_id)
    if job is None:
        raise HTTPException(404, "Training job not found")
    return job


@router.get("/{job_id}/log")
async def get_job_log(
    job_id: int,
    tail: int = 500,
    db: AsyncSession = Depends(get_db),
):
    job = await training_service.get_job(db, job_id)
    if job is None:
        raise HTTPException(404, "Training job not found")
    return {"lines": training_service.tail_log(job, max_lines=max(1, min(tail, 5000)))}


@router.post("/{job_id}/cancel", response_model=TrainingJobRead)
async def cancel_job(job_id: int, db: AsyncSession = Depends(get_db)):
    ok = await training_service.cancel(db, job_id)
    if not ok:
        raise HTTPException(400, "Cannot cancel this job")
    job = await training_service.get_job(db, job_id)
    return job


@router.delete("/{job_id}", status_code=204)
async def delete_job(job_id: int, db: AsyncSession = Depends(get_db)):
    ok = await training_service.delete_job(db, job_id)
    if not ok:
        raise HTTPException(400, "Cannot delete this job (running? not found?)")


@router.post("/{job_id}/export")
async def export_job(job_id: int, format: str = "onnx", db: AsyncSession = Depends(get_db)):
    job = await training_service.get_job(db, job_id)
    if job is None:
        raise HTTPException(404, "Training job not found")
    if job.status != "completed":
        raise HTTPException(400, "Only completed jobs can be exported")
    try:
        result = await training_service.export_model(job, format)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except Exception as exc:
        raise HTTPException(500, f"Export failed: {exc}")
    return {"ok": True, **result}


@router.get("/{job_id}/export/download")
async def download_export(job_id: int, format: str = "onnx", db: AsyncSession = Depends(get_db)):
    job = await training_service.get_job(db, job_id)
    if job is None:
        raise HTTPException(404, "Training job not found")
    path = training_service.export_path(job, format)
    if path is None:
        raise HTTPException(404, f"No {format} export found — run /export first")
    return FileResponse(
        path,
        filename=os.path.basename(path),
        media_type="application/octet-stream",
    )
