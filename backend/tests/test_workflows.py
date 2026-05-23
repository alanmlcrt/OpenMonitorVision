"""Tests for /api/workflows routes including graph validation."""

_WF = {"name": "Test WF", "nodes": [], "edges": []}


def _create(client, payload=None):
    return client.post("/api/workflows", json=payload or _WF)


# ── CRUD ──────────────────────────────────────────────────────────────────────

def test_create_workflow(client):
    r = _create(client)
    assert r.status_code == 201
    data = r.json()
    assert data["name"] == _WF["name"]
    assert data["enabled"] is False
    assert "id" in data


def test_list_workflows(client):
    _create(client)
    r = client.get("/api/workflows")
    assert r.status_code == 200
    assert isinstance(r.json(), list)
    assert len(r.json()) >= 1


def test_get_workflow(client):
    wf_id = _create(client).json()["id"]
    r = client.get(f"/api/workflows/{wf_id}")
    assert r.status_code == 200
    assert r.json()["id"] == wf_id


def test_get_workflow_not_found(client):
    assert client.get("/api/workflows/99999").status_code == 404


def test_update_workflow(client):
    wf_id = _create(client, {"name": "WF Before", "nodes": [], "edges": []}).json()["id"]
    r = client.patch(f"/api/workflows/{wf_id}", json={"name": "WF After"})
    assert r.status_code == 200
    assert r.json()["name"] == "WF After"


def test_delete_workflow(client):
    wf_id = _create(client, {"name": "Delete WF", "nodes": [], "edges": []}).json()["id"]
    assert client.delete(f"/api/workflows/{wf_id}").status_code == 204
    assert client.get(f"/api/workflows/{wf_id}").status_code == 404


def test_workflow_status(client):
    wf_id = _create(client).json()["id"]
    r = client.get(f"/api/workflows/{wf_id}/status")
    assert r.status_code == 200
    data = r.json()
    assert data["running"] is False
    assert "stats" in data


def test_workflow_export_import(client):
    payload = {
        "name": "Exportable",
        "nodes": [{"id": "src", "data": {"type": "source", "config": {"source_id": 1}}}],
        "edges": [],
    }
    wf_id = _create(client, payload).json()["id"]

    exported = client.get(f"/api/workflows/{wf_id}/export")
    assert exported.status_code == 200
    blob = exported.json()
    assert blob["name"] == "Exportable"
    assert blob["nodes"] == payload["nodes"]
    assert "id" not in blob

    blob["name"] = "Imported copy"
    imported = client.post("/api/workflows/import", json=blob)
    assert imported.status_code == 201
    data = imported.json()
    assert data["name"] == "Imported copy"
    assert data["nodes"] == payload["nodes"]


# ── Validation ────────────────────────────────────────────────────────────────

def _validate(client, nodes, edges=None):
    return client.post("/api/workflows/validate", json={"nodes": nodes, "edges": edges or []})


def test_validate_empty_workflow(client):
    r = _validate(client, [])
    assert r.status_code == 200
    data = r.json()
    assert data["valid"] is False
    assert data["errors"]


def test_validate_missing_source_node(client):
    nodes = [{"id": "n1", "data": {"type": "yolo_detect", "config": {}}}]
    r = _validate(client, nodes)
    assert r.status_code == 200
    data = r.json()
    assert data["valid"] is False
    assert any("Source" in e for e in data["errors"])


def test_validate_source_without_id(client):
    nodes = [{"id": "src", "data": {"type": "source", "config": {}}}]
    r = _validate(client, nodes)
    assert r.status_code == 200
    assert r.json()["valid"] is False


def test_validate_disconnected_node(client):
    nodes = [
        {"id": "src", "data": {"type": "source", "config": {"source_id": 1}}},
        {"id": "det", "data": {"type": "yolo_detect", "config": {}}},
    ]
    r = _validate(client, nodes, edges=[])  # no edges → det is disconnected
    assert r.status_code == 200
    assert r.json()["valid"] is False


def test_validate_valid_minimal_workflow(client):
    nodes = [
        {"id": "src", "data": {"type": "source", "config": {"source_id": 1}}},
        {"id": "det", "data": {"type": "yolo_detect", "config": {"model_path": "yolov8n.pt"}}},
    ]
    edges = [{"id": "e1", "source": "src", "target": "det"}]
    r = _validate(client, nodes, edges)
    assert r.status_code == 200
    data = r.json()
    assert data["valid"] is True
    assert data["errors"] == []


def test_validate_single_source_node(client):
    """A single source node with no edges is valid (no connectivity rules for single-node graphs)."""
    nodes = [{"id": "src", "data": {"type": "source", "config": {"source_id": 1}}}]
    r = _validate(client, nodes, edges=[])
    assert r.status_code == 200
    assert r.json()["valid"] is True


def test_validate_zone_filter_bad_polygon(client):
    nodes = [
        {"id": "src", "data": {"type": "source", "config": {"source_id": 1}}},
        {
            "id": "zf",
            "data": {
                "type": "zone_filter",
                "config": {"zones": [{"name": "Bad", "points": [[0, 0], [100, 0]]}]},  # only 2 points
            },
        },
    ]
    edges = [{"id": "e1", "source": "src", "target": "zf"}]
    r = _validate(client, nodes, edges)
    assert r.status_code == 200
    data = r.json()
    assert data["valid"] is False
    assert any("3 points" in e for e in data["errors"])
