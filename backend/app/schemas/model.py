from pydantic import BaseModel
from datetime import datetime
from typing import Optional


class ModelCreate(BaseModel):
    name: str
    is_default: bool = False


class ModelRead(BaseModel):
    id: int
    name: str
    filename: str
    path: str
    is_default: bool
    created_at: datetime

    model_config = {"from_attributes": True}
