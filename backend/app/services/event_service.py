import os
import glob
from datetime import datetime, timezone, timedelta
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, delete
from app.db.models import Event, Source
from app.schemas.event import EventStats


async def create_event(db: AsyncSession, **kwargs) -> Event:
    event = Event(**kwargs)
    db.add(event)
    await db.commit()
    await db.refresh(event)
    return event


async def list_events(
    db: AsyncSession,
    limit: int = 100,
    offset: int = 0,
    source_id: int | None = None,
    workflow_id: int | None = None,
    class_name: str | None = None,
    min_confidence: float | None = None,
    since: datetime | None = None,
    until: datetime | None = None,
) -> list[Event]:
    q = select(Event).order_by(Event.timestamp.desc())
    if source_id is not None:
        q = q.where(Event.source_id == source_id)
    if workflow_id is not None:
        q = q.where(Event.workflow_id == workflow_id)
    if class_name:
        q = q.where(Event.class_name == class_name)
    if min_confidence is not None:
        q = q.where(Event.confidence >= min_confidence)
    if since is not None:
        q = q.where(Event.timestamp >= since)
    if until is not None:
        q = q.where(Event.timestamp <= until)
    q = q.offset(offset).limit(limit)
    result = await db.execute(q)
    return result.scalars().all()


async def get_event(db: AsyncSession, event_id: int) -> Event | None:
    return await db.get(Event, event_id)


async def delete_event(db: AsyncSession, event_id: int) -> bool:
    event = await db.get(Event, event_id)
    if not event:
        return False
    await db.delete(event)
    await db.commit()
    return True


async def get_stats(db: AsyncSession) -> EventStats:
    total_result = await db.execute(select(func.count(Event.id)))
    total = total_result.scalar() or 0

    by_class_result = await db.execute(
        select(Event.class_name, func.count(Event.id)).group_by(Event.class_name)
    )
    by_class = {row[0]: row[1] for row in by_class_result.all()}

    by_source_result = await db.execute(
        select(Source.name, func.count(Event.id))
        .join(Source, Event.source_id == Source.id)
        .group_by(Source.name)
    )
    by_source = {row[0]: row[1] for row in by_source_result.all()}

    by_hour_result = await db.execute(
        select(
            func.strftime("%H", Event.timestamp).label("hour"),
            func.count(Event.id),
        ).group_by("hour")
    )
    by_hour = {row[0]: row[1] for row in by_hour_result.all()}

    return EventStats(total=total, by_class=by_class, by_source=by_source, by_hour=by_hour)


async def delete_all_events(
    db: AsyncSession,
    source_id: int | None = None,
    workflow_id: int | None = None,
) -> int:
    """Delete events in bulk, optionally scoped to a source or workflow. Returns deleted count."""
    q = delete(Event)
    if source_id is not None:
        q = q.where(Event.source_id == source_id)
    if workflow_id is not None:
        q = q.where(Event.workflow_id == workflow_id)
    result = await db.execute(q)
    await db.commit()
    return result.rowcount


def cleanup_frame_files(exports_dir: str, older_than_days: int = 7) -> int:
    """Delete JPEG frame snapshots older than `older_than_days` days. Returns deleted count."""
    if not os.path.isdir(exports_dir):
        return 0
    cutoff = datetime.now(tz=timezone.utc) - timedelta(days=older_than_days)
    deleted = 0
    for path in glob.glob(os.path.join(exports_dir, "*.jpg")):
        try:
            mtime = datetime.fromtimestamp(os.path.getmtime(path), tz=timezone.utc)
            if mtime < cutoff:
                os.remove(path)
                deleted += 1
        except OSError:
            pass
    return deleted
