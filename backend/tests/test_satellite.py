"""Tests for satellite metadata monitoring routes."""


def _area_payload():
    return {
        "name": "Test AOI",
        "description": "small monitoring area",
        "geojson": {
            "type": "Polygon",
            "coordinates": [[
                [2.0, 48.0],
                [3.0, 48.0],
                [3.0, 49.0],
                [2.0, 49.0],
                [2.0, 48.0],
            ]],
        },
        "enabled": True,
    }


def _stac_item():
    return {
        "type": "Feature",
        "id": "S2_TEST_SCENE",
        "collection": "sentinel-2-l2a",
        "bbox": [2.2, 48.2, 2.8, 48.8],
        "geometry": {
            "type": "Polygon",
            "coordinates": [[
                [2.2, 48.2],
                [2.8, 48.2],
                [2.8, 48.8],
                [2.2, 48.8],
                [2.2, 48.2],
            ]],
        },
        "properties": {
            "datetime": "2026-05-23T10:00:00Z",
            "platform": "sentinel-2a",
            "eo:cloud_cover": 8.5,
            "processing:level": "L2A",
        },
        "assets": {
            "thumbnail": {
                "href": "https://example.invalid/thumb.jpg",
                "type": "image/jpeg",
            }
        },
    }


def test_satellite_area_scene_monitoring_flow(client):
    area_resp = client.post("/api/satellite/areas", json=_area_payload())
    assert area_resp.status_code == 201
    area = area_resp.json()
    assert area["bbox"] == [2.0, 48.0, 3.0, 49.0]

    import_resp = client.post(
        "/api/satellite/scenes/import-stac",
        json={"item": _stac_item(), "area_id": area["id"]},
    )
    assert import_resp.status_code == 201
    scenes = import_resp.json()
    assert len(scenes) == 1
    assert scenes[0]["external_id"] == "S2_TEST_SCENE"
    assert scenes[0]["mission"] == "sentinel-2a"

    monitor_resp = client.post(
        "/api/satellite/monitor/run",
        json={"area_id": area["id"], "max_cloud_cover": 20, "create_events": True},
    )
    assert monitor_resp.status_code == 200
    result = monitor_resp.json()
    assert result["matched_scenes"] >= 1
    assert result["created_events"] >= 1

    events_resp = client.get("/api/satellite/events")
    assert events_resp.status_code == 200
    events = events_resp.json()
    assert any(e["metadata"]["external_id"] == "S2_TEST_SCENE" for e in events)


def test_satellite_stats_shape(client):
    resp = client.get("/api/satellite/stats")
    assert resp.status_code == 200
    data = resp.json()
    assert "areas" in data
    assert "scenes" in data
    assert "events" in data
    assert "by_mission" in data


def test_geo_zone_trigger_node_creates_event_from_scene_metadata():
    import asyncio

    from app.engine.nodes.geo_zone_trigger_node import GeoZoneTriggerNode
    from app.engine.workflow_context import WorkflowContext

    ctx = WorkflowContext(workflow_id=700)
    ctx.metadata["satellite_scene"] = {
        "id": 42,
        "external_id": "S2_NODE_SCENE",
        "provider": "sentinel-2-l2a",
        "mission": "sentinel-2a",
        "acquired_at": "2026-05-23T10:00:00+00:00",
        "cloud_cover": 4.0,
        "bbox": [2.2, 48.2, 2.8, 48.8],
        "footprint": _stac_item()["geometry"],
    }
    config = {
        "max_cloud_cover": 10,
        "areas": [{"name": "Paris AOI", "geojson": _area_payload()["geojson"]}],
    }

    asyncio.run(GeoZoneTriggerNode().run(ctx, {"config": config}))

    assert len(ctx.events) == 1
    assert ctx.events[0]["class_name"] == "satellite_scene"
    assert ctx.events[0]["zone_name"] == "Paris AOI"
    assert ctx.events[0]["geo"]["centroid"]["lon"] == 2.5
