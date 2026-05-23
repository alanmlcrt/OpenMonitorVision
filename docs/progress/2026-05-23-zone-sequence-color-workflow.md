# Progression - 2026-05-23 - Workflow couleur + sequence de zones

## Objectif

Rendre possible le scenario :

```text
Si une voiture verte passe dans Zone 1 puis passe aussi dans Zone 2,
alors enregistrer l'event.
```

## Actions realisees

- Ajout du node backend `color_filter`.
  - Analyse le crop de chaque detection dans l'image OpenCV courante.
  - Filtre par couleur cible via HSV.
  - Supporte notamment `green`, `blue`, `red`, `yellow`, `orange`, `white`, `black`, `gray`.
  - Ajoute `color_name` et `color_ratio` aux detections JSON conservees.
- Ajout du node backend `zone_sequence_trigger`.
  - Necessite un `Tracker` en amont.
  - Memorise l'etat par `workflow_id`, `node_id` et `tracker_id`.
  - Declenche un event quand le meme objet visite les zones dans l'ordre configure.
  - Enrichit l'event avec `zone_sequence`, `trigger_zone_name` et `sequence_duration_seconds`.
- Integration des nouveaux nodes dans `NODE_REGISTRY`.
- Reset de l'etat `zone_sequence_trigger` a l'arret d'un workflow.
- Extension de `SaveEventNode`.
  - `save_metadata=true` sauvegarde maintenant les champs enrichis non natifs dans la colonne JSON `metadata`.
  - Les colonnes custom peuvent utiliser les nouveaux placeholders comme `{color_name}` ou `{color_ratio}`.
- Extension de la serialisation detections JSON pour propager les champs `sv.Detections.data` simples.
- Extension du contexte de templates notifications pour exposer aussi les champs scalaires enrichis.
- Validation workflow etendu pour verifier les zones du node `zone_sequence_trigger`.
- Frontend Workflow Builder :
  - nouveau node `Color Filter`;
  - nouveau node `Zone Sequence`;
  - bouton `Build zone sequence`;
  - inspector couleur avec swatches;
  - inspector sequence avec editeur polygonal, ordre Zone 1 -> Zone 2, timeout, cooldown, anchor.
- Events UI :
  - affichage de `metadata` dans le modal detail event.
- Documentation `docs/05-workflow-engine.md` mise a jour.

## Fichiers modifies

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

## Validations

- `backend\\venv\\Scripts\\python.exe -m compileall app tests` : OK.
- `backend\\venv\\Scripts\\python.exe -m pytest tests\\test_engine.py -q --basetemp=.tmp\\pytest -p no:cacheprovider` : 30 tests passent.
- `backend\\venv\\Scripts\\python.exe -m pytest tests -q --basetemp=.tmp\\pytest -p no:cacheprovider` : 73 tests passent.
- `npx tsc --noEmit` : OK.
- `npm run build` :
  - echoue dans le sandbox a cause du refus d'acces esbuild connu ;
  - OK hors sandbox.
- Smoke UI Playwright avec Chrome local sur `http://127.0.0.1:5173/workflows` :
  - page chargee ;
  - bouton `Build zone sequence` visible ;
  - nodes `Color Filter` et `Zone Sequence` visibles dans la palette.

## Checklist ouverte

- [x] Ajouter un filtre couleur utilisable dans un workflow.
- [x] Ajouter un trigger de sequence de zones par `tracker_id`.
- [x] Brancher les deux nodes dans le builder.
- [x] Sauvegarder les metadonnees enrichies dans les events.
- [x] Ajouter des tests unitaires backend.
- [x] Verifier TypeScript, build frontend et smoke UI.
- [ ] Tester end-to-end sur une vraie video avec une voiture verte et deux zones dessinees.
- [ ] Ajuster les seuils HSV/couleur si la camera utilise une balance des blancs difficile.
