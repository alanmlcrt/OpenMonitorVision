import os
import shutil
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.database import get_db
from app.db.models import YoloModel
from app.schemas.model import ModelRead
from app.core.config import settings
from sqlalchemy import select

router = APIRouter(prefix="/models", tags=["models"])

_ALLOWED_MODEL_EXTENSIONS = {".pt", ".onnx"}


def _safe_model_filename(filename: str | None) -> str:
    raw = (filename or "").strip()
    if not raw or "/" in raw or "\\" in raw:
        raise HTTPException(400, "Invalid model filename")

    safe = os.path.basename(raw)
    stem, ext = os.path.splitext(safe)
    if not stem or ext.lower() not in _ALLOWED_MODEL_EXTENSIONS:
        allowed = ", ".join(sorted(_ALLOWED_MODEL_EXTENSIONS))
        raise HTTPException(400, f"Model file must use one of: {allowed}")

    normalized_stem = "".join(
        ch if ch.isalnum() or ch in ("-", "_", ".") else "_"
        for ch in stem
    ).strip("._")
    if not normalized_stem:
        raise HTTPException(400, "Invalid model filename")
    return f"{normalized_stem}{ext.lower()}"


def _models_dir() -> Path:
    return Path(settings.models_dir).resolve(strict=False)


def _unique_model_path(filename: str) -> Path:
    models_dir = _models_dir()
    models_dir.mkdir(parents=True, exist_ok=True)
    stem, ext = os.path.splitext(filename)
    candidate = (models_dir / filename).resolve(strict=False)
    index = 1
    while candidate.exists():
        candidate = (models_dir / f"{stem}_{index}{ext}").resolve(strict=False)
        index += 1
    try:
        candidate.relative_to(models_dir)
    except ValueError as exc:
        raise HTTPException(400, "Invalid model filename") from exc
    return candidate


def _stored_model_path(path: str | None) -> Path | None:
    if not path:
        return None
    models_dir = _models_dir()
    candidate = Path(path).resolve(strict=False)
    try:
        candidate.relative_to(models_dir)
    except ValueError:
        return None
    return candidate


@router.get("", response_model=list[ModelRead])
async def list_models(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(YoloModel))
    return result.scalars().all()


@router.post("", response_model=ModelRead, status_code=201)
async def upload_model(
    name: str,
    file: UploadFile = File(...),
    is_default: bool = False,
    db: AsyncSession = Depends(get_db),
):
    filename = _safe_model_filename(file.filename)
    dest = _unique_model_path(filename)
    with open(dest, "wb") as f:
        shutil.copyfileobj(file.file, f)

    if is_default:
        result = await db.execute(select(YoloModel).where(YoloModel.is_default == True))
        for m in result.scalars().all():
            m.is_default = False

    model = YoloModel(name=name, filename=dest.name, path=str(dest), is_default=is_default)
    db.add(model)
    await db.commit()
    await db.refresh(model)
    return model


@router.delete("/{model_id}", status_code=204)
async def delete_model(model_id: int, db: AsyncSession = Depends(get_db)):
    m = await db.get(YoloModel, model_id)
    if not m:
        raise HTTPException(404, "Model not found")
    path = _stored_model_path(m.path)
    if path is not None and path.exists():
        path.unlink()
    await db.delete(m)
    await db.commit()


@router.get("/default")
async def get_default_model(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(YoloModel).where(YoloModel.is_default == True))
    m = result.scalars().first()
    if not m:
        return {"path": "yolov8n.pt", "name": "yolov8n (built-in)"}
    return {"path": m.path, "name": m.name}
