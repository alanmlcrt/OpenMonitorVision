from __future__ import annotations

import time
from typing import Any

from app.core.logging import get_logger
from app.engine.base_node import BaseNode
from app.engine.workflow_context import WorkflowContext
from app.services.supervision_service import detections_to_json

logger = get_logger(__name__)

_sequence_state: dict[str, dict[int, dict[str, Any]]] = {}


def reset(workflow_id: int) -> None:
    prefix = f"wf_{workflow_id}:"
    for key in [key for key in _sequence_state if key.startswith(prefix)]:
        del _sequence_state[key]


def _zone_name(zone: dict, index: int) -> str:
    name = str(zone.get("name") or "").strip()
    return name or f"Zone {index + 1}"


def _normalise_zones(config: dict) -> list[dict[str, Any]]:
    zones: list[dict[str, Any]] = []
    for index, zone in enumerate(config.get("zones") or []):
        if not isinstance(zone, dict):
            continue
        points = zone.get("points") or []
        if len(points) < 3:
            continue
        normalised_points: list[tuple[float, float]] = []
        for point in points:
            try:
                x, y = point
                normalised_points.append((float(x), float(y)))
            except (TypeError, ValueError):
                normalised_points = []
                break
        if len(normalised_points) < 3:
            continue
        zones.append({"name": _zone_name(zone, index), "points": normalised_points})
    return zones


def _normalise_sequence(config: dict, zones: list[dict[str, Any]]) -> list[str]:
    configured = (
        config.get("sequence")
        or config.get("zone_sequence")
        or config.get("sequence_zone_names")
        or []
    )
    if isinstance(configured, str):
        sequence = [item.strip() for item in configured.split(",") if item.strip()]
    else:
        sequence = [str(item).strip() for item in configured if str(item).strip()]

    zone_names = {_zone["name"] for _zone in zones}
    sequence = [name for name in sequence if name in zone_names]
    if len(sequence) >= 2:
        return sequence
    return [zone["name"] for zone in zones[:2]]


def _anchor_point(xyxy, anchor: str) -> tuple[float, float]:
    x1, y1, x2, y2 = [float(v) for v in xyxy]
    if anchor == "center":
        return (x1 + x2) / 2.0, (y1 + y2) / 2.0
    if anchor == "top_center":
        return (x1 + x2) / 2.0, y1
    return (x1 + x2) / 2.0, y2


def _point_inside_polygon(x: float, y: float, polygon: list[tuple[float, float]]) -> bool:
    inside = False
    j = len(polygon) - 1
    for i, (xi, yi) in enumerate(polygon):
        xj, yj = polygon[j]
        intersects = (yi > y) != (yj > y)
        if intersects:
            x_intersect = ((xj - xi) * (y - yi) / ((yj - yi) or 1e-9)) + xi
            if x <= x_intersect:
                inside = not inside
        j = i
    return inside


def _current_zones_for_detection(xyxy, zones: list[dict[str, Any]], anchor: str) -> set[str]:
    x, y = _anchor_point(xyxy, anchor)
    return {
        zone["name"]
        for zone in zones
        if _point_inside_polygon(x, y, zone["points"])
    }


def _tracker_id_at(detections: Any, index: int) -> int | None:
    tracker_ids = getattr(detections, "tracker_id", None)
    if tracker_ids is None:
        return None
    try:
        tracker_id = tracker_ids[index]
    except (IndexError, TypeError):
        return None
    if tracker_id is None:
        return None
    try:
        tracker_id_int = int(tracker_id)
    except (TypeError, ValueError):
        return None
    return tracker_id_int if tracker_id_int >= 0 else None


class ZoneSequenceTriggerNode(BaseNode):
    type = "zone_sequence_trigger"

    async def run(self, context: WorkflowContext, input_data: dict) -> dict:
        config = input_data.get("config", {})
        if context.detections is None or len(context.detections) == 0:
            return {}

        zones = _normalise_zones(config)
        sequence = _normalise_sequence(config, zones)
        if len(sequence) < 2:
            return {}

        if getattr(context.detections, "tracker_id", None) is None:
            logger.warning("zone_sequence_trigger: requires Tracker upstream")
            return {}

        anchor = str(config.get("anchor") or "bottom_center")
        if anchor not in {"bottom_center", "center", "top_center"}:
            anchor = "bottom_center"

        timeout_seconds = float(config.get("max_seconds_between_zones", 30))
        cooldown_seconds = float(config.get("cooldown_seconds", 0))
        once_per_object = bool(config.get("trigger_once_per_object", True))

        node_id = context.current_node_id or "anon"
        sequence_key = ">".join(sequence)
        state_key = f"wf_{context.workflow_id}:{node_id}:{sequence_key}"
        per_object = _sequence_state.setdefault(state_key, {})

        now = time.time()
        json_detections = detections_to_json(context.detections, context.class_names)
        events: list[dict] = []

        for index in range(len(context.detections)):
            tracker_id = _tracker_id_at(context.detections, index)
            if tracker_id is None:
                continue

            current_zones = _current_zones_for_detection(
                context.detections.xyxy[index],
                zones,
                anchor,
            )
            if not current_zones:
                continue

            state = per_object.setdefault(
                tracker_id,
                {
                    "stage": 0,
                    "visited": [],
                    "started_at": None,
                    "updated_at": None,
                    "last_triggered_at": 0.0,
                    "completed": False,
                },
            )

            started_at = state.get("started_at")
            if (
                timeout_seconds > 0
                and started_at is not None
                and now - float(started_at) > timeout_seconds
            ):
                state.update({"stage": 0, "visited": [], "started_at": None, "updated_at": None})

            while state["stage"] < len(sequence):
                expected_zone = sequence[state["stage"]]
                if expected_zone not in current_zones:
                    break
                if state["stage"] == 0:
                    state["started_at"] = now
                    state["visited"] = []
                state["visited"].append(expected_zone)
                state["stage"] += 1
                state["updated_at"] = now

            if state["stage"] < len(sequence):
                continue

            if once_per_object and state.get("completed"):
                continue

            last_triggered_at = float(state.get("last_triggered_at") or 0.0)
            if cooldown_seconds > 0 and now - last_triggered_at < cooldown_seconds:
                continue

            event = dict(json_detections[index])
            event["zone_name"] = " -> ".join(sequence)
            event["zone_sequence"] = list(sequence)
            event["zone_sequence_completed"] = True
            event["sequence_duration_seconds"] = round(
                max(0.0, now - float(state.get("started_at") or now)),
                3,
            )
            event["trigger_zone_name"] = sequence[-1]
            events.append(event)

            state["last_triggered_at"] = now
            state["completed"] = True
            state["stage"] = 0
            state["visited"] = []
            state["started_at"] = None
            state["updated_at"] = None

        if events:
            context.events = (context.events or []) + events

        return {}
