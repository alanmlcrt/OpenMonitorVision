from app.engine.base_node import BaseNode
from app.engine.nodes.source_node import SourceNode
from app.engine.nodes.yolo_detect_node import YoloDetectNode
from app.engine.nodes.tracker_node import TrackerNode
from app.engine.nodes.class_filter_node import ClassFilterNode
from app.engine.nodes.confidence_filter_node import ConfidenceFilterNode
from app.engine.nodes.color_filter_node import ColorFilterNode
from app.engine.nodes.zone_filter_node import ZoneFilterNode
from app.engine.nodes.event_trigger_node import EventTriggerNode
from app.engine.nodes.zone_sequence_trigger_node import ZoneSequenceTriggerNode
from app.engine.nodes.satellite_scene_node import SatelliteSceneNode
from app.engine.nodes.geo_zone_trigger_node import GeoZoneTriggerNode
from app.engine.nodes.save_event_node import SaveEventNode
from app.engine.nodes.overlay_node import OverlayNode
from app.engine.nodes.harvest_node import HarvestNode
from app.engine.nodes.notify_node import NotifyNode
from app.engine.nodes.schedule_trigger_node import ScheduleTriggerNode
from app.engine.nodes.line_crossing_node import LineCrossingNode
from app.engine.nodes.crop_save_node import CropSaveNode

NODE_REGISTRY: dict[str, type[BaseNode]] = {
    "source": SourceNode,
    "yolo_detect": YoloDetectNode,
    "tracker": TrackerNode,
    "class_filter": ClassFilterNode,
    "confidence_filter": ConfidenceFilterNode,
    "color_filter": ColorFilterNode,
    "zone_filter": ZoneFilterNode,
    "event_trigger": EventTriggerNode,
    "zone_sequence_trigger": ZoneSequenceTriggerNode,
    "satellite_scene": SatelliteSceneNode,
    "geo_zone_trigger": GeoZoneTriggerNode,
    "save_event": SaveEventNode,
    "overlay": OverlayNode,
    "harvest": HarvestNode,
    "notify": NotifyNode,
    "schedule_trigger": ScheduleTriggerNode,
    "line_crossing": LineCrossingNode,
    "crop_save": CropSaveNode,
}


def get_node(node_type: str) -> BaseNode | None:
    cls = NODE_REGISTRY.get(node_type)
    return cls() if cls else None
