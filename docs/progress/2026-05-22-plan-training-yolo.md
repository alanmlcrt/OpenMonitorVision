# Plan — Onglet "Training" pour entraînement YOLO

Date : 2026-05-22
Statut : **Phases 1, 2 et 3 implémentées** ✅ — tests end-to-end restant à faire

---

## 1. Objectif

Permettre à l'utilisateur d'entraîner ses propres modèles YOLO directement depuis la WebUI :

1. importer un dataset (format YOLO) ;
2. configurer un job d'entraînement (modèle de base, epochs, image size, batch, device…) ;
3. suivre la progression en temps réel (loss, mAP, epoch courant) ;
4. récupérer automatiquement le `best.pt` comme modèle utilisable dans les workflows.

Objectif **non-MVP** : annotation in-app, hyperparameter search, distributed training, export ONNX/TensorRT.

---

## 2. Architecture cible

```
┌──────────────────────────────────────────────────────────────┐
│  Frontend  TrainingPage  ─►  REST  ─►  /api/datasets         │
│                                       /api/training          │
│             WS /ws/training/{job_id}  ◄── ws_manager         │
└──────────────────────────────────────────────────────────────┘
                          │
┌──────────────────────────────────────────────────────────────┐
│  Backend                                                     │
│   • dataset_service     : import zip, validation YAML        │
│   • training_service    : queue, lifecycle, callbacks YOLO   │
│   • training_worker     : asyncio.Task unique (FIFO)         │
│   • ws_manager channel  : training_{job_id}                  │
│   • ultralytics.YOLO.train(..., callbacks={on_*})            │
└──────────────────────────────────────────────────────────────┘
                          │
                ┌─────────┴─────────┐
                ▼                   ▼
        data/datasets/        data/training_runs/
        data/models/  ◄──── best.pt (auto-register)
```

Un seul worker à la fois (sérialisation FIFO) — la GPU ne supporte pas plusieurs trainings concurrents proprement et ça simplifie la queue.

---

## 3. Modèle de données (nouvelles tables)

```python
# backend/app/db/models.py

class Dataset(Base):
    __tablename__ = "datasets"
    id          = Column(Integer, primary_key=True)
    name        = Column(String, nullable=False)
    path        = Column(String, nullable=False)        # data/datasets/<id>/
    yaml_path   = Column(String, nullable=False)        # path/data.yaml
    classes     = Column(JSON, nullable=False)          # ["person", "car", …]
    num_images  = Column(Integer, default=0)
    num_train   = Column(Integer, default=0)
    num_val     = Column(Integer, default=0)
    created_at  = Column(DateTime, default=_utcnow)


class TrainingJob(Base):
    __tablename__ = "training_jobs"
    id            = Column(Integer, primary_key=True)
    name          = Column(String, nullable=False)
    dataset_id    = Column(Integer, ForeignKey("datasets.id"))
    base_model    = Column(String, nullable=False)      # "yolov8n.pt", "yolov11s.pt", …
    config        = Column(JSON, nullable=False)        # {epochs, imgsz, batch, lr0, device, …}
    status        = Column(String, default="queued")    # queued|running|completed|failed|cancelled
    progress      = Column(JSON, default=dict)          # {epoch, total_epochs, metrics: {…}}
    metrics       = Column(JSON, default=list)          # historique [{epoch, box_loss, map50, …}]
    output_path   = Column(String, nullable=True)       # data/training_runs/<job_id>/
    weights_path  = Column(String, nullable=True)       # best.pt enregistré
    model_id      = Column(Integer, ForeignKey("yolo_models.id"), nullable=True)
    error         = Column(Text, nullable=True)
    started_at    = Column(DateTime, nullable=True)
    finished_at   = Column(DateTime, nullable=True)
    created_at    = Column(DateTime, default=_utcnow)
```

Migration : ajout simple, pas de relation cassante. Tables créées via `Base.metadata.create_all` au démarrage (cohérent avec l'existant).

---

## 4. Backend

### 4.1 `app/services/dataset_service.py` (nouveau)

- `import_zip(file: UploadFile) -> Dataset`
  Décompresse dans `data/datasets/<id>/`, vérifie la structure :
  ```
  images/train/*.jpg
  images/val/*.jpg
  labels/train/*.txt
  labels/val/*.txt
  data.yaml      (path, train, val, names: [...])
  ```
  Si `data.yaml` est absent, on le génère depuis les sous-dossiers.
- `list_datasets()`, `get_dataset(id)`, `delete_dataset(id)`
- `validate_dataset(path) -> dict` : compte images/labels, détecte les labels orphelins, retourne `{ok, warnings, errors}`

### 4.2 `app/services/training_service.py` (nouveau)

```python
# Queue mémoire + asyncio.Task unique
_queue: asyncio.Queue[int] = asyncio.Queue()
_current_job: int | None = None
_worker_task: asyncio.Task | None = None

async def enqueue(db, payload: TrainingCreate) -> TrainingJob: ...
async def cancel(job_id: int) -> bool: ...
async def _worker_loop(): ...   # boucle FIFO, run_training()
async def _run_job(job: TrainingJob): ...
```

Le worker est démarré dans le `lifespan` FastAPI au boot.

### 4.3 Exécution Ultralytics

```python
from ultralytics import YOLO

def _train_sync(job, on_epoch_end):
    model = YOLO(job.base_model)
    model.add_callback("on_train_epoch_end", on_epoch_end)
    model.add_callback("on_train_end",       on_train_end)
    results = model.train(
        data=dataset.yaml_path,
        epochs=cfg["epochs"],
        imgsz=cfg["imgsz"],
        batch=cfg["batch"],
        device=resolve_device(cfg.get("device")),     # via app/core/device.py
        project=job.output_path,
        name="run",
        exist_ok=True,
    )
    return results
```

Wrapper appelé via `await asyncio.to_thread(_train_sync, …)`.
La callback `on_train_epoch_end` :
- met à jour `job.progress` et `job.metrics` en DB ;
- broadcast WS `training_{job_id}` avec `{type:"progress", epoch, total_epochs, metrics}`.

À la fin (success) :
- copie `runs/detect/run/weights/best.pt` vers `data/models/<job_name>_best.pt` ;
- crée une entrée `YoloModel` ;
- met `job.model_id` et `job.status="completed"`.

### 4.4 Annulation

`cancel(job_id)` : si le job est en queue, on le retire. S'il est en cours, on positionne un flag `_cancel_requested` et on lève une exception dans la callback `on_train_epoch_start` (clean stop).

### 4.5 Routes REST (`app/api/routes_training.py`)

```
GET    /api/datasets                 list
POST   /api/datasets                 upload zip
GET    /api/datasets/{id}            detail (+ validation report)
DELETE /api/datasets/{id}

GET    /api/training                 list jobs
POST   /api/training                 create + enqueue
GET    /api/training/{id}            detail
DELETE /api/training/{id}            cancel + delete
GET    /api/training/{id}/log        tail des logs ultralytics
GET    /api/training/base-models     liste des poids dispo (yolov8n/s/m/l/x, yolov11…)
GET    /api/training/device-info     {cuda_available, devices: [{name, memory_gb}]}
```

### 4.6 WebSocket

Réutilise `ws_manager` (déjà utilisé pour `workflow_{id}`).

Canal `training_{job_id}`. Types de messages :
- `{type:"progress", epoch, total_epochs, metrics:{box_loss, cls_loss, dfl_loss, map50, map5095}}`
- `{type:"status", status:"running"|"completed"|"failed"|"cancelled"}`
- `{type:"log", line:"…"}` (optionnel — capture stdout via un handler logging)
- `{type:"error", message}`

Route : `GET /ws/training/{job_id}` (analogue à `/ws/workflow/{id}`).

---

## 5. Frontend

### 5.1 Nouvelle page `TrainingPage`

Structure en 3 onglets internes (ou 3 cartes empilées) :

1. **Datasets**
   - Bouton "Import dataset (zip)" → upload + validation report
   - Liste : nom, nb images train/val, classes (chips), date
   - Suppression

2. **Training jobs**
   - Bouton "New training"
   - Tableau : nom, dataset, base model, status (badge coloré), progression (barre + epoch courant), mAP50 final, actions (View / Cancel / Delete)

3. **Détail job** (modal ou route `/training/:id`)
   - Header : nom, status, dataset, base model, durée
   - Charts Recharts : loss curves (box/cls/dfl) + mAP50 / mAP50-95 par epoch
   - Logs en bas (terminal-like, auto-scroll, capable de tail-follow via WS)
   - Bouton "Set as default model" / "Use in workflow" une fois `completed`

### 5.2 Formulaire "New training"

```
Name              [ ............................. ]
Dataset           [ ▼ select existant         ]
Base model        [ ▼ yolov8n.pt | yolov8s.pt | … ]
Epochs            [  50  ]
Image size        [ 640 ]
Batch size        [ -1 (auto) ]
Learning rate     [ 0.01 ]   (advanced collapse)
Device            [ ▼ auto | cuda:0 | cpu ]   (affiche les devices détectés)
```

Validation côté front : si CUDA absent et batch > 8, warning.

### 5.3 WebSocket hook

`useTrainingWs(jobId)` analogue à l'existant pour les workflows. Push dans state local pour les charts en temps réel.

### 5.4 Navigation

Ajouter `Training` dans la sidebar entre `Models` et `Events` (ou sous `Models`).

---

## 6. Types & schemas

### 6.1 Frontend `types/index.ts`

```ts
export interface Dataset {
  id: number; name: string; classes: string[];
  num_images: number; num_train: number; num_val: number;
  created_at: string;
}
export interface TrainingJob {
  id: number; name: string; dataset_id: number;
  base_model: string; status: 'queued'|'running'|'completed'|'failed'|'cancelled';
  config: Record<string, unknown>;
  progress: { epoch: number; total_epochs: number; metrics: Record<string, number> } | null;
  metrics: Array<{ epoch: number; [k: string]: number }>;
  model_id: number | null;
  error: string | null;
  started_at: string | null; finished_at: string | null; created_at: string;
}
```

### 6.2 Backend `schemas/training.py` & `schemas/dataset.py`

Pydantic `*Create`, `*Read`, `*Update` + `TrainingConfig` (epochs ≥ 1, imgsz multiple de 32, etc.).

---

## 7. Dépendances & infrastructure

- `ultralytics` est déjà dans `requirements.txt` ✅
- `roboflow/supervision` aussi ✅
- Ajouter `python-multipart` (déjà présent normalement pour les uploads existants)
- Vérifier `app/core/device.py` : exposer `list_devices()` (nom, VRAM dispo via `torch.cuda.mem_get_info`)
- Disque : prévoir 1–10 Go par run ; afficher l'espace libre dans le device-info endpoint

---

## 8. Découpage en phases

### Phase 1 — MVP fonctionnel ✅ (terminée)
- [x] Modèles `Dataset` + `TrainingJob` (créés via `Base.metadata.create_all` au boot)
- [x] `dataset_service.import_zip` + génération canonique de `data.yaml`
- [x] `training_service` avec worker FIFO unique, callbacks `on_train_epoch_end`, broadcast WS
- [x] Routes REST datasets + training (avec cancel + delete déjà inclus)
- [x] WS channel `/ws/training/{job_id}`
- [x] Worker démarré dans le `lifespan` FastAPI (relance des jobs queued, marque les running stale en failed)
- [x] TrainingPage : section datasets + section jobs + ligne dépliable avec progress bar et 4 métriques
- [x] Auto-register `best.pt` comme `YoloModel`
- [x] Endpoints `/training/base-models` et `/training/device-info` pour le formulaire

### Phase 2 — UX & observabilité ✅ (terminée)
- [x] Charts Recharts loss/mAP en live (`components/training/MetricsCharts.tsx`)
- [x] Capture des logs ultralytics — `WsLogHandler` attaché au logger `ultralytics`, persist dans `<output>/train.log` + broadcast WS
- [x] Endpoint `GET /api/training/{id}/log?tail=N` (tail du fichier)
- [x] `LogPanel` : fetch initial + append WS + follow auto-scroll
- [x] Validation détaillée du dataset — bouton **Validate** dans la liste, panneau dépliable avec errors/warnings
- [x] Cancel propre d'un job en cours (déjà fait Phase 1)
- [x] `device-info` endpoint + sélection device dans le form (déjà fait Phase 1)

### Phase 3 — Confort ✅ (terminée)
- [x] **Resume / transfer learning** : endpoint `GET /api/training/user-models` qui renvoie tous les `YoloModel` enregistrés. Le `<select>` du formulaire utilise `<optgroup>` pour séparer "Built-in" (yolov8n…yolo11m) et "Your models" (tous les modèles dispo, dont ceux auto-registered après chaque training précédent). Sélectionner un modèle entraîné = transfer learning à partir de ses propres poids.
- [x] **Compare runs** : bouton **Compare** dans la section jobs → mode sélection avec checkboxes → modal `CompareModal` qui overlay box_loss / cls_loss / mAP@.5 / mAP@.5-.95 avec une palette distincte par run + tableau de récap (epochs, final loss, best mAP).
- [x] **Capture from source** : bouton **From source** dans la section datasets → formulaire (Source, frames, interval, classes) → endpoint `POST /api/datasets/from-source` qui ouvre la source via OpenCV (réutilise `source_service._open_capture`), pioche N frames espacées de `interval_seconds`, crée `images/train/`, `labels/train/` (fichiers vides), `classes.txt` + `data.yaml` canonique. La validation détecte le cas "all labels empty" et warn l'utilisateur d'annoter externalement.
- [x] **Export ONNX / TorchScript** : endpoint `POST /api/training/{id}/export?format=onnx|torchscript` lance `ultralytics.YOLO(best.pt).export(format=…)` dans un thread, et `GET /api/training/{id}/export/download` sert le fichier produit en `FileResponse`. UI : `ExportButton` dans le JobDetail des jobs `completed` avec un select de format et un lien download après succès.

---

## 9. Risques & points à clarifier

1. **GPU et mémoire** : ultralytics télécharge les poids de base au premier run (`yolov8n.pt`…). Prévoir un endpoint qui pré-télécharge dans `data/ultralytics/` au boot ou à la demande, pour éviter un timeout HTTP au lancement du job.
2. **Thread safety SQLAlchemy** : la callback ultralytics tourne dans un thread worker, donc utiliser un `Session` synchrone dédié (`SessionLocal()`) à l'intérieur — pas le `AsyncSession` du request lifecycle.
3. **Annulation pendant `model.train()`** : ultralytics n'a pas d'API officielle d'annulation. Workaround : lever une exception custom dans `on_train_epoch_start` — ça stoppe la boucle mais peut laisser des fichiers partiels. À documenter.
4. **Concurrence** : un seul worker = pas de bug, mais l'UI doit afficher "queued" clairement quand un autre job tourne.
5. **Sécurité upload** : valider la taille du zip et le contenu (pas d'exécutable, paths relatifs uniquement).
6. **Annotation** : pas dans le scope. Recommander LabelStudio ou Roboflow dans la doc.

---

## 10. Checklist d'exécution

- [x] Phase 1 : DB models
- [x] Phase 1 : `dataset_service` (import zip + validation basique)
- [x] Phase 1 : `training_service` + worker + WS
- [x] Phase 1 : Routes REST (datasets, training, base-models, device-info)
- [x] Phase 1 : Frontend TrainingPage minimale (datasets + jobs + détail)
- [x] Phase 1 : Auto-register modèle final
- [x] Phase 1 : Cancel (basique — flag in-memory levé dans la callback)
- [x] Phase 1 : Device info endpoint
- [ ] **À tester** (à la fin du dev, demandé par l'utilisateur) :
  - [ ] Upload zip d'un dataset YOLO → vérifier que les classes/comptes apparaissent correctement
  - [ ] Lancer un mini training (1-2 epochs sur 50 images) → vérifier la progress bar live, les charts qui se remplissent, les logs qui tail
  - [ ] Vérifier que `best.pt` apparaît dans Models et dans le sélecteur "Your models" du nouveau form
  - [ ] Lancer un deuxième training en mode transfer-learning sur le modèle précédent
  - [ ] Activer le mode Compare, sélectionner 2 jobs → vérifier l'overlay
  - [ ] Exporter en ONNX → vérifier que le `.onnx` est téléchargeable
  - [ ] Créer un dataset From source (webcam ou vidéo) → vérifier les N images et le warning "all labels empty"
  - [ ] Tester l'annulation d'un job en cours
- [ ] Phase 1 : Doc utilisateur (format zip attendu)
- [x] Phase 2 : Charts Recharts (loss / mAP par epoch)
- [x] Phase 2 : Capture des logs ultralytics + tail WS + endpoint historique
- [x] Phase 2 : Validation détaillée du dataset (warnings/errors UI)
- [x] Phase 3 : Resume / transfer learning via optgroup `userModels`
- [x] Phase 3 : Compare runs (overlay 2+ courbes + tableau récap)
- [x] Phase 3 : Capture de frames depuis une Source pour créer un mini-dataset
- [x] Phase 3 : Export ONNX (+ TorchScript bonus) — TensorRT laissé hors scope (deps spécifiques)

---

## 11. Fichiers à créer / modifier (résumé)

**Backend**
- `app/db/models.py` (+ Dataset, TrainingJob)
- `app/schemas/dataset.py` (nouveau)
- `app/schemas/training.py` (nouveau)
- `app/services/dataset_service.py` (nouveau)
- `app/services/training_service.py` (nouveau)
- `app/api/routes_training.py` (nouveau)
- `app/api/routes_datasets.py` (nouveau)
- `app/api/routes_ws.py` (+ canal training)
- `app/core/device.py` (+ `list_devices()`)
- `app/main.py` (lifespan : start worker)

**Frontend**
- `src/pages/TrainingPage.tsx` (nouveau)
- `src/api/datasets.ts`, `src/api/training.ts` (nouveau)
- `src/hooks/useTrainingWs.ts` (nouveau)
- `src/types/index.ts` (+ Dataset, TrainingJob)
- `src/App.tsx` + sidebar (route + nav)
- `src/components/training/*` (DatasetTable, JobTable, JobDetail, NewJobForm, MetricsChart)
