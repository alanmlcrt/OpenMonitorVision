# OpenMonitorVision

OpenMonitorVision est une plateforme locale de supervision vidéo/image basée sur des workflows visuels.

Objectif MVP :

1. Ajouter une source webcam ou vidéo locale.
2. Construire un workflow `Source -> YOLO Detect -> Tracker -> Confidence Filter -> Event Trigger -> Save Event -> Overlay`.
3. Lancer le workflow.
4. Voir le flux annoté en live.
5. Sauvegarder les événements en SQLite.
6. Consulter les événements et statistiques simples dans la WebUI.

Tant que ce scénario n'est pas fiable, les fonctions avancées comme training, MQTT, notifications ou multi-cam restent secondaires.

## Stack

Backend :

- Python 3.12
- FastAPI
- SQLite / SQLAlchemy / aiosqlite
- OpenCV
- PyTorch
- Ultralytics YOLO
- Roboflow Supervision
- WebSockets

Frontend :

- React
- TypeScript
- Vite
- Tailwind CSS
- React Flow
- Recharts

## Setup Local Automatisé

Prérequis :

- Python 3.12.x accessible via `py -3.12`, `python` ou `python3.12`.
- Node.js LTS avec `npm`.

Premier setup ou mise à jour :

```powershell
.\setup.ps1
```

Recréer le venv backend s'il est cassé ou utilise une mauvaise version de Python :

```powershell
.\setup.ps1 -BackendOnly -RecreateBackendVenv
```

Installer les dépendances de test backend :

```powershell
backend\venv\Scripts\python.exe -m pip install -r backend\requirements-dev.txt
```

Lancer les serveurs :

```powershell
.\start-backend.ps1
.\start-frontend.ps1
```

URLs locales :

- API : http://127.0.0.1:8000
- API docs : http://127.0.0.1:8000/docs
- WebUI : http://127.0.0.1:5173

## Validation

Backend :

```powershell
cd backend
$env:TEMP="$PWD\.tmp"; $env:TMP=$env:TEMP; $env:TMPDIR=$env:TEMP
.\venv\Scripts\python.exe -m compileall app tests
.\venv\Scripts\python.exe -m pytest tests -q --basetemp=.tmp\pytest -p no:cacheprovider
```

Frontend :

```powershell
cd frontend
npx tsc --noEmit
npm run build
```

Note Windows/sandbox : si Vite/esbuild échoue avec `Cannot read directory "../../../.."`, relancer le build hors sandbox. Ce symptôme vient de l'environnement d'exécution, pas du code frontend.

## Workflow MVP

1. Ouvrir **Sources** et ajouter une webcam (`0`) ou un fichier vidéo local.
2. Cliquer **Test** pour vérifier que la source renvoie des dimensions.
3. Ouvrir **Workflows** et créer la chaîne MVP :
   `Source -> YOLO Detect -> Tracker -> Confidence Filter -> Event Trigger -> Save Event -> Overlay`.
4. Configurer le node `Source` avec la source créée.
5. Configurer le node `YOLO Detect` avec un modèle local `.pt` ou le modèle par défaut.
6. Sauvegarder le workflow.
7. Ouvrir **Live**, sélectionner le workflow, cliquer **Start**.
8. Vérifier que le flux annoté et les détections apparaissent.
9. Ouvrir **Events** pour consulter les événements, snapshots et filtres.
10. Ouvrir **Overview** pour vérifier les statistiques.

## Données Locales

Les fichiers générés restent sous `backend/data/` :

- `db/` : SQLite ;
- `models/` : poids YOLO ;
- `uploads/` : vidéos/images locales ;
- `exports/` : snapshots d'événements ;
- `datasets/` : datasets YOLO ;
- `training_runs/` : sorties d'entraînement ;
- `ultralytics/` : configuration locale Ultralytics.

Ces dossiers sont ignorés par Git.

## Documentation

La documentation projet est dans `docs/`.

Fichiers principaux :

- `AGENTS.md`
- `docs/01-product-vision.md`
- `docs/02-architecture.md`
- `docs/05-workflow-engine.md`
- `docs/06-supervision-integration.md`
- `docs/07-api.md`
- `docs/10-development-rules.md`
- `docs/progress/`

UI : viser un rendu propre et minimal inspiré par OpenChamber, avec une navigation claire et des composants réutilisables.
