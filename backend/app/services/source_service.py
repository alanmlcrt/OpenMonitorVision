from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import cv2
import base64
import os
import time
from app.db.models import Source
from app.schemas.source import SourceCreate, SourceUpdate
from app.core.logging import get_logger

logger = get_logger(__name__)

RTSP_OPEN_TIMEOUT_MS = 8000
RTSP_READ_TIMEOUT_MS = 8000


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
        cap = cv2.VideoCapture(idx, cv2.CAP_DSHOW)
    elif source.type == "rtsp":
        os.environ.setdefault(
            "OPENCV_FFMPEG_CAPTURE_OPTIONS",
            "rtsp_transport;tcp|stimeout;8000000|max_delay;5000000",
        )
        cap = cv2.VideoCapture(source.uri, cv2.CAP_FFMPEG)
        cap.set(cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, RTSP_OPEN_TIMEOUT_MS)
        cap.set(cv2.CAP_PROP_READ_TIMEOUT_MSEC, RTSP_READ_TIMEOUT_MS)
    else:
        cap = cv2.VideoCapture(source.uri)
    if not cap.isOpened():
        return None
    return cap


def _read_frame(cap: cv2.VideoCapture, timeout_seconds: float = 8.0):
    deadline = time.monotonic() + timeout_seconds
    last_frame = None
    while time.monotonic() < deadline:
        ret, frame = cap.read()
        if ret and frame is not None:
            last_frame = frame
            break
        time.sleep(0.1)
    return last_frame


def get_source_preview(source: Source) -> str | None:
    cap = _open_capture(source)
    if cap is None:
        return None
    try:
        frame = _read_frame(cap)
        if frame is None:
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
        frame = _read_frame(cap)
        if frame is None:
            return {"ok": False, "error": "Cannot read frame"}
        h, w = frame.shape[:2]
        fps = cap.get(cv2.CAP_PROP_FPS) or None
        return {
            "ok": True,
            "width": w,
            "height": h,
            "fps": round(float(fps), 2) if fps else None,
            "backend": "opencv",
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}
    finally:
        cap.release()
