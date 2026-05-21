# 06 — Intégration Roboflow Supervision

## Objectif

Le projet utilise `roboflow/supervision` comme couche computer vision backend.

Supervision sert à manipuler proprement les détections, annotations, zones et trackers.

Référence officielle :

Le code et les recommandations s'appuient sur le README du dépôt `roboflow/supervision`. Pour détails d'installation et dépendances, voir : https://raw.githubusercontent.com/roboflow/supervision/refs/heads/develop/README.md

## Supervision ne remplace pas la plateforme

Supervision n’est pas le backend complet.

Le projet garde :

- FastAPI ;
- React ;
- workflow engine ;
- WebSocket ;
- SQLite ;
- dashboard ;
- gestion des sources ;
- gestion des événements.

## Briques Supervision à utiliser

Utiliser en priorité :

```
sv.Detections
sv.Detections.from_ultralytics
sv.BoxAnnotator
sv.LabelAnnotator
sv.TraceAnnotator
sv.PolygonZone
sv.PolygonZoneAnnotator
sv.ByteTrack
sv.VideoInfo
sv.get_video_frames_generator
sv.DetectionDataset
```

## Pipeline recommandé

```
Frame OpenCV
  ↓
YOLO Ultralytics
  ↓
sv.Detections.from_ultralytics(...)
  ↓
sv.ByteTrack optionnel
  ↓
filtres classes / confiance / zones
  ↓
annotation avec Supervision
  ↓
conversion vers JSON interne
  ↓
WebSocket + SQLite
```

## Service dédié

Créer :

```
backend/app/services/supervision_service.py
```

Responsabilités :

* convertir Ultralytics vers `sv.Detections` ;
* convertir `sv.Detections` vers format JSON interne ;
* annoter les frames ;
* gérer `sv.PolygonZone` ;
* gérer `sv.ByteTrack`.

## Fonctions attendues

```python
def detections_from_ultralytics(result):
    pass


def detections_to_api_payload(detections, class_names):
    pass


def annotate_frame(frame, detections, options):
    pass


def filter_by_polygon_zone(detections, polygon, mode):
    pass


def create_tracker():
    pass
```

## Règle importante

Le code Supervision doit être centralisé.

Éviter de disperser des appels `sv.*` partout dans le backend.

Les nodes peuvent utiliser `supervision_service`, mais ne doivent pas chacun réimplémenter leur propre logique.

## Format JSON interne

Les objets `sv.Detections` ne doivent jamais être envoyés directement au frontend.

Format attendu :

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

## Zones

Les zones dessinées côté frontend sont stockées comme points JSON.

Exemple :

```json
{
  "name": "Parking",
  "type": "polygon",
  "points": [
    { "x": 100, "y": 120 },
    { "x": 400, "y": 120 },
    { "x": 420, "y": 300 },
    { "x": 80, "y": 280 }
  ]
}
```

Côté backend, ces points doivent être convertis en tableau utilisable par `sv.PolygonZone`.

## Tracking

Utiliser `sv.ByteTrack` pour attribuer des `tracker_id`.

Le tracking doit permettre :

* d’éviter les doublons d’événements ;
* d’appliquer des cooldowns par objet ;
* de préparer les futures fonctions de comptage ;
* de préparer le line crossing ;
* de préparer le dwell time.

## Annotation

Utiliser les annotateurs Supervision pour le MVP :

* boîtes ;
* labels ;
* confiance ;
* tracker_id ;
* zones.

Le frontend reçoit une frame annotée ou les métadonnées nécessaires pour dessiner lui-même les overlays.
