# Sources additionnelles : image_url + image_folder

Date : 2026-05-22
Statut : ✅ implémenté — à tester end-to-end

---

## Pourquoi

Il n'existe pas de standard "RSS pour images", mais deux patterns sont très répandus et n'étaient pas couverts :

1. **HTTP snapshot URL** — une URL qui renvoie un JPEG à chaque GET. C'est la moitié des vieilles IP cams et énormément de webcams publiques (météo, trafic, etc.)
2. **Dossier d'images** — un répertoire local d'images qu'on cycle comme une vidéo. Utile pour rejouer un dataset capturé, débugger un workflow sur des frames reproductibles, ou faire du batch processing.

---

## Architecture

Plutôt que de tordre `cv2.VideoCapture`, nouvelles classes qui **miment son interface** (`isOpened()`, `read()`, `release()`, `get()`) dans `app/runtime/captures.py`. Le runtime utilise déjà uniquement ces méthodes — drop-in replacement.

### `HttpPollCapture`

- Probe la URL à la construction (HEAD/GET 1 byte) pour que `if cap is None` du runtime fonctionne correctement
- `read()` fait un GET via `urllib.request` (stdlib, zéro nouvelle dep), décode via `cv2.imdecode`
- Rate-limit interne à 10 req/s minimum (combiné au `settings.max_fps` du runtime)
- User-Agent custom (`Mozilla/5.0 (OpenMonitorVision)`) car certains firmwares de caméras rejettent les requêtes sans UA
- Timeout 8s, erreurs silencieuses → renvoie `(False, None)` que le runtime gère déjà (reopen logic existante)

### `ImageFolderCapture`

- Glob du dossier à la construction → liste triée lexicographiquement
- `read()` renvoie l'image suivante via `cv2.imread`, skip les fichiers corrompus
- Loop automatique en fin de séquence (configurable, par défaut `loop=True`)
- Extensions supportées : `.jpg`, `.jpeg`, `.png`, `.bmp`, `.webp`

---

## Wiring

- `app/schemas/source.py` : `SourceType` étendu avec `image_url` et `image_folder`
- `app/services/source_service.py::_open_capture` : nouveaux branches qui retournent les captures custom
- `app/runtime/stream_manager.py::_open_capture` : idem (utilisé par le live)
- `frontend/src/types/index.ts` : `SourceType` étendu
- `frontend/src/pages/SourcesPage.tsx` :
  - Labels, placeholders, valeurs par défaut pour les deux nouveaux types
  - Label du champ URI adapté ("Snapshot URL" / "Folder path")
  - Notes explicatives sous le champ pour chaque type

---

## Résolution — réponse à la question

Le backend `_resize_frame` ramène **toute frame entrante** à `settings.frame_width × frame_height` (1280×720 par défaut) avant inférence. Donc :

- 480p, 720p, 1080p, 4K → toutes traitées comme 1280×720
- Une caméra 4K ne gagne rien en précision YOLO vs une 720p (la résolution est perdue avant inférence)
- L'annotateur in-app utilise les **dimensions natives de l'image** pour la normalisation YOLO 0-1, pas le `1280×720` du runtime — donc les datasets sont propres quelle que soit la résolution source

**À faire un jour si nécessaire** : sortir `frame_width/height` du `settings` global et le mettre par-source pour pouvoir garder du 4K natif sur une caméra à petits objets distants.

---

## Bugs latents notés au passage

Dans `source_service.test_source` :

```python
fps = cap.get(cv2.CAP_PROP_FPS) or None
```

`cv2` n'est pas importé au module level (seulement via le helper `_cv2()`). Cette ligne lèverait un `NameError` au runtime. Pas dans le scope de cette tâche — à fixer dans un prochain pass de fiabilité.

---

## À tester

- [ ] Créer une source `image_url` pointant sur une webcam publique snapshot (ex: `https://webcams.nyctmc.org/api/cameras/.../snap.jpg`) → Test → vérifier que ça renvoie OK + dimensions
- [ ] Preview de cette source dans la page Sources → image affichée
- [ ] Lancer un workflow utilisant cette source → flux live affiche les snapshots cyclés
- [ ] Créer une source `image_folder` pointant sur un dossier local de 50 images → Test → vérifier dims
- [ ] Lancer un workflow utilisant cette source → vérifier que le live cycle bien les images en loop
- [ ] Couper le réseau pendant un `image_url` → vérifier que la reopen logic du stream_manager récupère propre quand le réseau revient
