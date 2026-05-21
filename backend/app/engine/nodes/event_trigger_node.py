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
        once_per_object = bool(config.get("trigger_once_per_object", False))

        if context.detections is None or len(context.detections) == 0:
            return {}

        now = time.time()
        detections = detections_to_json(context.detections, context.class_names)
        events = []

        for index, detection in enumerate(detections):
            tracker_id = detection.get("tracker_id")
            object_key = tracker_id if tracker_id is not None else f"det_{index}"
            key = f"wf_{context.workflow_id}:{object_key if once_per_object else 'global'}"
            last = _cooldown_state.get(key, 0)
            if once_per_object and last:
                continue
            if now - last < cooldown:
                continue
            _cooldown_state[key] = now
            events.append(detection)

        context.events = events
        return {}
