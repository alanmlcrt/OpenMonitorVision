"""
YOLO training jobs.

A single background worker (FIFO queue) runs one training at a time to avoid
GPU contention. Ultralytics' `model.train()` runs inside `asyncio.to_thread`.
Per-epoch updates are pushed back to the asyncio loop via
`run_coroutine_threadsafe`, which both updates the DB row and broadcasts on
the WebSocket channel `training_{job_id}`.

On success, `best.pt` is copied into `data/models/` and registered as a
`YoloModel` so it's immediately usable from a workflow.
"""
from __future__ import annotations

import asyncio
import logging
import os
import shutil
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.device import get_best_device
from app.core.logging import get_logger
from app.db.database import AsyncSessionLocal
from app.db.models import Dataset, TrainingJob, YoloModel
from app.runtime.ws_manager import ws_manager
from app.schemas.training import TrainingJobCreate

logger = get_logger(__name__)

# ─────────────────────────────────────────────────────────────────────────────
# Worker state (module-level)
# ─────────────────────────────────────────────────────────────────────────────

_queue: asyncio.Queue[int] = asyncio.Queue()
_worker_task: asyncio.Task | None = None
_current_job_id: int | None = None
_cancel_requested: set[int] = set()
_loop: Optional[asyncio.AbstractEventLoop] = None


class _CancelledByUser(RuntimeError):
    pass


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────

async def start_worker() -> None:
    """Start the background worker. Idempotent."""
    global _worker_task, _loop
    if _worker_task and not _worker_task.done():
        return
    _loop = asyncio.get_running_loop()
    _worker_task = asyncio.create_task(_worker_loop(), name="training-worker")
    # Re-queue any jobs that were left in 'queued' state from a previous run
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(TrainingJob).where(TrainingJob.status == "queued"))
        for job in result.scalars().all():
            await _queue.put(job.id)
        # Any 'running' job at boot is stale — mark as failed
        result = await db.execute(select(TrainingJob).where(TrainingJob.status == "running"))
        for job in result.scalars().all():
            job.status = "failed"
            job.error = "Interrupted by server restart"
            job.finished_at = datetime.now(timezone.utc)
        await db.commit()


async def stop_worker() -> None:
    global _worker_task
    if _worker_task:
        _worker_task.cancel()
        try:
            await _worker_task
        except asyncio.CancelledError:
            pass
        _worker_task = None


async def list_jobs(db: AsyncSession) -> list[TrainingJob]:
    result = await db.execute(select(TrainingJob).order_by(TrainingJob.created_at.desc()))
    return result.scalars().all()


async def get_job(db: AsyncSession, job_id: int) -> TrainingJob | None:
    return await db.get(TrainingJob, job_id)


async def enqueue(db: AsyncSession, payload: TrainingJobCreate) -> TrainingJob:
    dataset = await db.get(Dataset, payload.dataset_id)
    if dataset is None:
        raise ValueError(f"Dataset {payload.dataset_id} not found")

    job = TrainingJob(
        name=payload.name,
        dataset_id=dataset.id,
        base_model=payload.base_model,
        config=payload.config.model_dump(),
        status="queued",
        progress={},
        metrics=[],
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)

    await _queue.put(job.id)
    logger.info("training: enqueued job %s (%s)", job.id, job.name)
    return job


async def cancel(db: AsyncSession, job_id: int) -> bool:
    job = await db.get(TrainingJob, job_id)
    if job is None:
        return False
    if job.status in ("completed", "failed", "cancelled"):
        return False
    _cancel_requested.add(job_id)
    if job.status == "queued":
        # Best effort: the worker will skip it when dequeued
        job.status = "cancelled"
        job.finished_at = datetime.now(timezone.utc)
        await db.commit()
    return True


async def delete_job(db: AsyncSession, job_id: int) -> bool:
    job = await db.get(TrainingJob, job_id)
    if job is None:
        return False
    if job.status == "running":
        # Refuse to delete a running job — caller should cancel first
        return False
    if job.output_path and os.path.isdir(job.output_path):
        shutil.rmtree(job.output_path, ignore_errors=True)
    await db.delete(job)
    await db.commit()
    return True


def current_job_id() -> int | None:
    return _current_job_id


_SUPPORTED_EXPORTS = ("onnx", "torchscript")


async def export_model(job: TrainingJob, fmt: str) -> dict[str, Any]:
    """Run ultralytics export on the job's best.pt. Blocking export runs in a
    worker thread. Returns the exported file path."""
    if fmt not in _SUPPORTED_EXPORTS:
        raise ValueError(f"Unsupported export format: {fmt}")
    if not job.weights_path or not os.path.exists(job.weights_path):
        raise ValueError("Training job has no weights to export")

    exported_path = await asyncio.to_thread(_export_sync, job.weights_path, fmt)
    if not exported_path or not os.path.exists(exported_path):
        raise RuntimeError("Export produced no file")
    return {"format": fmt, "path": exported_path}


def _export_sync(weights_path: str, fmt: str) -> str | None:
    from ultralytics import YOLO
    model = YOLO(weights_path)
    # ultralytics returns the exported file path as a str
    result = model.export(format=fmt)
    if isinstance(result, (list, tuple)) and result:
        return str(result[0])
    return str(result) if result else None


def export_path(job: TrainingJob, fmt: str) -> str | None:
    """Locate the exported artifact next to best.pt without re-running export."""
    if not job.weights_path:
        return None
    suffix = {"onnx": ".onnx", "torchscript": ".torchscript"}.get(fmt)
    if not suffix:
        return None
    candidate = os.path.splitext(job.weights_path)[0] + suffix
    return candidate if os.path.exists(candidate) else None


def tail_log(job: TrainingJob, max_lines: int = 500) -> list[str]:
    """Return the last `max_lines` lines of the training job's log file."""
    if not job.output_path:
        return []
    log_path = os.path.join(job.output_path, "train.log")
    if not os.path.exists(log_path):
        return []
    try:
        # For Phase 1-sized logs (<few MB) a single read is fine
        with open(log_path, "r", encoding="utf-8", errors="replace") as f:
            lines = f.readlines()
    except OSError:
        return []
    if len(lines) > max_lines:
        lines = lines[-max_lines:]
    return [ln.rstrip("\n") for ln in lines]


# ─────────────────────────────────────────────────────────────────────────────
# Worker loop
# ─────────────────────────────────────────────────────────────────────────────

async def _worker_loop() -> None:
    logger.info("training worker started")
    while True:
        job_id = await _queue.get()
        global _current_job_id
        _current_job_id = job_id
        try:
            await _run_job(job_id)
        except Exception:
            logger.exception("training: unhandled error in job %s", job_id)
        finally:
            _current_job_id = None
            _cancel_requested.discard(job_id)


async def _run_job(job_id: int) -> None:
    async with AsyncSessionLocal() as db:
        job = await db.get(TrainingJob, job_id)
        if job is None:
            return
        if job.status == "cancelled" or job_id in _cancel_requested:
            return
        dataset = await db.get(Dataset, job.dataset_id) if job.dataset_id else None
        if dataset is None:
            job.status = "failed"
            job.error = "Dataset not found"
            job.finished_at = datetime.now(timezone.utc)
            await db.commit()
            await _broadcast(job_id, {"type": "status", "status": "failed", "error": job.error})
            return

        output_path = os.path.join(settings.training_runs_dir, str(job.id))
        os.makedirs(output_path, exist_ok=True)
        job.output_path = output_path
        job.status = "running"
        job.started_at = datetime.now(timezone.utc)
        await db.commit()
        await db.refresh(job)

        cfg = dict(job.config or {})
        ds_yaml = dataset.yaml_path
        base_model = job.base_model
        job_name = job.name

    await _broadcast(job_id, {"type": "status", "status": "running"})

    try:
        results = await asyncio.to_thread(
            _train_sync, job_id, base_model, ds_yaml, cfg, output_path
        )
    except _CancelledByUser:
        await _finalize(job_id, status="cancelled", error="Cancelled by user")
        return
    except Exception as exc:
        logger.exception("training: job %s failed", job_id)
        await _finalize(job_id, status="failed", error=str(exc))
        return

    # Locate best.pt and auto-register
    best_pt = _find_best_weights(output_path)
    model_id: int | None = None
    weights_dest: str | None = None
    if best_pt:
        os.makedirs(settings.models_dir, exist_ok=True)
        weights_dest = os.path.join(settings.models_dir, f"{_safe(job_name)}_{job_id}_best.pt")
        try:
            shutil.copy2(best_pt, weights_dest)
        except OSError as exc:
            logger.warning("training: cannot copy best.pt: %s", exc)
            weights_dest = best_pt

        async with AsyncSessionLocal() as db:
            model = YoloModel(
                name=f"{job_name} (trained)",
                filename=os.path.basename(weights_dest),
                path=weights_dest,
                is_default=False,
            )
            db.add(model)
            await db.commit()
            await db.refresh(model)
            model_id = model.id

    await _finalize(job_id, status="completed", weights_path=weights_dest, model_id=model_id)


# ─────────────────────────────────────────────────────────────────────────────
# Sync training (runs in worker thread)
# ─────────────────────────────────────────────────────────────────────────────

def _train_sync(
    job_id: int,
    base_model: str,
    data_yaml: str,
    cfg: dict[str, Any],
    output_path: str,
) -> Any:
    """Blocking — runs inside asyncio.to_thread. Uses ultralytics callbacks."""
    from ultralytics import YOLO

    device = cfg.get("device") or get_best_device()
    if device in ("auto", "", None):
        device = get_best_device()

    # Capture ultralytics logger output → WS + log file
    log_path = os.path.join(output_path, "train.log")
    handler = _WsLogHandler(job_id, log_path)
    ultra_logger = logging.getLogger("ultralytics")
    prev_level = ultra_logger.level
    ultra_logger.addHandler(handler)
    if ultra_logger.level == logging.NOTSET or ultra_logger.level > logging.INFO:
        ultra_logger.setLevel(logging.INFO)

    model = YOLO(base_model)

    total_epochs = int(cfg.get("epochs", 50))

    def _on_train_epoch_end(trainer):
        if job_id in _cancel_requested:
            raise _CancelledByUser()
        metrics = _extract_metrics(trainer)
        epoch = int(getattr(trainer, "epoch", 0)) + 1  # ultralytics is 0-indexed
        payload = {
            "epoch": epoch,
            "total_epochs": total_epochs,
            "metrics": metrics,
        }
        _schedule(_persist_progress(job_id, payload))
        _schedule(_broadcast(job_id, {"type": "progress", **payload}))

    def _on_train_start(trainer):
        if job_id in _cancel_requested:
            raise _CancelledByUser()

    model.add_callback("on_train_start", _on_train_start)
    model.add_callback("on_train_epoch_end", _on_train_epoch_end)

    train_kwargs = {
        "data": data_yaml,
        "epochs": total_epochs,
        "imgsz": int(cfg.get("imgsz", 640)),
        "batch": int(cfg.get("batch", -1)),
        "lr0": float(cfg.get("lr0", 0.01)),
        "device": device,
        "project": output_path,
        "name": "run",
        "exist_ok": True,
        "verbose": True,
    }
    try:
        return model.train(**train_kwargs)
    finally:
        ultra_logger.removeHandler(handler)
        ultra_logger.setLevel(prev_level)
        handler.close()


class _WsLogHandler(logging.Handler):
    """Ultralytics logging.Handler that:
       1) appends every record to <output>/train.log
       2) broadcasts it on the training_{job_id} WS channel."""

    _FMT = logging.Formatter("%(asctime)s  %(message)s", datefmt="%H:%M:%S")

    def __init__(self, job_id: int, log_path: str):
        super().__init__(level=logging.INFO)
        self.job_id = job_id
        self.setFormatter(self._FMT)
        try:
            self._fp = open(log_path, "a", encoding="utf-8", buffering=1)
        except OSError:
            self._fp = None

    def emit(self, record: logging.LogRecord) -> None:
        try:
            line = self.format(record)
        except Exception:
            return
        if self._fp is not None:
            try:
                self._fp.write(line + "\n")
            except OSError:
                pass
        _schedule(_broadcast(self.job_id, {"type": "log", "line": line}))

    def close(self) -> None:
        if self._fp is not None:
            try:
                self._fp.close()
            except OSError:
                pass
            self._fp = None
        super().close()


def _extract_metrics(trainer) -> dict[str, float]:
    """Pull a flat dict of float metrics from the ultralytics trainer."""
    out: dict[str, float] = {}
    raw = getattr(trainer, "metrics", None) or {}
    for k, v in raw.items():
        try:
            out[str(k).replace("metrics/", "").replace("(B)", "").strip()] = float(v)
        except (TypeError, ValueError):
            continue
    # Loss components live on tloss after each train epoch
    tloss = getattr(trainer, "tloss", None)
    if tloss is not None:
        try:
            loss_items = list(map(float, tloss.tolist())) if hasattr(tloss, "tolist") else list(map(float, tloss))
            names = getattr(trainer, "loss_names", ["box_loss", "cls_loss", "dfl_loss"])
            for name, val in zip(names, loss_items):
                out[str(name)] = val
        except Exception:
            pass
    return out


# ─────────────────────────────────────────────────────────────────────────────
# Async helpers (scheduled from worker thread)
# ─────────────────────────────────────────────────────────────────────────────

def _schedule(coro) -> None:
    """Submit a coroutine onto the main event loop from a worker thread."""
    if _loop is None:
        return
    try:
        asyncio.run_coroutine_threadsafe(coro, _loop)
    except RuntimeError:
        pass


async def _persist_progress(job_id: int, payload: dict[str, Any]) -> None:
    async with AsyncSessionLocal() as db:
        job = await db.get(TrainingJob, job_id)
        if job is None:
            return
        job.progress = payload
        history = list(job.metrics or [])
        history.append({"epoch": payload["epoch"], **payload["metrics"]})
        job.metrics = history
        await db.commit()


async def _broadcast(job_id: int, data: dict[str, Any]) -> None:
    await ws_manager.broadcast(f"training_{job_id}", data)


async def _finalize(
    job_id: int,
    *,
    status: str,
    error: str | None = None,
    weights_path: str | None = None,
    model_id: int | None = None,
) -> None:
    async with AsyncSessionLocal() as db:
        job = await db.get(TrainingJob, job_id)
        if job is None:
            return
        job.status = status
        job.error = error
        job.finished_at = datetime.now(timezone.utc)
        if weights_path:
            job.weights_path = weights_path
        if model_id:
            job.model_id = model_id
        await db.commit()
    await _broadcast(job_id, {
        "type": "status",
        "status": status,
        "error": error,
        "model_id": model_id,
    })


def _find_best_weights(output_path: str) -> str | None:
    candidate = os.path.join(output_path, "run", "weights", "best.pt")
    if os.path.exists(candidate):
        return candidate
    # Fallback: walk the output dir
    for root, _, files in os.walk(output_path):
        if "best.pt" in files:
            return os.path.join(root, "best.pt")
    return None


def _safe(name: str) -> str:
    return "".join(c if c.isalnum() or c in ("-", "_") else "_" for c in name)[:60] or "model"
