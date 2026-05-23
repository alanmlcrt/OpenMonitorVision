from __future__ import annotations

import asyncio
import json
import urllib.request
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Event, SatelliteArea, SatelliteScene
from app.schemas.satellite import (
    SatelliteAreaCreate,
    SatelliteAreaUpdate,
    SatelliteMonitorRequest,
    SatelliteMonitorResult,
    SatelliteSceneCreate,
    SatelliteSceneUpdate,
    SatelliteStats,
    StacSearchAndImportRequest,
)
from app.services.event_service import create_event


# ─── Spatial helpers ──────────────────────────────────────────────────────────

def bbox_from_geojson(geojson: dict[str, Any]) -> list[float]:
    coords: list[tuple[float, float]] = []

    def walk(value: Any) -> None:
        if not isinstance(value, list):
            return
        if len(value) >= 2 and all(isinstance(v, (int, float)) for v in value[:2]):
            lon = float(value[0])
            lat = float(value[1])
            if -180 <= lon <= 180 and -90 <= lat <= 90:
                coords.append((lon, lat))
            return
        for item in value:
            walk(item)

    if geojson.get("type") == "Feature":
        walk((geojson.get("geometry") or {}).get("coordinates"))
    else:
        walk(geojson.get("coordinates"))

    if not coords:
        raise ValueError("GeoJSON has no valid lon/lat coordinates")
    lons = [lon for lon, _ in coords]
    lats = [lat for _, lat in coords]
    return [min(lons), min(lats), max(lons), max(lats)]


def bbox_intersects(a: list[float], b: list[float]) -> bool:
    return not (a[2] < b[0] or b[2] < a[0] or a[3] < b[1] or b[3] < a[1])


def bbox_centroid(bbox: list[float]) -> dict[str, float]:
    return {"lon": (bbox[0] + bbox[2]) / 2.0, "lat": (bbox[1] + bbox[3]) / 2.0}


def polygon_from_bbox(bbox: list[float]) -> dict[str, Any]:
    min_lon, min_lat, max_lon, max_lat = bbox
    return {
        "type": "Polygon",
        "coordinates": [[
            [min_lon, min_lat],
            [max_lon, min_lat],
            [max_lon, max_lat],
            [min_lon, max_lat],
            [min_lon, min_lat],
        ]],
    }


def bbox_area_deg2(bbox: list[float]) -> float:
    """Approximate area in square degrees (for display)."""
    return abs(bbox[2] - bbox[0]) * abs(bbox[3] - bbox[1])


# ─── Area CRUD ────────────────────────────────────────────────────────────────

async def list_areas(db: AsyncSession) -> list[SatelliteArea]:
    result = await db.execute(select(SatelliteArea).order_by(SatelliteArea.created_at.desc()))
    return list(result.scalars().all())


async def get_area(db: AsyncSession, area_id: int) -> SatelliteArea | None:
    return await db.get(SatelliteArea, area_id)


async def create_area(db: AsyncSession, data: SatelliteAreaCreate) -> SatelliteArea:
    bbox = bbox_from_geojson(data.geojson)
    area = SatelliteArea(
        name=data.name,
        description=data.description,
        geojson=data.geojson,
        bbox=bbox,
        enabled=data.enabled,
    )
    db.add(area)
    await db.commit()
    await db.refresh(area)
    return area


async def update_area(db: AsyncSession, area_id: int, data: SatelliteAreaUpdate) -> SatelliteArea | None:
    area = await db.get(SatelliteArea, area_id)
    if not area:
        return None
    payload = data.model_dump(exclude_unset=True)
    if "geojson" in payload and payload["geojson"] is not None:
        area.geojson = payload["geojson"]
        area.bbox = bbox_from_geojson(payload["geojson"])
        payload.pop("geojson")
    for key, value in payload.items():
        setattr(area, key, value)
    await db.commit()
    await db.refresh(area)
    return area


async def delete_area(db: AsyncSession, area_id: int) -> bool:
    area = await db.get(SatelliteArea, area_id)
    if not area:
        return False
    await db.delete(area)
    await db.commit()
    return True


async def get_area_scene_count(db: AsyncSession, area_id: int) -> int:
    result = await db.execute(
        select(func.count(SatelliteScene.id)).where(SatelliteScene.area_id == area_id)
    )
    return result.scalar() or 0


# ─── Scene CRUD ───────────────────────────────────────────────────────────────

async def list_scenes(
    db: AsyncSession,
    *,
    area_id: int | None = None,
    mission: str | None = None,
    max_cloud_cover: float | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    limit: int = 100,
    offset: int = 0,
) -> list[SatelliteScene]:
    q = select(SatelliteScene).order_by(
        SatelliteScene.acquired_at.desc().nullslast(),
        SatelliteScene.created_at.desc(),
    )
    if area_id is not None:
        q = q.where(SatelliteScene.area_id == area_id)
    if mission:
        q = q.where(SatelliteScene.mission == mission)
    if max_cloud_cover is not None:
        q = q.where(
            (SatelliteScene.cloud_cover == None) |  # noqa: E711
            (SatelliteScene.cloud_cover <= max_cloud_cover)
        )
    if date_from is not None:
        q = q.where(SatelliteScene.acquired_at >= date_from)
    if date_to is not None:
        q = q.where(SatelliteScene.acquired_at <= date_to)
    q = q.offset(offset).limit(limit)
    result = await db.execute(q)
    return list(result.scalars().all())


async def get_scene(db: AsyncSession, scene_id: int) -> SatelliteScene | None:
    return await db.get(SatelliteScene, scene_id)


async def scene_exists_by_external_id(db: AsyncSession, external_id: str) -> bool:
    result = await db.execute(
        select(SatelliteScene.id).where(SatelliteScene.external_id == external_id).limit(1)
    )
    return result.scalar() is not None


async def create_scene(db: AsyncSession, data: SatelliteSceneCreate) -> SatelliteScene:
    scene = SatelliteScene(
        external_id=data.external_id,
        provider=data.provider,
        mission=data.mission,
        product_type=data.product_type,
        acquired_at=data.acquired_at,
        cloud_cover=data.cloud_cover,
        bbox=data.bbox,
        footprint=data.footprint,
        assets=data.assets,
        metadata_=data.metadata,
        local_path=data.local_path,
        thumbnail_url=data.thumbnail_url,
        source_url=data.source_url,
        area_id=data.area_id,
        status=data.status,
    )
    db.add(scene)
    await db.commit()
    await db.refresh(scene)
    return scene


async def update_scene(db: AsyncSession, scene_id: int, data: SatelliteSceneUpdate) -> SatelliteScene | None:
    scene = await db.get(SatelliteScene, scene_id)
    if not scene:
        return None
    payload = data.model_dump(exclude_unset=True)
    metadata = payload.pop("metadata", None)
    if metadata is not None:
        scene.metadata_ = metadata
    for key, value in payload.items():
        setattr(scene, key, value)
    await db.commit()
    await db.refresh(scene)
    return scene


async def delete_scene(db: AsyncSession, scene_id: int) -> bool:
    scene = await db.get(SatelliteScene, scene_id)
    if not scene:
        return False
    await db.delete(scene)
    await db.commit()
    return True


# ─── STAC helpers ─────────────────────────────────────────────────────────────

def scene_from_stac_item(item: dict[str, Any], area_id: int | None = None) -> SatelliteSceneCreate:
    props = item.get("properties") or {}
    bbox = item.get("bbox")
    footprint = item.get("geometry")
    if not bbox and footprint:
        bbox = bbox_from_geojson(footprint)
    if not footprint and bbox:
        footprint = polygon_from_bbox([float(v) for v in bbox])
    if not bbox or not footprint:
        raise ValueError("STAC item needs bbox or geometry")

    acquired_raw = (
        props.get("datetime")
        or props.get("start_datetime")
        or props.get("created")
    )
    acquired_at = _parse_datetime(acquired_raw)
    assets = item.get("assets") or {}
    thumbnail_url = _asset_href(assets, ["thumbnail", "preview", "overview", "visual"])

    # Try to find a self/canonical URL from links
    source_url: str | None = None
    for link in (item.get("links") or []):
        if isinstance(link, dict) and link.get("rel") in ("self", "canonical"):
            source_url = str(link.get("href", ""))
            break

    mission = (
        props.get("platform")
        or props.get("constellation")
        or props.get("mission")
        or props.get("satellite")
    )
    product_type = (
        props.get("productType")
        or props.get("processing:level")
        or props.get("s2:product_type")
    )

    return SatelliteSceneCreate(
        external_id=str(item.get("id") or props.get("productIdentifier") or "scene"),
        provider=str(item.get("collection") or item.get("stac_extensions", [""])[0] or "stac"),
        mission=str(mission or "") or None,
        product_type=str(product_type or "") or None,
        acquired_at=acquired_at,
        cloud_cover=_float_or_none(
            props.get("eo:cloud_cover")
            or props.get("cloudCover")
            or props.get("s2:cloud_cover")
        ),
        bbox=[float(v) for v in bbox],
        footprint=footprint,
        assets=assets,
        metadata=props,
        thumbnail_url=thumbnail_url,
        source_url=source_url,
        area_id=area_id,
    )


async def import_stac_items(
    db: AsyncSession,
    items: list[dict[str, Any]],
    area_id: int | None = None,
    skip_existing: bool = True,
) -> list[SatelliteScene]:
    scenes = []
    for item in items:
        try:
            scene_data = scene_from_stac_item(item, area_id=area_id)
        except (ValueError, KeyError):
            continue
        if skip_existing and await scene_exists_by_external_id(db, scene_data.external_id):
            continue
        scenes.append(await create_scene(db, scene_data))
    return scenes


def build_stac_search_payload(
    collections: list[str] | None = None,
    bbox: list[float] | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    max_cloud_cover: float | None = None,
    limit: int = 50,
) -> dict[str, Any]:
    """Build a STAC API /search payload."""
    payload: dict[str, Any] = {"limit": limit}
    if collections:
        payload["collections"] = collections
    if bbox and len(bbox) == 4:
        payload["bbox"] = [round(v, 6) for v in bbox]
    # datetime filter
    if date_from or date_to:
        d_from = date_from or ".."
        d_to = date_to or ".."
        payload["datetime"] = f"{d_from}/{d_to}"
    # cloud cover via query extension
    if max_cloud_cover is not None:
        payload["query"] = {
            "eo:cloud_cover": {"lte": max_cloud_cover},
        }
    return payload


def search_stac_sync(
    url: str,
    payload: dict[str, Any],
    timeout: float = 30.0,
    auth_token: str | None = None,
) -> dict[str, Any]:
    """POST to a STAC search endpoint and return the FeatureCollection."""
    body = json.dumps(payload).encode("utf-8")
    headers: dict[str, str] = {
        "Content-Type": "application/json",
        "Accept": "application/geo+json, application/json",
        "User-Agent": "OpenMonitorVision/1.0",
    }
    if auth_token:
        headers["Authorization"] = f"Bearer {auth_token}"
    req = urllib.request.Request(url, data=body, method="POST", headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


async def search_and_import(
    db: AsyncSession,
    request: StacSearchAndImportRequest,
) -> tuple[list[SatelliteScene], int]:
    """Search a STAC endpoint and import scenes. Returns (new_scenes, skipped_count)."""
    # Resolve bbox: use area bbox if not provided
    bbox = request.bbox
    if bbox is None and request.area_id is not None:
        area = await get_area(db, request.area_id)
        if area:
            bbox = area.bbox

    payload = build_stac_search_payload(
        collections=request.collections or None,
        bbox=bbox,
        date_from=request.date_from,
        date_to=request.date_to,
        max_cloud_cover=request.max_cloud_cover,
        limit=request.limit,
    )

    result = await asyncio.to_thread(
        search_stac_sync,
        request.url,
        payload,
        auth_token=request.auth_token,
    )

    features: list[dict[str, Any]] = result.get("features") or []
    total_found = len(features)
    imported = await import_stac_items(
        db,
        features,
        area_id=request.area_id,
        skip_existing=request.skip_existing,
    )
    skipped = total_found - len(imported)
    return imported, skipped


def fetch_thumbnail_bytes(url: str, timeout: float = 10.0) -> tuple[bytes, str]:
    """Fetch a thumbnail image and return (bytes, content_type)."""
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "OpenMonitorVision/1.0"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as response:
        content_type = response.headers.get("Content-Type", "image/jpeg")
        return response.read(), content_type


# ─── Monitoring ───────────────────────────────────────────────────────────────

async def run_monitoring(db: AsyncSession, request: SatelliteMonitorRequest) -> SatelliteMonitorResult:
    areas = await list_areas(db)
    if request.area_id is not None:
        areas = [area for area in areas if area.id == request.area_id]
    areas = [area for area in areas if area.enabled]

    scenes = await list_scenes(
        db,
        max_cloud_cover=request.max_cloud_cover if request.max_cloud_cover is not None else None,
        limit=500,
    )
    matched = 0
    created = 0
    for scene in scenes:
        for area in areas:
            if not area.bbox or not bbox_intersects(scene.bbox, area.bbox):
                continue
            matched += 1
            if request.create_events and not await _event_exists(db, scene.id, area.id):
                centroid = bbox_centroid(scene.bbox)
                await create_event(
                    db,
                    source_id=None,
                    workflow_id=None,
                    class_name="satellite_scene",
                    class_id=None,
                    confidence=1.0,
                    tracker_id=None,
                    zone_name=area.name,
                    bbox=None,
                    frame_path=scene.local_path,
                    metadata_={
                        "kind": "satellite",
                        "scene_id": scene.id,
                        "external_id": scene.external_id,
                        "area_id": area.id,
                        "area_name": area.name,
                        "mission": scene.mission,
                        "provider": scene.provider,
                        "cloud_cover": scene.cloud_cover,
                        "acquired_at": scene.acquired_at.isoformat() if scene.acquired_at else None,
                        "geo": {
                            "centroid": centroid,
                            "bbox": scene.bbox,
                            "footprint": scene.footprint,
                            "area": area.geojson,
                        },
                    },
                )
                created += 1
    return SatelliteMonitorResult(matched_scenes=matched, created_events=created)


# ─── Events ───────────────────────────────────────────────────────────────────

async def list_geo_events(db: AsyncSession, limit: int = 100) -> list[Event]:
    result = await db.execute(
        select(Event)
        .where(Event.metadata_["kind"].as_string() == "satellite")
        .order_by(Event.timestamp.desc())
        .limit(limit)
    )
    return list(result.scalars().all())


# ─── Stats ────────────────────────────────────────────────────────────────────

async def get_stats(db: AsyncSession) -> SatelliteStats:
    areas = (await db.execute(select(func.count(SatelliteArea.id)))).scalar() or 0
    scenes = (await db.execute(select(func.count(SatelliteScene.id)))).scalar() or 0
    events = (await db.execute(
        select(func.count(Event.id)).where(Event.metadata_["kind"].as_string() == "satellite")
    )).scalar() or 0
    by_mission_rows = await db.execute(
        select(SatelliteScene.mission, func.count(SatelliteScene.id)).group_by(SatelliteScene.mission)
    )
    by_mission = {row[0] or "unknown": row[1] for row in by_mission_rows.all()}
    return SatelliteStats(areas=areas, scenes=scenes, events=events, by_mission=by_mission)


# ─── Internal helpers ─────────────────────────────────────────────────────────

async def _event_exists(db: AsyncSession, scene_id: int, area_id: int) -> bool:
    result = await db.execute(
        select(Event.id)
        .where(Event.metadata_["kind"].as_string() == "satellite")
        .where(Event.metadata_["scene_id"].as_integer() == scene_id)
        .where(Event.metadata_["area_id"].as_integer() == area_id)
        .limit(1)
    )
    return result.scalar() is not None


def _asset_href(assets: dict[str, Any], names: list[str]) -> str | None:
    for name in names:
        asset = assets.get(name)
        if isinstance(asset, dict) and asset.get("href"):
            return str(asset["href"])
    for asset in assets.values():
        if isinstance(asset, dict) and str(asset.get("type", "")).startswith("image/"):
            href = asset.get("href")
            if href:
                return str(href)
    return None


def _parse_datetime(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        text = str(value).replace("Z", "+00:00")
        parsed = datetime.fromisoformat(text)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed
    except ValueError:
        return None


def _float_or_none(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None
