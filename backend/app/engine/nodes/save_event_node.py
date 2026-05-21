import os
import base64
import cv2
from datetime import datetime
from app.engine.base_node import BaseNode
from app.engine.workflow_context import WorkflowContext
from app.db.database import AsyncSessionLocal
from app.services.event_service import create_event
from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)


class SaveEventNode(BaseNode):
    type = "save_event"

    async def run(self, context: WorkflowContext, input_data: dict) -> dict:
        config = input_data.get("config", {})
        save_frame = config.get("save_frame", False)

        if not context.events:
            return {}

        frame_path = None
        if save_frame and context.annotated_frame is not None:
            os.makedirs(settings.exports_dir, exist_ok=True)
            fname = f"{datetime.utcnow().strftime('%Y%m%d_%H%M%S_%f')}.jpg"
            frame_path = os.path.join(settings.exports_dir, fname)
            cv2.imwrite(frame_path, context.annotated_frame)

        async with AsyncSessionLocal() as db:
            for det in context.events:
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
                    )
                except Exception as e:
                    logger.error(f"SaveEventNode: {e}")

        return {}
