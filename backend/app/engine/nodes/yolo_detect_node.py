from app.engine.base_node import BaseNode
from app.engine.workflow_context import WorkflowContext
from app.services import inference_service, supervision_service
from app.core.logging import get_logger

logger = get_logger(__name__)


class YoloDetectNode(BaseNode):
    type = "yolo_detect"

    async def run(self, context: WorkflowContext, input_data: dict) -> dict:
        config = input_data.get("config", {})
        model_path = config.get("model_path", "yolov8n.pt")
        confidence = float(config.get("confidence", 0.25))
        iou = float(config.get("iou", 0.7))
        device = str(config.get("device", "auto"))

        if context.frame is None:
            return {}

        try:
            model = inference_service.load_model(model_path, device=device)
            result = inference_service.run_inference(model, context.frame, confidence, iou)
            if result is None:
                return {}
            context.class_names = list(model.names.values())
            context.detections = supervision_service.result_to_detections(result)
        except Exception as e:
            logger.error(f"YoloDetectNode error: {e}")

        return {}
