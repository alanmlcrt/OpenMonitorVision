"""Tests for stream runtime behavior."""

import asyncio
from types import SimpleNamespace

from app.runtime import stream_manager


class _FakeCapture:
    def __init__(self):
        self.released = False

    def read(self):
        return True, object()

    def release(self):
        self.released = True


class _FakeWsManager:
    def __init__(self):
        self.broadcasts = []

    def channel_count(self, channel):
        return 0

    async def broadcast(self, channel, data):
        self.broadcasts.append((channel, data))


def test_stream_loop_runs_workflow_without_ws_clients(monkeypatch):
    """A running workflow must keep analyzing frames even when nobody watches Live."""
    cap = _FakeCapture()
    ws_manager = _FakeWsManager()
    calls = {"count": 0}

    def fail_if_encoded(*args, **kwargs):
        raise AssertionError("JPEG encoding should be skipped when no WebSocket clients exist")

    async def run_case():
        ran = asyncio.Event()

        async def fake_run_workflow(**kwargs):
            calls["count"] += 1
            ran.set()
            return SimpleNamespace(
                annotated_frame=None,
                detections=None,
                class_names=[],
                events=[],
            )

        monkeypatch.setattr(stream_manager, "run_workflow", fake_run_workflow)

        task = asyncio.create_task(
            stream_manager._stream_loop(
                4242,
                SimpleNamespace(nodes=[], edges=[]),
                SimpleNamespace(id=7, type="video", uri="fake"),
            )
        )
        try:
            await asyncio.wait_for(ran.wait(), timeout=1.0)
        finally:
            task.cancel()
            await task

    monkeypatch.setattr(stream_manager, "ws_manager", ws_manager)
    monkeypatch.setattr(stream_manager, "_open_capture", lambda source, force_resolve=False: cap)
    monkeypatch.setattr(stream_manager, "_resize_frame", lambda frame, width, height: frame)
    monkeypatch.setattr(stream_manager, "_encode_frame_to_jpeg", fail_if_encoded)
    monkeypatch.setattr(stream_manager.settings, "max_fps", 1000)

    asyncio.run(run_case())

    assert calls["count"] >= 1
    assert ws_manager.broadcasts == []
    assert cap.released is True
    assert stream_manager.get_stream_stats(4242) is None
