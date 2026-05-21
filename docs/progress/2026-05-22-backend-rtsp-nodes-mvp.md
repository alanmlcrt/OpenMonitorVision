# Progression - 2026-05-22 - Backend, RTSP, nodes MVP

## Actions realisees

- Correction du demarrage backend qui pouvait echouer des l'import a cause d'Ultralytics essayant d'ecrire dans `AppData/Roaming`.
- Ajout d'un dossier de config Ultralytics local dans `backend/data/ultralytics`.
- Chargement YOLO rendu paresseux: le backend peut demarrer sans importer Ultralytics tant qu'aucune inference n'est lancee.
- Correction de la lecture des nodes React Flow cote backend: le runtime utilise maintenant `node.data.type` avant `node.type`.
- Correction du node YOLO pour prendre en compte `device` (`auto`, `cuda`, `cpu`).
- Durcissement des sources RTSP OpenCV: backend FFMPEG, transport TCP, timeouts d'ouverture/lecture, lecture avec retry court.
- Les routes de test/preview source executent la capture dans un thread pour ne pas bloquer la boucle FastAPI.
- Le lancement d'un workflow verifie que la source existe, est active, et qu'une frame peut etre lue.
- Le stream manager tente de rouvrir la source en cas de frame vide ou de deconnexion.
- Le node `Save Event` sauvegarde la frame annotee si disponible, sinon la frame brute.
- Le node `Event Trigger` gere le cooldown global et l'option `trigger_once_per_object`.
- Amelioration du Workflow Builder:
  - nodes visuels dedies React Flow;
  - bouton `Build MVP chain`;
  - panneau de configuration lateral;
  - configuration Source, YOLO, device, tracker, filtres, event trigger, save event, overlay;
  - selection de sources et modeles depuis l'API.
- Vite proxy pointe maintenant explicitement vers `127.0.0.1:8000` pour eviter les ambiguities `localhost` IPv4/IPv6.
- `start-backend.ps1` detecte un venv casse et le recree au lieu de rester sur un Python invalide.

## Fichiers modifies

- `backend/app/core/config.py`
- `backend/app/db/database.py`
- `backend/app/services/inference_service.py`
- `backend/app/services/source_service.py`
- `backend/app/runtime/stream_manager.py`
- `backend/app/api/routes_sources.py`
- `backend/app/api/routes_workflows.py`
- `backend/app/engine/workflow_engine.py`
- `backend/app/engine/nodes/yolo_detect_node.py`
- `backend/app/engine/nodes/event_trigger_node.py`
- `backend/app/engine/nodes/save_event_node.py`
- `frontend/src/pages/WorkflowBuilderPage.tsx`
- `frontend/vite.config.ts`
- `.gitignore`
- `start-backend.ps1`
- `docs/progress/2026-05-22-backend-rtsp-nodes-mvp.md`
- `claude.md`

## Commandes executees

- `npm.cmd run build`
- `python -m compileall app`
- `Invoke-RestMethod http://127.0.0.1:8000/api/health`
- `Invoke-RestMethod http://127.0.0.1:8000/api/workflows`
- `Invoke-RestMethod http://127.0.0.1:8000/api/events?limit=50`
- `Invoke-RestMethod http://127.0.0.1:8000/api/events/stats`
- `Invoke-RestMethod http://127.0.0.1:8000/api/models`
- `Invoke-RestMethod http://127.0.0.1:8000/api/sources`
- `Invoke-RestMethod http://127.0.0.1:5173/api/health`
- Creation API d'une source RTSP de test.
- Test API de la source RTSP fournie.
- Creation d'une video locale synthetique `backend/data/uploads/sample_video.avi`.
- Creation API d'une source video locale de test.
- Test API de la source video locale.
- Creation/demarrage/arret API d'un workflow smoke test RTSP.

## Resultats verifies

- Backend FastAPI joignable sur `http://127.0.0.1:8000`.
- Proxy Vite joignable sur `http://127.0.0.1:5173/api/health`.
- Routes verifiees: `/api/health`, `/api/workflows`, `/api/events`, `/api/events/stats`, `/api/models`, `/api/sources`.
- RTSP fourni verifie:
  - URL: `rtsp://9627b0bf2a7b.entrypoint.cloud.wowza.com:1935/app-p5260J38/66abe4b9_stream1`
  - resultat: `ok: true`, `width: 854`, `height: 480`, `fps: 30.0`, backend `opencv`.
- Preview RTSP verifiee: frame JPEG base64 retournee.
- Video locale verifiee:
  - `ok: true`, `width: 320`, `height: 240`, `fps: 10.0`, backend `opencv`.
- Workflow RTSP minimal verifie:
  - `start: started`
  - `running_after_start: true`
  - `stop: stopped`
- Build frontend OK.
- Compilation Python backend OK.

## Checklist MVP

- [x] Backend FastAPI demarre sans crash d'import Ultralytics.
- [x] API REST de base disponible: health, sources, workflows, events, stats, models.
- [x] SQLite initialise et accessible.
- [x] Ajout source RTSP via API.
- [x] Test source RTSP via OpenCV.
- [x] Preview source RTSP.
- [x] Ajout source video locale via API.
- [x] Test source video locale.
- [x] Workflow builder avec chain MVP rapide.
- [x] Nodes configurables: Source, YOLO, Tracker, Class Filter, Confidence Filter, Event Trigger, Save Event, Overlay.
- [x] Backend lit correctement les types de nodes React Flow depuis `data.type`.
- [x] Selection CUDA/CPU centralisee dans `backend/app/core/device.py`.
- [x] YOLO node accepte `device: auto | cuda | cpu`.
- [x] Fallback CPU verifie dans cet environnement (`cuda_available: false`).
- [x] Sauvegarde events en SQLite implementee via `SaveEventNode`.
- [x] Liste events et stats exposees par API.
- [x] Live stream WebSocket implemente.
- [x] Overlay Supervision implemente pour boxes/labels/confidence/tracker id.
- [ ] Verifier inference YOLO de bout en bout sur machine avec modele disponible localement.
- [ ] Verifier CUDA sur machine equipee NVIDIA avec build PyTorch CUDA.
- [ ] Ajouter une route/API de validation workflow avant sauvegarde.
- [ ] Ajouter gestion UI explicite des erreurs de demarrage workflow/source.
- [ ] Ajouter nettoyage ou rotation des frames exportees.
- [ ] Ajouter suppression/maintenance des events sauvegardes.
- [ ] Ajouter Zone Filter backend + UI zones polygonales.
- [ ] Ajouter tests automatises backend pour sources/workflows/events.
- [ ] Ajouter tests UI ou smoke Playwright pour le workflow builder/live view.
- [ ] Optimiser bundle frontend par code splitting si necessaire.

## Notes de progression

- Le venv local existant etait casse dans cet environnement: `backend/venv/Scripts/python.exe` pointait vers un Python utilisateur absent.
- Le systeme n'exposait pas `python` ni `py` sur le PATH dans la session agent; les tests backend ont ete lances avec le Python embarque Codex et les paquets du venv existant via `PYTHONPATH`.
- Le backend et Vite ont ete lances localement pour verification.
