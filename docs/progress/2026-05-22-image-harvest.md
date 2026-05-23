# Récolte d'images (import dossier + harvest node)

Date : 2026-05-22
Statut : ✅ implémenté — à tester end-to-end

---

## Objectif

Préparer plus facilement les datasets d'entraînement :

- soit en piochant un **dossier d'images** déjà présent sur le PC
- soit en **récoltant des frames** au fil d'un workflow qui tourne (avec règles : tous les N frames, toutes les X secondes, ou uniquement quand le YOLO détecte quelque chose)

---

## 1. Import dossier local

### Backend

- `dataset_service.import_folder(db, name, files, classes)` — itère les `UploadFile`, filtre aux extensions image, déduplique les collisions de stems, écrit images dans `images/train/` + label vide dans `labels/train/`, génère `classes.txt` et `data.yaml` canonique
- Route `POST /api/datasets/from-folder` (multipart : `name`, `classes` CSV, `files[]`)

### Frontend

- Bouton **From folder** dans `DatasetsSection` (entre From source et Import zip)
- Formulaire : nom + classes CSV + `<input type="file" webkitdirectory directory multiple accept="image/*">`
- Filtre côté navigateur aux extensions `.jpg/.jpeg/.png/.bmp/.webp`
- Compteur live "X images selected"
- `datasetsApi.uploadFolder(name, classes, files)` envoie en multipart

---

## 2. Harvest node (récolte depuis un workflow)

### Backend

- `app/engine/nodes/harvest_node.py` — nouveau node `harvest`
- Config :
  - `dataset_id` (int, obligatoire) — dataset cible
  - `mode` — `'every_n' | 'every_seconds' | 'on_detection'`
  - `n` — intervalle de frames (mode every_n)
  - `interval_seconds` — espacement wall-clock (mode every_seconds)
  - `max_frames` — plafond (0 = illimité)
  - `save_annotated` — sauvegarde la frame avec overlay au lieu de la frame brute
- State par `(workflow_id, node_id)` : compteur de frames, nb d'images sauvegardées, timestamp de dernier save
- Si `mode == 'on_detection'` ET il y a des détections : sauvegarde la frame, **et seed le `.txt` avec les boxes YOLO normalisées** (utilise `context.detections.xyxy + class_id`). L'utilisateur a juste à raffiner via l'annotateur.
- `cv2.imwrite` exécuté dans `asyncio.to_thread` pour ne pas bloquer la loop
- Compteurs du dataset rafraîchis tous les 10 saves pour ne pas marteler la DB
- Reset du state via `reset(workflow_id)` appelé depuis `stream_manager.stop_stream()`

### Frontend

- Ajout à `NODE_DEFINITIONS` (groupe **Output**, couleur `#facc15`) avec summary dynamique
- Icon SVG personnalisé (paniers/escabeau)
- `HarvestInspector` (composant dédié) :
  - Select de dataset (depuis la liste fetchée au mount du builder)
  - 3 cartes radio pour le mode, avec hint explicatif
  - Slider/input pour N ou interval selon le mode
  - Plafond max_frames
  - Toggle "save annotated frame"
  - Tip pédagogique sur le workflow "scout"
- `WorkflowBuilderPage` fetche les datasets au mount et les passe au `NodeInspector`

---

## Use-cases typiques débloqués

1. **Préparation manuelle** : utilisateur a déjà un dossier d'images → **From folder** → annoter via le bouton **Annotate** → entraîner
2. **Pré-labellisation automatique** : créer un workflow `Source → YOLO Detect (modèle générique) → Harvest (on_detection)` → laisser tourner sur une caméra/vidéo → le dataset se remplit avec des frames pré-labellisées au format YOLO → l'utilisateur n'a qu'à corriger les boxes via l'annotateur
3. **Collecte continue** : `Source → Harvest (every_seconds=30)` → un instantané toutes les 30s sur 24h = 2880 frames pour annotation
4. **Capture évènementielle** : `Source → YOLO → Zone Filter → Harvest (on_detection)` → ne récolte que les frames où il se passe quelque chose **dans une zone précise**

---

## Fichiers créés / modifiés

**Backend**
- `app/engine/nodes/harvest_node.py` (nouveau)
- `app/engine/node_registry.py` (registre)
- `app/runtime/stream_manager.py` (reset du state au stop)
- `app/services/dataset_service.py` (`import_folder`)
- `app/api/routes_datasets.py` (`POST /from-folder`)

**Frontend**
- `frontend/src/api/datasets.ts` (`uploadFolder`)
- `frontend/src/pages/TrainingPage.tsx` (button + form **From folder**)
- `frontend/src/pages/WorkflowBuilderPage.tsx` :
  - import `datasetsApi` + type `Dataset`
  - state `datasets` + fetch au mount
  - prop `datasets` plumée jusqu'à `NodeInspector`
  - définition node `harvest` (palette + icon)
  - composant `HarvestInspector`

---

## À tester

- [ ] **From folder** : sélectionner un dossier de 20 images, vérifier que le dataset apparaît avec `num_train=20` et `classes=[…]` issus du CSV
- [ ] Cliquer **Annotate** sur ce dataset → annoter quelques images → entraîner → vérifier que le best.pt apparaît dans Models
- [ ] **Harvest mode every_n** : créer un workflow `Source → Harvest(every_n=10, max=30)`, lancer, attendre 30 saves, vérifier le compteur `num_train` du dataset (rafraîchi par paquets de 10)
- [ ] **Harvest mode on_detection** : `Source → YOLO Detect → Harvest(on_detection)`, lancer sur une vidéo qui contient des objets, vérifier que les `.txt` créés contiennent les boxes pré-labellisées (pas vides)
- [ ] Stopper le workflow puis le relancer → le compteur de saves repart à 0 (reset_harvest dans stop_stream)
- [ ] Ouvrir l'annotateur sur le dataset harvesté → vérifier que les boxes pré-labellisées s'affichent et peuvent être corrigées
