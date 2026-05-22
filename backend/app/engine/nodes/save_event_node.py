import asyncio
import os
from datetime import datetime, timezone
from app.engine.base_node import BaseNode
from app.engine.workflow_context import WorkflowContext
from app.db.database import AsyncSessionLocal
from app.services.event_service import create_event
from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)


def _cv2():
    try:
        import cv2
    except ImportError as exc:
        raise RuntimeError("OpenCV is required to save event frames") from exc
    return cv2


def _write_frame(path: str, frame) -> None:
    _cv2().imwrite(path, frame)


def _resolve_column_value(expr: str, det: dict) -> str:
    """Substitute {variable} placeholders in a column value expression."""
    value = str(expr)
    value = value.replace("{class_name}", str(det.get("class_name") or ""))
    value = value.replace("{confidence}", str(round(float(det.get("confidence") or 0), 4)))
    value = value.replace("{tracker_id}", str(det.get("tracker_id") or ""))
    value = value.replace("{zone_name}", str(det.get("zone_name") or ""))
    return value


class SaveEventNode(BaseNode):
    type = "save_event"

    async def run(self, context: WorkflowContext, input_data: dict) -> dict:
        config = input_data.get("config", {})
        save_frame = config.get("save_frame", False)
        custom_columns: list[dict] = config.get("custom_columns") or []

        if not context.events:
            return {}

        frame_path = None
        frame_to_save = context.annotated_frame if context.annotated_frame is not None else context.frame
        if save_frame and frame_to_save is not None:
            os.makedirs(settings.exports_dir, exist_ok=True)
            fname = f"{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S_%f')}.jpg"
            frame_path = os.path.join(settings.exports_dir, fname)
            try:
                await asyncio.to_thread(_write_frame, frame_path, frame_to_save)
            except RuntimeError as exc:
                logger.warning(str(exc))
                frame_path = None

        async with AsyncSessionLocal() as db:
            for det in context.events:
                # Build metadata from custom columns
                metadata = None
                if custom_columns:
                    metadata = {}
                    for col in custom_columns:
                        name = (col.get("name") or "").strip()
                        if not name:
                            continue
                        metadata[name] = _resolve_column_value(col.get("value") or "", det)

                try:
                    await create_event(
                        db,
                        source_id=context.source_id,
                        workflow_id=context.workflow_id,
                        class_name=det["class_name"],
                        class_id=det.get("class_id"),
                        confidence=det.get("confidence"),
                        tracker_id=det.get("tracker_id"),
                        zone_name=det.get("zone_name"),
                        bbox=det.get("bbox"),
                        frame_path=frame_path,
                        metadata_=metadata,
                    )
                except Exception as e:
                    logger.error(f"SaveEventNode: {e}")

        return {}
