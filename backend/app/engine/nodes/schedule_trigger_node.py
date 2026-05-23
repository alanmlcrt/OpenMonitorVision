"""
ScheduleTriggerNode — gate qui laisse passer les frames uniquement dans les
fenêtres de temps configurées. En dehors, il pose context.halted = True ce
qui interrompt l'exécution du reste du workflow pour cette frame.

Modes :
  time_window  Actif entre des plages horaires quotidiennes répétées.
               config.windows = [{"start": "08:00", "end": "20:00"}, ...]

  periodic     Actif pendant duration_minutes toutes les interval_minutes.
               config.interval_minutes = 60, config.duration_minutes = 10

  once         Actif une seule fois à partir de start_at pendant duration_minutes.
               config.start_at = "2024-06-01T14:00", config.duration_minutes = 60
"""
from __future__ import annotations

import time
from datetime import datetime
from datetime import time as dtime

from app.core.logging import get_logger
from app.engine.base_node import BaseNode
from app.engine.workflow_context import WorkflowContext

logger = get_logger(__name__)

# workflow_id → {"window_start": float | None}
_periodic_state: dict[int, dict] = {}


def reset(workflow_id: int) -> None:
    """Réinitialise l'état périodique du workflow (appelé à l'arrêt)."""
    _periodic_state.pop(workflow_id, None)


def _parse_hhmm(s: str) -> dtime:
    parts = s.strip().split(":")
    return dtime(int(parts[0]), int(parts[1]) if len(parts) > 1 else 0)


class ScheduleTriggerNode(BaseNode):
    type = "schedule_trigger"

    async def run(self, context: WorkflowContext, input_data: dict) -> dict:
        config = input_data.get("config", {})
        mode = str(config.get("mode", "time_window"))
        active = self._is_active(context.workflow_id, config, mode)
        if not active:
            context.halted = True
        return {}

    # ──────────────────────────────────────────────────────────────

    def _is_active(self, workflow_id: int, config: dict, mode: str) -> bool:
        try:
            if mode == "time_window":
                return self._check_time_window(config)
            if mode == "periodic":
                return self._check_periodic(workflow_id, config)
            if mode == "once":
                return self._check_once(config)
        except Exception as exc:
            logger.warning("schedule_trigger: error checking schedule: %s", exc)
        return True

    def _check_time_window(self, config: dict) -> bool:
        windows = config.get("windows") or []
        if not windows:
            return True  # aucune plage = toujours actif
        now_t = datetime.now().time()
        for w in windows:
            try:
                start = _parse_hhmm(str(w.get("start", "00:00")))
                end = _parse_hhmm(str(w.get("end", "23:59")))
                if start <= now_t <= end:
                    return True
            except Exception:
                continue
        return False

    def _check_periodic(self, workflow_id: int, config: dict) -> bool:
        interval_s = float(config.get("interval_minutes", 60)) * 60
        duration_s = float(config.get("duration_minutes", 5)) * 60
        state = _periodic_state.setdefault(workflow_id, {"window_start": None})
        now = time.monotonic()
        ws = state["window_start"]
        if ws is None:
            state["window_start"] = now
            return True
        elapsed = now - ws
        if elapsed < duration_s:
            return True
        if elapsed >= interval_s:
            state["window_start"] = now
            return True
        return False

    def _check_once(self, config: dict) -> bool:
        start_at_str = str(config.get("start_at") or "")
        duration_s = float(config.get("duration_minutes", 60)) * 60
        if not start_at_str:
            return False
        try:
            start_dt = datetime.fromisoformat(start_at_str)
            start_ts = start_dt.timestamp()
            now_ts = time.time()
            return start_ts <= now_ts <= start_ts + duration_s
        except Exception:
            return False
