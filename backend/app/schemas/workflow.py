from pydantic import BaseModel
from datetime import datetime
from typing import Optional, Any


class WorkflowCreate(BaseModel):
    name: str
    nodes: list[dict[str, Any]] = []
    edges: list[dict[str, Any]] = []


class WorkflowUpdate(BaseModel):
    name: Optional[str] = None
    nodes: Optional[list[dict[str, Any]]] = None
    edges: Optional[list[dict[str, Any]]] = None
    enabled: Optional[bool] = None


class WorkflowRead(BaseModel):
    id: int
    name: str
    nodes: list[dict[str, Any]]
    edges: list[dict[str, Any]]
    enabled: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
