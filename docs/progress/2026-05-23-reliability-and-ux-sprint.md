# Sprint fiabilité & UX

Date : 2026-05-23
Statut : ✅ implémenté — smoke MVP validé, tests avancés encore ouverts

Objectif : combler les 5 angles morts identifiés dans le topo (hors notifs et multi-cam qui sont des sprints à part entière).

---

## 1. Bug latent : `cv2.CAP_PROP_FPS` dans `test_source`

### Constat

`backend/app/services/source_service.py::test_source` faisait :

```python
fps = cap.get(cv2.CAP_PROP_FPS) or None
```

mais `cv2` n'est jamais importé au module-level (seulement via le helper `_cv2()`). Le `try/except` autour capturait silencieusement le `NameError` et le user voyait l'erreur sous forme `name 'cv2' is not defined` dans la colonne Test de la page Sources. Cassait toute la fonctionnalité Test pour **toutes** les sources.

### Fix

Hardcode la valeur de la constante OpenCV (`CAP_PROP_FPS = 5`) avec commentaire. Ça marche aussi bien avec mes custom captures (`HttpPollCapture`, `ImageFolderCapture`) qui exposent `get(int)`.

---

## 2. Auto-restart des workflows au boot

### Constat

Après chaque reboot du backend, les workflows `enabled=True` ne redémarraient pas : l'utilisateur devait re-cliquer Start manuellement. Rédhibitoire pour quelqu'un qui veut laisser tourner la plateforme 24/7.

### Fix

`workflow_service.restart_enabled_workflows()` appelée dans le `lifespan` de `main.py`, après `init_db()` et `migrate_zone_coordinates()` :

- Récupère tous les workflows `enabled=True`
- Pour chacun : trouve le node `source`, test la source via `source_service.test_source` (off main thread)
- Si OK → `stream_manager.start_stream(wf.id, wf, source)`
- Sinon → log un warning et passe (l'utilisateur pourra re-activer manuellement)

Robuste : silencieusement skip les workflows dont la source a disparu ou est devenue inatteignable. Log un récap "auto-restart: resumed N workflow(s)".

---

## 3. `/api/health` enrichi + per-workflow stats

### Backend

Nouveau module-level state dans `stream_manager.py` :

```python
_stream_stats: dict[int, dict] = {}   # workflow_id → {source_id, started_at, frames_total, last_frame_at, fps_smoothed}
```

Initialisé au démarrage d'un workflow, mis à jour à chaque frame avec un FPS lissé exponentiellement (`0.85 * prev + 0.15 * inst`), purgé au stop.

Helpers exposés : `get_stream_stats(workflow_id)` et `all_running_stats()`.

### `/api/health` étendu

```json
{
  "status": "ok",
  "device": {"device": "cuda", "cuda_available": true, "gpu_name": "RTX 4080", "gpu_count": 1},
  "workflows": {
    "running_count": 2,
    "ids": [3, 7],
    "stats": {
      "3": {"source_id": 1, "started_at": …, "frames_total": 12345, "last_frame_at": …, "fps_smoothed": 14.8},
      "7": {…}
    }
  },
  "training": {"current_job_id": 5}
}
```

### `/api/workflows/{id}/status` étendu

Renvoie `{running: bool, stats: {…}}` au lieu de `{running: bool}` seul.

---

## 4. Workflow export / import JSON

### Backend

- `GET /api/workflows/{id}/export` → blob portable `{version, name, nodes, edges, exported_at}` (pas d'ID DB)
- `POST /api/workflows/import` body = blob → crée un nouveau workflow

### Frontend

- Boutons **Export** et **Import** sous Save/Run dans la sidebar du Workflow Builder
- Export : génère un Blob, télécharge `<safe-name>.json`
- Import : `<input type="file" hidden>` + parse JSON + valide nodes/edges + appelle l'API
- Notice de succès/erreur via le système existant

### Use-cases débloqués

- Backup d'un workflow avant un refactor
- Cloner un workflow (export + import + renommer)
- Partager un workflow entre deux instances OpenMonitorVision
- Versionner ses workflows dans Git

---

## 5. Events page — filtres avancés + détail modal

### Backend

- `event_service.list_events` étendu avec 3 nouveaux filtres :
  - `min_confidence: float`
  - `since: datetime`
  - `until: datetime`
- Route `GET /api/events?…` : nouveaux query params correspondants
- Route `GET /api/events/{id}/frame` → `FileResponse` du JPEG snapshot (404 si pas de `frame_path`)

### Frontend

`EventsPage.tsx` ré-écrit :

**Filtre bar (Card)** : 6 colonnes
- Classe (Input texte)
- Source (Select de toutes les sources)
- Workflow (Select de tous les workflows)
- Min confidence (number, 0-1, step 0.05)
- From / To (datetime-local)
- Compteur "N filter(s) active" + bouton **Reset filters**

**Tableau**
- Source et Workflow affichés en clair (nom, pas ID)
- Click ligne → ouvre le modal de détail (au lieu d'agir uniquement sur Delete)
- CSV export incluant les noms (pas les IDs)
- "Clear filtered" scope la bulk-delete aux filtres source/workflow actifs

**Modal de détail**
- Header : badge classe + confidence + ID event + timestamp lisible
- Layout 3 colonnes :
  - 2/3 : frame snapshot plein écran si dispo (`<img src="/api/events/{id}/frame">`). HEAD-probe au montage pour détecter l'absence et afficher une placeholder propre avec hint "enable save_frame on the Save Event node"
  - 1/3 : métadonnées (source name, workflow name, class_id, tracker_id, zone, bbox, frame_path)
- Boutons : Delete (efface + ferme), Close

---

## Fichiers modifiés / créés

**Backend**
- `app/services/source_service.py` (cv2 NameError fix)
- `app/services/workflow_service.py` (`restart_enabled_workflows`)
- `app/services/event_service.py` (filtres `min_confidence/since/until`)
- `app/api/routes_events.py` (params + endpoint frame)
- `app/api/routes_workflows.py` (export/import + status enrichi)
- `app/runtime/stream_manager.py` (stats + helpers)
- `app/main.py` (lifespan : auto-restart + health enrichi)

**Frontend**
- `frontend/src/api/workflows.ts` (`exportJson`, `importJson`)
- `frontend/src/api/events.ts` (filtres + `frameUrl`)
- `frontend/src/pages/WorkflowBuilderPage.tsx` (boutons Export/Import + handlers)
- `frontend/src/pages/EventsPage.tsx` (ré-écrit avec filtres + modal)

---

## Validations

- TypeScript frontend : aucune erreur
- Python backend : compile clean
- Nouvelles routes vérifiées présentes :
  - `/api/events/{event_id}/frame`
  - `/api/workflows/{workflow_id}/export`
  - `/api/workflows/import`
  - `/api/health` (enrichi)
  - `/api/workflows/{workflow_id}/status` (enrichi)
- 2026-05-23 : validations automatisées ajoutées
  - `test_health_ok` vérifie maintenant les sections `workflows` et `training` de `/api/health` ;
  - `test_workflow_status` vérifie la présence de `stats` dans `/api/workflows/{id}/status` ;
  - `test_workflow_export_import` couvre les routes backend export/import ;
  - suite backend : `69 passed`.
- 2026-05-23 : stabilisation MVP finale
  - backend venv recréé en Python 3.12.7 ;
  - suite backend complète : `70 passed` avec temp local `.tmp/pytest` ;
  - TypeScript frontend : OK ;
  - build Vite : OK hors sandbox ;
  - smoke MVP backend : source vidéo locale, workflow, WebSocket frame, events SQLite et stats OK ;
  - smoke UI navigateur : Overview, Sources, Workflows, Live, Events et Models chargent ;
  - correction du warning React `SourcesPage` sur les fragments sans clé.

---

## Reste en suspens (sprints futurs)

| Item | Effort estimé |
|---|---|
| **Notifications** (webhook + email) | 1-2 h |
| **Multi-cam live view** (grille N×N) | 1-2 h |
| **Auth basique** (single password) | 1 h |
| **Logs UI** (tail des logs backend depuis WebUI) | 30 min |
| **Per-source frame dimensions** (sortir frame_width/height du settings global) | 1 h |
| **Workflow templates** (cloner un preset) | 30 min |
| **Plugin system pour nodes** | sprint dédié |

---

## À tester (à la fin du dev)

- [x] Cliquer/tester une source vidéo locale → dimensions OK (`810 x 1080`, `fps=5`, backend OpenCV)
- [x] Démarrer un workflow MVP → vérifier frame WebSocket, détections, events et stats
- [x] `curl /api/health` → vérifier la présence des sections `workflows` et `training` (validé par test API automatisé)
- [x] Export workflow validé côté backend par test automatisé et smoke API
- [x] Page Events chargée en navigateur avec filtres, table et events du smoke test
- [ ] Tester chaque type de source en UI : webcam, RTSP, stream web, image_url, image_folder
- [ ] Tester export/import workflow par boutons UI
- [ ] Tester le modal Events en interaction UI complète : snapshot, delete, clear filtered
