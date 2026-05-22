import asyncio
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.database import get_db
from app.schemas.event import EventRead, EventStats
from app.services import event_service
from app.core.config import settings

router = APIRouter(prefix="/events", tags=["events"])


@router.get("", response_model=list[EventRead])
async def list_events(
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    source_id: int | None = None,
    workflow_id: int | None = None,
    class_name: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    return await event_service.list_events(db, limit, offset, source_id, workflow_id, class_name)


@router.get("/stats", response_model=EventStats)
async def get_stats(db: AsyncSession = Depends(get_db)):
    return await event_service.get_stats(db)


@router.delete("", status_code=200)
async def clear_events(
    source_id: int | None = None,
    workflow_id: int | None = None,
    db: AsyncSession = Depends(get_db),
):
    """Bulk-delete events, optionally scoped to a source or workflow."""
    count = await event_service.delete_all_events(db, source_id=source_id, workflow_id=workflow_id)
    return {"deleted": count}


@router.post("/cleanup-frames")
async def cleanup_frames(older_than_days: int = Query(7, ge=1)):
    """Delete frame snapshot files older than N days from the exports directory."""
    deleted = await asyncio.to_thread(
        event_service.cleanup_frame_files, settings.exports_dir, older_than_days
    )
    return {"deleted_files": deleted}


@router.get("/{event_id}", response_model=EventRead)
async def get_event(event_id: int, db: AsyncSession = Depends(get_db)):
    event = await event_service.get_event(db, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    return event


@router.delete("/{event_id}", status_code=204)
async def delete_event(event_id: int, db: AsyncSession = Depends(get_db)):
    ok = await event_service.delete_event(db, event_id)
    if not ok:
        raise HTTPException(404, "Event not found")
