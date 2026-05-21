# 03 — Backend

## Stack backend

- Python 3.11+
- FastAPI
- Pydantic
- SQLAlchemy
- SQLite / aiosqlite
- OpenCV
- PyTorch
- Ultralytics
- Supervision
- Uvicorn
- WebSockets

## Structure backend

```
backend/
├── app/
│   ├── main.py
│   ├── core/
│   │   ├── config.py
│   │   ├── device.py
│   │   └── logging.py
│   │
│   ├── api/
│   │   ├── routes_sources.py
│   │   ├── routes_workflows.py
│   │   ├── routes_events.py
│   │   ├── routes_models.py
│   │   ├── routes_zones.py
│   │   └── routes_ws.py
│   │
│   ├── db/
│   │   ├── database.py
│   │   └── models.py
│   │
│   ├── schemas/
│   ├── services/
│   ├── engine/
│   └── runtime/
│
└── data/
    ├── db/
    ├── models/
    ├── uploads/
    ├── datasets/
    └── exports/
```

## Device CUDA/CPU

L’inférence doit utiliser CUDA si disponible.

Créer :

```
backend/app/core/device.py
```

Contenu attendu :

```python
import torch


def get_best_device() -> str:
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


def get_device_info() -> dict:
    if torch.cuda.is_available():
        return {
            "device": "cuda",
            "cuda_available": True,
            "gpu_name": torch.cuda.get_device_name(0),
            "gpu_count": torch.cuda.device_count(),
        }

    return {
        "device": "cpu",
        "cuda_available": False,
        "gpu_name": None,
        "gpu_count": 0,
    }
```

Cette logique ne doit pas être dupliquée ailleurs.

Référence stack Supervision :

Ce projet s'appuie sur la stack Python et les conventions de Roboflow Supervision. Consultez le README officiel pour les versions recommandées des dépendances et instructions d'installation : https://raw.githubusercontent.com/roboflow/supervision/refs/heads/develop/README.md

## Services attendus

### `source_service.py`

Responsabilités :

* créer/modifier/supprimer des sources ;
* tester une source ;
* récupérer une frame de preview ;
* valider une URI.

### `inference_service.py`

Responsabilités :

* charger les modèles YOLO ;
* cacher les modèles ;
* sélectionner le device ;
* lancer l’inférence ;
* retourner les résultats bruts vers `supervision_service`.

### `supervision_service.py`

Responsabilités :

* convertir Ultralytics vers `sv.Detections` ;
* annoter les frames ;
* gérer les zones ;
* gérer ByteTrack ;
* convertir les détections vers JSON interne.

### `workflow_service.py`

Responsabilités :

* créer/modifier/supprimer des workflows ;
* sauvegarder les nodes et edges ;
* valider un workflow ;
* lancer/arrêter un workflow via le runtime.

### `event_service.py`

Responsabilités :

* créer les événements ;
* les sauvegarder en SQLite ;
* les filtrer ;
* produire des statistiques.

### `overlay_service.py`

Responsabilités :

* préparer les overlays ;
* gérer l’affichage des bounding boxes ;
* gérer labels, confidence, tracker_id, zones.

## Format interne des détections

```json
{
  "detections": [
    {
      "class_id": 2,
      "class_name": "car",
      "confidence": 0.87,
      "tracker_id": 15,
      "bbox": {
        "x1": 120,
        "y1": 80,
        "x2": 300,
        "y2": 240
      },
      "zone_name": "Parking"
    }
  ]
}
```

## Règle importante

Ne jamais envoyer directement les objets Ultralytics, OpenCV, Supervision ou SQLAlchemy au frontend.
