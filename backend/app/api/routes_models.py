import os
import shutil
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.database import get_db
from app.db.models import YoloModel
from app.schemas.model import ModelCreate, ModelRead
from app.core.config import settings
from sqlalchemy import select

router = APIRouter(prefix="/models", tags=["models"])


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
    os.makedirs(settings.models_dir, exist_ok=True)
    dest = os.path.join(settings.models_dir, file.filename)
    with open(dest, "wb") as f:
        shutil.copyfileobj(file.file, f)

    if is_default:
        result = await db.execute(select(YoloModel).where(YoloModel.is_default == True))
        for m in result.scalars().all():
            m.is_default = False

    model = YoloModel(name=name, filename=file.filename, path=dest, is_default=is_default)
    db.add(model)
    await db.commit()
    await db.refresh(model)
    return model


@router.delete("/{model_id}", status_code=204)
async def delete_model(model_id: int, db: AsyncSession = Depends(get_db)):
    m = await db.get(YoloModel, model_id)
    if not m:
        raise HTTPException(404, "Model not found")
    if os.path.exists(m.path):
        os.remove(m.path)
    await db.delete(m)
    await db.commit()


@router.get("/default")
async def get_default_model(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(YoloModel).where(YoloModel.is_default == True))
    m = result.scalars().first()
    if not m:
        return {"path": "yolov8n.pt", "name": "yolov8n (built-in)"}
    return {"path": m.path, "name": m.name}
