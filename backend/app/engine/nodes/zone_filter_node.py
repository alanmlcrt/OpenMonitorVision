import numpy as np
from app.engine.base_node import BaseNode
from app.engine.workflow_context import WorkflowContext
from app.core.logging import get_logger

logger = get_logger(__name__)


class ZoneFilterNode(BaseNode):
    type = "zone_filter"

    async def run(self, context: WorkflowContext, input_data: dict) -> dict:
        config = input_data.get("config", {})
        zones_config = config.get("zones", [])

        if not zones_config or context.detections is None or len(context.detections) == 0:
            return {}

        try:
            import supervision as sv
        except ImportError:
            logger.warning("supervision not available — ZoneFilterNode skipped")
            return {}

        combined_mask = None

        for zone_cfg in zones_config:
            points = zone_cfg.get("points", [])
            if not points or len(points) < 3:
                continue
            try:
                polygon = np.array(points, dtype=np.int32)
                zone = sv.PolygonZone(polygon=polygon)
                mask = zone.trigger(detections=context.detections)
                combined_mask = mask if combined_mask is None else (combined_mask | mask)
            except Exception as e:
                logger.warning(f"ZoneFilterNode zone error: {e}")

        if combined_mask is not None:
            context.detections = context.detections[combined_mask]

        return {}
