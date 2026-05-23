"""Tests for MQTT broker cache lifecycle."""

from app.services import mqtt_service


class _FakeClient:
    def __init__(self):
        self.stopped = False
        self.disconnected = False

    def loop_stop(self):
        self.stopped = True

    def disconnect(self):
        self.disconnected = True


def _broker_payload(name="Local"):
    return {
        "name": name,
        "host": "localhost",
        "port": 1883,
        "username": None,
        "password": None,
        "use_tls": False,
        "client_id": None,
        "keepalive": 60,
    }


def test_invalidate_broker_closes_cached_client():
    mqtt_service._clients.clear()
    fake = _FakeClient()
    mqtt_service._clients[123] = fake

    mqtt_service.invalidate_broker(123)

    assert 123 not in mqtt_service._clients
    assert fake.stopped is True
    assert fake.disconnected is True


def test_update_broker_invalidates_cached_client(client, monkeypatch):
    invalidated = []
    monkeypatch.setattr(mqtt_service, "invalidate_broker", lambda broker_id: invalidated.append(broker_id))

    created = client.post("/api/mqtt/brokers", json=_broker_payload()).json()
    r = client.patch(f"/api/mqtt/brokers/{created['id']}", json={"host": "127.0.0.1"})

    assert r.status_code == 200
    assert invalidated == [created["id"]]


def test_delete_broker_invalidates_cached_client(client, monkeypatch):
    invalidated = []
    monkeypatch.setattr(mqtt_service, "invalidate_broker", lambda broker_id: invalidated.append(broker_id))

    created = client.post("/api/mqtt/brokers", json=_broker_payload("Delete me")).json()
    r = client.delete(f"/api/mqtt/brokers/{created['id']}")

    assert r.status_code == 204
    assert invalidated == [created["id"]]

