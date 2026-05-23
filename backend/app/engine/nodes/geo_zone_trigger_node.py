from __future__ import annotations

from app.engine.base_node import BaseNode
from app.engine.workflow_context import WorkflowContext
from app.services import satellite_service


class GeoZoneTriggerNode(BaseNode):
    type = "geo_zone_trigger"

    async def run(self, context: WorkflowContext, input_data: dict) -> dict:
        config = input_data.get("config", {})
        scene = context.metadata.get("satellite_scene")
        if not isinstance(scene, dict):
            return {}

        scene_bbox = scene.get("bbox")
        if not isinstance(scene_bbox, list) or len(scene_bbox) != 4:
            return {}

        max_cloud = config.get("max_cloud_cover")
        if max_cloud is not None and scene.get("cloud_cover") is not None:
            try:
                if float(scene["cloud_cover"]) > float(max_cloud):
                    return {}
            except (TypeError, ValueError):
                return {}

        areas = config.get("areas") or []
        events: list[dict] = []
        for index, area in enumerate(areas):
            if not isinstance(area, dict):
                continue
            geojson = area.get("geojson")
            if not isinstance(geojson, dict):
                continue
            try:
                area_bbox = satellite_service.bbox_from_geojson(geojson)
            except ValueError:
                continue
            if not satellite_service.bbox_intersects(scene_bbox, area_bbox):
                continue
            name = str(area.get("name") or f"Geo Zone {index + 1}")
            events.append({
                "class_name": str(config.get("event_class_name") or "satellite_scene"),
                "class_id": None,
                "confidence": 1.0,
                "tracker_id": None,
                "zone_name": name,
                "bbox": None,
                "kind": "satellite",
                "scene_id": scene.get("id"),
                "external_id": scene.get("external_id"),
                "area_name": name,
                "mission": scene.get("mission"),
                "provider": scene.get("provider"),
                "cloud_cover": scene.get("cloud_cover"),
                "acquired_at": scene.get("acquired_at"),
                "geo": {
                    "centroid": satellite_service.bbox_centroid(scene_bbox),
                    "bbox": scene_bbox,
                    "footprint": scene.get("footprint"),
                    "area": geojson,
                },
            })

        if events:
            context.events = (context.events or []) + events
        return {}
