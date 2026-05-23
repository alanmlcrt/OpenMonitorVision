"""
CropSaveNode — sauvegarde les crops d'images de chaque détection sur disque.

Utile pour :
- captures de plaques d'immatriculation, visages
- constitution d'un dataset ciblé sur certaines classes
- déploiements "privacy-friendly" (on garde uniquement les crops, pas les frames)

Config:
    output_subdir       str   sous-dossier sous exports_dir (ex: "plates")
    filter_classes      list  si non vide, on ne sauvegarde que ces classes
    min_confidence      float seuil de confiance optionnel
    padding_px          int   pixels de marge autour de la bbox (élargit le crop)
    max_per_frame       int   limite par frame (0 = illimité)
    only_with_event     bool  si True, sauvegarde uniquement quand context.events est non vide
"""
from __future__ import annotations

import asyncio
import os
from datetime import datetime, timezone
from pathlib import Path

from app.core.config import settings
from app.core.logging import get_logger
from app.engine.base_node import BaseNode
from app.engine.workflow_context import WorkflowContext

logger = get_logger(__name__)


def _cv2():
    import cv2
    return cv2


def _write_crop(path: str, crop) -> bool:
    try:
        return bool(_cv2().imwrite(path, crop))
    except Exception as exc:
        logger.warning("crop_save: imwrite failed: %s", exc)
        return False


class CropSaveNode(BaseNode):
    type = "crop_save"

    async def run(self, context: WorkflowContext, input_data: dict) -> dict:
        config = input_data.get("config") or {}

        if context.frame is None or context.detections is None or len(context.detections) == 0:
            return {}

        only_with_event = bool(config.get("only_with_event") or False)
        if only_with_event and not context.events:
            return {}

        subdir = str(config.get("output_subdir") or "crops").strip().strip("/\\") or "crops"
        out_dir = Path(settings.exports_dir) / subdir
        try:
            out_dir.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            logger.warning("crop_save: mkdir failed: %s", exc)
            return {}

        filter_classes = config.get("filter_classes") or []
        if isinstance(filter_classes, str):
            filter_classes = [c.strip() for c in filter_classes.split(",") if c.strip()]
        filter_set = {str(c).lower() for c in filter_classes} if filter_classes else None

        try:
            min_conf = float(config.get("min_confidence") or 0)
        except (TypeError, ValueError):
            min_conf = 0.0

        try:
            padding = max(0, int(config.get("padding_px") or 0))
        except (TypeError, ValueError):
            padding = 0

        try:
            max_per_frame = int(config.get("max_per_frame") or 0)
        except (TypeError, ValueError):
            max_per_frame = 0

        frame = context.frame
        h, w = frame.shape[:2]

        xyxy = getattr(context.detections, "xyxy", None)
        class_ids = getattr(context.detections, "class_id", None)
        confidences = getattr(context.detections, "confidence", None)
        tracker_ids = getattr(context.detections, "tracker_id", None)
        if xyxy is None or class_ids is None:
            return {}

        saved = 0
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S_%f")

        for i in range(len(xyxy)):
            if max_per_frame and saved >= max_per_frame:
                break

            class_id = int(class_ids[i]) if class_ids[i] is not None else -1
            class_name = (
                context.class_names[class_id]
                if 0 <= class_id < len(context.class_names)
                else "unknown"
            )

            if filter_set and class_name.lower() not in filter_set:
                continue

            conf = float(confidences[i]) if confidences is not None else 1.0
            if conf < min_conf:
                continue

            x1, y1, x2, y2 = xyxy[i]
            x1 = max(0, int(x1) - padding)
            y1 = max(0, int(y1) - padding)
            x2 = min(w, int(x2) + padding)
            y2 = min(h, int(y2) + padding)
            if x2 <= x1 or y2 <= y1:
                continue

            crop = frame[y1:y2, x1:x2]
            if crop.size == 0:
                continue

            tid = int(tracker_ids[i]) if tracker_ids is not None and tracker_ids[i] is not None else None
            tid_part = f"_t{tid}" if tid is not None else ""
            safe_class = "".join(ch if ch.isalnum() else "_" for ch in class_name).strip("_") or "unknown"
            fname = f"{stamp}_{safe_class}{tid_part}_{i}.jpg"
            path = str(out_dir / fname)

            ok = await asyncio.to_thread(_write_crop, path, crop)
            if ok:
                saved += 1

        return {}
