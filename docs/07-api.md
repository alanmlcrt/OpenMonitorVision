# 07 — API REST et WebSocket

## API REST

### Sources

```
GET    /api/sources
POST   /api/sources
GET    /api/sources/{id}
PUT    /api/sources/{id}
DELETE /api/sources/{id}
POST   /api/sources/{id}/test
```

### Workflows

```
GET    /api/workflows
POST   /api/workflows
GET    /api/workflows/{id}
PUT    /api/workflows/{id}
DELETE /api/workflows/{id}
POST   /api/workflows/{id}/validate
POST   /api/workflows/{id}/start
POST   /api/workflows/{id}/stop
```

### Events

```
GET    /api/events
GET    /api/events/{id}
GET    /api/events/stats/summary
GET    /api/events/stats/by-class
GET    /api/events/stats/by-source
GET    /api/events/stats/timeline
GET    /api/events/export.csv
```

### Models

```
GET    /api/models
POST   /api/models
GET    /api/models/{id}
DELETE /api/models/{id}
POST   /api/models/{id}/test
```

### Zones

```
GET    /api/sources/{source_id}/zones
POST   /api/sources/{source_id}/zones
PUT    /api/zones/{id}
DELETE /api/zones/{id}
```

## WebSockets

Canaux proposés :

```
/ws/live/{source_id}
/ws/events
/ws/workflows/{workflow_id}/status
```

## Message WebSocket frame

```json
{
  "type": "frame",
  "source_id": 1,
  "timestamp": "2026-05-21T14:00:00Z",
  "image_jpeg_base64": "...",
  "detections": [
    {
      "class_name": "car",
      "confidence": 0.91,
      "tracker_id": 12,
      "bbox": {
        "x1": 100,
        "y1": 80,
        "x2": 260,
        "y2": 210
      },
      "zone": "parking"
    }
  ]
}
```

## Message WebSocket event

```json
{
  "type": "event",
  "event": {
    "id": 42,
    "timestamp": "2026-05-21T14:00:00Z",
    "source_id": 1,
    "workflow_id": 3,
    "class_name": "car",
    "confidence": 0.91,
    "tracker_id": 12,
    "zone_name": "parking"
  }
}
```

## Message WebSocket workflow status

```json
{
  "type": "workflow_status",
  "workflow_id": 3,
  "status": "running",
  "fps": 12.4,
  "last_error": null
}
```

## Règles API

* Les routes doivent utiliser des schémas Pydantic.
* Ne pas retourner des objets SQLAlchemy bruts.
* Ne pas retourner des objets Supervision bruts.
* Les erreurs doivent être explicites.
* Les endpoints doivent être simples à tester.
