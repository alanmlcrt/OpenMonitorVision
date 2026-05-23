"""
LineCrossingNode — détecte les franchissements de ligne par les objets trackés.

Utilise sv.LineZone qui suit, frame après frame, de quel côté de la ligne se
trouve chaque tracker_id et émet une transition "in" ou "out" lorsqu'il
change de côté.

Nécessite un node Tracker en amont (les détections doivent avoir tracker_id).

Config:
    line          {"start_x": int, "start_y": int, "end_x": int, "end_y": int}
    direction     'both' | 'in' | 'out'    direction filtrée pour l'émission
    anchor        'bottom_center' | 'center' | 'top_center'   point déclencheur

State held module-level keyed by (workflow_id, node_id). Reset on workflow stop.
"""
from __future__ import annotations

from typing import Any

from app.core.logging import get_logger
from app.engine.base_node import BaseNode
from app.engine.workflow_context import WorkflowContext
from app.services.supervision_service import detections_to_json

logger = get_logger(__name__)


# (workflow_id, node_id, line_signature) → sv.LineZone instance
_line_zones: dict[str, Any] = {}


def reset(workflow_id: int) -> None:
    prefix = f"wf_{workflow_id}:"
    for k in [k for k in _line_zones if k.startswith(prefix)]:
        del _line_zones[k]


def _sv():
    import supervision as sv
    return sv


class LineCrossingNode(BaseNode):
    type = "line_crossing"

    async def run(self, context: WorkflowContext, input_data: dict) -> dict:
        config = input_data.get("config") or {}
        line = config.get("line") or {}

        try:
            start_x = int(line.get("start_x"))
            start_y = int(line.get("start_y"))
            end_x = int(line.get("end_x"))
            end_y = int(line.get("end_y"))
        except (TypeError, ValueError):
            return {}

        if context.detections is None or len(context.detections) == 0:
            return {}

        tracker_id = getattr(context.detections, "tracker_id", None)
        if tracker_id is None:
            logger.warning("line_crossing: requires Tracker upstream — no tracker_id on detections")
            return {}

        try:
            sv = _sv()
        except ImportError:
            return {}

        # Identifie la ligne par (workflow_id, node_id, coords) — si l'utilisateur
        # déplace la ligne, un nouveau LineZone est créé (l'ancien expire au reset).
        node_id = context.current_node_id or "anon"
        line_sig = f"{start_x},{start_y},{end_x},{end_y}"
        key = f"wf_{context.workflow_id}:{node_id}:{line_sig}"

        line_zone = _line_zones.get(key)
        if line_zone is None:
            anchor_name = str(config.get("anchor") or "bottom_center")
            anchor_map = {
                "bottom_center": sv.Position.BOTTOM_CENTER,
                "center": sv.Position.CENTER,
                "top_center": sv.Position.TOP_CENTER,
            }
            anchor = anchor_map.get(anchor_name, sv.Position.BOTTOM_CENTER)
            try:
                line_zone = sv.LineZone(
                    start=sv.Point(x=start_x, y=start_y),
                    end=sv.Point(x=end_x, y=end_y),
                    triggering_anchors=[anchor],
                )
            except TypeError:
                # Anciennes versions de supervision sans triggering_anchors
                line_zone = sv.LineZone(
                    start=sv.Point(x=start_x, y=start_y),
                    end=sv.Point(x=end_x, y=end_y),
                )
            _line_zones[key] = line_zone

        try:
            crossed_in, crossed_out = line_zone.trigger(detections=context.detections)
        except Exception as exc:
            logger.warning("line_crossing: trigger error: %s", exc)
            return {}

        direction_filter = str(config.get("direction") or "both").lower()

        any_crossing = False
        crossing_events: list[dict] = []
        all_json = detections_to_json(context.detections, context.class_names)
        for i, det_json in enumerate(all_json):
            in_i = bool(crossed_in[i]) if i < len(crossed_in) else False
            out_i = bool(crossed_out[i]) if i < len(crossed_out) else False
            if not (in_i or out_i):
                continue
            direction = "in" if in_i else "out"
            if direction_filter != "both" and direction != direction_filter:
                continue
            any_crossing = True
            det_json["crossing_direction"] = direction
            det_json["line_in_count"] = int(getattr(line_zone, "in_count", 0))
            det_json["line_out_count"] = int(getattr(line_zone, "out_count", 0))
            crossing_events.append(det_json)

        if any_crossing:
            # Ajoute aux events existants pour que les nodes en aval (Save/Notify)
            # déclenchent automatiquement sans avoir besoin d'un Event Trigger.
            context.events = (context.events or []) + crossing_events

        return {}
