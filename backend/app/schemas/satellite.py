from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class SatelliteAreaCreate(BaseModel):
    name: str
    description: str | None = None
    geojson: dict[str, Any]
    enabled: bool = True


class SatelliteAreaUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    geojson: dict[str, Any] | None = None
    enabled: bool | None = None


class SatelliteAreaRead(BaseModel):
    id: int
    name: str
    description: str | None = None
    geojson: dict[str, Any]
    bbox: list[float]
    enabled: bool
    created_at: datetime
    scene_count: int = 0

    model_config = {"from_attributes": True}


class SatelliteSceneCreate(BaseModel):
    external_id: str
    provider: str = "manual"
    mission: str | None = None
    product_type: str | None = None
    acquired_at: datetime | None = None
    cloud_cover: float | None = Field(default=None, ge=0, le=100)
    bbox: list[float]
    footprint: dict[str, Any]
    assets: dict[str, Any] = Field(default_factory=dict)
    metadata: dict[str, Any] | None = None
    local_path: str | None = None
    thumbnail_url: str | None = None
    source_url: str | None = None
    area_id: int | None = None
    status: str = "available"


class SatelliteSceneUpdate(BaseModel):
    external_id: str | None = None
    provider: str | None = None
    mission: str | None = None
    product_type: str | None = None
    acquired_at: datetime | None = None
    cloud_cover: float | None = Field(default=None, ge=0, le=100)
    bbox: list[float] | None = None
    footprint: dict[str, Any] | None = None
    assets: dict[str, Any] | None = None
    metadata: dict[str, Any] | None = None
    local_path: str | None = None
    thumbnail_url: str | None = None
    source_url: str | None = None
    area_id: int | None = None
    status: str | None = None


class SatelliteSceneRead(BaseModel):
    id: int
    external_id: str
    provider: str
    mission: str | None = None
    product_type: str | None = None
    acquired_at: datetime | None = None
    cloud_cover: float | None = None
    bbox: list[float]
    footprint: dict[str, Any]
    assets: dict[str, Any]
    metadata: dict[str, Any] | None = Field(default=None, validation_alias="metadata_")
    local_path: str | None = None
    thumbnail_url: str | None = None
    source_url: str | None = None
    area_id: int | None = None
    status: str
    created_at: datetime

    model_config = {"from_attributes": True, "populate_by_name": True}


class SatelliteStacImportRequest(BaseModel):
    item: dict[str, Any] | None = None
    items: list[dict[str, Any]] | None = None
    feature_collection: dict[str, Any] | None = None
    area_id: int | None = None
    skip_existing: bool = True


class StacSearchAndImportRequest(BaseModel):
    """Search a STAC endpoint and import matching scenes directly."""
    url: str
    collections: list[str] = Field(default_factory=list)
    bbox: list[float] | None = None
    date_from: str | None = None
    date_to: str | None = None
    max_cloud_cover: float | None = Field(default=None, ge=0, le=100)
    limit: int = Field(default=50, ge=1, le=200)
    area_id: int | None = None
    auth_token: str | None = None
    skip_existing: bool = True


class SatelliteMonitorRequest(BaseModel):
    area_id: int | None = None
    max_cloud_cover: float | None = Field(default=30, ge=0, le=100)
    create_events: bool = True


class SatelliteMonitorResult(BaseModel):
    matched_scenes: int
    created_events: int


class SatelliteStats(BaseModel):
    areas: int
    scenes: int
    events: int
    by_mission: dict[str, int]
