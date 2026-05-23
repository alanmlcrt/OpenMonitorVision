"""
HarvestNode — collect frames from a running workflow into a dataset.

Useful as a "data-gathering" pass: hook a generic YOLO detect upstream, then
have this node persist frames where the detection landed (or just every N
frames) into an annotation-ready dataset. The user annotates afterwards in
the Training tab.

Config:
    dataset_id           int   target dataset (must exist)
    mode                 str   'every_n' | 'on_detection' | 'every_seconds'
    n                    int   frame interval for 'every_n'
    interval_seconds     float interval for 'every_seconds'
    max_frames           int   stop saving after this many (0 = unlimited)
    save_annotated       bool  if true, save the overlay-annotated frame instead

State is held module-level keyed by (workflow_id, node_id). Counters are
reset when the workflow stops, but we also expose a reset helper.
"""
from __future__ import annotations

import asyncio
import os
import time
from datetime import datetime, timezone
from pathlib import Path

from app.engine.base_node import BaseNode
from app.engine.workflow_context import WorkflowContext
from app.core.config import settings
from app.core.logging import get_logger
from app.db.database import AsyncSessionLocal
from app.db.models import Dataset

logger = get_logger(__name__)


# (workflow_id, node_id) → state
_state: dict[tuple[int, str], dict] = {}


def reset(workflow_id: int) -> None:
    """Clear all harvest counters for a workflow (called when stopping it)."""
    for k in [k for k in _state if k[0] == workflow_id]:
        del _state[k]


def _cv2():
    try:
        import cv2
    except ImportError as exc:
        raise RuntimeError("OpenCV is required for the Harvest node") from exc
    return cv2


def _write_frame(path: str, frame) -> bool:
    try:
        return bool(_cv2().imwrite(path, frame))
    except Exception as exc:
        logger.warning("harvest_node: imwrite failed: %s", exc)
        return False


class HarvestNode(BaseNode):
    type = "harvest"

    async def run(self, context: WorkflowContext, input_data: dict) -> dict:
        config = input_data.get("config") or {}
        try:
            dataset_id = int(config.get("dataset_id") or 0)
        except (TypeError, ValueError):
            return {}
        if dataset_id <= 0:
            return {}

        mode = str(config.get("mode") or "every_n")
        n = max(1, int(config.get("n") or 30))
        interval = float(config.get("interval_seconds") or 5.0)
        max_frames = int(config.get("max_frames") or 0)
        save_annotated = bool(config.get("save_annotated") or False)

        # Pick the frame to save
        frame = context.annotated_frame if (save_annotated and context.annotated_frame is not None) else context.frame
        if frame is None:
            return {}

        # 'on_detection' requires actual detections
        has_detections = context.detections is not None and len(context.detections) > 0
        if mode == "on_detection" and not has_detections:
            return {}

        # Get/initialise per-node state
        node_id = context.current_node_id if hasattr(context, "current_node_id") else None
        # Workflow engine doesn't currently pass node_id — fall back to (workflow_id, dataset_id)
        state_key = (context.workflow_id, str(node_id) if node_id else f"ds_{dataset_id}")
        state = _state.setdefault(state_key, {
            "frame_counter": 0,
            "saved": 0,
            "last_save_ts": 0.0,
        })

        state["frame_counter"] += 1

        if max_frames > 0 and state["saved"] >= max_frames:
            return {}

        # Decide whether to actually save this tick
        should_save = False
        now = time.monotonic()
        if mode == "every_n":
            if state["frame_counter"] % n == 0:
                should_save = True
        elif mode == "every_seconds":
            if state["last_save_ts"] == 0 or (now - state["last_save_ts"]) >= interval:
                should_save = True
        elif mode == "on_detection":
            should_save = True
        else:
            return {}

        if not should_save:
            return {}

        # Resolve dataset target directory (load once, but tolerate dataset deletion)
        async with AsyncSessionLocal() as db:
            ds = await db.get(Dataset, dataset_id)
            if ds is None or not ds.path:
                return {}
            images_dir = Path(ds.path) / "images" / "train"
            labels_dir = Path(ds.path) / "labels" / "train"

        try:
            images_dir.mkdir(parents=True, exist_ok=True)
            labels_dir.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            logger.warning("harvest_node: mkdir failed: %s", exc)
            return {}

        stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S_%f")
        stem = f"harvest_wf{context.workflow_id}_{stamp}"
        img_path = str(images_dir / f"{stem}.jpg")
        lbl_path = str(labels_dir / f"{stem}.txt")

        ok = await asyncio.to_thread(_write_frame, img_path, frame)
        if not ok:
            return {}

        # If we have detections in normalized YOLO form already, optionally
        # seed the label file so the user only has to refine; otherwise empty.
        seed_lines: list[str] = []
        if has_detections and not save_annotated:
            try:
                h, w = frame.shape[:2]
                # context.detections is a sv.Detections (or numpy-like xyxy + class_id)
                xyxy = getattr(context.detections, "xyxy", None)
                class_ids = getattr(context.detections, "class_id", None)
                if xyxy is not None and class_ids is not None:
                    for (x1, y1, x2, y2), cid in zip(xyxy, class_ids):
                        cx = ((x1 + x2) / 2.0) / w
                        cy = ((y1 + y2) / 2.0) / h
                        bw = abs(x2 - x1) / w
                        bh = abs(y2 - y1) / h
                        if bw <= 0 or bh <= 0:
                            continue
                        seed_lines.append(f"{int(cid)} {cx:.6f} {cy:.6f} {bw:.6f} {bh:.6f}")
            except Exception as exc:
                logger.debug("harvest_node: seed-labels failed: %s", exc)

        try:
            with open(lbl_path, "w", encoding="utf-8") as f:
                if seed_lines:
                    f.write("\n".join(seed_lines) + "\n")
                # else: empty file (valid YOLO label for "no objects")
        except OSError as exc:
            logger.warning("harvest_node: label write failed: %s", exc)

        state["saved"] += 1
        state["last_save_ts"] = now

        # Update dataset row counters periodically (every 10 saves) to keep the UI fresh
        if state["saved"] % 10 == 0 or state["saved"] == 1:
            async with AsyncSessionLocal() as db:
                ds = await db.get(Dataset, dataset_id)
                if ds is not None:
                    ds.num_train = (ds.num_train or 0) + (1 if state["saved"] == 1 else 10)
                    ds.num_images = (ds.num_images or 0) + (1 if state["saved"] == 1 else 10)
                    await db.commit()

        return {}
