def test_health_ok(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "ok"
    assert "device" in data
    assert "workflows" in data
    assert "running_count" in data["workflows"]
    assert "ids" in data["workflows"]
    assert "stats" in data["workflows"]
    assert "training" in data
    assert "current_job_id" in data["training"]
