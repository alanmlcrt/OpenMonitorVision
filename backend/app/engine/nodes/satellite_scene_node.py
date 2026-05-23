from __future__ import annotations

from app.db.database import AsyncSessionLocal
from app.engine.base_node import BaseNode
from app.engine.workflow_context import WorkflowContext
from app.services import satellite_service


class SatelliteSceneNode(BaseNode):
    type = "satellite_scene"

    async def run(self, context: WorkflowContext, input_data: dict) -> dict:
        config = input_data.get("config", {})
        scene_id = config.get("scene_id")
        if not scene_id:
            return {}
        try:
            scene_id = int(scene_id)
        except (TypeError, ValueError):
            return {}

        async with AsyncSessionLocal() as db:
            scene = await satellite_service.get_scene(db, scene_id)
        if scene is None:
            return {}

        context.metadata["satellite_scene"] = {
            "id": scene.id,
            "external_id": scene.external_id,
            "provider": scene.provider,
            "mission": scene.mission,
            "product_type": scene.product_type,
            "acquired_at": scene.acquired_at.isoformat() if scene.acquired_at else None,
            "cloud_cover": scene.cloud_cover,
            "bbox": scene.bbox,
            "footprint": scene.footprint,
            "assets": scene.assets,
            "metadata": scene.metadata_,
            "local_path": scene.local_path,
            "thumbnail_url": scene.thumbnail_url,
            "source_url": scene.source_url,
            "area_id": scene.area_id,
            "status": scene.status,
        }
        return {}
