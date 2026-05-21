from typing import Any
from app.core.device import get_best_device
from app.core.logging import get_logger
import numpy as np

logger = get_logger(__name__)

_model_cache: dict[str, Any] = {}


def load_model(model_path: str, device: str = "auto") -> Any:
    if device == "auto":
        device = get_best_device()

    cache_key = f"{model_path}:{device}"
    if cache_key in _model_cache:
        return _model_cache[cache_key]

    from ultralytics import YOLO

    logger.info(f"Loading model {model_path} on {device}")
    model = YOLO(model_path)
    model.to(device)
    _model_cache[cache_key] = model
    return model


def run_inference(model: Any, frame: np.ndarray, confidence: float = 0.25, iou: float = 0.7):
    results = model(frame, conf=confidence, iou=iou, verbose=False)
    return results[0] if results else None


def unload_model(model_path: str) -> None:
    _model_cache.pop(model_path, None)
