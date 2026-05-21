from app.engine.base_node import BaseNode
from app.engine.workflow_context import WorkflowContext


class SourceNode(BaseNode):
    type = "source"

    async def run(self, context: WorkflowContext, input_data: dict) -> dict:
        source_id = input_data.get("config", {}).get("source_id")
        context.source_id = source_id
        return {}
