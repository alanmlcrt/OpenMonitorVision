import asyncio
import base64
import time
import os
from typing import Any
from app.engine.workflow_engine import run_workflow
from app.runtime.ws_manager import ws_manager
from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

_running_tasks: dict[int, asyncio.Task] = {}

# Per-workflow runtime stats, refreshed each frame in the stream loop
_stream_stats: dict[int, dict] = {}


def get_stream_stats(workflow_id: int) -> dict | None:
    """Return last-known stats for a workflow, or None if it's not running."""
    return _stream_stats.get(workflow_id)


def all_running_stats() -> dict[int, dict]:
    """Snapshot of stats for every currently-tracked workflow."""
    return dict(_stream_stats)


def _cv2():
    try:
        import cv2
    except ImportError as exc:
        raise RuntimeError("OpenCV is required for stream runtime") from exc
    return cv2


def _open_capture(source, force_resolve: bool = False) -> Any | None:
    cv2 = _cv2()
    uri = source.uri

    if source.type == "stream":
        from app.services.stream_resolver import resolve
        try:
            uri = resolve(source.uri, force=force_resolve)
        except RuntimeError as exc:
            logger.error("stream_resolver: %s", exc)
            return None

    if source.type == "webcam":
        try:
            idx = int(uri)
        except ValueError:
            idx = 0
        cap = cv2.VideoCapture(idx, cv2.CAP_DSHOW)
    elif source.type in ("rtsp", "stream"):
        os.environ.setdefault(
            "OPENCV_FFMPEG_CAPTURE_OPTIONS",
            "rtsp_transport;tcp|stimeout;8000000|max_delay;5000000",
        )
        cap = cv2.VideoCapture(uri, cv2.CAP_FFMPEG)
        cap.set(cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 8000)
        cap.set(cv2.CAP_PROP_READ_TIMEOUT_MSEC, 8000)
    elif source.type == "ip_camera":
        if uri.startswith("rtsp://"):
            os.environ.setdefault(
                "OPENCV_FFMPEG_CAPTURE_OPTIONS",
                "rtsp_transport;tcp|stimeout;8000000|max_delay;5000000",
            )
            cap = cv2.VideoCapture(uri, cv2.CAP_FFMPEG)
            cap.set(cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 8000)
            cap.set(cv2.CAP_PROP_READ_TIMEOUT_MSEC, 8000)
        else:
            cap = cv2.VideoCapture(uri)
    elif source.type == "image_url":
        from app.runtime.captures import HttpPollCapture
        cap = HttpPollCapture(uri)
        return cap if cap.isOpened() else None
    elif source.type == "image_folder":
        from app.runtime.captures import ImageFolderCapture
        cap = ImageFolderCapture(uri)
        return cap if cap.isOpened() else None
    else:
        cap = cv2.VideoCapture(uri)
    return cap if cap.isOpened() else None


def _read_frame(cap) -> tuple[bool, Any]:
    return cap.read()


def _release_capture(cap) -> None:
    cap.release()


def _resize_frame(frame, width: int, height: int):
    return _cv2().resize(frame, (width, height))


def _encode_frame_to_jpeg(frame, jpeg_quality: int) -> str:
    cv2 = _cv2()
    _, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, jpeg_quality])
    return base64.b64encode(buf.tobytes()).decode()


async def _stream_loop(workflow_id: int, workflow, source) -> None:
    channel = f"workflow_{workflow_id}"
    try:
        cap = await asyncio.to_thread(_open_capture, source)
    except RuntimeError as exc:
        logger.error(str(exc))
        await ws_manager.broadcast(channel, {"type": "error", "message": str(exc)})
        return
    if cap is None:
        msg = f"Cannot open source {source.id} for workflow {workflow_id}"
        logger.error(msg)
        await ws_manager.broadcast(channel, {"type": "error", "message": msg})
        return

    target_interval = 1.0 / settings.max_fps
    logger.info(f"Stream started: workflow={workflow_id}, source={source.id}")

    _stream_stats[workflow_id] = {
        "source_id": source.id,
        "started_at": time.time(),
        "frames_total": 0,
        "last_frame_at": None,
        "fps_smoothed": 0.0,
    }

    # For 'stream' sources: track consecutive read failures to know when to
    # force-re-resolve the URL (YouTube/Twitch URLs expire after a few hours).
    consecutive_failures = 0
    _MAX_FAILURES_BEFORE_RESOLVE = 3

    try:
        while True:
            t0 = time.monotonic()

            ret, frame = await asyncio.to_thread(_read_frame, cap)
            if not ret:
                consecutive_failures += 1
                force_resolve = (
                    source.type == "stream"
                    and consecutive_failures >= _MAX_FAILURES_BEFORE_RESOLVE
                )
                if force_resolve:
                    logger.warning(
                        f"Stream URL likely expired for workflow {workflow_id}, re-resolving…"
                    )
                    from app.services.stream_resolver import invalidate
                    invalidate(source.uri)
                    consecutive_failures = 0
                else:
                    logger.warning(f"Empty frame on workflow {workflow_id}, reopening source…")

                await asyncio.to_thread(_release_capture, cap)
                await asyncio.sleep(0.5)
                cap = await asyncio.to_thread(_open_capture, source, force_resolve)
                if cap is None:
                    await ws_manager.broadcast(channel, {
                        "type": "error",
                        "message": "Cannot reopen source",
                    })
                    await asyncio.sleep(2.0)
                    continue
                continue

            consecutive_failures = 0

            frame = await asyncio.to_thread(
                _resize_frame,
                frame,
                settings.frame_width,
                settings.frame_height,
            )

            ctx = await run_workflow(
                workflow_id=workflow_id,
                nodes=workflow.nodes or [],
                edges=workflow.edges or [],
                frame=frame,
                source_id=source.id,
            )

            if ws_manager.channel_count(channel) > 0:
                display_frame = ctx.annotated_frame if ctx.annotated_frame is not None else frame
                b64 = await asyncio.to_thread(
                    _encode_frame_to_jpeg,
                    display_frame,
                    settings.jpeg_quality,
                )

                from app.services.supervision_service import detections_to_json

                detections = detections_to_json(ctx.detections, ctx.class_names) if ctx.detections is not None and len(ctx.detections) > 0 else []

                await ws_manager.broadcast(channel, {
                    "type": "frame",
                    "frame": b64,
                    "detections": detections,
                    "events": ctx.events,
                })

            # Update per-workflow runtime stats
            stats = _stream_stats.get(workflow_id)
            if stats is not None:
                stats["frames_total"] += 1
                stats["last_frame_at"] = time.time()
                # Exponential-moving-average FPS over the last few frames
                frame_dt = time.monotonic() - t0
                if frame_dt > 0:
                    inst = 1.0 / frame_dt
                    stats["fps_smoothed"] = (
                        inst if stats["fps_smoothed"] == 0
                        else 0.85 * stats["fps_smoothed"] + 0.15 * inst
                    )

            elapsed = time.monotonic() - t0
            sleep_time = max(0.0, target_interval - elapsed)
            await asyncio.sleep(sleep_time)

    except asyncio.CancelledError:
        logger.info(f"Stream stopped: workflow {workflow_id}")
    finally:
        await asyncio.to_thread(_release_capture, cap)
        _stream_stats.pop(workflow_id, None)


def _on_stream_done(workflow_id: int, task: asyncio.Task) -> None:
    if _running_tasks.get(workflow_id) is task:
        _running_tasks.pop(workflow_id, None)
    _stream_stats.pop(workflow_id, None)
    if task.cancelled():
        return
    try:
        exc = task.exception()
    except asyncio.CancelledError:
        return
    if exc is not None:
        logger.error(
            "Stream task crashed: workflow=%s error=%s",
            workflow_id,
            exc,
            exc_info=(type(exc), exc, exc.__traceback__),
        )


async def start_stream(workflow_id: int, workflow, source) -> None:
    await stop_stream(workflow_id)
    task = asyncio.create_task(_stream_loop(workflow_id, workflow, source))
    task.add_done_callback(lambda done: _on_stream_done(workflow_id, done))
    _running_tasks[workflow_id] = task


async def stop_stream(workflow_id: int) -> None:
    task = _running_tasks.pop(workflow_id, None)
    if task and not task.done():
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
    from app.services.supervision_service import reset_tracker
    from app.engine.nodes.event_trigger_node import reset_cooldown
    from app.engine.nodes.harvest_node import reset as reset_harvest
    from app.engine.nodes.schedule_trigger_node import reset as reset_schedule
    from app.engine.nodes.line_crossing_node import reset as reset_line_crossing
    from app.engine.nodes.zone_sequence_trigger_node import reset as reset_zone_sequence
    reset_tracker(f"workflow_{workflow_id}")
    reset_cooldown(workflow_id)
    reset_harvest(workflow_id)
    reset_schedule(workflow_id)
    reset_line_crossing(workflow_id)
    reset_zone_sequence(workflow_id)
    _stream_stats.pop(workflow_id, None)


def is_running(workflow_id: int) -> bool:
    task = _running_tasks.get(workflow_id)
    return task is not None and not task.done()
