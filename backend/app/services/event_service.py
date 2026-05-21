from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from datetime import datetime
from typing import Any
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
) -> list[Event]:
    q = select(Event).order_by(Event.timestamp.desc())
    if source_id is not None:
        q = q.where(Event.source_id == source_id)
    if workflow_id is not None:
        q = q.where(Event.workflow_id == workflow_id)
    if class_name:
        q = q.where(Event.class_name == class_name)
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
