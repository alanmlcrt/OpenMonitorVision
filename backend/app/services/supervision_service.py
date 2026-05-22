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
) -> np.ndarray:
    sv = _sv()
    annotated = frame.copy()

    if show_boxes and len(detections) > 0:
        box_annotator = sv.BoxAnnotator()
        annotated = box_annotator.annotate(annotated, detections)

    if show_labels and len(detections) > 0:
        labels = []
        for i in range(len(detections)):
            class_id = int(detections.class_id[i]) if detections.class_id is not None else -1
            name = class_names[class_id] if 0 <= class_id < len(class_names) else "?"
            conf = f" {detections.confidence[i]:.2f}" if show_confidence and detections.confidence is not None else ""
            tid = f" #{detections.tracker_id[i]}" if show_tracker_id and detections.tracker_id is not None else ""
            labels.append(f"{name}{conf}{tid}")
        label_annotator = sv.LabelAnnotator()
        annotated = label_annotator.annotate(annotated, detections, labels=labels)

    return annotated


def detections_to_json(
    detections: Any, class_names: list[str], zone_names: dict[int, str] | None = None
) -> list[dict[str, Any]]:
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
        result.append(entry)
    return result
