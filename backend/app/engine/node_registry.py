from app.engine.base_node import BaseNode
from app.engine.nodes.source_node import SourceNode
from app.engine.nodes.yolo_detect_node import YoloDetectNode
from app.engine.nodes.tracker_node import TrackerNode
from app.engine.nodes.class_filter_node import ClassFilterNode
from app.engine.nodes.confidence_filter_node import ConfidenceFilterNode
from app.engine.nodes.zone_filter_node import ZoneFilterNode
from app.engine.nodes.event_trigger_node import EventTriggerNode
from app.engine.nodes.save_event_node import SaveEventNode
from app.engine.nodes.overlay_node import OverlayNode

NODE_REGISTRY: dict[str, type[BaseNode]] = {
    "source": SourceNode,
    "yolo_detect": YoloDetectNode,
    "tracker": TrackerNode,
    "class_filter": ClassFilterNode,
    "confidence_filter": ConfidenceFilterNode,
    "zone_filter": ZoneFilterNode,
    "event_trigger": EventTriggerNode,
    "save_event": SaveEventNode,
    "overlay": OverlayNode,
}


def get_node(node_type: str) -> BaseNode | None:
    cls = NODE_REGISTRY.get(node_type)
    return cls() if cls else None
