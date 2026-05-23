"""Tests for /api/datasets file path safety."""

import asyncio
from pathlib import Path
from types import SimpleNamespace


def _create_folder_dataset(client, tmp_path, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "datasets_dir", str(tmp_path))
    r = client.post(
        "/api/datasets/from-folder",
        data={"name": "Security Dataset", "classes": "thing"},
        files={"files": ("safe.jpg", b"fake image bytes", "image/jpeg")},
    )
    assert r.status_code == 201
    return r.json()


def test_dataset_label_roundtrip_for_safe_stem(client, tmp_path, monkeypatch):
    ds = _create_folder_dataset(client, tmp_path, monkeypatch)

    payload = {"boxes": [{"class_id": 0, "x": 0.5, "y": 0.5, "w": 0.25, "h": 0.25}]}
    r = client.put(
        f"/api/datasets/{ds['id']}/label",
        params={"stem": "safe", "split": "train"},
        json=payload,
    )
    assert r.status_code == 200
    assert r.json()["saved"] == 1

    r = client.get(
        f"/api/datasets/{ds['id']}/label",
        params={"stem": "safe", "split": "train"},
    )
    assert r.status_code == 200
    assert r.json()["boxes"][0]["class_id"] == 0


def test_dataset_label_rejects_traversal_stem(client, tmp_path, monkeypatch):
    ds = _create_folder_dataset(client, tmp_path, monkeypatch)

    traversal = "../../outside"
    payload = {"boxes": [{"class_id": 0, "x": 0.5, "y": 0.5, "w": 0.25, "h": 0.25}]}

    put_response = client.put(
        f"/api/datasets/{ds['id']}/label",
        params={"stem": traversal, "split": "train"},
        json=payload,
    )
    get_response = client.get(
        f"/api/datasets/{ds['id']}/label",
        params={"stem": traversal, "split": "train"},
    )

    assert put_response.status_code == 400
    assert get_response.status_code == 400
    assert not list(Path(tmp_path).rglob("outside.txt"))


def test_dataset_image_rejects_traversal_stem(client, tmp_path, monkeypatch):
    ds = _create_folder_dataset(client, tmp_path, monkeypatch)

    r = client.get(
        f"/api/datasets/{ds['id']}/image",
        params={"stem": "../../outside", "split": "train"},
    )

    assert r.status_code == 400


def test_delete_dataset_does_not_remove_path_outside_datasets_dir(tmp_path, monkeypatch):
    from app.core.config import settings
    from app.services.dataset_service import delete_dataset

    monkeypatch.setattr(settings, "datasets_dir", str(tmp_path / "datasets"))
    outside = tmp_path / "outside"
    outside.mkdir()
    sentinel = outside / "keep.txt"
    sentinel.write_text("keep", encoding="utf-8")

    class FakeDb:
        def __init__(self):
            self.dataset = SimpleNamespace(id=1, path=str(outside))
            self.deleted = None
            self.committed = False

        async def get(self, _model, _id):
            return self.dataset

        async def delete(self, obj):
            self.deleted = obj

        async def commit(self):
            self.committed = True

    db = FakeDb()

    assert asyncio.run(delete_dataset(db, 1)) is True
    assert sentinel.exists()
    assert db.deleted is db.dataset
    assert db.committed is True
