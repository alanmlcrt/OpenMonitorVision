# Fix coordonnées zones + Annotateur in-app

Date : 2026-05-22
Statut : ✅ implémenté — à tester end-to-end

---

## 1. Fix bug coordonnées des zones

### Constat

- Backend : `_resize_frame(frame, 1280, 720)` dans `stream_manager` (= `settings.frame_width × frame_height`)
- `zone_filter_node` passait les polygones **en pixels bruts** à `sv.PolygonZone`
- Frontend : SVG du Workflow Builder et du Live View dessinaient dans un repère **`640 × 360`**
- Résultat : les zones étaient appliquées dans le **quart en haut-à-gauche** de la frame réelle, le filtrage par zone retournait des faux négatifs systématiques

### Fix

**Frontend** — alignement sur les dims natives du backend :
- `frontend/src/pages/LiveViewPage.tsx` : `FRAME_WIDTH/HEIGHT` → `1280 × 720`
- `frontend/src/pages/WorkflowBuilderPage.tsx` : `editorWidth/editorHeight` → `1280 × 720` (2 occurrences)
- Le SVG s'adapte par CSS, donc la taille visible ne change pas — seul le repère interne (viewBox) est désormais cohérent avec le backend

**Backend** — migration one-shot des zones existantes :
- `app/services/workflow_service.py::migrate_zone_coordinates()` :
  - parcourt tous les workflows
  - pour chaque `zone_filter` node, multiplie les points par `(1280/640, 720/360) = (2, 2)`
  - pose un flag `_zones_scale_v2` dans le config du node → idempotent
  - utilise `flag_modified(wf, "nodes")` car SQLAlchemy ne détecte pas les mutations in-place de JSON
- Appelée dans le `lifespan` de `app/main.py`, juste après `init_db()`

### Conséquence

- Au prochain boot du backend, toutes les zones existantes seront re-scalées **une fois**.
- Les nouvelles zones (dessinées via Workflow Builder ou LiveView) sont sauvegardées d'office dans le bon repère.
- Le node de filtrage par zone fonctionne désormais comme attendu.

---

## 2. Annotateur YOLO in-app

### Backend

- `app/schemas/dataset.py` : nouveaux schémas `DatasetImage`, `YoloBox`, `LabelRead`, `LabelWrite`
- `app/services/dataset_service.py` :
  - `list_images(dataset)` : énumère train + val avec stem, dims, et état d'annotation
  - `image_path(dataset, stem, split)` : résout le chemin disque (multi-extension)
  - `read_label / write_label` : parse / écrit le format YOLO (`class_id cx cy w h` normalisé 0-1)
  - Clamp 0-1 + filtre les boxes de largeur ou hauteur nulle, valide `class_id < len(dataset.classes)`
- `app/api/routes_datasets.py` : 4 endpoints
  - `GET /api/datasets/{id}/images` → liste avec stem, filename, split, width, height, label_count
  - `GET /api/datasets/{id}/image?stem=…&split=…` → `FileResponse` de l'image (multi-format)
  - `GET /api/datasets/{id}/label?stem=…&split=…` → `LabelRead` (boxes normalisées)
  - `PUT /api/datasets/{id}/label?stem=…&split=…` body `{boxes: YoloBox[]}` → écrit le `.txt`

### Frontend

- `components/training/Annotator.tsx` (nouveau, ~370 lignes) :
  - Modal plein écran déclenché par un bouton **Annotate** sur chaque dataset
  - **Canvas** : `<img>` + SVG overlay (viewBox = dimensions natives de l'image, `preserveAspectRatio="none"` pour matcher l'image affichée)
  - **Dessin** :
    - click-drag dans une zone vide → nouvelle box dans la classe active
    - click sur une box existante → sélection
    - drag corps → déplacement avec clamping
    - drag d'un des 4 handles d'angle → redimensionnement
  - **Classes** : palette à droite, 10 couleurs distinctes cyclées, hotkeys `1`–`9` pour activer / assigner
  - **Liste de boxes** : panneau de droite avec sélection et suppression individuelle
  - **Image strip** : grille de miniatures cliquables avec point vert = annotée
  - **Keyboard** : `←`/`→` navigation (auto-save avant changement si dirty), `s` save, `Del` supprimer la box sélectionnée, `Esc` close, `1`-`9` classe
  - **State sync** : badge `Unsaved` quand dirty, auto-save lors de la navigation, le label_count local est mis à jour après save pour rafraîchir le point d'annotation
- `types/index.ts` : `DatasetImage` + `YoloBox`
- `api/datasets.ts` : `listImages`, `imageUrl`, `getLabel`, `putLabel`
- `pages/TrainingPage.tsx` : bouton **Annotate** dans chaque ligne dataset, `<Annotator>` rendu au top level (modal-style), `onClose` recharge la liste pour rafraîchir les comptes/badges

### UX et limites

- L'annotateur sait gérer des datasets de toute taille. La strip de miniatures utilise `loading="lazy"`.
- Une box doit faire ≥ 4 px de chaque côté à la création (filtre les clicks accidentels).
- La normalisation 0-1 utilise les **dimensions naturelles de l'image** (lues à l'`onLoad` de `<img>` si différentes du backend) — robuste si les images ont des résolutions hétérogènes.
- Les fichiers `.txt` sont écrits dans `labels/{split}/{stem}.txt` comme attendu par Ultralytics.

### Fichiers modifiés / créés

**Backend**
- `app/schemas/dataset.py` (étendu)
- `app/services/dataset_service.py` (étendu — list/read/write label + helpers `_image_size`, `_count_label_boxes`, `_clamp01`)
- `app/api/routes_datasets.py` (étendu — 4 endpoints annotation)
- `app/services/workflow_service.py` (étendu — migration zones)
- `app/main.py` (lifespan — appel migration)

**Frontend**
- `frontend/src/components/training/Annotator.tsx` (nouveau)
- `frontend/src/api/datasets.ts` (étendu)
- `frontend/src/types/index.ts` (étendu)
- `frontend/src/pages/TrainingPage.tsx` (bouton + modal trigger)
- `frontend/src/pages/LiveViewPage.tsx` (constantes 1280×720)
- `frontend/src/pages/WorkflowBuilderPage.tsx` (constantes 1280×720, 2 occurrences)

---

## 3. À tester (après le sprint global)

- [ ] Workflow existant avec zone polygonale : au premier boot post-fix, vérifier que la zone est re-scalée (× 2) et qu'elle filtre maintenant la bonne région de la frame
- [ ] Dessiner une nouvelle zone via Workflow Builder → vérifier qu'elle est sauvée dans le bon repère et filtre correctement
- [ ] Idem via Live View
- [ ] Upload d'un dataset YOLO → cliquer Annotate → naviguer entre images, dessiner / redimensionner / supprimer des boxes, save, fermer, rouvrir → vérifier que les boxes sont persistées
- [ ] Hotkeys 1-9 / `s` / `←` `→` / `Del`
- [ ] Bug case : dataset capturé depuis une Source (labels initialement vides) → annoter quelques images → vérifier que `validate` ne warn plus "all labels empty" si des boxes existent
- [ ] Lancer un training sur un dataset annoté in-app → vérifier que le training tourne et converge
