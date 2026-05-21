from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, Text, ForeignKey, JSON
from sqlalchemy.orm import relationship
from datetime import datetime
from app.db.database import Base


class Source(Base):
    __tablename__ = "sources"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    type = Column(String, nullable=False)  # webcam | video | rtsp | image
    uri = Column(String, nullable=False)
    enabled = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    events = relationship("Event", back_populates="source", cascade="all, delete-orphan")


class YoloModel(Base):
    __tablename__ = "yolo_models"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    filename = Column(String, nullable=False)
    path = Column(String, nullable=False)
    is_default = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class Workflow(Base):
    __tablename__ = "workflows"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    nodes = Column(JSON, default=list)
    edges = Column(JSON, default=list)
    enabled = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    events = relationship("Event", back_populates="workflow", cascade="all, delete-orphan")


class Zone(Base):
    __tablename__ = "zones"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    source_id = Column(Integer, ForeignKey("sources.id"), nullable=True)
    polygon = Column(JSON, nullable=False)  # list of [x, y] points
    created_at = Column(DateTime, default=datetime.utcnow)


class Event(Base):
    __tablename__ = "events"

    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(DateTime, default=datetime.utcnow, index=True)
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
