from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import cv2
import base64
import numpy as np
from app.db.models import Source
from app.schemas.source import SourceCreate, SourceUpdate
from app.core.logging import get_logger

logger = get_logger(__name__)


async def list_sources(db: AsyncSession) -> list[Source]:
    result = await db.execute(select(Source))
    return result.scalars().all()


async def get_source(db: AsyncSession, source_id: int) -> Source | None:
    return await db.get(Source, source_id)


async def create_source(db: AsyncSession, data: SourceCreate) -> Source:
    source = Source(**data.model_dump())
    db.add(source)
    await db.commit()
    await db.refresh(source)
    return source


async def update_source(db: AsyncSession, source_id: int, data: SourceUpdate) -> Source | None:
    source = await db.get(Source, source_id)
    if not source:
        return None
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(source, key, value)
    await db.commit()
    await db.refresh(source)
    return source


async def delete_source(db: AsyncSession, source_id: int) -> bool:
    source = await db.get(Source, source_id)
    if not source:
        return False
    await db.delete(source)
    await db.commit()
    return True


def _open_capture(source: Source) -> cv2.VideoCapture | None:
    if source.type == "webcam":
        try:
            idx = int(source.uri)
        except ValueError:
            idx = 0
        cap = cv2.VideoCapture(idx)
    else:
        cap = cv2.VideoCapture(source.uri)
    if not cap.isOpened():
        return None
    return cap


def get_source_preview(source: Source) -> str | None:
    cap = _open_capture(source)
    if cap is None:
        return None
    try:
        ret, frame = cap.read()
        if not ret or frame is None:
            return None
        frame = cv2.resize(frame, (640, 360))
        _, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 75])
        return base64.b64encode(buf.tobytes()).decode()
    except Exception as e:
        logger.warning(f"Preview error: {e}")
        return None
    finally:
        cap.release()


def test_source(source: Source) -> dict:
    cap = _open_capture(source)
    if cap is None:
        return {"ok": False, "error": "Cannot open source"}
    try:
        ret, frame = cap.read()
        if not ret:
            return {"ok": False, "error": "Cannot read frame"}
        h, w = frame.shape[:2]
        return {"ok": True, "width": w, "height": h}
    except Exception as e:
        return {"ok": False, "error": str(e)}
    finally:
        cap.release()
