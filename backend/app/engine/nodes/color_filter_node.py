from __future__ import annotations

import asyncio
from typing import Any

import numpy as np

from app.core.logging import get_logger
from app.engine.base_node import BaseNode
from app.engine.workflow_context import WorkflowContext

logger = get_logger(__name__)


HSV_RANGES: dict[str, list[tuple[tuple[int, int, int], tuple[int, int, int]]]] = {
    "green": [((35, 40, 40), (90, 255, 255))],
    "blue": [((90, 40, 40), (130, 255, 255))],
    "yellow": [((20, 40, 40), (35, 255, 255))],
    "orange": [((5, 50, 50), (20, 255, 255))],
    "red": [((0, 50, 40), (10, 255, 255)), ((170, 50, 40), (179, 255, 255))],
    "white": [((0, 0, 170), (179, 55, 255))],
    "black": [((0, 0, 0), (179, 255, 70))],
    "gray": [((0, 0, 60), (179, 55, 190))],
}


def _cv2():
    try:
        import cv2
    except ImportError as exc:
        raise RuntimeError("OpenCV is required for ColorFilterNode") from exc
    return cv2


def _clip_bbox(xyxy: np.ndarray, width: int, height: int, padding: int) -> tuple[int, int, int, int] | None:
    x1, y1, x2, y2 = [float(v) for v in xyxy]
    x1 = max(0, int(np.floor(x1 - padding)))
    y1 = max(0, int(np.floor(y1 - padding)))
    x2 = min(width, int(np.ceil(x2 + padding)))
    y2 = min(height, int(np.ceil(y2 + padding)))
    if x2 <= x1 or y2 <= y1:
        return None
    return x1, y1, x2, y2


def _mask_ratio(crop: np.ndarray, color_name: str, min_saturation: int, min_value: int) -> float:
    cv2 = _cv2()
    ranges = HSV_RANGES.get(color_name)
    if not ranges:
        return 0.0

    hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
    mask = np.zeros(hsv.shape[:2], dtype=np.uint8)
    for lower, upper in ranges:
        lower_arr = np.array(
            [lower[0], max(lower[1], min_saturation), max(lower[2], min_value)],
            dtype=np.uint8,
        )
        upper_arr = np.array(upper, dtype=np.uint8)
        mask = mask | cv2.inRange(hsv, lower_arr, upper_arr)

    return float(np.count_nonzero(mask)) / float(mask.size or 1)


def _with_detection_data(detections: Any, color_name: str, ratios: list[float]) -> Any:
    data = dict(getattr(detections, "data", {}) or {})
    data["color_name"] = np.array([color_name] * len(ratios), dtype=object)
    data["color_ratio"] = np.array(ratios, dtype=np.float32)
    try:
        detections.data = data
    except Exception:
        logger.debug("ColorFilterNode: unable to attach detection data", exc_info=True)
    return detections


def _filter_by_color(
    frame: np.ndarray,
    detections: Any,
    *,
    color_name: str,
    min_ratio: float,
    min_saturation: int,
    min_value: int,
    padding_px: int,
) -> Any:
    height, width = frame.shape[:2]
    keep: list[bool] = []
    ratios: list[float] = []

    for i in range(len(detections)):
        clipped = _clip_bbox(detections.xyxy[i], width, height, padding_px)
        if clipped is None:
            keep.append(False)
            ratios.append(0.0)
            continue
        x1, y1, x2, y2 = clipped
        crop = frame[y1:y2, x1:x2]
        if crop.size == 0:
            ratio = 0.0
        else:
            ratio = _mask_ratio(crop, color_name, min_saturation, min_value)
        keep.append(ratio >= min_ratio)
        ratios.append(ratio)

    detections = _with_detection_data(detections, color_name, ratios)
    return detections[np.array(keep, dtype=bool)]


class ColorFilterNode(BaseNode):
    type = "color_filter"

    async def run(self, context: WorkflowContext, input_data: dict) -> dict:
        config = input_data.get("config", {})
        if context.frame is None or context.detections is None or len(context.detections) == 0:
            return {}

        color_name = str(config.get("target_color") or "green").lower()
        if color_name not in HSV_RANGES:
            logger.warning("ColorFilterNode: unknown target_color '%s'", color_name)
            return {}

        min_ratio = float(config.get("min_color_ratio", 0.12))
        min_saturation = int(config.get("min_saturation", 40))
        min_value = int(config.get("min_value", 40))
        padding_px = max(0, int(config.get("bbox_padding_px", 0)))

        try:
            context.detections = await asyncio.to_thread(
                _filter_by_color,
                context.frame,
                context.detections,
                color_name=color_name,
                min_ratio=min_ratio,
                min_saturation=min_saturation,
                min_value=min_value,
                padding_px=padding_px,
            )
        except RuntimeError as exc:
            logger.warning(str(exc))

        return {}
