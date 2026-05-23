from __future__ import annotations

import asyncio
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.schemas.event import EventRead
from app.schemas.satellite import (
    SatelliteAreaCreate,
    SatelliteAreaRead,
    SatelliteAreaUpdate,
    SatelliteMonitorRequest,
    SatelliteMonitorResult,
    SatelliteSceneCreate,
    SatelliteSceneRead,
    SatelliteSceneUpdate,
    SatelliteStacImportRequest,
    SatelliteStats,
    StacSearchAndImportRequest,
)
from app.services import satellite_service

router = APIRouter(prefix="/satellite", tags=["satellite"])


# ─── Areas ────────────────────────────────────────────────────────────────────

@router.get("/areas", response_model=list[SatelliteAreaRead])
async def list_areas(db: AsyncSession = Depends(get_db)):
    areas = await satellite_service.list_areas(db)
    result = []
    for area in areas:
        count = await satellite_service.get_area_scene_count(db, area.id)
        read = SatelliteAreaRead.model_validate(area)
        read.scene_count = count
        result.append(read)
    return result


@router.post("/areas", response_model=SatelliteAreaRead, status_code=201)
async def create_area(data: SatelliteAreaCreate, db: AsyncSession = Depends(get_db)):
    try:
        area = await satellite_service.create_area(db, data)
        read = SatelliteAreaRead.model_validate(area)
        read.scene_count = 0
        return read
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.get("/areas/{area_id}", response_model=SatelliteAreaRead)
async def get_area(area_id: int, db: AsyncSession = Depends(get_db)):
    area = await satellite_service.get_area(db, area_id)
    if not area:
        raise HTTPException(404, "Satellite area not found")
    count = await satellite_service.get_area_scene_count(db, area_id)
    read = SatelliteAreaRead.model_validate(area)
    read.scene_count = count
    return read


@router.patch("/areas/{area_id}", response_model=SatelliteAreaRead)
async def update_area(area_id: int, data: SatelliteAreaUpdate, db: AsyncSession = Depends(get_db)):
    try:
        area = await satellite_service.update_area(db, area_id, data)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    if not area:
        raise HTTPException(404, "Satellite area not found")
    count = await satellite_service.get_area_scene_count(db, area_id)
    read = SatelliteAreaRead.model_validate(area)
    read.scene_count = count
    return read


@router.delete("/areas/{area_id}", status_code=204)
async def delete_area(area_id: int, db: AsyncSession = Depends(get_db)):
    ok = await satellite_service.delete_area(db, area_id)
    if not ok:
        raise HTTPException(404, "Satellite area not found")


# ─── Scenes ───────────────────────────────────────────────────────────────────

@router.get("/scenes", response_model=list[SatelliteSceneRead])
async def list_scenes(
    area_id: int | None = None,
    mission: str | None = None,
    max_cloud_cover: float | None = Query(default=None, ge=0, le=100),
    date_from: str | None = None,
    date_to: str | None = None,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    def _parse_dt(s: str | None) -> datetime | None:
        if not s:
            return None
        try:
            return datetime.fromisoformat(s.replace("Z", "+00:00"))
        except ValueError:
            return None

    return await satellite_service.list_scenes(
        db,
        area_id=area_id,
        mission=mission,
        max_cloud_cover=max_cloud_cover,
        date_from=_parse_dt(date_from),
        date_to=_parse_dt(date_to),
        limit=limit,
        offset=offset,
    )


@router.post("/scenes", response_model=SatelliteSceneRead, status_code=201)
async def create_scene(data: SatelliteSceneCreate, db: AsyncSession = Depends(get_db)):
    return await satellite_service.create_scene(db, data)


@router.get("/scenes/{scene_id}", response_model=SatelliteSceneRead)
async def get_scene(scene_id: int, db: AsyncSession = Depends(get_db)):
    scene = await satellite_service.get_scene(db, scene_id)
    if not scene:
        raise HTTPException(404, "Satellite scene not found")
    return scene


@router.patch("/scenes/{scene_id}", response_model=SatelliteSceneRead)
async def update_scene(scene_id: int, data: SatelliteSceneUpdate, db: AsyncSession = Depends(get_db)):
    scene = await satellite_service.update_scene(db, scene_id, data)
    if not scene:
        raise HTTPException(404, "Satellite scene not found")
    return scene


@router.delete("/scenes/{scene_id}", status_code=204)
async def delete_scene(scene_id: int, db: AsyncSession = Depends(get_db)):
    ok = await satellite_service.delete_scene(db, scene_id)
    if not ok:
        raise HTTPException(404, "Satellite scene not found")


@router.get("/scenes/{scene_id}/thumbnail")
async def get_scene_thumbnail(scene_id: int, db: AsyncSession = Depends(get_db)):
    """Proxy the thumbnail image so the browser doesn't need CORS access to external URLs."""
    scene = await satellite_service.get_scene(db, scene_id)
    if not scene:
        raise HTTPException(404, "Scene not found")
    if not scene.thumbnail_url:
        raise HTTPException(404, "No thumbnail available for this scene")
    try:
        data, content_type = await asyncio.to_thread(
            satellite_service.fetch_thumbnail_bytes, scene.thumbnail_url
        )
        return Response(content=data, media_type=content_type)
    except Exception as exc:
        raise HTTPException(502, f"Could not fetch thumbnail: {exc}") from exc


# ─── STAC import & search ─────────────────────────────────────────────────────

@router.post("/scenes/import-stac", response_model=list[SatelliteSceneRead], status_code=201)
async def import_stac(data: SatelliteStacImportRequest, db: AsyncSession = Depends(get_db)):
    items: list[dict] = []
    if data.item:
        items.append(data.item)
    if data.items:
        items.extend(data.items)
    if data.feature_collection:
        features = data.feature_collection.get("features")
        if isinstance(features, list):
            items.extend(features)
    if not items:
        raise HTTPException(400, "No STAC items provided")
    try:
        return await satellite_service.import_stac_items(
            db, items, area_id=data.area_id, skip_existing=data.skip_existing
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/search-stac")
async def search_stac(payload: dict):
    """Raw STAC search passthrough (returns the provider's response)."""
    url = str(payload.pop("url", "")).strip()
    auth_token = payload.pop("auth_token", None)
    if not url:
        raise HTTPException(400, "Missing STAC search url")
    try:
        return await asyncio.to_thread(
            satellite_service.search_stac_sync, url, payload, auth_token=auth_token
        )
    except Exception as exc:
        raise HTTPException(502, f"STAC search failed: {exc}") from exc


@router.post("/search-and-import", response_model=list[SatelliteSceneRead], status_code=201)
async def search_and_import(data: StacSearchAndImportRequest, db: AsyncSession = Depends(get_db)):
    """Search a STAC catalog and import matching scenes, skipping duplicates."""
    try:
        imported, skipped = await satellite_service.search_and_import(db, data)
        # Embed skipped count in a custom header so the caller can read it
        response_headers = {"X-Skipped-Count": str(skipped)}
        return Response(
            content=_scenes_to_json(imported),
            status_code=201,
            media_type="application/json",
            headers=response_headers,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(502, f"STAC search/import failed: {exc}") from exc


def _scenes_to_json(scenes: list) -> bytes:
    import json as _json
    return _json.dumps([
        SatelliteSceneRead.model_validate(s).model_dump(mode="json")
        for s in scenes
    ]).encode()


# ─── Monitoring ───────────────────────────────────────────────────────────────

@router.post("/monitor/run", response_model=SatelliteMonitorResult)
async def run_monitoring(data: SatelliteMonitorRequest, db: AsyncSession = Depends(get_db)):
    return await satellite_service.run_monitoring(db, data)


# ─── Events & stats ───────────────────────────────────────────────────────────

@router.get("/events", response_model=list[EventRead])
async def list_satellite_events(
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    return await satellite_service.list_geo_events(db, limit=limit)


@router.get("/stats", response_model=SatelliteStats)
async def get_stats(db: AsyncSession = Depends(get_db)):
    return await satellite_service.get_stats(db)
