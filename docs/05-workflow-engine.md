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

## Nodes conditionnels avances

Ces nodes permettent de couvrir des scenarios du type : "si une voiture verte
passe en Zone 1 puis en Zone 2, enregistrer l'evenement".

### Color Filter Node

Filtre les detections selon la couleur dominante dans le crop de la bounding box.

Config :

```json
{
  "target_color": "green",
  "min_color_ratio": 0.12,
  "min_saturation": 40,
  "min_value": 40,
  "bbox_padding_px": 0
}
```

Le node ajoute aussi des metadonnees JSON propres aux detections conservees :

```json
{
  "color_name": "green",
  "color_ratio": 0.42
}
```

### Zone Sequence Trigger Node

Declenche un event quand un meme objet tracke visite plusieurs zones dans
l'ordre configure. Il necessite un `Tracker` en amont.

Config :

```json
{
  "zones": [
    { "name": "Zone 1", "points": [[0, 0], [200, 0], [200, 200], [0, 200]] },
    { "name": "Zone 2", "points": [[300, 0], [500, 0], [500, 200], [300, 200]] }
  ],
  "sequence": ["Zone 1", "Zone 2"],
  "max_seconds_between_zones": 30,
  "cooldown_seconds": 0,
  "trigger_once_per_object": true,
  "anchor": "bottom_center"
}
```

Workflow type :

```text
Source
  -> YOLO Detection
  -> Tracker
  -> Class Filter (car)
  -> Confidence Filter
  -> Color Filter (green)
  -> Zone Sequence Trigger (Zone 1 -> Zone 2)
  -> Save Event
  -> Overlay
```

## Nodes satellite / geospatiaux

Ces nodes permettent de traiter un flux base sur des images satellite ou des
items STAC, avec une logique de zone geographique plutot qu'une zone image.

### Satellite Scene Node

Charge une scene satellite deja enregistree en base et expose ses metadonnees
dans le contexte du workflow.

Config :

```json
{
  "scene_id": 1
}
```

Le node ajoute notamment `satellite_scene` dans les metadonnees du contexte,
avec l'identifiant externe, la mission, la date d'acquisition, le bbox, le
footprint, les assets et les metadonnees fournisseur.

### Geo Zone Trigger Node

Declenche un evenement si la scene satellite intersecte une ou plusieurs zones
geographiques configurees.

Config :

```json
{
  "areas": [
    {
      "id": 1,
      "name": "Port",
      "bbox": [2.20, 48.80, 2.45, 48.95]
    }
  ],
  "max_cloud_cover": 35,
  "event_class": "satellite_scene"
}
```

Workflow type :

```text
Satellite Scene
  -> Geo Zone Trigger
  -> Save Event
```

Ce scenario complete le monitoring video : il permet de surveiller des zones
geographiques a partir de scenes STAC / satellite et d'enregistrer les
evenements geolocalises dans la meme table d'evenements que le reste de la
plateforme.

## Règles

* Un node fait une seule chose.
* Ne pas créer un node géant qui fait tout.
* Le workflow engine orchestre, mais ne contient pas toute la logique métier.
* Les nodes peuvent appeler les services backend.
* Le format de sortie entre nodes doit rester stable.
