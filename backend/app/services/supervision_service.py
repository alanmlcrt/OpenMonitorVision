import numpy as np
from typing import Any

_trackers: dict[str, Any] = {}


def _sv():
    try:
        import supervision as sv
    except ImportError as exc:
        raise RuntimeError("supervision is required for detection post-processing") from exc
    return sv


def result_to_detections(ultralytics_result) -> Any:
    sv = _sv()
    return sv.Detections.from_ultralytics(ultralytics_result)


def apply_tracker(detections: Any, tracker_key: str) -> Any:
    sv = _sv()
    if tracker_key not in _trackers:
        _trackers[tracker_key] = sv.ByteTrack()
    return _trackers[tracker_key].update_with_detections(detections)


def reset_tracker(tracker_key: str) -> None:
    _trackers.pop(tracker_key, None)


def filter_by_confidence(detections: Any, min_confidence: float) -> Any:
    mask = detections.confidence >= min_confidence
    return detections[mask]


def filter_by_classes(detections: Any, class_names: list[str], model_names: list[str]) -> Any:
    target_ids = [i for i, name in enumerate(model_names) if name in class_names]
    mask = np.isin(detections.class_id, target_ids)
    return detections[mask]


def annotate_frame(
    frame: np.ndarray,
    detections: Any,
    class_names: list[str],
    show_boxes: bool = True,
    show_labels: bool = True,
    show_confidence: bool = True,
    show_tracker_id: bool = True,
    box_style: str = "box",
    box_thickness: int = 2,
    show_mask: bool = False,
    label_position: str = "top_left",
) -> np.ndarray:
    sv = _sv()
    annotated = frame.copy()

    _position_map = {
        "top_left": sv.Position.TOP_LEFT,
        "top_center": sv.Position.TOP_CENTER,
        "bottom_center": sv.Position.BOTTOM_CENTER,
        "center": sv.Position.CENTER,
    }
    text_position = _position_map.get(label_position, sv.Position.TOP_LEFT)

    if show_mask and len(detections) > 0 and getattr(detections, "mask", None) is not None:
        mask_annotator = sv.MaskAnnotator()
        annotated = mask_annotator.annotate(annotated, detections)

    if show_boxes and len(detections) > 0:
        if box_style == "round":
            box_annotator = sv.RoundBoxAnnotator(thickness=box_thickness)
        elif box_style == "ellipse":
            box_annotator = sv.EllipseAnnotator(thickness=box_thickness)
        elif box_style == "dot":
            box_annotator = sv.DotAnnotator()
        elif box_style == "triangle":
            box_annotator = sv.TriangleAnnotator()
        else:
            box_annotator = sv.BoxAnnotator(thickness=box_thickness)
        annotated = box_annotator.annotate(annotated, detections)

    if show_labels and len(detections) > 0:
        labels = []
        for i in range(len(detections)):
            class_id = int(detections.class_id[i]) if detections.class_id is not None else -1
            name = class_names[class_id] if 0 <= class_id < len(class_names) else "?"
            conf = f" {detections.confidence[i]:.2f}" if show_confidence and detections.confidence is not None else ""
            tid = f" #{detections.tracker_id[i]}" if show_tracker_id and detections.tracker_id is not None else ""
            labels.append(f"{name}{conf}{tid}")
        label_annotator = sv.LabelAnnotator(text_position=text_position)
        annotated = label_annotator.annotate(annotated, detections, labels=labels)

    return annotated


def detections_to_json(
    detections: Any, class_names: list[str], zone_names: dict[int, str] | None = None
) -> list[dict[str, Any]]:
    data = getattr(detections, "data", {}) or {}
    result = []
    for i in range(len(detections)):
        class_id = int(detections.class_id[i]) if detections.class_id is not None else -1
        name = class_names[class_id] if 0 <= class_id < len(class_names) else "unknown"
        xyxy = detections.xyxy[i]
        entry = {
            "class_id": class_id,
            "class_name": name,
            "confidence": float(detections.confidence[i]) if detections.confidence is not None else None,
            "tracker_id": int(detections.tracker_id[i]) if detections.tracker_id is not None else None,
            "bbox": {"x1": float(xyxy[0]), "y1": float(xyxy[1]), "x2": float(xyxy[2]), "y2": float(xyxy[3])},
            "zone_name": zone_names.get(i) if zone_names else None,
        }
        for key, values in data.items():
            if key in entry:
                continue
            value = _indexed_data_value(values, i, len(detections))
            if value is not _MISSING:
                json_value = _jsonable(value)
                if json_value is not None:
                    entry[str(key)] = json_value
        result.append(entry)
    return result


_MISSING = object()


def _indexed_data_value(values: Any, index: int, expected_len: int) -> Any:
    if isinstance(values, np.ndarray):
        if values.ndim == 0:
            return _MISSING
        if len(values) != expected_len:
            return _MISSING
        return values[index]
    if isinstance(values, (list, tuple)):
        if len(values) != expected_len:
            return _MISSING
        return values[index]
    return _MISSING


def _jsonable(value: Any) -> Any:
    if isinstance(value, np.generic):
        return value.item()
    if isinstance(value, np.ndarray):
        if value.ndim == 0:
            return _jsonable(value.item())
        if value.size > 16:
            return None
        return [_jsonable(item) for item in value.tolist()]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    if isinstance(value, (list, tuple)):
        if len(value) > 16:
            return None
        return [_jsonable(item) for item in value]
    if isinstance(value, dict):
        return {str(key): _jsonable(item) for key, item in value.items()}
    return str(value)
