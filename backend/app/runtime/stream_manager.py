import asyncio
import base64
import time
import cv2
import os
from typing import Any
from app.engine.workflow_engine import run_workflow
from app.runtime.ws_manager import ws_manager
from app.services.supervision_service import detections_to_json
from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

_running_tasks: dict[int, asyncio.Task] = {}


def _open_capture(source) -> cv2.VideoCapture | None:
    if source.type == "webcam":
        try:
            idx = int(source.uri)
        except ValueError:
            idx = 0
        cap = cv2.VideoCapture(idx, cv2.CAP_DSHOW)
    elif source.type == "rtsp":
        os.environ.setdefault(
            "OPENCV_FFMPEG_CAPTURE_OPTIONS",
            "rtsp_transport;tcp|stimeout;8000000|max_delay;5000000",
        )
        cap = cv2.VideoCapture(source.uri, cv2.CAP_FFMPEG)
        cap.set(cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 8000)
        cap.set(cv2.CAP_PROP_READ_TIMEOUT_MSEC, 8000)
    else:
        cap = cv2.VideoCapture(source.uri)
    return cap if cap.isOpened() else None


async def _stream_loop(workflow_id: int, workflow, source) -> None:
    channel = f"workflow_{workflow_id}"
    cap = _open_capture(source)
    if cap is None:
        logger.error(f"Cannot open source {source.id} for workflow {workflow_id}")
        return

    target_interval = 1.0 / settings.max_fps
    logger.info(f"Stream started: workflow={workflow_id}, source={source.id}")

    try:
        while True:
            t0 = time.monotonic()

            if ws_manager.channel_count(channel) == 0:
                await asyncio.sleep(0.5)
                continue

            ret, frame = cap.read()
            if not ret:
                logger.warning(f"Empty frame on workflow {workflow_id}, reopening source...")
                cap.release()
                await asyncio.sleep(0.5)
                cap = _open_capture(source)
                if cap is None:
                    await ws_manager.broadcast(channel, {
                        "type": "error",
                        "message": "Cannot reopen source",
                    })
                    await asyncio.sleep(2.0)
                    continue
                continue

            frame = cv2.resize(frame, (settings.frame_width, settings.frame_height))

            ctx = await run_workflow(
                workflow_id=workflow_id,
                nodes=workflow.nodes or [],
                edges=workflow.edges or [],
                frame=frame,
                source_id=source.id,
            )

            display_frame = ctx.annotated_frame if ctx.annotated_frame is not None else frame
            _, buf = cv2.imencode(".jpg", display_frame, [cv2.IMWRITE_JPEG_QUALITY, settings.jpeg_quality])
            b64 = base64.b64encode(buf.tobytes()).decode()

            detections = detections_to_json(ctx.detections, ctx.class_names) if ctx.detections is not None and len(ctx.detections) > 0 else []

            await ws_manager.broadcast(channel, {
                "type": "frame",
                "frame": b64,
                "detections": detections,
                "events": ctx.events,
            })

            elapsed = time.monotonic() - t0
            sleep_time = max(0.0, target_interval - elapsed)
            await asyncio.sleep(sleep_time)

    except asyncio.CancelledError:
        logger.info(f"Stream stopped: workflow {workflow_id}")
    finally:
        cap.release()


async def start_stream(workflow_id: int, workflow, source) -> None:
    await stop_stream(workflow_id)
    task = asyncio.create_task(_stream_loop(workflow_id, workflow, source))
    _running_tasks[workflow_id] = task


async def stop_stream(workflow_id: int) -> None:
    task = _running_tasks.pop(workflow_id, None)
    if task and not task.done():
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass


def is_running(workflow_id: int) -> bool:
    task = _running_tasks.get(workflow_id)
    return task is not None and not task.done()
