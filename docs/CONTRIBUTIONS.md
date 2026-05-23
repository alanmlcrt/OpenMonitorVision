# Contributions

## 2026-05-23 — Codex — Stabilisation MVP

Fichiers modifiés :

- `backend/app/services/dataset_service.py`
- `backend/tests/test_datasets.py`
- `frontend/src/pages/SourcesPage.tsx`
- `docs/07-api.md`
- `README.md`
- `docs/progress/2026-05-23-app-review-and-correction-plan.md`
- `docs/progress/2026-05-23-reliability-and-ux-sprint.md`
- `docs/progress/2026-05-23-mvp-stabilization-summary.md`

Commandes et validations :

- `.\setup.ps1 -BackendOnly -RecreateBackendVenv`
- `backend\venv\Scripts\python.exe -m pip install -r backend\requirements-dev.txt`
- `.\setup.ps1 -BackendOnly`
- `backend\venv\Scripts\python.exe -m compileall app tests`
- `backend\venv\Scripts\python.exe -m pytest tests -q --basetemp=.tmp\pytest -p no:cacheprovider`
- `npx tsc --noEmit`
- `npm run build`
- Smoke MVP backend avec vidéo locale + `yolov8n.pt` local : source, workflow, WebSocket frame, détections, events SQLite, stats.
- Smoke UI navigateur : Overview, Sources, Workflows, Live, Events, Models.

Checklist :

- [x] Venv backend recréé en Python 3.12.7.
- [x] Dépendances runtime et dev installées.
- [x] Tests backend complets verts.
- [x] TypeScript frontend vert.
- [x] Build frontend vert hors sandbox.
- [x] Inference YOLO locale validée sur CPU.
- [x] Fallback CPU validé, CUDA indisponible sur cette machine.
- [x] Scénario MVP backend validé de bout en bout.
- [x] Warning React `SourcesPage` corrigé.
- [x] Documentation API et README mis à jour.
- [ ] Validation CUDA sur une machine NVIDIA.
- [ ] Validation notifications sortantes.
- [ ] Validation training réel.
- [ ] Validation longue durée RTSP/stream/image_url.

## 2026-05-23 - Codex - Workflow couleur + sequence de zones

Fichiers modifies :

- `backend/app/engine/nodes/color_filter_node.py`
- `backend/app/engine/nodes/zone_sequence_trigger_node.py`
- `backend/app/engine/node_registry.py`
- `backend/app/runtime/stream_manager.py`
- `backend/app/services/supervision_service.py`
- `backend/app/engine/nodes/save_event_node.py`
- `backend/app/schemas/event.py`
- `backend/app/services/notification_service.py`
- `backend/app/services/workflow_service.py`
- `backend/tests/test_engine.py`
- `frontend/src/pages/WorkflowBuilderPage.tsx`
- `frontend/src/pages/EventsPage.tsx`
- `frontend/src/types/index.ts`
- `docs/05-workflow-engine.md`
- `docs/progress/2026-05-23-zone-sequence-color-workflow.md`
- `docs/CONTRIBUTIONS.md`

Commandes et validations :

- `backend\venv\Scripts\python.exe -m compileall app tests`
- `backend\venv\Scripts\python.exe -m pytest tests\test_engine.py -q --basetemp=.tmp\pytest -p no:cacheprovider`
- `backend\venv\Scripts\python.exe -m pytest tests -q --basetemp=.tmp\pytest -p no:cacheprovider`
- `npx tsc --noEmit`
- `npm run build` hors sandbox
- Smoke UI Playwright local sur `/workflows`

Checklist :

- [x] Node `Color Filter` implemente.
- [x] Node `Zone Sequence` implemente.
- [x] Workflow Builder mis a jour avec les nouveaux nodes.
- [x] Events enrichis avec metadonnees JSON.
- [x] Tests backend et frontend/build valides.
- [ ] Valider sur une vraie video avec une voiture verte et deux zones dessinees.

## 2026-05-23 - Codex - Monitoring satellite MVP

Fichiers modifies :

- `backend/app/db/models.py`
- `backend/app/schemas/satellite.py`
- `backend/app/schemas/source.py`
- `backend/app/services/satellite_service.py`
- `backend/app/api/routes_satellite.py`
- `backend/app/main.py`
- `backend/app/engine/nodes/satellite_scene_node.py`
- `backend/app/engine/nodes/geo_zone_trigger_node.py`
- `backend/app/engine/node_registry.py`
- `backend/tests/test_satellite.py`
- `frontend/src/types/index.ts`
- `frontend/src/api/satellite.ts`
- `frontend/src/pages/SatellitePage.tsx`
- `frontend/src/App.tsx`
- `frontend/src/components/Layout.tsx`
- `frontend/src/pages/SourcesPage.tsx`
- `frontend/src/pages/WorkflowBuilderPage.tsx`
- `docs/05-workflow-engine.md`
- `docs/progress/2026-05-23-satellite-monitoring-mvp.md`
- `docs/CONTRIBUTIONS.md`

Commandes et validations :

- `backend\venv\Scripts\python.exe -m compileall app tests`
- `backend\venv\Scripts\python.exe -m pytest tests\test_satellite.py -q --basetemp=.tmp\pytest -p no:cacheprovider`
- `backend\venv\Scripts\python.exe -m pytest tests -q --basetemp=.tmp\pytest -p no:cacheprovider`
- `npx tsc --noEmit`
- `npm run build`
- Smoke UI local sur `/satellite` et `/workflows`

Checklist :

- [x] Tables et schemas satellite ajoutes.
- [x] API satellite ajoutee.
- [x] Import STAC et monitoring AOI/scene ajoutes.
- [x] Evenements satellite sauvegardes dans SQLite.
- [x] Page satellite avec carte locale ajoutee.
- [x] Nodes workflow `satellite_scene` et `geo_zone_trigger` ajoutes.
- [x] Tests backend, TypeScript, build et smoke UI valides.
- [ ] Brancher un fournisseur reel type Copernicus Data Space / STAC.
- [ ] Ajouter le rendu raster GeoTIFF / COG.
- [ ] Ajouter une analyse CV specialisee sur les images satellite.
