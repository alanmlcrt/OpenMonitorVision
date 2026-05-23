from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.schemas.dataset import (
    DatasetFromSource,
    DatasetImage,
    DatasetRead,
    DatasetValidation,
    LabelRead,
    LabelWrite,
)
from app.services import dataset_service

router = APIRouter(prefix="/datasets", tags=["datasets"])


@router.get("", response_model=list[DatasetRead])
async def list_datasets(db: AsyncSession = Depends(get_db)):
    return await dataset_service.list_datasets(db)


@router.post("", response_model=DatasetRead, status_code=201)
async def upload_dataset(
    name: str = Form(...),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await dataset_service.import_zip(db, name, file)
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@router.post("/from-source", response_model=DatasetRead, status_code=201)
async def create_from_source(payload: DatasetFromSource, db: AsyncSession = Depends(get_db)):
    try:
        return await dataset_service.create_from_source(db, payload)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except RuntimeError as exc:
        raise HTTPException(500, str(exc))


@router.post("/from-folder", response_model=DatasetRead, status_code=201)
async def create_from_folder(
    name: str = Form(...),
    classes: str = Form(""),   # comma-separated
    files: list[UploadFile] = File(...),
    db: AsyncSession = Depends(get_db),
):
    parsed_classes = [c.strip() for c in classes.split(",") if c.strip()]
    try:
        return await dataset_service.import_folder(db, name, files, parsed_classes)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except RuntimeError as exc:
        raise HTTPException(500, str(exc))


@router.get("/{dataset_id}", response_model=DatasetRead)
async def get_dataset(dataset_id: int, db: AsyncSession = Depends(get_db)):
    ds = await dataset_service.get_dataset(db, dataset_id)
    if ds is None:
        raise HTTPException(404, "Dataset not found")
    return ds


@router.get("/{dataset_id}/validate", response_model=DatasetValidation)
async def validate_dataset(dataset_id: int, db: AsyncSession = Depends(get_db)):
    ds = await dataset_service.get_dataset(db, dataset_id)
    if ds is None:
        raise HTTPException(404, "Dataset not found")
    return dataset_service.validate(ds)


@router.delete("/{dataset_id}", status_code=204)
async def delete_dataset(dataset_id: int, db: AsyncSession = Depends(get_db)):
    ok = await dataset_service.delete_dataset(db, dataset_id)
    if not ok:
        raise HTTPException(404, "Dataset not found")


# ── Annotation endpoints ────────────────────────────────────────────────────

@router.get("/{dataset_id}/images", response_model=list[DatasetImage])
async def list_dataset_images(dataset_id: int, db: AsyncSession = Depends(get_db)):
    ds = await dataset_service.get_dataset(db, dataset_id)
    if ds is None:
        raise HTTPException(404, "Dataset not found")
    return dataset_service.list_images(ds)


@router.get("/{dataset_id}/image")
async def get_dataset_image(
    dataset_id: int,
    stem: str,
    split: str = "train",
    db: AsyncSession = Depends(get_db),
):
    ds = await dataset_service.get_dataset(db, dataset_id)
    if ds is None:
        raise HTTPException(404, "Dataset not found")
    if split not in ("train", "val"):
        raise HTTPException(400, "split must be train or val")
    try:
        path = dataset_service.image_path(ds, stem, split)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    if path is None:
        raise HTTPException(404, "Image not found")
    return FileResponse(path, filename=path.name)


@router.get("/{dataset_id}/label", response_model=LabelRead)
async def get_dataset_label(
    dataset_id: int,
    stem: str,
    split: str = "train",
    db: AsyncSession = Depends(get_db),
):
    ds = await dataset_service.get_dataset(db, dataset_id)
    if ds is None:
        raise HTTPException(404, "Dataset not found")
    if split not in ("train", "val"):
        raise HTTPException(400, "split must be train or val")
    try:
        return dataset_service.read_label(ds, stem, split)
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@router.put("/{dataset_id}/label")
async def put_dataset_label(
    dataset_id: int,
    stem: str,
    payload: LabelWrite,
    split: str = "train",
    db: AsyncSession = Depends(get_db),
):
    ds = await dataset_service.get_dataset(db, dataset_id)
    if ds is None:
        raise HTTPException(404, "Dataset not found")
    if split not in ("train", "val"):
        raise HTTPException(400, "split must be train or val")
    try:
        n = dataset_service.write_label(ds, stem, split, payload)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    return {"stem": stem, "split": split, "saved": n}
