import asyncio
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.database import get_db
from app.schemas.workflow import WorkflowCreate, WorkflowUpdate, WorkflowRead, WorkflowValidateRequest, WorkflowValidateResponse
from app.services import workflow_service, source_service
from app.runtime import stream_manager

router = APIRouter(prefix="/workflows", tags=["workflows"])


@router.get("", response_model=list[WorkflowRead])
async def list_workflows(db: AsyncSession = Depends(get_db)):
    return await workflow_service.list_workflows(db)


@router.post("", response_model=WorkflowRead, status_code=201)
async def create_workflow(data: WorkflowCreate, db: AsyncSession = Depends(get_db)):
    return await workflow_service.create_workflow(db, data)


@router.post("/validate", response_model=WorkflowValidateResponse)
async def validate_workflow(data: WorkflowValidateRequest):
    errors = workflow_service.validate_workflow_graph(data.nodes, data.edges)
    return WorkflowValidateResponse(valid=len(errors) == 0, errors=errors)


@router.get("/{workflow_id}", response_model=WorkflowRead)
async def get_workflow(workflow_id: int, db: AsyncSession = Depends(get_db)):
    wf = await workflow_service.get_workflow(db, workflow_id)
    if not wf:
        raise HTTPException(404, "Workflow not found")
    return wf


@router.patch("/{workflow_id}", response_model=WorkflowRead)
async def update_workflow(workflow_id: int, data: WorkflowUpdate, db: AsyncSession = Depends(get_db)):
    wf = await workflow_service.update_workflow(db, workflow_id, data)
    if not wf:
        raise HTTPException(404, "Workflow not found")
    return wf


@router.delete("/{workflow_id}", status_code=204)
async def delete_workflow(workflow_id: int, db: AsyncSession = Depends(get_db)):
    await stream_manager.stop_stream(workflow_id)
    ok = await workflow_service.delete_workflow(db, workflow_id)
    if not ok:
        raise HTTPException(404, "Workflow not found")


@router.get("/{workflow_id}/export")
async def export_workflow(workflow_id: int, db: AsyncSession = Depends(get_db)):
    """Return a portable JSON blob containing the workflow's graph (no DB id)."""
    wf = await workflow_service.get_workflow(db, workflow_id)
    if not wf:
        raise HTTPException(404, "Workflow not found")
    return {
        "version": 1,
        "name": wf.name,
        "nodes": wf.nodes or [],
        "edges": wf.edges or [],
        "exported_at": wf.updated_at.isoformat() if wf.updated_at else None,
    }


@router.post("/import", response_model=WorkflowRead, status_code=201)
async def import_workflow(payload: dict, db: AsyncSession = Depends(get_db)):
    """Create a workflow from an exported JSON blob (replaces conflicting names)."""
    name = (payload.get("name") or "Imported workflow").strip()
    nodes = payload.get("nodes") or []
    edges = payload.get("edges") or []
    if not isinstance(nodes, list) or not isinstance(edges, list):
        raise HTTPException(400, "Invalid payload: nodes / edges must be lists")
    return await workflow_service.create_workflow(
        db,
        WorkflowCreate(name=name, nodes=nodes, edges=edges),
    )


@router.post("/{workflow_id}/start")
async def start_workflow(workflow_id: int, db: AsyncSession = Depends(get_db)):
    wf = await workflow_service.get_workflow(db, workflow_id)
    if not wf:
        raise HTTPException(404, "Workflow not found")

    source_node = next(
        (n for n in (wf.nodes or []) if (n.get("data", {}).get("type") or n.get("type")) == "source"),
        None,
    )
    if not source_node:
        raise HTTPException(400, "Workflow has no source node")

    source_id = (source_node.get("data", {}).get("config", {}) or source_node.get("config", {})).get("source_id")
    if not source_id:
        raise HTTPException(400, "Source node has no source_id configured")

    source = await source_service.get_source(db, source_id)
    if not source:
        raise HTTPException(404, "Source not found")
    if not source.enabled:
        raise HTTPException(400, "Source is disabled")

    source_test = await asyncio.to_thread(source_service.test_source, source)
    if not source_test.get("ok"):
        raise HTTPException(503, source_test.get("error", "Cannot open source"))

    await workflow_service.update_workflow(db, workflow_id, WorkflowUpdate(enabled=True))
    await stream_manager.start_stream(workflow_id, wf, source)
    return {"status": "started"}


@router.post("/{workflow_id}/stop")
async def stop_workflow(workflow_id: int, db: AsyncSession = Depends(get_db)):
    await stream_manager.stop_stream(workflow_id)
    await workflow_service.update_workflow(db, workflow_id, WorkflowUpdate(enabled=False))
    return {"status": "stopped"}


@router.get("/running-ids")
async def running_workflow_ids():
    """Return the IDs of all currently-running workflows."""
    return {"ids": list(stream_manager.all_running_stats().keys())}


@router.get("/{workflow_id}/status")
async def workflow_status(workflow_id: int):
    return {
        "running": stream_manager.is_running(workflow_id),
        "stats": stream_manager.get_stream_stats(workflow_id),
    }
