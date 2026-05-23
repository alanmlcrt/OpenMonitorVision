from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional, Any


class BBox(BaseModel):
    x1: float
    y1: float
    x2: float
    y2: float


class EventRead(BaseModel):
    id: int
    timestamp: datetime
    source_id: Optional[int] = None
    workflow_id: Optional[int] = None
    class_name: str
    class_id: Optional[int] = None
    confidence: Optional[float] = None
    tracker_id: Optional[int] = None
    zone_name: Optional[str] = None
    bbox: Optional[dict[str, Any]] = None
    frame_path: Optional[str] = None
    metadata: Optional[dict[str, Any]] = Field(default=None, validation_alias="metadata_")

    model_config = {"from_attributes": True, "populate_by_name": True}


class EventStats(BaseModel):
    total: int
    by_class: dict[str, int]
    by_source: dict[str, int]
    by_hour: dict[str, int]
