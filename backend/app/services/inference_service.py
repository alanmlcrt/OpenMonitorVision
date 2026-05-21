from ultralytics import YOLO
from app.core.device import get_best_device
from app.core.logging import get_logger
import numpy as np

logger = get_logger(__name__)

_model_cache: dict[str, YOLO] = {}


def load_model(model_path: str, device: str = "auto") -> YOLO:
    if model_path in _model_cache:
        return _model_cache[model_path]
    if device == "auto":
        device = get_best_device()
    logger.info(f"Loading model {model_path} on {device}")
    model = YOLO(model_path)
    model.to(device)
    _model_cache[model_path] = model
    return model


def run_inference(model: YOLO, frame: np.ndarray, confidence: float = 0.25, iou: float = 0.7):
    results = model(frame, conf=confidence, iou=iou, verbose=False)
    return results[0] if results else None


def unload_model(model_path: str) -> None:
    _model_cache.pop(model_path, None)
