from fastapi import WebSocket
from app.core.logging import get_logger

logger = get_logger(__name__)


class WebSocketManager:
    def __init__(self):
        self._connections: dict[str, list[WebSocket]] = {}

    async def connect(self, channel: str, ws: WebSocket) -> None:
        await ws.accept()
        self._connections.setdefault(channel, []).append(ws)
        logger.info(f"WS connected: {channel} ({len(self._connections[channel])} clients)")

    def disconnect(self, channel: str, ws: WebSocket) -> None:
        conns = self._connections.get(channel, [])
        if ws in conns:
            conns.remove(ws)

    async def broadcast(self, channel: str, data: dict) -> None:
        conns = self._connections.get(channel, [])
        dead = []
        for ws in conns:
            try:
                await ws.send_json(data)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(channel, ws)

    def channel_count(self, channel: str) -> int:
        return len(self._connections.get(channel, []))


ws_manager = WebSocketManager()
