"""
Unit tests for the workflow engine and individual nodes.

Requires supervision (sv.Detections). If supervision is not installed,
the entire module is skipped gracefully.
"""
import asyncio
import numpy as np
import pytest

sv = pytest.importorskip("supervision")

from app.engine.workflow_engine import _sort_nodes, run_workflow
from app.engine.workflow_context import WorkflowContext
from app.engine.nodes.event_trigger_node import EventTriggerNode, reset_cooldown
from app.engine.nodes.confidence_filter_node import ConfidenceFilterNode
from app.engine.nodes.class_filter_node import ClassFilterNode
from app.engine.nodes.color_filter_node import ColorFilterNode
from app.engine.nodes.zone_filter_node import ZoneFilterNode
from app.engine.nodes.zone_sequence_trigger_node import ZoneSequenceTriggerNode, reset as reset_zone_sequence


# ── helpers ──────────────────────────────────────────────────────────────────

def _dets(n: int = 2) -> sv.Detections:
    """n fake detections; confidences spaced from 0.9 down to 0.3."""
    confs = np.linspace(0.9, 0.3, max(n, 1))[:n].astype(np.float32)
    return sv.Detections(
        xyxy=np.array(
            [[i * 10, i * 10, i * 10 + 5, i * 10 + 5] for i in range(n)],
            dtype=np.float32,
        ),
        confidence=confs,
        class_id=np.array([i % 3 for i in range(n)], dtype=np.int32),
        tracker_id=np.array([i + 1 for i in range(n)], dtype=np.int32),
    )


def _dets_without_tracker(n: int = 2) -> sv.Detections:
    confs = np.linspace(0.9, 0.3, max(n, 1))[:n].astype(np.float32)
    return sv.Detections(
        xyxy=np.array(
            [[i * 10, i * 10, i * 10 + 5, i * 10 + 5] for i in range(n)],
            dtype=np.float32,
        ),
        confidence=confs,
        class_id=np.array([i % 3 for i in range(n)], dtype=np.int32),
    )


def _ctx(workflow_id: int = 1, dets=None, class_names=None) -> WorkflowContext:
    ctx = WorkflowContext(
        workflow_id=workflow_id,
        source_id=1,
        frame=np.zeros((100, 100, 3), dtype=np.uint8),
    )
    ctx.detections = dets
    ctx.class_names = class_names or ["cat", "dog", "bird"]
    return ctx


def run(coro):
    return asyncio.run(coro)


# ── _sort_nodes ───────────────────────────────────────────────────────────────

def test_sort_empty():
    assert _sort_nodes([], []) == []


def test_sort_linear():
    nodes = [{"id": "a"}, {"id": "b"}, {"id": "c"}]
    edges = [{"source": "a", "target": "b"}, {"source": "b", "target": "c"}]
    ids = [n["id"] for n in _sort_nodes(nodes, edges)]
    assert ids.index("a") < ids.index("b") < ids.index("c")


def test_sort_diamond():
    nodes = [{"id": "a"}, {"id": "b"}, {"id": "c"}, {"id": "d"}]
    edges = [
        {"source": "a", "target": "b"},
        {"source": "a", "target": "c"},
        {"source": "b", "target": "d"},
        {"source": "c", "target": "d"},
    ]
    ids = [n["id"] for n in _sort_nodes(nodes, edges)]
    assert ids[0] == "a"
    assert ids[-1] == "d"


def test_sort_isolated_nodes_included():
    result = _sort_nodes([{"id": "a"}, {"id": "b"}], [])
    assert len(result) == 2


def test_sort_unknown_edge_ignored():
    nodes = [{"id": "a"}]
    edges = [{"source": "a", "target": "ghost"}]
    result = _sort_nodes(nodes, edges)
    assert len(result) == 1


# ── ConfidenceFilterNode ──────────────────────────────────────────────────────

def test_confidence_removes_low():
    node = ConfidenceFilterNode()
    # confs: [0.9, 0.6, 0.3] — threshold 0.5 keeps first two
    ctx = _ctx(dets=_dets(3))
    run(node.run(ctx, {"config": {"min_confidence": 0.5}}))
    assert len(ctx.detections) == 2
    assert all(ctx.detections.confidence >= 0.5)


def test_confidence_removes_all():
    node = ConfidenceFilterNode()
    ctx = _ctx(dets=_dets(2))
    run(node.run(ctx, {"config": {"min_confidence": 0.99}}))
    assert len(ctx.detections) == 0


def test_confidence_no_dets_is_noop():
    node = ConfidenceFilterNode()
    ctx = _ctx(dets=None)
    run(node.run(ctx, {"config": {"min_confidence": 0.5}}))
    assert ctx.detections is None


# ── ClassFilterNode ───────────────────────────────────────────────────────────

def test_class_filter_keeps_matching():
    node = ClassFilterNode()
    # 3 dets: class_ids [0=cat, 1=dog, 2=bird]
    ctx = _ctx(dets=_dets(3))
    run(node.run(ctx, {"config": {"classes": ["cat"]}}))
    assert len(ctx.detections) == 1
    assert ctx.detections.class_id[0] == 0


def test_class_filter_multi_class():
    node = ClassFilterNode()
    ctx = _ctx(dets=_dets(3))
    run(node.run(ctx, {"config": {"classes": ["cat", "dog"]}}))
    assert len(ctx.detections) == 2


def test_class_filter_empty_list_passthrough():
    node = ClassFilterNode()
    ctx = _ctx(dets=_dets(3))
    run(node.run(ctx, {"config": {"classes": []}}))
    assert len(ctx.detections) == 3


def test_class_filter_no_dets_is_noop():
    node = ClassFilterNode()
    ctx = _ctx(dets=None)
    run(node.run(ctx, {"config": {"classes": ["cat"]}}))
    assert ctx.detections is None


# ── EventTriggerNode ──────────────────────────────────────────────────────────

def test_event_trigger_fires_first_call():
    reset_cooldown(900)
    ctx = _ctx(workflow_id=900, dets=_dets(2))
    # cooldown=0 → now-last=now > 0, never blocked; global key fires for each detection
    run(EventTriggerNode().run(ctx, {"config": {"cooldown_seconds": 0}}))
    assert len(ctx.events) == 2


def test_event_trigger_global_keeps_full_burst_then_cools_down():
    reset_cooldown(905)
    node = EventTriggerNode()
    ctx1 = _ctx(workflow_id=905, dets=_dets(3))
    ctx2 = _ctx(workflow_id=905, dets=_dets(3))
    run(node.run(ctx1, {"config": {"cooldown_seconds": 60}}))
    run(node.run(ctx2, {"config": {"cooldown_seconds": 60}}))
    assert len(ctx1.events) == 3
    assert len(ctx2.events) == 0


def test_event_trigger_cooldown_blocks_repeat():
    reset_cooldown(901)
    node = EventTriggerNode()
    ctx1 = _ctx(workflow_id=901, dets=_dets(1))
    ctx2 = _ctx(workflow_id=901, dets=_dets(1))
    run(node.run(ctx1, {"config": {"cooldown_seconds": 60}}))
    run(node.run(ctx2, {"config": {"cooldown_seconds": 60}}))
    assert len(ctx1.events) == 1
    assert len(ctx2.events) == 0


def test_event_trigger_reset_clears_cooldown():
    reset_cooldown(904)
    node = EventTriggerNode()
    ctx1 = _ctx(workflow_id=904, dets=_dets(1))
    ctx2 = _ctx(workflow_id=904, dets=_dets(1))
    run(node.run(ctx1, {"config": {"cooldown_seconds": 60}}))
    reset_cooldown(904)
    run(node.run(ctx2, {"config": {"cooldown_seconds": 60}}))
    assert len(ctx1.events) == 1
    assert len(ctx2.events) == 1  # fires again after reset


def test_event_trigger_no_dets():
    reset_cooldown(902)
    ctx = _ctx(workflow_id=902, dets=None)
    run(EventTriggerNode().run(ctx, {"config": {}}))
    assert ctx.events == []


def test_event_trigger_once_per_object():
    reset_cooldown(903)
    node = EventTriggerNode()
    dets = _dets(2)  # tracker_ids: [1, 2]
    ctx1 = _ctx(workflow_id=903, dets=dets)
    ctx2 = _ctx(workflow_id=903, dets=dets)
    run(node.run(ctx1, {"config": {"cooldown_seconds": 0, "trigger_once_per_object": True}}))
    run(node.run(ctx2, {"config": {"cooldown_seconds": 0, "trigger_once_per_object": True}}))
    assert len(ctx1.events) == 2
    assert len(ctx2.events) == 0


# ── ZoneFilterNode ────────────────────────────────────────────────────────────

def test_event_trigger_once_per_object_without_tracker_uses_cooldown_not_forever():
    reset_cooldown(906)
    node = EventTriggerNode()
    ctx1 = _ctx(workflow_id=906, dets=_dets_without_tracker(1))
    ctx2 = _ctx(workflow_id=906, dets=_dets_without_tracker(1))
    run(node.run(ctx1, {"config": {"cooldown_seconds": 0, "trigger_once_per_object": True}}))
    run(node.run(ctx2, {"config": {"cooldown_seconds": 0, "trigger_once_per_object": True}}))
    assert len(ctx1.events) == 1
    assert len(ctx2.events) == 1


_SQUARE_ZONE = [{"points": [[0, 0], [10, 0], [10, 10], [0, 10]]}]


def test_zone_filter_inside():
    node = ZoneFilterNode()
    dets = sv.Detections(
        xyxy=np.array([[1, 1, 4, 4]], dtype=np.float32),
        confidence=np.array([0.9], dtype=np.float32),
        class_id=np.array([0], dtype=np.int32),
    )
    ctx = _ctx(dets=dets)
    run(node.run(ctx, {"config": {"zones": _SQUARE_ZONE}}))
    assert len(ctx.detections) == 1


def test_zone_filter_outside():
    node = ZoneFilterNode()
    dets = sv.Detections(
        xyxy=np.array([[90, 90, 95, 95]], dtype=np.float32),
        confidence=np.array([0.9], dtype=np.float32),
        class_id=np.array([0], dtype=np.int32),
    )
    ctx = _ctx(dets=dets)
    run(node.run(ctx, {"config": {"zones": _SQUARE_ZONE}}))
    assert len(ctx.detections) == 0


def test_zone_filter_no_dets_is_noop():
    node = ZoneFilterNode()
    ctx = _ctx(dets=None)
    run(node.run(ctx, {"config": {"zones": _SQUARE_ZONE}}))
    assert ctx.detections is None


def test_zone_filter_bad_polygon_skipped():
    node = ZoneFilterNode()
    ctx = _ctx(dets=_dets(1))
    run(node.run(ctx, {"config": {"zones": [{"points": [[0, 0], [10, 0]]}]}}))
    assert len(ctx.detections) == 1  # bad polygon skipped, dets unchanged


def test_zone_filter_no_zones_is_noop():
    node = ZoneFilterNode()
    ctx = _ctx(dets=_dets(2))
    run(node.run(ctx, {"config": {"zones": []}}))
    assert len(ctx.detections) == 2


# â”€â”€ ColorFilterNode â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def test_color_filter_keeps_green_detection():
    pytest.importorskip("cv2")
    dets = sv.Detections(
        xyxy=np.array([[10, 10, 40, 40], [60, 10, 90, 40]], dtype=np.float32),
        confidence=np.array([0.9, 0.9], dtype=np.float32),
        class_id=np.array([0, 0], dtype=np.int32),
        tracker_id=np.array([1, 2], dtype=np.int32),
    )
    frame = np.zeros((100, 120, 3), dtype=np.uint8)
    frame[10:40, 10:40] = [0, 255, 0]      # BGR green
    frame[10:40, 60:90] = [0, 0, 255]      # BGR red
    ctx = _ctx(dets=dets, class_names=["car"])
    ctx.frame = frame

    run(ColorFilterNode().run(ctx, {"config": {"target_color": "green", "min_color_ratio": 0.5}}))

    assert len(ctx.detections) == 1
    assert int(ctx.detections.tracker_id[0]) == 1
    assert ctx.detections.data["color_name"][0] == "green"


# â”€â”€ ZoneSequenceTriggerNode â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

_ZONE_SEQUENCE_CONFIG = {
    "zones": [
        {"name": "Zone 1", "points": [[0, 0], [20, 0], [20, 20], [0, 20]]},
        {"name": "Zone 2", "points": [[40, 0], [60, 0], [60, 20], [40, 20]]},
    ],
    "sequence": ["Zone 1", "Zone 2"],
    "max_seconds_between_zones": 30,
    "trigger_once_per_object": True,
    "anchor": "bottom_center",
}


def test_zone_sequence_triggers_after_same_tracker_visits_two_zones():
    reset_zone_sequence(910)
    node = ZoneSequenceTriggerNode()
    ctx1 = _ctx(
        workflow_id=910,
        dets=sv.Detections(
            xyxy=np.array([[4, 4, 10, 10]], dtype=np.float32),
            confidence=np.array([0.9], dtype=np.float32),
            class_id=np.array([0], dtype=np.int32),
            tracker_id=np.array([7], dtype=np.int32),
        ),
        class_names=["car"],
    )
    ctx1.current_node_id = "seq"
    ctx2 = _ctx(
        workflow_id=910,
        dets=sv.Detections(
            xyxy=np.array([[44, 4, 50, 10]], dtype=np.float32),
            confidence=np.array([0.88], dtype=np.float32),
            class_id=np.array([0], dtype=np.int32),
            tracker_id=np.array([7], dtype=np.int32),
        ),
        class_names=["car"],
    )
    ctx2.current_node_id = "seq"

    run(node.run(ctx1, {"config": _ZONE_SEQUENCE_CONFIG}))
    run(node.run(ctx2, {"config": _ZONE_SEQUENCE_CONFIG}))

    assert ctx1.events == []
    assert len(ctx2.events) == 1
    assert ctx2.events[0]["tracker_id"] == 7
    assert ctx2.events[0]["zone_name"] == "Zone 1 -> Zone 2"
    assert ctx2.events[0]["zone_sequence"] == ["Zone 1", "Zone 2"]


def test_zone_sequence_requires_same_tracker():
    reset_zone_sequence(911)
    node = ZoneSequenceTriggerNode()
    ctx1 = _ctx(
        workflow_id=911,
        dets=sv.Detections(
            xyxy=np.array([[4, 4, 10, 10]], dtype=np.float32),
            confidence=np.array([0.9], dtype=np.float32),
            class_id=np.array([0], dtype=np.int32),
            tracker_id=np.array([7], dtype=np.int32),
        ),
        class_names=["car"],
    )
    ctx1.current_node_id = "seq"
    ctx2 = _ctx(
        workflow_id=911,
        dets=sv.Detections(
            xyxy=np.array([[44, 4, 50, 10]], dtype=np.float32),
            confidence=np.array([0.88], dtype=np.float32),
            class_id=np.array([0], dtype=np.int32),
            tracker_id=np.array([8], dtype=np.int32),
        ),
        class_names=["car"],
    )
    ctx2.current_node_id = "seq"

    run(node.run(ctx1, {"config": _ZONE_SEQUENCE_CONFIG}))
    run(node.run(ctx2, {"config": _ZONE_SEQUENCE_CONFIG}))

    assert ctx2.events == []


# ── run_workflow integration ──────────────────────────────────────────────────

def test_run_workflow_unknown_node_skipped():
    nodes = [{"id": "x", "data": {"type": "nonexistent", "config": {}}}]
    ctx = asyncio.run(
        run_workflow(1, nodes, [], np.zeros((10, 10, 3), dtype=np.uint8), 1)
    )
    assert ctx.workflow_id == 1
    assert ctx.detections is None


def test_run_workflow_confidence_filter_noop_without_dets():
    nodes = [
        {"id": "1", "data": {"type": "confidence_filter", "config": {"min_confidence": 0.8}}}
    ]
    ctx = asyncio.run(
        run_workflow(2, nodes, [], np.zeros((10, 10, 3), dtype=np.uint8), 1)
    )
    assert ctx.detections is None


def test_run_workflow_linear_chain():
    """confidence_filter → class_filter in order; no detections so both are noops."""
    nodes = [
        {"id": "1", "data": {"type": "confidence_filter", "config": {"min_confidence": 0.5}}},
        {"id": "2", "data": {"type": "class_filter", "config": {"classes": ["cat"]}}},
    ]
    edges = [{"source": "1", "target": "2"}]
    ctx = asyncio.run(
        run_workflow(3, nodes, edges, np.zeros((10, 10, 3), dtype=np.uint8), 1)
    )
    assert ctx.workflow_id == 3
