# 09 — Roadmap

## Phase 0 — Initialisation

Objectif : poser une base propre.

Tâches :

- créer backend FastAPI ;
- créer frontend Vite React TypeScript ;
- configurer Tailwind ;
- configurer SQLite ;
- installer Ultralytics ;
- installer Supervision ;
- créer endpoint `/health` ;
- créer structure projet propre ;
- ajouter `AGENTS.md` et `/docs`.

Livrable :

- backend démarre ;
- frontend démarre ;
- `/health` fonctionne.

## Phase 1 — Sources

Objectif : gérer les sources vidéo.

Tâches :

- CRUD sources ;
- webcam locale ;
- fichier vidéo ;
- preview de frame ;
- test de source.

Livrable :

- l’utilisateur peut ajouter une webcam ou une vidéo locale.

## Phase 2 — YOLO + Supervision

Objectif : détecter des objets.

Tâches :

- charger modèle YOLO pré-entraîné ;
- auto-détection CUDA/CPU ;
- convertir résultats avec `sv.Detections.from_ultralytics`;
- convertir `sv.Detections` vers JSON interne ;
- annoter une frame avec Supervision.

Livrable :

- une frame est analysée et annotée.

## Phase 3 — Live View

Objectif : afficher un flux annoté.

Tâches :

- WebSocket live ;
- envoi frames JPEG ;
- affichage côté frontend ;
- affichage bounding boxes ;
- affichage labels.

Livrable :

- flux live annoté visible dans la WebUI.

## Phase 4 — Tracking

Objectif : suivre les objets.

Tâches :

- ajouter node Tracker ;
- intégrer `sv.ByteTrack` ;
- ajouter `tracker_id` ;
- utiliser `tracker_id` dans les événements.

Livrable :

- les objets suivis ont un identifiant stable.

## Phase 5 — Events

Objectif : sauvegarder les événements.

Tâches :

- créer table events ;
- créer `EventService` ;
- sauvegarde SQLite ;
- page Events ;
- filtres simples ;
- export CSV.

Livrable :

- les événements sont consultables.

## Phase 6 — Workflow Builder

Objectif : créer des workflows visuels.

Tâches :

- intégrer React Flow ;
- créer nodes MVP ;
- sauvegarder nodes/edges ;
- validation backend ;
- exécution workflow simple.

Livrable :

- l’utilisateur peut créer un workflow simple.

## Phase 7 — Zones

Objectif : surveiller des zones.

Tâches :

- dessin zones avec Konva ;
- sauvegarde zones ;
- intégration `sv.PolygonZone` ;
- filtrage par zone ;
- affichage zones dans le live.

Livrable :

- l’utilisateur peut filtrer les détections dans une zone.

## Phase 8 — Dashboard

Objectif : afficher les statistiques.

Tâches :

- stats par classe ;
- stats par source ;
- stats par heure ;
- derniers événements ;
- cartes de synthèse.

Livrable :

- dashboard simple mais utile.

## Phase 9 — Modèles personnalisés

Objectif : gérer plusieurs modèles YOLO.

Tâches :

- upload `.pt` ;
- liste modèles ;
- choix modèle dans node YOLO ;
- test modèle.

Livrable :

- l’utilisateur peut utiliser son propre modèle.

## Phase 10 — Training

Objectif : préparer l’entraînement YOLO.

Tâches :

- page Training ;
- import dataset ;
- configuration entraînement ;
- logs ;
- sauvegarde modèle entraîné.

Livrable :

- premier entraînement lançable depuis la WebUI.

## Priorité

Ne pas travailler sur les phases avancées tant que le MVP n’est pas fonctionnel.
