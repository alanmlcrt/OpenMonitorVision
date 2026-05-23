from pydantic import BaseModel, Field
from datetime import datetime
from typing import Any, Optional


class TrainingConfig(BaseModel):
    epochs: int = Field(default=50, ge=1, le=2000)
    imgsz: int = Field(default=640, ge=64, le=2048)
    batch: int = Field(default=-1)        # -1 = auto
    lr0: float = Field(default=0.01, gt=0)
    device: Optional[str] = None           # "auto" | "cuda" | "cuda:0" | "cpu"


class TrainingJobCreate(BaseModel):
    name: str
    dataset_id: int
    base_model: str = "yolov8n.pt"
    config: TrainingConfig = TrainingConfig()


class TrainingJobRead(BaseModel):
    id: int
    name: str
    dataset_id: Optional[int]
    base_model: str
    config: dict[str, Any] = {}
    status: str
    progress: dict[str, Any] = {}
    metrics: list[dict[str, Any]] = []
    output_path: Optional[str]
    weights_path: Optional[str]
    model_id: Optional[int]
    error: Optional[str]
    started_at: Optional[datetime]
    finished_at: Optional[datetime]
    created_at: datetime

    model_config = {"from_attributes": True, "protected_namespaces": ()}


class BaseModelOption(BaseModel):
    value: str   # "yolov8n.pt"
    label: str   # "YOLOv8 Nano (3.2M params)"


class DeviceInfo(BaseModel):
    cuda_available: bool
    devices: list[dict[str, Any]] = []
    recommended: str = "cpu"
