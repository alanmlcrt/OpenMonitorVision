# 07 — API REST et WebSocket

Cette page décrit le contrat API actuellement exposé par le backend FastAPI.

Base URL locale :

```text
http://127.0.0.1:8000/api
```

Documentation interactive :

```text
http://127.0.0.1:8000/docs
```

## Health

```text
GET /api/health
```

Réponse attendue :

- statut applicatif ;
- device d'inférence (`cpu` ou `cuda`) ;
- workflows en cours et statistiques runtime ;
- job training courant si présent.

## Sources

```text
GET    /api/sources
POST   /api/sources
GET    /api/sources/{source_id}
PATCH  /api/sources/{source_id}
DELETE /api/sources/{source_id}
GET    /api/sources/{source_id}/test
GET    /api/sources/{source_id}/preview
```

Types supportés :

- `webcam`
- `video`
- `rtsp`
- `image`
- `stream`
- `ip_camera`
- `image_url`
- `image_folder`

## Workflows

```text
GET    /api/workflows
POST   /api/workflows
POST   /api/workflows/validate
GET    /api/workflows/{workflow_id}
PATCH  /api/workflows/{workflow_id}
DELETE /api/workflows/{workflow_id}
GET    /api/workflows/{workflow_id}/export
POST   /api/workflows/import
POST   /api/workflows/{workflow_id}/start
POST   /api/workflows/{workflow_id}/stop
GET    /api/workflows/{workflow_id}/status
```

Le endpoint `status` renvoie `running` et les stats runtime connues (`source_id`, `started_at`, `frames_total`, `last_frame_at`, `fps_smoothed`).

## Events

```text
GET    /api/events
GET    /api/events/stats
DELETE /api/events
POST   /api/events/cleanup-frames
GET    /api/events/{event_id}
GET    /api/events/{event_id}/frame
DELETE /api/events/{event_id}
```

Filtres de liste supportés :

- `source_id`
- `workflow_id`
- `class_name`
- `min_confidence`
- `since`
- `until`
- `limit`
- `offset`

## Models

```text
GET    /api/models
POST   /api/models
DELETE /api/models/{model_id}
GET    /api/models/default
```

Les uploads de modèles sont limités aux extensions `.pt` et `.onnx`. Les chemins et noms de fichiers sont normalisés côté backend.

## Datasets

```text
GET    /api/datasets
POST   /api/datasets
POST   /api/datasets/from-source
POST   /api/datasets/from-folder
GET    /api/datasets/{dataset_id}
GET    /api/datasets/{dataset_id}/validate
DELETE /api/datasets/{dataset_id}
GET    /api/datasets/{dataset_id}/images
GET    /api/datasets/{dataset_id}/image
GET    /api/datasets/{dataset_id}/label
PUT    /api/datasets/{dataset_id}/label
```

Les endpoints d'image/label refusent les stems avec chemin ou traversal. La suppression d'un dataset ne supprime un dossier que s'il reste sous `settings.datasets_dir`.

## Training

```text
GET    /api/training/base-models
GET    /api/training/user-models
GET    /api/training/device-info
GET    /api/training
POST   /api/training
GET    /api/training/{job_id}
GET    /api/training/{job_id}/log
POST   /api/training/{job_id}/cancel
DELETE /api/training/{job_id}
POST   /api/training/{job_id}/export
GET    /api/training/{job_id}/export/download
```

Le training est une fonctionnalité hors MVP de supervision. Il doit rester secondaire tant que le scénario live/events/stats n'est pas stable.

## MQTT

```text
GET    /api/mqtt/brokers
POST   /api/mqtt/brokers
GET    /api/mqtt/brokers/{broker_id}
PATCH  /api/mqtt/brokers/{broker_id}
DELETE /api/mqtt/brokers/{broker_id}
POST   /api/mqtt/brokers/{broker_id}/test
```

Le cache client MQTT est invalidé après update/delete d'un broker.

## WebSockets

```text
WS /ws/workflow/{workflow_id}
WS /ws/training/{job_id}
```

Message frame workflow :

```json
{
  "type": "frame",
  "frame": "...base64 jpeg...",
  "detections": [
    {
      "class_id": 0,
      "class_name": "person",
      "confidence": 0.91,
      "tracker_id": 1,
      "bbox": {
        "x1": 100.0,
        "y1": 80.0,
        "x2": 260.0,
        "y2": 210.0
      },
      "zone_name": null
    }
  ],
  "events": []
}
```

## Règles API

- Les routes retournent des schémas Pydantic ou des types JSON simples.
- Ne jamais exposer directement des objets OpenCV, Ultralytics, Supervision ou SQLAlchemy.
- Les endpoints fichiers doivent borner les chemins sous les dossiers `backend/data/*` prévus.
- Les erreurs doivent être explicites et testables.
