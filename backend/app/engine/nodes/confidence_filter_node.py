from app.engine.base_node import BaseNode
from app.engine.workflow_context import WorkflowContext
from app.services import supervision_service


class ConfidenceFilterNode(BaseNode):
    type = "confidence_filter"

    async def run(self, context: WorkflowContext, input_data: dict) -> dict:
        config = input_data.get("config", {})
        min_conf = float(config.get("min_confidence", 0.5))
        if context.detections is None:
            return {}
        context.detections = supervision_service.filter_by_confidence(context.detections, min_conf)
        return {}
