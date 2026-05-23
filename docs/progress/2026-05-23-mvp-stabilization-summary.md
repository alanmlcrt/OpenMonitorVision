# Synthèse — Stabilisation MVP

Date : 2026-05-23  
Statut : MVP backend validé, frontend validé, points avancés encore ouverts

## Résumé

La priorité de cette intervention était de transformer les sprints déjà implémentés en un MVP testable et démontrable.

Résultat :

- environnement backend recréé proprement ;
- tests backend complets verts ;
- frontend typé et buildable ;
- modèle YOLO réel disponible localement ;
- scénario MVP validé avec source vidéo locale, workflow, WebSocket live, événements SQLite et stats ;
- documentation API/README remise en cohérence avec les routes réelles ;
- un warning React sur `SourcesPage` corrigé ;
- suppression dataset durcie pour ne pas sortir de `settings.datasets_dir`.

## Validations Réalisées

- Backend :
  - `.\setup.ps1 -BackendOnly -RecreateBackendVenv` a recréé `backend/venv` en Python 3.12.7.
  - `backend\venv\Scripts\python.exe -m pip install -r backend\requirements-dev.txt`.
  - `backend\venv\Scripts\python.exe -m compileall app tests`.
  - `backend\venv\Scripts\python.exe -m pytest tests -q --basetemp=.tmp\pytest -p no:cacheprovider` : 70 tests passent.
- Frontend :
  - `npx tsc --noEmit` : OK.
  - `npm run build` : OK hors sandbox.
- Vision :
  - `backend/data/models/yolov8n.pt` téléchargé pour validation locale.
  - Inference CPU validée sur `ultralytics/assets/bus.jpg` : 6 détections.
  - CUDA contrôlé : indisponible sur cette machine (`cuda_available=False`, `cuda_device_count=0`).
- Scénario MVP backend :
  - vidéo locale générée dans `backend/data/uploads/mvp_bus_smoke.mp4` ;
  - source vidéo testée avec dimensions `810 x 1080`, `fps=5` ;
  - workflow `Source -> YOLO Detect -> Tracker -> Confidence Filter -> Event Trigger -> Save Event -> Overlay` validé et lancé ;
  - WebSocket `/ws/workflow/{id}` : frame JPEG reçue avec 5 détections ;
  - 5 événements sauvegardés pour le workflow de smoke test ;
  - `/api/events/stats` expose les compteurs par classe/source/heure ;
  - sources, workflows, events et snapshots de smoke test supprimés après validation pour ne pas polluer la base locale.
- Smoke UI navigateur :
  - Overview, Sources, Workflows, Live, Events et Models chargent avec le backend local ;
  - le warning React `SourcesPage` lié aux fragments sans clé a été corrigé.

## Fichiers Modifiés

- `backend/app/services/dataset_service.py` : garde de suppression dataset sous `settings.datasets_dir`.
- `backend/tests/test_datasets.py` : test de non-régression pour suppression hors dossier dataset.
- `frontend/src/pages/SourcesPage.tsx` : clé React placée sur le fragment de ligne source.
- `docs/07-api.md` : routes REST/WebSocket réelles documentées.
- `README.md` : setup, validation et scénario MVP actualisés.
- `docs/CONTRIBUTIONS.md` : suivi d'intervention créé.
- `docs/progress/2026-05-23-app-review-and-correction-plan.md` : checklist de stabilisation mise à jour.
- `docs/progress/2026-05-23-reliability-and-ux-sprint.md` : validations de fin de sprint mises à jour.

## Checklists Ouvertes Réelles

- [ ] Valider CUDA sur une machine NVIDIA avec un build PyTorch CUDA.
- [ ] Tester notifications webhook/email/MQTT end-to-end.
- [ ] Tester training YOLO réel : upload zip, annotation, entraînement 1-2 epochs, auto-register model.
- [ ] Tester capture from source et harvest node end-to-end.
- [ ] Tester sources web longues durées : RTSP, stream web, image_url.
- [ ] Ajouter une vue runtime health/logs UI si l'usage 24/7 devient prioritaire.
