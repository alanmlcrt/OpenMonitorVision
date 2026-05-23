# App review et plan de correction

Date : 2026-05-23
Statut : MVP stabilise et valide en smoke test local

## Portee

Review fonctionnelle et technique de l'application OpenMonitorVision a partir :

- des docs projet de reference ;
- des fichiers de progression existants dans `docs/progress/` ;
- de la structure backend/frontend ;
- des validations locales disponibles.

## Topo rapide

L'application couvre deja une grande partie du MVP et plusieurs fonctions hors MVP :

- CRUD sources : webcam, video, RTSP, stream web, IP camera, snapshot HTTP, dossier d'images ;
- workflow builder React Flow avec nodes Source, YOLO, Tracker, filtres, zones, event, save, overlay ;
- live WebSocket avec frames JPEG annotees ;
- sauvegarde et consultation des events SQLite ;
- dashboard et stats simples ;
- gestion de modeles YOLO ;
- datasets, annotateur in-app et training YOLO ;
- notifications webhook, email et MQTT ;
- import/export de workflows.

Le principal ecart produit n'est pas le nombre de features, mais la robustesse de bout en bout :
plusieurs sprints sont implementes mais restent marques "a tester end-to-end".

## Validations lancees

- `npm.cmd run build` depuis `frontend` :
  - echoue dans le sandbox a cause d'un refus d'acces esbuild sur un repertoire parent ;
  - OK hors sandbox : build Vite reussi, chunks decoupes correctement.
- `C:\Users\alanc\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe -m compileall app` depuis `backend` : OK.
- `.\venv\Scripts\python.exe -m compileall app` depuis `backend` : OK.
- `.\venv\Scripts\python.exe -m pytest tests -q` :
  - le venv local ne contient pas `pytest` ;
  - OK hors sandbox avec `PYTHONPATH=C:\tmp\omv-api-test-deps` : 56 tests passes.
- Apres correction runtime headless :
  - `.\venv\Scripts\python.exe -m compileall app tests` : OK ;
  - `PYTHONPATH=C:\tmp\omv-api-test-deps .\venv\Scripts\python.exe -m pytest tests\test_stream_manager.py -q` : 1 test passe ;
  - `PYTHONPATH=C:\tmp\omv-api-test-deps .\venv\Scripts\python.exe -m pytest tests -q` : 57 tests passes.
- Apres correction securite fichiers :
  - `.\venv\Scripts\python.exe -m compileall app tests` : OK ;
  - `PYTHONPATH=C:\tmp\omv-api-test-deps .\venv\Scripts\python.exe -m pytest tests\test_models.py tests\test_datasets.py -q` : 6 tests passent ;
  - `PYTHONPATH=C:\tmp\omv-api-test-deps .\venv\Scripts\python.exe -m pytest tests -q` : 63 tests passent.
- Apres correction EventTrigger/MQTT cache :
  - `.\venv\Scripts\python.exe -m compileall app tests` : OK ;
  - `PYTHONPATH=C:\tmp\omv-api-test-deps .\venv\Scripts\python.exe -m pytest tests\test_engine.py tests\test_mqtt.py -q` : 30 tests passent ;
  - `PYTHONPATH=C:\tmp\omv-api-test-deps .\venv\Scripts\python.exe -m pytest tests -q` : 68 tests passent.
- Apres revue des plans et renforcement API health/workflows :
  - `.\venv\Scripts\python.exe -m compileall app tests` : OK ;
  - `PYTHONPATH=C:\tmp\omv-api-test-deps .\venv\Scripts\python.exe -m pytest tests -q` : 69 tests passent.
- Stabilisation MVP finale :
  - `.\setup.ps1 -BackendOnly -RecreateBackendVenv` : venv backend recrée en Python 3.12.7 ;
  - `.\venv\Scripts\python.exe -m pip install -r requirements-dev.txt` : dépendances de test installées ;
  - `.\venv\Scripts\python.exe -m compileall app tests` : OK ;
  - `.\venv\Scripts\python.exe -m pytest tests -q --basetemp=.tmp\pytest -p no:cacheprovider` : 70 tests passent ;
  - `npx tsc --noEmit` : OK ;
  - `npm run build` : OK hors sandbox ;
  - smoke MVP backend : source vidéo locale, YOLO local CPU, workflow, WebSocket frame, events SQLite et stats OK ;
  - smoke UI navigateur : Overview, Sources, Workflows, Live, Events, Models chargent.

## Actions realisees le 2026-05-23

- `backend/app/runtime/stream_manager.py` :
  - la boucle runtime continue maintenant a lire les frames et executer le workflow meme sans client WebSocket ;
  - l'encodage JPEG et le broadcast sont executes uniquement quand au moins un client WebSocket ecoute le canal ;
  - les stats runtime sont nettoyees dans le `finally` de la boucle ;
  - un callback de fin de task retire les tasks terminees et loggue les crashs.
- `backend/tests/test_stream_manager.py` :
  - ajout d'un test de regression qui verifie qu'un workflow analyse une frame sans client WebSocket ;
  - le meme test verifie que l'encodage JPEG est saute quand aucun client ne regarde.
- `backend/app/services/dataset_service.py` :
  - validation stricte des `stem` d'image/label ;
  - verification des chemins resolus sous le dossier dataset avant lecture/ecriture.
- `backend/app/api/routes_datasets.py` :
  - transformation des stems invalides en reponses HTTP 400 explicites.
- `backend/app/api/routes_models.py` :
  - refus des noms de fichiers avec chemin ;
  - normalisation des noms de fichiers ;
  - restriction des extensions modeles a `.pt` et `.onnx` ;
  - generation de chemins uniques dans `models_dir` ;
  - suppression protegee pour ne retirer que les fichiers sous `models_dir`.
- `backend/tests/test_models.py` :
  - tests upload modele normalise, traversal refuse, extension refusee.
- `backend/tests/test_datasets.py` :
  - tests label roundtrip valide, traversal label refuse, traversal image refuse.
- `backend/app/engine/nodes/event_trigger_node.py` :
  - le mode global declenche maintenant un burst complet par frame quand le cooldown est expire ;
  - le cooldown global bloque le burst suivant, sans supprimer les autres detections du burst courant ;
  - en mode `trigger_once_per_object`, les detections trackees restent limitees a une fois par `tracker_id` ;
  - les detections sans `tracker_id` utilisent le cooldown, pas une suppression definitive par index.
- `backend/tests/test_engine.py` :
  - tests multi-detections sur cooldown global ;
  - test explicite du comportement `trigger_once_per_object` sans `tracker_id`.
- `backend/app/services/mqtt_service.py` et `backend/app/api/routes_mqtt.py` :
  - ajout de `invalidate_broker(broker_id)` ;
  - invalidation du client MQTT cache apres update/delete broker.
- `backend/tests/test_mqtt.py` :
  - tests fermeture du client cache et invalidation via routes update/delete.
- `backend/tests/test_health.py` :
  - verification explicite des sections `workflows` et `training` de `/api/health`.
- `backend/tests/test_workflows.py` :
  - verification de `stats` dans `/api/workflows/{id}/status` ;
  - test backend export/import de workflow.
- `backend/app/services/dataset_service.py` :
  - suppression dataset bornée sous `settings.datasets_dir`.
- `backend/tests/test_datasets.py` :
  - test de non-regression : delete dataset ne supprime pas un chemin hors datasets_dir.
- `frontend/src/pages/SourcesPage.tsx` :
  - correction du warning React "unique key" sur les fragments de lignes source.
- Documentation :
  - `docs/07-api.md` mis a jour avec les routes reelles ;
  - `README.md` mis a jour avec setup, validation et scenario MVP ;
  - `docs/CONTRIBUTIONS.md` cree ;
  - `docs/progress/2026-05-23-mvp-stabilization-summary.md` cree.

## Findings prioritaires

### P1 - Les workflows ne tournent pas vraiment sans WebSocket client - corrige

Dans `backend/app/runtime/stream_manager.py`, la boucle saute lecture, inference, events et notifications quand aucun client n'est connecte au canal WebSocket.

Impact : un workflow marque running ou auto-redemarre au boot ne detecte rien, ne sauvegarde aucun event et n'envoie aucune notification tant qu'une page Live/Workflow est ouverte. C'est contraire au besoin supervision 24/7.

Reference : `stream_manager.py`, autour de `ws_manager.channel_count(channel) == 0`.

Correction appliquee : le runtime d'analyse est decouple du transport UI. La boucle continue a lire/inferer/sauvegarder meme sans client ; seul l'encodage JPEG et le broadcast sont conditionnels.

### P1 - Les endpoints dataset annotation acceptent un `stem` non borne - corrige

`image_path`, `read_label` et `write_label` reconstruisent des chemins a partir de `stem` sans verifier que le chemin final reste dans le dossier dataset.

Impact : risque de lecture/ecriture hors dataset via traversal si l'API est appelee directement.

References :

- `backend/app/services/dataset_service.py`, fonctions `image_path`, `read_label`, `write_label`.
- `backend/app/api/routes_datasets.py`, endpoints `/image`, `/label`.

Correction appliquee : `stem` refuse les chemins/separateurs, les chemins finaux sont resolus et controles sous leur dossier parent dataset.

### P1 - Upload modele : nom de fichier non sanitise - corrige

`backend/app/api/routes_models.py` ecrit `file.filename` directement dans `settings.models_dir`.

Impact : risque d'ecriture hors dossier modeles et absence de validation forte extension/taille.

Correction appliquee : noms avec chemin refuses, nom normalise, extensions limitees a `.pt` / `.onnx`, collisions gerees, suppression bornee a `models_dir`.

### P2 - Etat runtime stale si une boucle de stream crashe - corrige

`_stream_stats` est purge dans `stop_stream`, mais pas dans le `finally` de `_stream_loop`.

Impact : `/api/health` peut afficher un workflow comme actif dans les stats alors que la task est terminee sur erreur.

Correction appliquee : purge dans le `finally` et callback de fin de task avec log d'erreur en cas de crash.

### P2 - Event Trigger global ne garde qu'un event par cooldown - corrige

Avec `trigger_once_per_object=false`, tous les objets partagent la cle `global`. Des qu'un premier objet declenche, les suivants de la meme frame peuvent etre bloques si le cooldown est positif.

Impact : notifications et sauvegardes peuvent perdre des detections d'une meme scene.

Correction appliquee : en mode global, le node declenche un burst contenant toutes les detections de la frame, puis applique le cooldown au burst suivant. Le comportement sans `tracker_id` en mode per-object est documente par test.

### P2 - Cache MQTT non invalide apres update/delete broker - corrige

Le pool MQTT garde un client par `broker.id`. Modifier ou supprimer un broker en DB ne ferme pas le client deja connecte.

Impact : un broker modifie peut continuer a publier avec l'ancienne config jusqu'a restart ou erreur reseau.

Correction appliquee : `mqtt_service.invalidate_broker(id)` ferme et retire le client cache ; les routes update/delete broker l'appellent apres mutation DB.

### P2 - Documentation API partiellement obsolete

`docs/07-api.md` decrit encore des routes anciennes (`PUT`, stats fragmentees, zones separees, WebSocket proposes) alors que le code expose plutot `PATCH`, `/api/events/stats`, `/ws/workflow/{id}`, datasets/training/MQTT, etc.

Impact : la doc ne peut plus servir de contrat API fiable.

Correction attendue : mettre a jour `docs/07-api.md`, puis garder une checklist "API contract" pour les changements futurs.

## Plan priorise

### Phase 1 - Stabiliser le MVP de supervision

- [x] Decoupler inference/events du nombre de clients WebSocket.
- [x] Ajouter tests unitaires/runtime : workflow running sans client WS continue l'analyse.
- [x] Nettoyer la lifecycle des streams : stats purgees, task exceptions logguees, health coherent.
- [x] Retester scenario MVP complet : source video locale -> workflow -> live -> events -> stats.
- [x] Tester inference YOLO avec un modele local reel sur CPU (`backend/data/models/yolov8n.pt`).
- [ ] Tester CUDA sur machine NVIDIA si disponible (machine actuelle : `cuda_available=False`).

### Phase 2 - Securiser les entrees fichiers locales

- [x] Sanitiser upload modele (`routes_models.py`).
- [x] Borne stricte pour `stem` dataset image/label.
- [x] Ajouter tests de traversal sur model upload et dataset annotation.
- [x] Verifier suppression modele sans sortir de `models_dir`.
- [x] Verifier suppression dataset sans sortir de `datasets_dir` (test de non-regression ajoute).
- [x] Verifier cleanup event frames : suppression limitee au glob `*.jpg` de `settings.exports_dir`.

### Phase 3 - Corriger la semantique events/notifications

- [x] Revoir `EventTriggerNode` : burst global vs once per object.
- [x] Ajouter tests multi-detections sur cooldown global.
- [x] Ajouter tests `trigger_once_per_object` sans tracker_id et documenter le comportement attendu.
- [ ] Tester webhook, email et MQTT end-to-end.
- [x] Invalider le cache MQTT sur update/delete broker.

### Phase 4 - Finaliser UX et observabilite

- [ ] Ajouter une page/section "Runtime health" avec workflows running, FPS, last frame, last error.
- [ ] Afficher dans Live/Workflow les erreurs runtime persistantes, pas seulement les messages WebSocket instantanes.
- [ ] Ajouter logs UI simples ou endpoint tail logs backend.
- [ ] Clarifier le statut "running mais sans client live" apres decouplage.

### Phase 5 - Consolider training/datasets

- [ ] Tester upload zip YOLO, validation, annotation, training 1-2 epochs, auto-register model.
- [ ] Tester capture from source et harvest node.
- [ ] Ajouter garde-fous taille zip/nombre fichiers/duree import.
- [ ] Documenter le format zip attendu et le workflow annotation -> training -> model.

### Phase 6 - Nettoyer docs et suivis

- [x] Mettre a jour `docs/07-api.md`.
- [x] Mettre a jour `README.md` avec le scenario MVP actuel.
- [x] Ajouter ou creer `docs/CONTRIBUTIONS.md` si le projet veut centraliser les interventions.
- [x] Creer une synthese MVP a jour dans `docs/progress/2026-05-23-mvp-stabilization-summary.md`.
- [x] Supprimer les suivis MVP/UI devenus redondants apres validation end-to-end.

## Points ouverts reels

- [x] Validation end-to-end YOLO/Supervision sur machine avec stack vision complete en CPU.
- [ ] Validation CUDA/PyTorch GPU.
- [ ] Validation notifications sortantes.
- [ ] Validation training reel.
- [ ] Validation sources web longues durees : RTSP, stream web, image_url.
- [x] Mise en coherence documentation API / routes reelles.
