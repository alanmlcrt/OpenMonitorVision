import time
from app.engine.base_node import BaseNode
from app.engine.workflow_context import WorkflowContext
from app.services.supervision_service import detections_to_json

_cooldown_state: dict[str, float] = {}


def reset_cooldown(workflow_id: int) -> None:
    prefix = f"wf_{workflow_id}:"
    for k in [k for k in _cooldown_state if k.startswith(prefix)]:
        del _cooldown_state[k]


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

        if not once_per_object:
            key = f"wf_{context.workflow_id}:global"
            last = _cooldown_state.get(key, 0)
            if now - last >= cooldown:
                _cooldown_state[key] = now
                context.events = detections
            else:
                context.events = []
            return {}

        events = []

        for index, detection in enumerate(detections):
            tracker_id = detection.get("tracker_id")
            has_tracker = tracker_id is not None
            object_key = f"track_{tracker_id}" if has_tracker else f"untracked_{index}"
            key = f"wf_{context.workflow_id}:{object_key}"
            last = _cooldown_state.get(key, 0)
            if has_tracker and last:
                continue
            if now - last < cooldown:
                continue
            _cooldown_state[key] = now
            events.append(detection)

        context.events = events
        return {}
