import os
from pydantic_settings import BaseSettings
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent.parent
DATA_DIR = BASE_DIR / "data"

os.environ.setdefault("YOLO_CONFIG_DIR", str(DATA_DIR / "ultralytics"))


class Settings(BaseSettings):
    app_name: str = "OpenMonitorVision"
    version: str = "0.1.0"
    debug: bool = True

    db_path: str = str(DATA_DIR / "db" / "omv.db")
    models_dir: str = str(DATA_DIR / "models")
    uploads_dir: str = str(DATA_DIR / "uploads")
    exports_dir: str = str(DATA_DIR / "exports")
    ultralytics_config_dir: str = str(DATA_DIR / "ultralytics")

    max_fps: int = 15
    frame_width: int = 1280
    frame_height: int = 720
    jpeg_quality: int = 75

    cors_origins: list[str] = ["http://localhost:5173", "http://localhost:3000"]

    model_config = {"env_file": ".env"}


settings = Settings()
