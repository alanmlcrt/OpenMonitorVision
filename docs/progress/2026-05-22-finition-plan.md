# Progression - 2026-05-22 - Finition du plan MVP

## Actions realisees

### Backend - Validation workflow
- `POST /api/workflows/validate` valide le graphe avant sauvegarde.
- Regles: au moins un node source, `source_id` configure, connectivite, zones polygonales avec au moins 3 points.
- Schemas Pydantic `WorkflowValidateRequest` / `WorkflowValidateResponse`.
- Fonction pure `validate_workflow_graph()` dans `workflow_service.py`.

### Backend - Maintenance events
- `DELETE /api/events` supprime les events en masse, optionnellement par `source_id` / `workflow_id`.
- `POST /api/events/cleanup-frames?older_than_days=N` supprime les snapshots JPEG anciens.
- Fonctions `delete_all_events()` et `cleanup_frame_files()` dans `event_service.py`.

### Backend - Imports lazy
- `device.py` importe `torch` uniquement dans les fonctions.
- `source_service.py` importe `cv2` uniquement pour preview/test source.
- `stream_manager.py` importe `cv2` uniquement au lancement d'un stream.
- `supervision_service.py` importe `supervision` uniquement lors des operations detection/tracking/annotation.
- `save_event_node.py` importe `cv2` uniquement si une frame doit etre sauvegardee.
- Les tests API peuvent tourner sans OpenCV, Supervision, PyTorch ni Ultralytics.

### Frontend - Erreurs inline
- `LiveViewPage.tsx` affiche une banner d'erreur inline dismissable.
- `SourcesPage.tsx` affiche les erreurs de formulaire inline.

### Frontend - Validation avant sauvegarde
- `workflowsApi.validate()` ajoute dans `api/workflows.ts`.
- `WorkflowBuilderPage` appelle la validation avant `save()` et affiche les erreurs inline.

### Frontend - Events
- `eventsApi.clearAll()` et `eventsApi.cleanupFrames()` ajoutes.
- Bouton `Clear all` avec confirmation dans `EventsPage.tsx`.

### Frontend - Code splitting
- `App.tsx` charge toutes les pages avec `React.lazy()` + `Suspense`, dashboard inclus.
- Recharts et ReactFlow sont sortis du chunk initial.
- Le build ne signale plus de chunk > 500 kB.

### Frontend - Zone Filter
- Editeur polygonal visuel dans le Workflow Builder.
- Ajout/suppression de zones, ajout/deplacement de points, suppression d'un point par double-clic.
- Export du format `{ name, points }` attendu par le backend.
- Projection et edition des zones sur la page LiveView:
  - overlay SVG alignee sur le flux 640x360;
  - selection de zone;
  - ajout/deplacement/suppression de points;
  - sauvegarde des zones dans le workflow selectionne.

### Tests backend
- `backend/tests/conftest.py` configure un client FastAPI avec SQLite de test isolee.
- Suites: health, sources, workflows, events.
- Relance effectuee avec dependances temporaires legeres dans `C:\tmp\omv-api-test-deps`.

### Tests UI
- Smoke UI Playwright sur Vite local:
  - `/workflows` charge et expose `Workflows` + `Add node`;
  - `/live` charge et expose `Real-time detection stream` + `Zones`.
- Serveur Vite arrete apres verification.

## Fichiers modifies / crees

- `backend/app/core/device.py`
- `backend/app/services/source_service.py`
- `backend/app/runtime/stream_manager.py`
- `backend/app/services/supervision_service.py`
- `backend/app/engine/nodes/save_event_node.py`
- `backend/app/schemas/workflow.py`
- `backend/app/services/workflow_service.py`
- `backend/app/api/routes_workflows.py`
- `backend/app/services/event_service.py`
- `backend/app/api/routes_events.py`
- `backend/pytest.ini`
- `backend/requirements-test.txt`
- `backend/requirements-dev.txt`
- `backend/tests/`
- `frontend/src/api/client.ts`
- `frontend/src/api/workflows.ts`
- `frontend/src/api/events.ts`
- `frontend/src/pages/LiveViewPage.tsx`
- `frontend/src/pages/SourcesPage.tsx`
- `frontend/src/pages/WorkflowBuilderPage.tsx`
- `frontend/src/pages/EventsPage.tsx`
- `frontend/src/App.tsx`

## Validations finales

- `npm.cmd run build` : OK, plus de warning chunk > 500 kB.
- `npm.cmd run build` apres overlay LiveView : OK.
- `python -m pytest tests -q` : 31 passed, 18 warnings SQLAlchemy/datetime.
- `python -m compileall app` : OK.
- Smoke UI Playwright : OK (`workflowsOk`, `addNodeOk`, `liveOk`, `zonesOk` a `true`).

## Checklist finale

- [x] Route/API validation workflow.
- [x] Validation integree dans WorkflowBuilderPage.
- [x] UI erreurs demarrage workflow.
- [x] UI erreurs creation source.
- [x] Bulk delete events.
- [x] Cleanup frames anciens.
- [x] Tests backend automatises.
- [x] Smoke UI workflow builder/live view.
- [x] Code splitting frontend, dashboard inclus.
- [x] Imports lazy pour demarrer/tester sans stack vision complete.
- [x] Zone Filter avec editeur polygonal visuel dans le Workflow Builder.
- [x] Projection/edition des zones sur la page LiveView avec image live reelle.
- [ ] Verifier inference YOLO bout en bout sur machine avec modele local.
- [ ] Verifier CUDA sur machine NVIDIA + build PyTorch CUDA.
