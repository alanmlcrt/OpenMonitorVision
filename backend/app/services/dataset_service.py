"""
Dataset management for YOLO training.

Accepts a zip upload containing a YOLO-format dataset:

    images/train/*.jpg
    images/val/*.jpg
    labels/train/*.txt
    labels/val/*.txt
    data.yaml          (optional — generated from classes.txt if absent)

`data.yaml` must declare `names:` (class list). If missing, we look for a
`classes.txt` (one class per line) and regenerate `data.yaml`.
"""
from __future__ import annotations

import asyncio
import os
import shutil
import time
import zipfile
from pathlib import Path
from typing import Any

import yaml
from fastapi import UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.logging import get_logger
from app.db.models import Dataset, Source
from app.schemas.dataset import DatasetFromSource, DatasetImage, DatasetValidation, LabelRead, LabelWrite, YoloBox

logger = get_logger(__name__)

_IMAGE_EXT = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


# ─────────────────────────────────────────────────────────────────────────────
# CRUD
# ─────────────────────────────────────────────────────────────────────────────

async def list_datasets(db: AsyncSession) -> list[Dataset]:
    result = await db.execute(select(Dataset).order_by(Dataset.created_at.desc()))
    return result.scalars().all()


async def get_dataset(db: AsyncSession, dataset_id: int) -> Dataset | None:
    return await db.get(Dataset, dataset_id)


def _dataset_path_for_delete(path: str | None) -> Path | None:
    if not path:
        return None

    datasets_root = Path(settings.datasets_dir).resolve(strict=False)
    candidate = Path(path).resolve(strict=False)
    try:
        candidate.relative_to(datasets_root)
    except ValueError:
        logger.warning("Refusing to delete dataset path outside datasets_dir: %s", candidate)
        return None
    if candidate == datasets_root:
        logger.warning("Refusing to delete datasets_dir root: %s", candidate)
        return None
    return candidate


async def delete_dataset(db: AsyncSession, dataset_id: int) -> bool:
    ds = await db.get(Dataset, dataset_id)
    if not ds:
        return False
    dataset_path = _dataset_path_for_delete(ds.path)
    if dataset_path is not None and dataset_path.is_dir():
        shutil.rmtree(dataset_path, ignore_errors=True)
    await db.delete(ds)
    await db.commit()
    return True


# ─────────────────────────────────────────────────────────────────────────────
# Import
# ─────────────────────────────────────────────────────────────────────────────

async def import_zip(db: AsyncSession, name: str, file: UploadFile) -> Dataset:
    """
    1. Persist an empty Dataset row to obtain an id.
    2. Extract the zip into data/datasets/<id>/.
    3. Locate / generate data.yaml.
    4. Fill metadata + commit.
    """
    os.makedirs(settings.datasets_dir, exist_ok=True)

    # Stage 1: insert empty row to get an id
    ds = Dataset(name=name, path="", yaml_path="", classes=[])
    db.add(ds)
    await db.commit()
    await db.refresh(ds)

    dest_dir = os.path.join(settings.datasets_dir, str(ds.id))
    os.makedirs(dest_dir, exist_ok=True)
    zip_path = os.path.join(dest_dir, "_upload.zip")

    try:
        # Save the upload to disk first (avoids streaming pitfalls inside zipfile)
        with open(zip_path, "wb") as f:
            shutil.copyfileobj(file.file, f)

        with zipfile.ZipFile(zip_path) as zf:
            # Security: reject absolute paths or "../" traversal
            for member in zf.namelist():
                if member.startswith("/") or ".." in member.replace("\\", "/").split("/"):
                    raise ValueError(f"Unsafe zip entry: {member}")
            zf.extractall(dest_dir)

        # Some zips wrap everything in a single top-level folder — unwrap it
        _flatten_if_single_root(dest_dir)

        yaml_path, classes, num_train, num_val = _resolve_yaml(dest_dir)

        ds.path = dest_dir
        ds.yaml_path = yaml_path
        ds.classes = classes
        ds.num_train = num_train
        ds.num_val = num_val
        ds.num_images = num_train + num_val
        await db.commit()
        await db.refresh(ds)
        return ds

    except Exception:
        # Rollback: remove staged folder + row
        shutil.rmtree(dest_dir, ignore_errors=True)
        await db.delete(ds)
        await db.commit()
        raise
    finally:
        if os.path.exists(zip_path):
            try:
                os.remove(zip_path)
            except OSError:
                pass


async def import_folder(
    db: AsyncSession,
    name: str,
    files: list[UploadFile],
    classes: list[str],
) -> Dataset:
    """
    Build a dataset skeleton from a flat folder of images (the user picked a
    directory in the browser; the FE forwards every file individually).
    Non-image files are silently skipped. Labels are created empty — the user
    annotates via the in-app annotator before training.
    """
    if not classes:
        raise ValueError("At least one class name is required")

    # Filter to image files only
    image_files = [f for f in files if Path(f.filename or "").suffix.lower() in _IMAGE_EXT]
    if not image_files:
        raise ValueError("No image files found in the uploaded folder")

    os.makedirs(settings.datasets_dir, exist_ok=True)

    ds = Dataset(name=name, path="", yaml_path="", classes=list(classes))
    db.add(ds)
    await db.commit()
    await db.refresh(ds)

    dest_dir = os.path.join(settings.datasets_dir, str(ds.id))
    images_dir = os.path.join(dest_dir, "images", "train")
    labels_dir = os.path.join(dest_dir, "labels", "train")
    os.makedirs(images_dir, exist_ok=True)
    os.makedirs(labels_dir, exist_ok=True)

    try:
        saved = 0
        used_names: set[str] = set()
        for upload in image_files:
            # Strip directory prefix from webkitRelativePath-style filenames
            original = os.path.basename(upload.filename or "")
            stem, ext = os.path.splitext(original)
            stem = stem or f"image_{saved:06d}"
            ext = ext.lower() or ".jpg"
            # Disambiguate collisions when the user picks a folder with sub-dirs
            final = f"{stem}{ext}"
            suffix = 1
            while final in used_names:
                final = f"{stem}_{suffix}{ext}"
                suffix += 1
            used_names.add(final)

            img_path = os.path.join(images_dir, final)
            with open(img_path, "wb") as f:
                shutil.copyfileobj(upload.file, f)

            # Empty YOLO label (valid — "no objects in this image")
            lbl_path = os.path.join(labels_dir, os.path.splitext(final)[0] + ".txt")
            open(lbl_path, "w", encoding="utf-8").close()
            saved += 1

        if saved == 0:
            raise RuntimeError("No image could be saved")

        # classes.txt + canonical data.yaml
        with open(os.path.join(dest_dir, "classes.txt"), "w", encoding="utf-8") as f:
            for c in classes:
                f.write(c + "\n")
        yaml_path = os.path.join(dest_dir, "data.yaml")
        with open(yaml_path, "w", encoding="utf-8") as f:
            yaml.safe_dump(
                {
                    "path": os.path.abspath(dest_dir),
                    "train": "images/train",
                    "val":   "images/train",  # no val split yet
                    "names": {i: name for i, name in enumerate(classes)},
                },
                f,
                sort_keys=False,
            )

        ds.path = dest_dir
        ds.yaml_path = yaml_path
        ds.num_train = saved
        ds.num_val = 0
        ds.num_images = saved
        await db.commit()
        await db.refresh(ds)
        return ds
    except Exception:
        shutil.rmtree(dest_dir, ignore_errors=True)
        await db.delete(ds)
        await db.commit()
        raise


async def create_from_source(db: AsyncSession, payload: DatasetFromSource) -> Dataset:
    """
    Capture N frames from a configured Source and build a dataset skeleton
    (images/train/, labels/train/ with empty .txt files, classes.txt, data.yaml).
    The user is expected to annotate the images externally and re-import, OR
    annotate the empty .txt files in place.
    """
    source = await db.get(Source, payload.source_id)
    if source is None:
        raise ValueError(f"Source {payload.source_id} not found")
    if not payload.classes:
        raise ValueError("At least one class name is required")

    num_frames = max(1, min(int(payload.num_frames), 500))
    interval = max(0.0, float(payload.interval_seconds))

    os.makedirs(settings.datasets_dir, exist_ok=True)

    ds = Dataset(name=payload.name, path="", yaml_path="", classes=list(payload.classes))
    db.add(ds)
    await db.commit()
    await db.refresh(ds)

    dest_dir = os.path.join(settings.datasets_dir, str(ds.id))
    images_dir = os.path.join(dest_dir, "images", "train")
    labels_dir = os.path.join(dest_dir, "labels", "train")
    os.makedirs(images_dir, exist_ok=True)
    os.makedirs(labels_dir, exist_ok=True)

    try:
        captured = await asyncio.to_thread(
            _capture_frames_sync, source, images_dir, labels_dir, num_frames, interval
        )
        if captured == 0:
            raise RuntimeError("Could not capture any frame from source")

        # classes.txt + canonical data.yaml
        with open(os.path.join(dest_dir, "classes.txt"), "w", encoding="utf-8") as f:
            for c in payload.classes:
                f.write(c + "\n")
        yaml_path = os.path.join(dest_dir, "data.yaml")
        with open(yaml_path, "w", encoding="utf-8") as f:
            yaml.safe_dump(
                {
                    "path": os.path.abspath(dest_dir),
                    "train": "images/train",
                    "val":   "images/train",  # no val split yet
                    "names": {i: name for i, name in enumerate(payload.classes)},
                },
                f,
                sort_keys=False,
            )

        ds.path = dest_dir
        ds.yaml_path = yaml_path
        ds.num_train = captured
        ds.num_val = 0
        ds.num_images = captured
        await db.commit()
        await db.refresh(ds)
        return ds
    except Exception:
        shutil.rmtree(dest_dir, ignore_errors=True)
        await db.delete(ds)
        await db.commit()
        raise


def _capture_frames_sync(
    source: Source,
    images_dir: str,
    labels_dir: str,
    num_frames: int,
    interval_seconds: float,
) -> int:
    """Blocking — opens the source via OpenCV and writes N JPEG frames + empty .txt labels."""
    import cv2
    # Reuse the same opening logic the runtime uses
    from app.services.source_service import _open_capture as _src_open  # type: ignore

    cap = _src_open(source)
    if cap is None:
        raise RuntimeError(f"Cannot open source {source.id} ({source.type})")

    # Hard wall-clock limit so HTTP requests don't hang forever
    deadline = time.monotonic() + max(60.0, num_frames * (interval_seconds + 1.0))

    saved = 0
    last_save = 0.0
    try:
        while saved < num_frames and time.monotonic() < deadline:
            ret, frame = cap.read()
            if not ret or frame is None:
                # Try a short sleep then continue (RTSP / stream warmup)
                time.sleep(0.1)
                continue
            now = time.monotonic()
            if saved > 0 and (now - last_save) < interval_seconds:
                continue
            stem = f"frame_{saved:06d}"
            img_path = os.path.join(images_dir, stem + ".jpg")
            lbl_path = os.path.join(labels_dir, stem + ".txt")
            if cv2.imwrite(img_path, frame):
                # YOLO accepts an empty label file as "no objects in this image"
                open(lbl_path, "w", encoding="utf-8").close()
                saved += 1
                last_save = now
    finally:
        try:
            cap.release()
        except Exception:
            pass
    return saved


# ─────────────────────────────────────────────────────────────────────────────
# Annotation (YOLO label files)
# ─────────────────────────────────────────────────────────────────────────────

def list_images(dataset: Dataset) -> list[DatasetImage]:
    """Enumerate every image of the dataset across train/val splits."""
    out: list[DatasetImage] = []
    for split in ("train", "val"):
        img_dir = Path(dataset.path) / "images" / split
        if not img_dir.is_dir():
            continue
        for img in sorted(img_dir.iterdir()):
            if img.suffix.lower() not in _IMAGE_EXT:
                continue
            label_path = Path(dataset.path) / "labels" / split / f"{img.stem}.txt"
            width, height = _image_size(img)
            label_count = _count_label_boxes(label_path)
            out.append(DatasetImage(
                stem=img.stem,
                filename=img.name,
                split=split,
                width=width,
                height=height,
                label_count=label_count,
                annotated=label_count > 0,
            ))
    return out


def image_path(dataset: Dataset, stem: str, split: str) -> Path | None:
    stem = _safe_stem(stem)
    base = Path(dataset.path) / "images" / split
    if not base.is_dir():
        return None
    for ext in sorted(_IMAGE_EXT):
        candidate = _safe_child_path(base, f"{stem}{ext}")
        if candidate.exists():
            return candidate
    return None


def read_label(dataset: Dataset, stem: str, split: str) -> LabelRead:
    stem = _safe_stem(stem)
    label_file = _safe_child_path(Path(dataset.path) / "labels" / split, f"{stem}.txt")
    boxes: list[YoloBox] = []
    if label_file.exists():
        try:
            for line in label_file.read_text(encoding="utf-8").splitlines():
                parts = line.strip().split()
                if len(parts) < 5:
                    continue
                try:
                    cls = int(parts[0])
                    x, y, w, h = (float(p) for p in parts[1:5])
                except ValueError:
                    continue
                boxes.append(YoloBox(class_id=cls, x=x, y=y, w=w, h=h))
        except OSError as exc:
            logger.warning("read_label %s: %s", label_file, exc)
    return LabelRead(stem=stem, boxes=boxes)


def write_label(dataset: Dataset, stem: str, split: str, payload: LabelWrite) -> int:
    """Persist a YOLO-format label file. Returns the number of boxes written."""
    stem = _safe_stem(stem)
    labels_dir = Path(dataset.path) / "labels" / split
    labels_dir.mkdir(parents=True, exist_ok=True)
    label_file = _safe_child_path(labels_dir, f"{stem}.txt")

    valid_lines: list[str] = []
    n_classes = len(dataset.classes or [])
    for box in payload.boxes:
        if n_classes and not (0 <= box.class_id < n_classes):
            raise ValueError(f"class_id {box.class_id} out of range (dataset has {n_classes} classes)")
        # Clamp & guard against NaN
        x, y, w, h = (_clamp01(box.x), _clamp01(box.y), _clamp01(box.w), _clamp01(box.h))
        if w <= 0 or h <= 0:
            continue
        valid_lines.append(f"{box.class_id} {x:.6f} {y:.6f} {w:.6f} {h:.6f}")
    label_file.write_text("\n".join(valid_lines) + ("\n" if valid_lines else ""), encoding="utf-8")
    return len(valid_lines)


def _image_size(path: Path) -> tuple[int, int]:
    """Return (width, height) without loading the full image into memory.
    Falls back to (0, 0) on error — caller can choose to filter these out."""
    try:
        # Try the lightweight PIL fallback first if available
        try:
            from PIL import Image  # type: ignore
            with Image.open(path) as im:
                return im.size
        except Exception:
            pass
        # OpenCV fallback
        import cv2
        img = cv2.imread(str(path))
        if img is None:
            return (0, 0)
        return (int(img.shape[1]), int(img.shape[0]))
    except Exception:
        return (0, 0)


def _count_label_boxes(label_path: Path) -> int:
    if not label_path.exists():
        return 0
    try:
        return sum(1 for line in label_path.read_text(encoding="utf-8").splitlines() if line.strip())
    except OSError:
        return 0


def _clamp01(v: float) -> float:
    if v != v:   # NaN
        return 0.0
    return max(0.0, min(1.0, float(v)))


def _safe_stem(stem: str) -> str:
    value = str(stem or "").strip()
    if not value or value in (".", ".."):
        raise ValueError("Invalid image stem")
    if "/" in value or "\\" in value:
        raise ValueError("Invalid image stem")
    return value


def _safe_child_path(base: Path, filename: str) -> Path:
    base_resolved = base.resolve(strict=False)
    candidate = (base / filename).resolve(strict=False)
    try:
        candidate.relative_to(base_resolved)
    except ValueError as exc:
        raise ValueError("Invalid image stem") from exc
    return candidate


def validate(dataset: Dataset) -> DatasetValidation:
    """Re-validate an existing dataset on disk (useful after manual edits)."""
    errors: list[str] = []
    warnings: list[str] = []

    if not os.path.isdir(dataset.path):
        errors.append(f"Dataset folder missing: {dataset.path}")
        return DatasetValidation(ok=False, errors=errors)

    if not os.path.exists(dataset.yaml_path):
        errors.append("data.yaml is missing")
        return DatasetValidation(ok=False, errors=errors)

    try:
        with open(dataset.yaml_path) as f:
            data = yaml.safe_load(f) or {}
    except Exception as exc:
        errors.append(f"Cannot parse data.yaml: {exc}")
        return DatasetValidation(ok=False, errors=errors)

    classes = _parse_names(data.get("names"))
    if not classes:
        errors.append("data.yaml has no `names:` entries")

    num_train = _count_images(dataset.path, "train")
    num_val = _count_images(dataset.path, "val")

    if num_train == 0:
        errors.append("No images found under images/train/")
    if num_val == 0:
        warnings.append("No images found under images/val/ — training will skip validation")

    # Orphan labels (label file with no matching image)
    orphans = _count_orphans(dataset.path)
    if orphans:
        warnings.append(f"{orphans} label file(s) without matching image")

    # All-empty labels: dataset has images but no boxes (common after capture-from-source
    # before the user has annotated). Training on this is unusable.
    if num_train > 0 and _all_labels_empty(dataset.path, "train"):
        warnings.append(
            "All training labels are empty — annotate the images (e.g. with LabelStudio) before training"
        )

    return DatasetValidation(
        ok=len(errors) == 0,
        warnings=warnings,
        errors=errors,
        classes=classes,
        num_train=num_train,
        num_val=num_val,
    )


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _flatten_if_single_root(folder: str) -> None:
    """If the zip extracted everything under one top folder, move its contents up."""
    entries = [e for e in os.listdir(folder) if not e.startswith("_")]
    if len(entries) != 1:
        return
    only = os.path.join(folder, entries[0])
    if not os.path.isdir(only):
        return
    # Only flatten if the inner folder looks like a YOLO dataset
    inner = set(os.listdir(only))
    if not (inner & {"images", "labels", "data.yaml", "classes.txt"}):
        return
    for item in os.listdir(only):
        shutil.move(os.path.join(only, item), os.path.join(folder, item))
    os.rmdir(only)


def _resolve_yaml(folder: str) -> tuple[str, list[str], int, int]:
    """
    Returns (yaml_path, classes, num_train, num_val).
    Generates data.yaml if missing but classes.txt is present.
    Raises ValueError on missing essentials.
    """
    yaml_path = os.path.join(folder, "data.yaml")
    classes: list[str] = []

    if os.path.exists(yaml_path):
        with open(yaml_path) as f:
            data = yaml.safe_load(f) or {}
        classes = _parse_names(data.get("names"))
    else:
        classes_txt = os.path.join(folder, "classes.txt")
        if not os.path.exists(classes_txt):
            raise ValueError(
                "Neither data.yaml nor classes.txt found in archive. "
                "Provide a YOLO-format zip with at least classes.txt."
            )
        with open(classes_txt) as f:
            classes = [line.strip() for line in f if line.strip()]

    if not classes:
        raise ValueError("No class names found in dataset")

    num_train = _count_images(folder, "train")
    num_val = _count_images(folder, "val")
    if num_train == 0:
        raise ValueError("Dataset has no training images under images/train/")

    # Always (re)write a canonical absolute-path data.yaml so ultralytics resolves correctly
    canonical = {
        "path": os.path.abspath(folder),
        "train": "images/train",
        "val": "images/val" if num_val > 0 else "images/train",
        "names": {i: name for i, name in enumerate(classes)},
    }
    with open(yaml_path, "w") as f:
        yaml.safe_dump(canonical, f, sort_keys=False)

    return yaml_path, classes, num_train, num_val


def _parse_names(raw: Any) -> list[str]:
    if raw is None:
        return []
    if isinstance(raw, list):
        return [str(x) for x in raw]
    if isinstance(raw, dict):
        # YOLOv8 style: {0: "person", 1: "car"} — preserve numeric order
        try:
            items = sorted(raw.items(), key=lambda kv: int(kv[0]))
        except (ValueError, TypeError):
            items = list(raw.items())
        return [str(v) for _, v in items]
    return []


def _count_images(folder: str, split: str) -> int:
    p = Path(folder) / "images" / split
    if not p.is_dir():
        return 0
    return sum(1 for entry in p.iterdir() if entry.suffix.lower() in _IMAGE_EXT)


def _all_labels_empty(folder: str, split: str) -> bool:
    p = Path(folder) / "labels" / split
    if not p.is_dir():
        return False
    found_any = False
    for entry in p.iterdir():
        if entry.suffix.lower() != ".txt":
            continue
        found_any = True
        try:
            if entry.stat().st_size > 0:
                return False
        except OSError:
            return False
    return found_any


def _count_orphans(folder: str) -> int:
    count = 0
    for split in ("train", "val"):
        labels_dir = Path(folder) / "labels" / split
        images_dir = Path(folder) / "images" / split
        if not labels_dir.is_dir():
            continue
        image_stems = {p.stem for p in images_dir.iterdir()} if images_dir.is_dir() else set()
        for lbl in labels_dir.iterdir():
            if lbl.suffix.lower() == ".txt" and lbl.stem not in image_stems:
                count += 1
    return count
