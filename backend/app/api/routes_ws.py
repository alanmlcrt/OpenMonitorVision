from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from app.runtime.ws_manager import ws_manager
from app.core.logging import get_logger

logger = get_logger(__name__)

router = APIRouter(tags=["websocket"])


@router.websocket("/ws/workflow/{workflow_id}")
async def workflow_ws(workflow_id: int, ws: WebSocket):
    channel = f"workflow_{workflow_id}"
    await ws_manager.connect(channel, ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        ws_manager.disconnect(channel, ws)
        logger.info(f"WS disconnected: {channel}")


@router.websocket("/ws/training/{job_id}")
async def training_ws(job_id: int, ws: WebSocket):
    channel = f"training_{job_id}"
    await ws_manager.connect(channel, ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        ws_manager.disconnect(channel, ws)
        logger.info(f"WS disconnected: {channel}")
