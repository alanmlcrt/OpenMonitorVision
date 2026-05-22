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
- Ajout d'un editeur polygonal visuel pour le node `Zone Filter` dans l'inspector:
  - creation/suppression de zones;
  - ajout de points sur canvas SVG;
  - deplacement des points;
  - suppression d'un point par double-clic;
  - affichage des coordonnees exportees au format attendu par le backend.
- Correction TypeScript du helper d'icones SVG `NodeIcon`.
- Typage generique de `api.delete<T>()` pour les endpoints qui retournent un payload JSON.
- Imports OpenCV/Supervision rendus paresseux dans les services/runtime/nodes afin que l'API et les tests puissent demarrer sans stack vision complete.
- Tests backend automatises relances avec dependances API legeres temporaires: 31 tests OK.
- Code splitting frontend complete: `DashboardPage` est aussi chargee en lazy route; le warning Vite de chunk > 500 kB disparait.
- `backend/requirements-test.txt` allege: plus de dependance OpenCV/Supervision pour la suite API.
- LiveView projette maintenant les zones du workflow selectionne sur le flux et permet leur edition/sauvegarde.
- Smoke UI Playwright CLI effectue sur Vite local: `/workflows` et `/live` chargent, les surfaces `Add node` et `Zones` sont visibles.
- `AGENTS.md` precise maintenant qu'a chaque debut de session l'agent doit faire le point sur les plans, fusionner les doublons et remplacer les plans quasi termines par une synthese propre.
- Vite proxy pointe maintenant explicitement vers `127.0.0.1:8000` pour eviter les ambiguities `localhost` IPv4/IPv6.
- `start-backend.ps1` detecte un venv casse et le recree au lieu de rester sur un Python invalide.
- Ajout d'un setup local automatise et relancable:
  - `setup.ps1` installe backend + frontend par defaut;
  - Python backend verrouille sur Python 3.12.x;
  - recreation automatique du venv backend si la version Python est incorrecte;
  - stamps locaux pour eviter de reinstaller si `requirements.txt`, `package.json` ou `package-lock.json` n'ont pas change;
  - `start-backend.ps1` et `start-frontend.ps1` appellent le setup automatiquement avant de lancer les serveurs.
- Correction priorite 1 streaming: les operations bloquantes de lecture video, resize, encodage JPEG, inference YOLO, conversion Supervision, tracking, annotation et ecriture JPEG d'evenement sont desormais executees via `asyncio.to_thread(...)` pour ne plus bloquer l'event loop FastAPI.

## Fichiers modifies

- `backend/app/core/config.py`
- `backend/app/db/database.py`
- `backend/app/services/inference_service.py`
- `backend/app/services/source_service.py`
- `backend/app/runtime/stream_manager.py`
- `backend/app/engine/nodes/yolo_detect_node.py`
- `backend/app/engine/nodes/tracker_node.py`
- `backend/app/engine/nodes/overlay_node.py`
- `backend/app/engine/nodes/save_event_node.py`
- `backend/app/services/supervision_service.py`
- `backend/app/api/routes_sources.py`
- `backend/app/api/routes_workflows.py`
- `backend/app/engine/workflow_engine.py`
- `backend/app/engine/nodes/yolo_detect_node.py`
- `backend/app/engine/nodes/event_trigger_node.py`
- `backend/app/engine/nodes/save_event_node.py`
- `frontend/src/pages/WorkflowBuilderPage.tsx`
- `frontend/src/pages/LiveViewPage.tsx`
- `frontend/src/App.tsx`
- `frontend/src/api/client.ts`
- `frontend/vite.config.ts`
- `backend/requirements-test.txt`
- `AGENTS.md`
- `.python-version`
- `setup.ps1`
- `.gitignore`
- `start-backend.ps1`
- `start-frontend.ps1`
- `README.md`
- `docs/progress/2026-05-22-backend-rtsp-nodes-mvp.md`
- `claude.md`

## Commandes executees

- `npm.cmd run build`
- `npm.cmd ci`
- `python -m pip install --target C:\tmp\omv-api-test-deps fastapi==0.115.0 pydantic-settings==2.5.2 sqlalchemy==2.0.35 aiosqlite==0.20.0 python-multipart==0.0.12 httpx pytest`
- `python -m pytest tests -q`
- `python -m compileall app`
- `npm.cmd run build` apres overlay LiveView
- Smoke UI Playwright via Chromium local deja installe
- Parse PowerShell AST: `setup.ps1`, `start-backend.ps1`, `start-frontend.ps1`
- `C:\Users\alanc\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe -m compileall app`
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
- Build frontend OK apres installation des dependances (`npm.cmd run build`).
- Build frontend OK apres code splitting Dashboard; plus de warning de chunk > 500 kB.
- Build frontend OK apres projection/edition des zones dans LiveView.
- Tests backend OK: 31 passed, 18 warnings.
- Smoke UI OK: `workflowsOk`, `addNodeOk`, `liveOk`, `zonesOk` a `true`.
- Compilation Python backend OK.
- Syntaxe PowerShell OK pour `setup.ps1`, `start-backend.ps1`, `start-frontend.ps1`.

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
- [x] Boucle de streaming decouplee des appels OpenCV/YOLO/Supervision bloquants via `asyncio.to_thread(...)`.
- [x] Overlay Supervision implemente pour boxes/labels/confidence/tracker id.
- [ ] Verifier inference YOLO de bout en bout sur machine avec modele disponible localement.
- [ ] Verifier CUDA sur machine equipee NVIDIA avec build PyTorch CUDA.
- [x] Ajouter une route/API de validation workflow avant sauvegarde.
- [x] Ajouter gestion UI explicite des erreurs de demarrage workflow/source.
- [x] Ajouter nettoyage ou rotation des frames exportees.
- [x] Ajouter suppression/maintenance des events sauvegardes.
- [x] Ajouter Zone Filter backend + UI zones polygonales.
- [x] Ajouter tests automatises backend pour sources/workflows/events.
- [x] Ajouter tests UI ou smoke Playwright pour le workflow builder/live view.
- [x] Optimiser bundle frontend par code splitting si necessaire.
- [x] Automatiser le setup local backend/frontend et documenter la relance.

## Notes de progression

- Le venv local existant etait casse dans cet environnement: `backend/venv/Scripts/python.exe` pointait vers un Python utilisateur absent.
- Le systeme n'exposait pas `python` ni `py` sur le PATH dans la session agent; les tests backend ont ete lances avec le Python embarque Codex et les paquets du venv existant via `PYTHONPATH`.
- Le backend et Vite ont ete lances localement pour verification.
- Intervention suivante: l'editeur polygonal visuel est disponible dans le Workflow Builder, sans nouvelle dependance frontend.
- `npm.cmd run build` passe apres `npm.cmd ci`; Vite a du etre lance hors sandbox Windows a cause d'un refus d'acces esbuild sur les chemins parents.
- Tests backend non relances dans cette session: le venv backend pointe vers un Python absent et l'installation temporaire des dependances de test dans `C:\tmp\omv-test-deps` a depasse le delai sans produire de paquets utilisables.
- Verification navigateur integre non realisee: le runtime Browser/Node a echoue sur `EPERM: operation not permitted, lstat 'C:\Users\alanc\AppData'`.
- Intervention suivante: tests backend relances avec un set de dependances API legeres dans `C:\tmp\omv-api-test-deps`; resultat `31 passed`.
- Les imports OpenCV/Supervision sont paresseux dans `source_service.py`, `stream_manager.py`, `supervision_service.py` et `save_event_node.py`.
- Le build frontend passe avec `DashboardPage` en lazy route; le chunk initial est environ `170.39 kB` et le dashboard est separe.
- Smoke UI realise avec serveur Vite local et Playwright temporaire dans `C:\tmp\omv-pw`; serveur Vite arrete apres verification.
- Setup automatise ajoute le 2026-05-22. Commandes utiles: `.\setup.ps1`, `.\setup.ps1 -ForceInstall`, `.\setup.ps1 -BackendOnly -RecreateBackendVenv`, puis `.\start-backend.ps1` et `.\start-frontend.ps1`.
- Installation complete non relancee dans cette session pour eviter un telechargement PyTorch long; seule la syntaxe des scripts PowerShell a ete verifiee.
- Intervention priorite 1 du 2026-05-22: compilation backend OK apres decouplage de la boucle streaming. Tests backend complets non relances: `python` systeme tente de telecharger un runtime via PyManager sans reseau, le runtime Python embarque n'a pas `pytest`, le venv local n'a pas `pytest`/`numpy`, et `C:\tmp\omv-api-test-deps` contient un package `pytest` incomplet.
