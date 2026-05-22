"""Tests for /api/events routes."""


def test_list_events_empty(client):
    r = client.get("/api/events")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_events_stats_shape(client):
    r = client.get("/api/events/stats")
    assert r.status_code == 200
    data = r.json()
    assert "total" in data
    assert "by_class" in data
    assert "by_hour" in data
    assert "by_source" in data


def test_get_event_not_found(client):
    assert client.get("/api/events/99999").status_code == 404


def test_delete_event_not_found(client):
    assert client.delete("/api/events/99999").status_code == 404


def test_bulk_delete_events(client):
    r = client.delete("/api/events")
    assert r.status_code == 200
    data = r.json()
    assert "deleted" in data
    assert isinstance(data["deleted"], int)


def test_bulk_delete_events_with_filter(client):
    r = client.delete("/api/events?source_id=999")
    assert r.status_code == 200
    assert r.json()["deleted"] == 0


def test_cleanup_frames_endpoint(client):
    r = client.post("/api/events/cleanup-frames?older_than_days=1")
    assert r.status_code == 200
    data = r.json()
    assert "deleted_files" in data
    assert isinstance(data["deleted_files"], int)


def test_list_events_pagination(client):
    r = client.get("/api/events?limit=5&offset=0")
    assert r.status_code == 200
    assert len(r.json()) <= 5


def test_list_events_filter_class(client):
    r = client.get("/api/events?class_name=nonexistent_class")
    assert r.status_code == 200
    assert r.json() == []
