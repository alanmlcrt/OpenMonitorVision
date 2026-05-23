"""
MQTT connection pool and publish helpers.

Keeps one persistent paho.Client per broker_id, reconnects in the background
via loop_start(). A publish call is non-blocking from the caller's perspective
(returned MQTTMessageInfo, fire-and-forget by default).

Tested with QoS 0 and 1; QoS 2 supported but rarely needed for notifications.
"""
from __future__ import annotations

import asyncio
import threading
import time
from typing import Any, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.db.models import MqttBroker

logger = get_logger(__name__)


# broker_id → connected client
_clients: dict[int, Any] = {}
_lock = threading.Lock()


def _close_client(client: Any) -> None:
    try:
        client.loop_stop()
        client.disconnect()
    except Exception:
        pass


def _paho():
    try:
        import paho.mqtt.client as mqtt  # noqa: WPS433
    except ImportError as exc:
        raise RuntimeError("paho-mqtt is not installed (pip install paho-mqtt)") from exc
    return mqtt


def _make_client(broker: MqttBroker):
    """Build and connect a paho client. Raises on failure."""
    mqtt = _paho()
    client_id = broker.client_id or f"omv-{broker.id}-{int(time.time())}"
    # CallbackAPIVersion.VERSION2 is the modern API in paho-mqtt 2.x
    try:
        client = mqtt.Client(
            client_id=client_id,
            callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
        )
    except AttributeError:
        # paho-mqtt < 2.0 fallback
        client = mqtt.Client(client_id=client_id)

    if broker.username:
        client.username_pw_set(broker.username, broker.password or None)
    if broker.use_tls:
        client.tls_set()

    client.connect(broker.host, broker.port, broker.keepalive)
    client.loop_start()
    return client


def get_client(broker: MqttBroker):
    """Return a connected client, creating it lazily. Thread-safe."""
    with _lock:
        client = _clients.get(broker.id)
        if client is not None and client.is_connected():
            return client
        # Reconnect / first connect
        if client is not None:
            _close_client(client)
            _clients.pop(broker.id, None)
        client = _make_client(broker)
        _clients[broker.id] = client
        return client


def publish(broker: MqttBroker, topic: str, payload: str, qos: int = 0, retain: bool = False) -> bool:
    """Blocking publish. Returns True on success."""
    try:
        client = get_client(broker)
        info = client.publish(topic, payload=payload, qos=int(qos), retain=bool(retain))
        # MQTTMessageInfo.wait_for_publish blocks until acked (for QoS>0)
        if qos > 0:
            info.wait_for_publish(timeout=5.0)
        return info.rc == 0
    except Exception as exc:
        logger.warning("mqtt publish failed (broker=%s topic=%s): %s", broker.id, topic, exc)
        # Drop the cached client so the next call reconnects
        with _lock:
            cached = _clients.pop(broker.id, None)
        if cached is not None:
            _close_client(cached)
        return False


async def publish_async(broker: MqttBroker, topic: str, payload: str, qos: int = 0, retain: bool = False) -> bool:
    """Async wrapper — runs the blocking publish in a thread."""
    return await asyncio.to_thread(publish, broker, topic, payload, qos, retain)


def test_connection(broker: MqttBroker, timeout: float = 5.0) -> tuple[bool, str]:
    """One-shot connection test, used by the 'Test' button in the UI."""
    try:
        mqtt = _paho()
    except RuntimeError as exc:
        return False, str(exc)

    try:
        client_id = broker.client_id or f"omv-test-{int(time.time())}"
        try:
            client = mqtt.Client(
                client_id=client_id,
                callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
            )
        except AttributeError:
            client = mqtt.Client(client_id=client_id)

        if broker.username:
            client.username_pw_set(broker.username, broker.password or None)
        if broker.use_tls:
            client.tls_set()

        client.connect(broker.host, broker.port, broker.keepalive)
        try:
            client.loop_start()
            time.sleep(min(timeout, 1.5))  # let the connect ack land
            ok = client.is_connected()
        finally:
            try:
                client.loop_stop()
                client.disconnect()
            except Exception:
                pass

        if not ok:
            return False, "Connected, then immediately dropped — check credentials / TLS"
        return True, "Connected successfully"
    except Exception as exc:
        return False, str(exc)


async def test_connection_async(broker: MqttBroker, timeout: float = 5.0) -> tuple[bool, str]:
    return await asyncio.to_thread(test_connection, broker, timeout)


def shutdown_all() -> None:
    """Disconnect every cached client (called from app lifespan)."""
    with _lock:
        for client in list(_clients.values()):
            _close_client(client)
        _clients.clear()


def invalidate_broker(broker_id: int) -> None:
    """Close and drop the cached client for one broker after config changes."""
    with _lock:
        client = _clients.pop(broker_id, None)
    if client is not None:
        _close_client(client)


# Plain async helpers around the DB so the engine and routes can co-operate
async def get_broker(db: AsyncSession, broker_id: int) -> Optional[MqttBroker]:
    return await db.get(MqttBroker, broker_id)
