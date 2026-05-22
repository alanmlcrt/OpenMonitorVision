# OpenMonitorVision

## Setup local automatise

Prerequis:

- Python 3.12.x installe et accessible via `py -3.12`, `python`, ou `python3.12`.
- Node.js LTS avec `npm`.

Premier setup complet:

```powershell
.\setup.ps1
```

Relancer le setup si le projet est deja installe:

```powershell
.\setup.ps1
```

Le script compare les fichiers de dependances avec un stamp local et reinstalle seulement si necessaire.

Forcer une reinstallation des dependances:

```powershell
.\setup.ps1 -ForceInstall
```

Recreer le venv backend quand il est casse ou cree avec une mauvaise version de Python:

```powershell
.\setup.ps1 -BackendOnly -RecreateBackendVenv
```

Lancer les serveurs:

```powershell
.\start-backend.ps1
.\start-frontend.ps1
```

Les scripts `start-*` appellent le setup automatiquement. Pour demarrer sans verification:

```powershell
.\start-backend.ps1 -SkipSetup
.\start-frontend.ps1 -SkipSetup
```

Plateforme locale de supervision vidéo/image basée sur des workflows visuels.

## Démarrage rapide

### Backend

```powershell
cd backend
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

API docs: http://localhost:8000/docs

### Frontend

```powershell
cd frontend
npm install
npm run dev
```

UI: http://localhost:5173

### Workflow MVP

1. **Sources** → ajouter une webcam (index `0`) ou un fichier vidéo
2. **Workflows** → créer un workflow avec les nodes: Source → YOLO Detect → Tracker → Confidence Filter → Event Trigger → Save Event → Overlay → connecter et sauvegarder
3. **Live** → sélectionner le workflow → Start
4. **Events** → consulter les événements détectés

---

## Objectif

Créer une plateforme bac à sable permettant de :

- brancher des sources vidéo ou image ;
- créer des workflows par nodes ;
- détecter des objets avec YOLO ;
- utiliser certaines briques de Roboflow Supervision ;
- déclencher des événements ;
- sauvegarder les événements en SQLite ;
- afficher les flux annotés en temps réel ;
- générer des statistiques.

## Stack

Backend :

- Python
- FastAPI
- SQLite
- OpenCV
- PyTorch
- Ultralytics
- Supervision

Note: La stack Python s'appuie sur Roboflow Supervision — voir https://raw.githubusercontent.com/roboflow/supervision/refs/heads/develop/README.md pour les dépendances recommandées et instructions d'installation. L'inférence privilégie CUDA si disponible.

Frontend :

- React
- TypeScript
- Vite
- Tailwind CSS
- React Flow
- Konva
- Recharts

## Lancement backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Sous Windows PowerShell :

```powershell
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload
```

## Lancement frontend

```bash
cd frontend
npm install
npm run dev
```

## Documentation

La documentation projet est dans `/docs`.

Le fichier principal pour les agents IA est `AGENTS.md`.

UI : l'interface doit viser un rendu propre et minimal inspiré par OpenChamber (dashboard sobre, navigation latérale, composants clairs). Utiliser Tailwind CSS pour la cohérence visuelle.
