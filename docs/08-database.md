# 08 — Base de données

## Base choisie

SQLite pour le MVP.

Objectif :

- simple ;
- local ;
- portable ;
- suffisant pour un prototype avancé ;
- facile à inspector ;
- facile à inspecter ;

## Tables principales

### sources

```
id
name
type
uri
enabled
fps_limit
created_at
updated_at
```

### workflows

```
id
name
description
enabled
created_at
updated_at
```

### workflow_nodes

```
id
workflow_id
node_id
type
label
position_x
position_y
config_json
```

### workflow_edges

```
id
workflow_id
source_node_id
source_handle
target_node_id
target_handle
```

### models

```
id
name
path
type
classes_json
created_at
updated_at
```

### zones

```
id
source_id
name
type
points_json
created_at
updated_at
```

### events

```
id
timestamp
source_id
workflow_id
class_name
confidence
tracker_id
zone_name
bbox_json
frame_path
metadata_json
```

### runs

```
id
workflow_id
source_id
status
started_at
stopped_at
error_message
```

## Règles DB

* Ajouter `created_at` et `updated_at` sur les tables principales.
* Stocker les configs de nodes en JSON.
* Stocker les bounding boxes en JSON.
* Stocker les points de zones en JSON.
* Garder SQLite pour le MVP.
* Prévoir Alembic plus tard, mais pas obligatoire au tout début.

## Événements

Un événement doit contenir assez d’informations pour être exploitable même après l’arrêt du workflow.

Informations importantes :

* timestamp ;
* source ;
* workflow ;
* classe ;
* confiance ;
* tracker_id si disponible ;
* zone ;
* bounding box ;
* chemin de frame si sauvegardée ;
* métadonnées.

## Sauvegarde des frames

La sauvegarde des frames doit être optionnelle.

Par défaut, prévoir :

* sauvegarde activable/désactivable ;
* chemin local ;
* suppression possible ;
* pas d’envoi cloud.
