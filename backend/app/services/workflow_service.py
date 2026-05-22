from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.db.models import Workflow
from app.schemas.workflow import WorkflowCreate, WorkflowUpdate


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
        if ntype == "zone_filter":
            for z in cfg.get("zones", []):
                pts = z.get("points", [])
                name = z.get("name", "unnamed")
                if len(pts) < 3:
                    errors.append(f"Zone '{name}' needs at least 3 points")

    return errors
