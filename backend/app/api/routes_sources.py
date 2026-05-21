import asyncio
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.database import get_db
from app.schemas.source import SourceCreate, SourceUpdate, SourceRead
from app.services import source_service

router = APIRouter(prefix="/sources", tags=["sources"])


@router.get("", response_model=list[SourceRead])
async def list_sources(db: AsyncSession = Depends(get_db)):
    return await source_service.list_sources(db)


@router.post("", response_model=SourceRead, status_code=201)
async def create_source(data: SourceCreate, db: AsyncSession = Depends(get_db)):
    return await source_service.create_source(db, data)


@router.get("/{source_id}", response_model=SourceRead)
async def get_source(source_id: int, db: AsyncSession = Depends(get_db)):
    src = await source_service.get_source(db, source_id)
    if not src:
        raise HTTPException(404, "Source not found")
    return src


@router.patch("/{source_id}", response_model=SourceRead)
async def update_source(source_id: int, data: SourceUpdate, db: AsyncSession = Depends(get_db)):
    src = await source_service.update_source(db, source_id, data)
    if not src:
        raise HTTPException(404, "Source not found")
    return src


@router.delete("/{source_id}", status_code=204)
async def delete_source(source_id: int, db: AsyncSession = Depends(get_db)):
    ok = await source_service.delete_source(db, source_id)
    if not ok:
        raise HTTPException(404, "Source not found")


@router.get("/{source_id}/preview")
async def preview_source(source_id: int, db: AsyncSession = Depends(get_db)):
    src = await source_service.get_source(db, source_id)
    if not src:
        raise HTTPException(404, "Source not found")
    img = await asyncio.to_thread(source_service.get_source_preview, src)
    if img is None:
        raise HTTPException(503, "Cannot capture frame")
    return {"frame": img}


@router.get("/{source_id}/test")
async def test_source(source_id: int, db: AsyncSession = Depends(get_db)):
    src = await source_service.get_source(db, source_id)
    if not src:
        raise HTTPException(404, "Source not found")
    return await asyncio.to_thread(source_service.test_source, src)
