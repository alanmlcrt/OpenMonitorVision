# 05 — Workflow Engine

## Objectif

Le workflow engine exécute les workflows créés dans l’interface React Flow.

Un workflow est un graphe orienté composé de nodes connectés entre eux.

Exemple :

```
Source
  ↓
YOLO Detection
  ↓
Tracker
  ↓
Class Filter
  ↓
Confidence Filter
  ↓
Zone Filter
  ↓
Event Trigger
  ↓
Save Event
  ↓
Overlay
```

## Principe MVP

Pour le MVP, l’exécution peut être simple et séquentielle.

Chaque frame passe dans les nodes dans l’ordre.

Pas besoin d’optimisation complexe au départ.

## Structure attendue

```
backend/app/engine/
├── workflow_engine.py
├── workflow_context.py
├── node_registry.py
├── base_node.py
└── nodes/
    ├── source_node.py
    ├── yolo_detect_node.py
    ├── tracker_node.py
    ├── class_filter_node.py
    ├── confidence_filter_node.py
    ├── zone_filter_node.py
    ├── event_trigger_node.py
    ├── save_event_node.py
    └── overlay_node.py
```

## Interface commune des nodes

Chaque node doit respecter une interface similaire :

```python
class BaseNode:
    type: str

    def validate_config(self, config: dict) -> None:
        pass

    async def run(self, context, input_data: dict) -> dict:
        pass
```

## Node Registry

Créer un registre central :

```python
NODE_REGISTRY = {
    "source": SourceNode,
    "yolo_detect": YoloDetectNode,
    "tracker": TrackerNode,
    "class_filter": ClassFilterNode,
    "confidence_filter": ConfidenceFilterNode,
    "zone_filter": ZoneFilterNode,
    "event_trigger": EventTriggerNode,
    "save_event": SaveEventNode,
    "overlay": OverlayNode,
}
```

## Nodes MVP

### Source Node

Sélectionne une source vidéo/image.

Config :

```json
{
  "source_id": 1
}
```

### YOLO Detection Node

Applique un modèle YOLO.

Config :

```json
{
  "model_id": 1,
  "confidence": 0.25,
  "iou": 0.7,
  "device": "auto"
}
```

### Tracker Node

Utilise `sv.ByteTrack`.

Config :

```json
{
  "enabled": true,
  "tracker": "bytetrack"
}
```

### Class Filter Node

Filtre par classe.

Config :

```json
{
  "classes": ["person", "car"]
}
```

### Confidence Filter Node

Filtre par confiance.

Config :

```json
{
  "min_confidence": 0.6
}
```

### Zone Filter Node

Filtre par zone.

Config :

```json
{
  "zone_ids": [1, 2],
  "mode": "bottom_center_inside"
}
```

### Event Trigger Node

Crée des événements selon des conditions.

Config :

```json
{
  "cooldown_seconds": 5,
  "trigger_once_per_object": false
}
```

### Save Event Node

Sauvegarde les événements en SQLite.

Config :

```json
{
  "save_frame": true,
  "save_metadata": true
}
```

### Overlay Node

Prépare les annotations visuelles.

Config :

```json
{
  "show_boxes": true,
  "show_labels": true,
  "show_confidence": true,
  "show_tracker_id": true,
  "show_zones": true
}
```

## Règles

* Un node fait une seule chose.
* Ne pas créer un node géant qui fait tout.
* Le workflow engine orchestre, mais ne contient pas toute la logique métier.
* Les nodes peuvent appeler les services backend.
* Le format de sortie entre nodes doit rester stable.
