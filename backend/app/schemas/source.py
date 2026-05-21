from pydantic import BaseModel
from datetime import datetime
from typing import Optional
from enum import Enum


class SourceType(str, Enum):
    webcam = "webcam"
    video = "video"
    rtsp = "rtsp"
    image = "image"


class SourceCreate(BaseModel):
    name: str
    type: SourceType
    uri: str
    enabled: bool = True


class SourceUpdate(BaseModel):
    name: Optional[str] = None
    type: Optional[SourceType] = None
    uri: Optional[str] = None
    enabled: Optional[bool] = None


class SourceRead(BaseModel):
    id: int
    name: str
    type: str
    uri: str
    enabled: bool
    created_at: datetime

    model_config = {"from_attributes": True}
