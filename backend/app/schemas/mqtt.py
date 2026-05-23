from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional


class MqttBrokerCreate(BaseModel):
    name: str
    host: str
    port: int = Field(default=1883, ge=1, le=65535)
    username: Optional[str] = None
    password: Optional[str] = None
    use_tls: bool = False
    client_id: Optional[str] = None
    keepalive: int = Field(default=60, ge=5, le=600)


class MqttBrokerUpdate(BaseModel):
    name: Optional[str] = None
    host: Optional[str] = None
    port: Optional[int] = Field(default=None, ge=1, le=65535)
    username: Optional[str] = None
    password: Optional[str] = None
    use_tls: Optional[bool] = None
    client_id: Optional[str] = None
    keepalive: Optional[int] = Field(default=None, ge=5, le=600)


class MqttBrokerRead(BaseModel):
    id: int
    name: str
    host: str
    port: int
    username: Optional[str]
    use_tls: bool
    client_id: Optional[str]
    keepalive: int
    created_at: datetime

    # Password is intentionally NOT exposed in reads
    model_config = {"from_attributes": True}


class MqttBrokerTest(BaseModel):
    ok: bool
    message: str
