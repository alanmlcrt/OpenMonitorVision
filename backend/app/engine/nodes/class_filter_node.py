from app.engine.base_node import BaseNode
from app.engine.workflow_context import WorkflowContext
from app.services import supervision_service


class ClassFilterNode(BaseNode):
    type = "class_filter"

    async def run(self, context: WorkflowContext, input_data: dict) -> dict:
        config = input_data.get("config", {})
        classes = config.get("classes", [])
        if not classes or context.detections is None:
            return {}
        context.detections = supervision_service.filter_by_classes(
            context.detections, classes, context.class_names
        )
        return {}
