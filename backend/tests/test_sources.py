"""Tests for /api/sources routes."""

_SOURCE = {"name": "Test Cam", "type": "webcam", "uri": "0", "enabled": True}


def _create(client, payload=None):
    return client.post("/api/sources", json=payload or _SOURCE)


# ── CRUD ──────────────────────────────────────────────────────────────────────

def test_create_source(client):
    r = _create(client)
    assert r.status_code == 201
    data = r.json()
    assert data["name"] == _SOURCE["name"]
    assert data["type"] == _SOURCE["type"]
    assert data["enabled"] is True
    assert "id" in data


def test_list_sources(client):
    _create(client)
    r = client.get("/api/sources")
    assert r.status_code == 200
    assert isinstance(r.json(), list)
    assert len(r.json()) >= 1


def test_get_source(client):
    source_id = _create(client).json()["id"]
    r = client.get(f"/api/sources/{source_id}")
    assert r.status_code == 200
    assert r.json()["id"] == source_id


def test_get_source_not_found(client):
    r = client.get("/api/sources/99999")
    assert r.status_code == 404


def test_update_source(client):
    source_id = _create(client, {"name": "Cam Patch", "type": "rtsp", "uri": "rtsp://x", "enabled": True}).json()["id"]
    r = client.patch(f"/api/sources/{source_id}", json={"enabled": False})
    assert r.status_code == 200
    assert r.json()["enabled"] is False


def test_delete_source(client):
    source_id = _create(client, {"name": "Delete Me", "type": "video", "uri": "/tmp/v.mp4", "enabled": True}).json()["id"]
    r = client.delete(f"/api/sources/{source_id}")
    assert r.status_code == 204
    assert client.get(f"/api/sources/{source_id}").status_code == 404


def test_delete_source_not_found(client):
    r = client.delete("/api/sources/99999")
    assert r.status_code == 404
