from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.db.models import MqttBroker
from app.schemas.mqtt import MqttBrokerCreate, MqttBrokerRead, MqttBrokerTest, MqttBrokerUpdate
from app.services import mqtt_service

router = APIRouter(prefix="/mqtt/brokers", tags=["mqtt"])


@router.get("", response_model=list[MqttBrokerRead])
async def list_brokers(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(MqttBroker).order_by(MqttBroker.created_at.desc()))
    return result.scalars().all()


@router.post("", response_model=MqttBrokerRead, status_code=201)
async def create_broker(payload: MqttBrokerCreate, db: AsyncSession = Depends(get_db)):
    broker = MqttBroker(**payload.model_dump())
    db.add(broker)
    await db.commit()
    await db.refresh(broker)
    return broker


@router.get("/{broker_id}", response_model=MqttBrokerRead)
async def get_broker(broker_id: int, db: AsyncSession = Depends(get_db)):
    broker = await db.get(MqttBroker, broker_id)
    if broker is None:
        raise HTTPException(404, "Broker not found")
    return broker


@router.patch("/{broker_id}", response_model=MqttBrokerRead)
async def update_broker(broker_id: int, payload: MqttBrokerUpdate, db: AsyncSession = Depends(get_db)):
    broker = await db.get(MqttBroker, broker_id)
    if broker is None:
        raise HTTPException(404, "Broker not found")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(broker, k, v)
    await db.commit()
    await db.refresh(broker)
    mqtt_service.invalidate_broker(broker_id)
    return broker


@router.delete("/{broker_id}", status_code=204)
async def delete_broker(broker_id: int, db: AsyncSession = Depends(get_db)):
    broker = await db.get(MqttBroker, broker_id)
    if broker is None:
        raise HTTPException(404, "Broker not found")
    await db.delete(broker)
    await db.commit()
    mqtt_service.invalidate_broker(broker_id)


@router.post("/{broker_id}/test", response_model=MqttBrokerTest)
async def test_broker(broker_id: int, db: AsyncSession = Depends(get_db)):
    broker = await db.get(MqttBroker, broker_id)
    if broker is None:
        raise HTTPException(404, "Broker not found")
    ok, message = await mqtt_service.test_connection_async(broker)
    return MqttBrokerTest(ok=ok, message=message)
