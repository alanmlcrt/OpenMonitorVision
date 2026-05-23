from pydantic import BaseModel
from datetime import datetime
from typing import Optional


class DatasetRead(BaseModel):
    id: int
    name: str
    path: str
    yaml_path: str
    classes: list[str] = []
    num_images: int = 0
    num_train: int = 0
    num_val: int = 0
    created_at: datetime

    model_config = {"from_attributes": True}


class DatasetValidation(BaseModel):
    ok: bool
    warnings: list[str] = []
    errors: list[str] = []
    classes: list[str] = []
    num_train: int = 0
    num_val: int = 0


class DatasetFromSource(BaseModel):
    name: str
    source_id: int
    num_frames: int = 20            # how many frames to capture
    interval_seconds: float = 1.0   # seconds between captures (best-effort)
    classes: list[str] = []         # class names to seed classes.txt


# ── Annotation ──────────────────────────────────────────────────────────────

class DatasetImage(BaseModel):
    stem: str          # filename without extension (label-file pairing key)
    filename: str      # filename with extension
    split: str         # "train" or "val"
    width: int
    height: int
    label_count: int   # number of bounding boxes currently in the .txt label
    annotated: bool    # has at least one labelled box


class YoloBox(BaseModel):
    """One YOLO box, **normalized 0-1** (center-x, center-y, width, height)."""
    class_id: int
    x: float           # center x in [0, 1]
    y: float           # center y in [0, 1]
    w: float           # width in [0, 1]
    h: float           # height in [0, 1]


class LabelRead(BaseModel):
    stem: str
    boxes: list[YoloBox] = []


class LabelWrite(BaseModel):
    boxes: list[YoloBox] = []
