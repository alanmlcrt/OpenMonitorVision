from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, Text, ForeignKey, JSON
from sqlalchemy.orm import relationship
from datetime import datetime, timezone
from app.db.database import Base


def _utcnow():
    return datetime.now(timezone.utc)


class Source(Base):
    __tablename__ = "sources"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    type = Column(String, nullable=False)  # webcam | video | rtsp | image
    uri = Column(String, nullable=False)
    enabled = Column(Boolean, default=True)
    created_at = Column(DateTime, default=_utcnow)

    events = relationship("Event", back_populates="source", cascade="all, delete-orphan")


class YoloModel(Base):
    __tablename__ = "yolo_models"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    filename = Column(String, nullable=False)
    path = Column(String, nullable=False)
    is_default = Column(Boolean, default=False)
    created_at = Column(DateTime, default=_utcnow)


class Workflow(Base):
    __tablename__ = "workflows"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    nodes = Column(JSON, default=list)
    edges = Column(JSON, default=list)
    enabled = Column(Boolean, default=False)
    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)

    events = relationship("Event", back_populates="workflow", cascade="all, delete-orphan")


class Zone(Base):
    __tablename__ = "zones"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    source_id = Column(Integer, ForeignKey("sources.id"), nullable=True)
    polygon = Column(JSON, nullable=False)  # list of [x, y] points
    created_at = Column(DateTime, default=_utcnow)


class SatelliteArea(Base):
    __tablename__ = "satellite_areas"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    geojson = Column(JSON, nullable=False)
    bbox = Column(JSON, nullable=False)  # [min_lon, min_lat, max_lon, max_lat]
    enabled = Column(Boolean, default=True)
    created_at = Column(DateTime, default=_utcnow)

    scenes = relationship("SatelliteScene", back_populates="area")


class SatelliteScene(Base):
    __tablename__ = "satellite_scenes"

    id = Column(Integer, primary_key=True, index=True)
    external_id = Column(String, nullable=False, index=True)
    provider = Column(String, default="manual")
    mission = Column(String, nullable=True)
    product_type = Column(String, nullable=True)
    acquired_at = Column(DateTime, nullable=True, index=True)
    cloud_cover = Column(Float, nullable=True)
    bbox = Column(JSON, nullable=False)  # [min_lon, min_lat, max_lon, max_lat]
    footprint = Column(JSON, nullable=False)
    assets = Column(JSON, default=dict)
    metadata_ = Column("metadata", JSON, nullable=True)
    local_path = Column(String, nullable=True)
    thumbnail_url = Column(String, nullable=True)
    source_url = Column(String, nullable=True)
    area_id = Column(Integer, ForeignKey("satellite_areas.id"), nullable=True)
    status = Column(String, default="available")
    created_at = Column(DateTime, default=_utcnow)

    area = relationship("SatelliteArea", back_populates="scenes")


class MqttBroker(Base):
    __tablename__ = "mqtt_brokers"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    host = Column(String, nullable=False)
    port = Column(Integer, default=1883)
    username = Column(String, nullable=True)
    password = Column(String, nullable=True)
    use_tls = Column(Boolean, default=False)
    client_id = Column(String, nullable=True)        # auto-generated if empty
    keepalive = Column(Integer, default=60)
    created_at = Column(DateTime, default=_utcnow)


class Dataset(Base):
    __tablename__ = "datasets"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    path = Column(String, nullable=False)            # data/datasets/<id>/
    yaml_path = Column(String, nullable=False)       # path/data.yaml
    classes = Column(JSON, default=list)             # ["person", "car", ...]
    num_images = Column(Integer, default=0)
    num_train = Column(Integer, default=0)
    num_val = Column(Integer, default=0)
    created_at = Column(DateTime, default=_utcnow)


class TrainingJob(Base):
    __tablename__ = "training_jobs"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    dataset_id = Column(Integer, ForeignKey("datasets.id"), nullable=True)
    base_model = Column(String, nullable=False)       # "yolov8n.pt", ...
    config = Column(JSON, default=dict)               # {epochs, imgsz, batch, lr0, device}
    status = Column(String, default="queued", index=True)  # queued|running|completed|failed|cancelled
    progress = Column(JSON, default=dict)             # {epoch, total_epochs, metrics: {...}}
    metrics = Column(JSON, default=list)              # history [{epoch, box_loss, map50, ...}]
    output_path = Column(String, nullable=True)
    weights_path = Column(String, nullable=True)
    model_id = Column(Integer, ForeignKey("yolo_models.id"), nullable=True)
    error = Column(Text, nullable=True)
    started_at = Column(DateTime, nullable=True)
    finished_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=_utcnow)


class Event(Base):
    __tablename__ = "events"

    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(DateTime, default=_utcnow, index=True)
    source_id = Column(Integer, ForeignKey("sources.id"), nullable=True)
    workflow_id = Column(Integer, ForeignKey("workflows.id"), nullable=True)
    class_name = Column(String, nullable=False)
    class_id = Column(Integer, nullable=True)
    confidence = Column(Float, nullable=True)
    tracker_id = Column(Integer, nullable=True)
    zone_name = Column(String, nullable=True)
    bbox = Column(JSON, nullable=True)
    frame_path = Column(String, nullable=True)
    metadata_ = Column("metadata", JSON, nullable=True)

    source = relationship("Source", back_populates="events")
    workflow = relationship("Workflow", back_populates="events")
