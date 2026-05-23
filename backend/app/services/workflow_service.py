import copy

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified
from sqlalchemy import select

from app.core.config import settings
from app.core.logging import get_logger
from app.db.database import AsyncSessionLocal
from app.db.models import Workflow
from app.schemas.workflow import WorkflowCreate, WorkflowUpdate

logger = get_logger(__name__)


async def list_workflows(db: AsyncSession) -> list[Workflow]:
    result = await db.execute(select(Workflow))
    return result.scalars().all()


async def get_workflow(db: AsyncSession, workflow_id: int) -> Workflow | None:
    return await db.get(Workflow, workflow_id)


async def create_workflow(db: AsyncSession, data: WorkflowCreate) -> Workflow:
    wf = Workflow(**data.model_dump())
    db.add(wf)
    await db.commit()
    await db.refresh(wf)
    return wf


async def update_workflow(db: AsyncSession, workflow_id: int, data: WorkflowUpdate) -> Workflow | None:
    wf = await db.get(Workflow, workflow_id)
    if not wf:
        return None
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(wf, key, value)
    await db.commit()
    await db.refresh(wf)
    return wf


async def delete_workflow(db: AsyncSession, workflow_id: int) -> bool:
    wf = await db.get(Workflow, workflow_id)
    if not wf:
        return False
    await db.delete(wf)
    await db.commit()
    return True


# ─────────────────────────────────────────────────────────────────────────────
# One-shot migration: zones used to be drawn in a 640×360 SVG even though the
# backend resizes frames to settings.frame_width × frame_height (1280×720).
# sv.PolygonZone was therefore filtering in the top-left quadrant only. We
# rescale every saved zone once, tagged via _zones_scale_v2 inside the node
# config so the migration is idempotent.
# ─────────────────────────────────────────────────────────────────────────────

_LEGACY_FRAME_WIDTH = 640
_LEGACY_FRAME_HEIGHT = 360
_MIGRATION_FLAG = "_zones_scale_v2"


async def restart_enabled_workflows() -> None:
    """Resume every workflow that was running when the backend last shut down.
    Looks at the `enabled` column and starts the stream for each (if its source
    is still reachable). Silently skips any whose source has disappeared or
    can't be opened — the user can re-enable manually."""
    from app.runtime import stream_manager
    from app.services import source_service
    import asyncio

    async with AsyncSessionLocal() as db:
        from sqlalchemy import select
        from app.db.models import Workflow

        result = await db.execute(select(Workflow).where(Workflow.enabled == True))   # noqa: E712
        candidates = list(result.scalars().all())

    if not candidates:
        return

    started = 0
    for wf in candidates:
        try:
            source_node = next(
                (n for n in (wf.nodes or [])
                 if (n.get("data", {}).get("type") or n.get("type")) == "source"),
                None,
            )
            if not source_node:
                continue
            source_id = (source_node.get("data", {}).get("config", {})
                         or source_node.get("config", {})).get("source_id")
            if not source_id:
                continue

            async with AsyncSessionLocal() as db:
                source = await source_service.get_source(db, source_id)
            if source is None or not source.enabled:
                continue

            # Try to open the source synchronously (off the main thread)
            test = await asyncio.to_thread(source_service.test_source, source)
            if not test.get("ok"):
                logger.warning(
                    "auto-restart: workflow %s skipped — source %s unreachable: %s",
                    wf.id, source_id, test.get("error")
                )
                continue

            await stream_manager.start_stream(wf.id, wf, source)
            started += 1
        except Exception as exc:
            logger.warning("auto-restart: workflow %s failed: %s", wf.id, exc)

    if started:
        logger.info("auto-restart: resumed %d workflow(s)", started)


async def migrate_zone_coordinates() -> None:
    """Scan all workflows and rescale legacy zone polygons in-place."""
    scale_x = settings.frame_width / _LEGACY_FRAME_WIDTH
    scale_y = settings.frame_height / _LEGACY_FRAME_HEIGHT
    if scale_x == 1.0 and scale_y == 1.0:
        return  # frame dims unchanged from legacy → nothing to do

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Workflow))
        touched = 0
        for wf in result.scalars().all():
            nodes = wf.nodes or []
            mutated = False
            for node in nodes:
                if not isinstance(node, dict):
                    continue
                data = node.get("data") or {}
                if data.get("type") != "zone_filter":
                    continue
                config = data.get("config")
                if not isinstance(config, dict):
                    continue
                if config.get(_MIGRATION_FLAG):
                    continue
                zones = config.get("zones") or []
                for zone in zones:
                    if not isinstance(zone, dict):
                        continue
                    pts = zone.get("points") or []
                    zone["points"] = [
                        [round(float(x) * scale_x), round(float(y) * scale_y)]
                        for x, y in pts
                        if isinstance(x, (int, float)) and isinstance(y, (int, float))
                    ]
                config[_MIGRATION_FLAG] = True
                mutated = True
            if mutated:
                # SQLAlchemy doesn't detect in-place mutations of JSON columns
                wf.nodes = copy.deepcopy(nodes)
                flag_modified(wf, "nodes")
                touched += 1
        if touched:
            await db.commit()
            logger.info("workflow_service: migrated zone coords on %d workflow(s)", touched)


def validate_workflow_graph(nodes: list, edges: list) -> list[str]:
    """Return a list of human-readable error strings (empty = valid)."""
    if not nodes:
        return ["Workflow has no nodes"]

    errors: list[str] = []
    node_info: dict[str, tuple[str, dict]] = {}
    for node in nodes:
        nid = node.get("id", "")
        ntype = node.get("data", {}).get("type") or node.get("type", "")
        ncfg = node.get("data", {}).get("config", {}) or node.get("config", {}) or {}
        node_info[nid] = (ntype, ncfg)

    # Must have at least one source node
    source_entries = [(nid, cfg) for nid, (nt, cfg) in node_info.items() if nt == "source"]
    if not source_entries:
        errors.append("Workflow must have at least one Source node")
    else:
        for _, cfg in source_entries:
            if not cfg.get("source_id"):
                errors.append("Source node: no source selected")

    # Connectivity: each non-source node needs an incoming edge; each source needs an outgoing edge
    if len(nodes) > 1:
        edge_targets = {e.get("target") for e in edges}
        edge_sources = {e.get("source") for e in edges}
        for nid, (ntype, _) in node_info.items():
            if ntype == "source" and nid not in edge_sources:
                errors.append(f"Source node is not connected to anything")
            elif ntype not in ("source",) and nid not in edge_targets:
                errors.append(f"Node '{ntype}' has no incoming connection")

    # Zone filter: each zone must have ≥ 3 points
    for _, (ntype, cfg) in node_info.items():
        if ntype in ("zone_filter", "zone_sequence_trigger"):
            for z in cfg.get("zones", []):
                pts = z.get("points", [])
                name = z.get("name", "unnamed")
                if len(pts) < 3:
                    errors.append(f"Zone '{name}' needs at least 3 points")
        if ntype == "zone_sequence_trigger":
            zones = cfg.get("zones", [])
            sequence = cfg.get("sequence") or []
            if len(zones) < 2:
                errors.append("Zone Sequence Trigger needs at least two zones")
            if sequence and len(sequence) < 2:
                errors.append("Zone Sequence Trigger sequence needs at least two zone names")

    return errors
