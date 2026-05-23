"""Tests for /api/models file handling."""

from pathlib import Path


def test_upload_model_normalizes_filename_and_stays_in_models_dir(client, tmp_path, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "models_dir", str(tmp_path))

    r = client.post(
        "/api/models?name=Safe",
        files={"file": ("safe model.pt", b"weights", "application/octet-stream")},
    )

    assert r.status_code == 201
    data = r.json()
    assert data["filename"] == "safe_model.pt"

    saved = Path(data["path"]).resolve()
    assert saved.is_relative_to(tmp_path.resolve())
    assert saved.exists()


def test_upload_model_rejects_path_traversal_filename(client, tmp_path, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "models_dir", str(tmp_path))

    r = client.post(
        "/api/models?name=Traversal",
        files={"file": ("../evil.pt", b"weights", "application/octet-stream")},
    )

    assert r.status_code == 400
    assert not (tmp_path.parent / "evil.pt").exists()


def test_upload_model_rejects_unexpected_extension(client, tmp_path, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "models_dir", str(tmp_path))

    r = client.post(
        "/api/models?name=Bad",
        files={"file": ("bad.exe", b"nope", "application/octet-stream")},
    )

    assert r.status_code == 400
    assert not (tmp_path / "bad.exe").exists()

