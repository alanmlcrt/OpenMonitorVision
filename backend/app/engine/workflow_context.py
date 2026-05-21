from dataclasses import dataclass, field
from typing import Any
import numpy as np


@dataclass
class WorkflowContext:
    workflow_id: int
    source_id: int | None = None
    frame: np.ndarray | None = None
    detections: Any = None  # sv.Detections
    class_names: list[str] = field(default_factory=list)
    events: list[dict] = field(default_factory=list)
    annotated_frame: np.ndarray | None = None
    metadata: dict[str, Any] = field(default_factory=dict)
