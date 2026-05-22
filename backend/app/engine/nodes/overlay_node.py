import asyncio

from app.engine.base_node import BaseNode
from app.engine.workflow_context import WorkflowContext
from app.services import supervision_service


class OverlayNode(BaseNode):
    type = "overlay"

    async def run(self, context: WorkflowContext, input_data: dict) -> dict:
        config = input_data.get("config", {})
        if context.frame is None or context.detections is None:
            context.annotated_frame = context.frame
            return {}

        context.annotated_frame = await asyncio.to_thread(
            supervision_service.annotate_frame,
            context.frame,
            context.detections,
            context.class_names,
            show_boxes=config.get("show_boxes", True),
            show_labels=config.get("show_labels", True),
            show_confidence=config.get("show_confidence", True),
            show_tracker_id=config.get("show_tracker_id", True),
        )
        return {}
