import asyncio

from app.engine.base_node import BaseNode
from app.engine.workflow_context import WorkflowContext
from app.services import supervision_service


class TrackerNode(BaseNode):
    type = "tracker"

    async def run(self, context: WorkflowContext, input_data: dict) -> dict:
        config = input_data.get("config", {})
        if not config.get("enabled", True) or context.detections is None:
            return {}
        tracker_key = f"workflow_{context.workflow_id}"
        context.detections = await asyncio.to_thread(
            supervision_service.apply_tracker,
            context.detections,
            tracker_key,
        )
        return {}
