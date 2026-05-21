from typing import Any
from app.engine.workflow_context import WorkflowContext
from app.engine.node_registry import get_node
from app.core.logging import get_logger

logger = get_logger(__name__)


def _sort_nodes(nodes: list[dict], edges: list[dict]) -> list[dict]:
    """Topological sort of workflow nodes."""
    adjacency: dict[str, list[str]] = {n["id"]: [] for n in nodes}
    in_degree: dict[str, int] = {n["id"]: 0 for n in nodes}

    for edge in edges:
        src = edge.get("source")
        tgt = edge.get("target")
        if src in adjacency and tgt in in_degree:
            adjacency[src].append(tgt)
            in_degree[tgt] += 1

    queue = [nid for nid, deg in in_degree.items() if deg == 0]
    sorted_ids = []
    while queue:
        nid = queue.pop(0)
        sorted_ids.append(nid)
        for neighbor in adjacency[nid]:
            in_degree[neighbor] -= 1
            if in_degree[neighbor] == 0:
                queue.append(neighbor)

    node_map = {n["id"]: n for n in nodes}
    return [node_map[nid] for nid in sorted_ids if nid in node_map]


async def run_workflow(
    workflow_id: int,
    nodes: list[dict],
    edges: list[dict],
    frame,
    source_id: int | None = None,
) -> WorkflowContext:
    context = WorkflowContext(workflow_id=workflow_id, source_id=source_id, frame=frame)
    sorted_nodes = _sort_nodes(nodes, edges)

    for node_def in sorted_nodes:
        node_type = node_def.get("data", {}).get("type") or node_def.get("type")
        config = node_def.get("data", {}).get("config", node_def.get("config", {}))
        node = get_node(node_type)
        if node is None:
            logger.warning(f"Unknown node type: {node_type}")
            continue
        try:
            await node.run(context, {"config": config})
        except Exception as e:
            logger.error(f"Node {node_type} error: {e}")

    return context
