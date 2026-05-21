from pydantic_settings import BaseSettings
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent.parent


class Settings(BaseSettings):
    app_name: str = "OpenMonitorVision"
    version: str = "0.1.0"
    debug: bool = True

    db_path: str = str(BASE_DIR / "data" / "db" / "omv.db")
    models_dir: str = str(BASE_DIR / "data" / "models")
    uploads_dir: str = str(BASE_DIR / "data" / "uploads")
    exports_dir: str = str(BASE_DIR / "data" / "exports")

    max_fps: int = 15
    frame_width: int = 1280
    frame_height: int = 720
    jpeg_quality: int = 75

    cors_origins: list[str] = ["http://localhost:5173", "http://localhost:3000"]

    model_config = {"env_file": ".env"}


settings = Settings()
