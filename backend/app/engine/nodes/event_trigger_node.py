import time
from app.engine.base_node import BaseNode
from app.engine.workflow_context import WorkflowContext
from app.services.supervision_service import detections_to_json

_cooldown_state: dict[str, float] = {}


class EventTriggerNode(BaseNode):
    type = "event_trigger"

    async def run(self, context: WorkflowContext, input_data: dict) -> dict:
        config = input_data.get("config", {})
        cooldown = float(config.get("cooldown_seconds", 5))

        if context.detections is None or len(context.detections) == 0:
            return {}

        now = time.time()
        key = f"wf_{context.workflow_id}"
        last = _cooldown_state.get(key, 0)
        if now - last < cooldown:
            return {}

        _cooldown_state[key] = now
        context.events = detections_to_json(context.detections, context.class_names)
        return {}
