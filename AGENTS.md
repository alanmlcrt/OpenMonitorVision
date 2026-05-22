# AGENTS.md — Local Vision Sandbox Platform

## Rôle de ce fichier

Ce fichier est le point d’entrée principal pour tout agent IA travaillant sur ce projet.

Avant de modifier le code, l’agent doit lire :

1. `AGENTS.md`
2. `docs/01-product-vision.md`
3. `docs/02-architecture.md`
4. `docs/05-workflow-engine.md`
5. `docs/06-supervision-integration.md`
6. `docs/10-development-rules.md`
7. `docs/00-reference.md`

---

## Résumé du projet

Le projet est une plateforme locale de supervision vidéo/image.

Elle permet de :

- brancher plusieurs sources vidéo ou image ;
- créer des workflows visuels avec des nodes ;
- appliquer des modèles YOLO ;
- utiliser certaines briques de `roboflow/supervision` ;
- définir des zones de surveillance ;
- déclencher des événements ;
- sauvegarder ces événements en SQLite ;
- visualiser les flux en temps réel avec overlays ;
- afficher des statistiques dans une WebUI.

La plateforme doit tourner localement sur PC, sans dépendance cloud obligatoire.

---

## Stack principale

Backend :

- Python
- FastAPI
- Pydantic
- SQLAlchemy
- SQLite / aiosqlite
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
- Konva / React-Konva
- Recharts
- WebSockets

UI Inspiration: privilégier une interface propre et moderne à la manière d'OpenChamber — dashboard minimal, navigation claire, composants réutilisables. Tailwind CSS est recommandé pour obtenir ce rendu.

---

## Rôle de Roboflow Supervision

Le projet utilise `roboflow/supervision` comme couche computer vision backend.

Supervision doit servir à :

- représenter les détections avec `sv.Detections` ;
- convertir les sorties YOLO avec `sv.Detections.from_ultralytics(...)` ;
- annoter les frames ;
- gérer les zones polygonales ;
- gérer le tracking avec `sv.ByteTrack`.

Supervision ne remplace pas notre plateforme.

La plateforme garde ses propres modules :

- backend FastAPI ;
- workflow engine ;
- runtime vidéo ;
- WebSocket ;
- base SQLite ;
- frontend React ;
- dashboard ;
- éditeur de workflows.

---

## Règle importante

Ne jamais envoyer directement au frontend des objets internes venant de :

- OpenCV ;
- Ultralytics ;
- Supervision ;
- SQLAlchemy.

Toujours convertir vers des schémas Pydantic et des types JSON propres.

Pipeline attendu :

```
Frame OpenCV
  ↓
YOLO Ultralytics
  ↓
sv.Detections
  ↓
tracking / zones / annotations
  ↓
format JSON interne
  ↓
WebSocket + SQLite + frontend
```

---

## Accélération matérielle

L’inférence doit privilégier NVIDIA CUDA lorsque disponible.

Ordre de priorité :

1. CUDA / GPU NVIDIA
2. CPU

La sélection du device doit être centralisée dans :

```
backend/app/core/device.py
```

Le backend doit fonctionner même sans GPU.

Nous nous appuyons sur la stack Python et les bonnes pratiques documentées par Roboflow Supervision. Voir le README officiel pour détails et recommandations d'installation : https://raw.githubusercontent.com/roboflow/supervision/refs/heads/develop/README.md

---

## MVP prioritaire

Le MVP doit permettre cette démo :

1. Ajouter une webcam ou une vidéo locale.
2. Créer un workflow simple :

   * Source ;
   * YOLO Detection ;
   * Tracker ;
   * Confidence Filter ;
   * Event Trigger ;
   * Save Event ;
   * Overlay.
3. Lancer le workflow.
4. Voir le flux annoté en temps réel.
5. Sauvegarder les événements en SQLite.
6. Consulter les événements dans une page dédiée.
7. Voir des statistiques simples.

Tant que ce scénario ne fonctionne pas, ne pas travailler sur les fonctionnalités avancées.

---

## Documents détaillés

Lire les fichiers suivants selon la tâche :

* vision produit : `docs/01-product-vision.md`
* architecture : `docs/02-architecture.md`
* backend : `docs/03-backend.md`
* frontend : `docs/04-frontend.md`
* workflow engine : `docs/05-workflow-engine.md`
* intégration Supervision : `docs/06-supervision-integration.md`
* API REST / WebSocket : `docs/07-api.md`
* base de données : `docs/08-database.md`
* roadmap : `docs/09-roadmap.md`
* règles de développement : `docs/10-development-rules.md`

---

Référence projet : le dossier `/docs` est la source de vérité pour toute documentation. Voir aussi :

- `/docs/00-reference.md` — décrit le dossier de référence et le format de suivi des contributions ;
- `/docs/CONTRIBUTIONS.md` — (à créer) fichier de suivi des interventions et checklists.

---

## Gestion des plans et synthèses

Au début de chaque session, avant de commencer une nouvelle intervention, l'agent doit faire le point sur les plans et fichiers de progression existants :

- lire les fichiers pertinents dans `docs/progress/` ;
- identifier les checklists encore ouvertes ;
- distinguer les actions réellement restantes des éléments déjà terminés mais non cochés ;
- repérer les plans ou synthèses qui se recoupent, se contredisent ou font doublon.

Si un plan est quasiment terminé et qu'il ne reste que des détails mineurs, l'agent doit :

- terminer ou documenter clairement ces derniers détails ;
- supprimer le fichier de plan devenu obsolète ;
- créer un nouveau fichier de synthèse clair dans `docs/progress/` ;
- y résumer les actions terminées, les validations, les fichiers modifiés et les vrais points encore ouverts.

Si plusieurs plans ou synthèses font doublon, l'agent doit les reprendre et les restructurer :

- combiner les informations utiles dans un seul fichier de synthèse à jour ;
- retirer les contradictions et les checklists périmées ;
- supprimer les anciens fichiers Markdown redondants ;
- garder uniquement les fichiers de suivi qui apportent une information claire et actuelle.

Le nettoyage des fichiers Markdown de suivi fait partie de la tâche lorsque l'agent constate que les plans existants sont fragmentés, quasi terminés ou redondants.

---

## Documentation exigée par l'agent

Tout agent (ou contributeur) travaillant sur ce projet doit, à chaque intervention significative :

- documenter **ce qu'il a fait** (actions réalisées, fichiers modifiés, commandes lancées) ;
- documenter **ce qu'il reste à faire** (liste d'actions ouvertes) sous forme de checklist ;
- **mettre à jour la checklist** à chaque avancée (cocher les éléments complétés) et laisser une note de progression concise.

Ces informations doivent être ajoutées dans `CLAUDE.md` (ou un fichier de suivi dédié dans `/docs`) et reflétées dans la TODO list de l'agent utilisée pour orchestrer les tâches. Ne pas clore une tâche sans avoir mis à jour la checklist correspondante.
