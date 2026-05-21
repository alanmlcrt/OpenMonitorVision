# 02 — Architecture

## Vue globale

Le projet est séparé en deux grandes parties :

- backend FastAPI ;
- frontend React.

Le backend gère :

- les sources vidéo ;
- les modèles YOLO ;
- Supervision ;
- le workflow engine ;
- le runtime temps réel ;
- les événements ;
- SQLite ;
- les WebSockets.

Le frontend gère :

- l’interface utilisateur ;
- le workflow builder ;
- le live view ;
- le dashboard ;
- les pages de gestion.

## Structure recommandée

```
local-vision-sandbox/
│
├── backend/
│   ├── app/
│   │   ├── main.py
│   │   ├── core/
│   │   ├── api/
│   │   ├── db/
│   │   ├── schemas/
│   │   ├── services/
│   │   ├── engine/
│   │   └── runtime/
│   │
│   └── data/
│       ├── db/
│       ├── models/
│       ├── uploads/
│       ├── datasets/
│       └── exports/
│
├── frontend/
│   └── src/
│       ├── api/
│       ├── components/
│       ├── pages/
│       ├── features/
│       ├── hooks/
│       ├── stores/
│       ├── types/
│       └── utils/
│
├── docs/
├── AGENTS.md
├── CLAUDE.md
└── README.md
```

## Pipeline backend

```
Source vidéo
  ↓
Frame OpenCV
  ↓
Workflow Runner
  ↓
YOLO Node
  ↓
Supervision Service
  ↓
Filters / Zones / Tracker
  ↓
Events
  ↓
SQLite + WebSocket
```

## Principe d’architecture

Les routes FastAPI ne doivent pas contenir de logique métier.

Structure attendue :

```
routes → services → engine/runtime → db
```

## Modules backend principaux

* `core/` : configuration, logging, device CUDA/CPU.
* `api/` : endpoints REST et WebSocket.
* `db/` : configuration SQLite et modèles SQLAlchemy.
* `schemas/` : schémas Pydantic.
* `services/` : logique métier.
* `engine/` : workflow engine et nodes.
* `runtime/` : exécution temps réel, stream manager, WebSocket manager.

## Modules frontend principaux

* `pages/` : pages principales.
* `features/` : logique par domaine.
* `components/` : composants réutilisables.
* `api/` : appels backend.
* `types/` : types TypeScript partagés.
* `stores/` : état global.
