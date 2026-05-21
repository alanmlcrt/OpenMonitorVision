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
