# Progression - 2026-05-22 - Redesign nodes + Zone Filter

## Actions realisees

### Frontend - Redesign WorkflowBuilderPage
- Refonte du composant `WorkflowNodeCard` React Flow:
  - stripe coloree verticale;
  - icone SVG inline par type de node;
  - badge groupe;
  - handles personnalises;
  - etat selectionne avec bordure coloree et glow ring;
  - resume compact de configuration.
- Palette de nodes groupee par categorie: Input, Vision, Filter, Event, Output.
- Toggle switch CSS.
- `NumberField` avec track colore et valeur monospace.
- Inspector avec header sticky, icone, label, groupe et sections nommees.
- Boutons Run/Stop dans la sidebar.
- Polling du statut workflow toutes les 3 secondes.
- Edges animes quand le workflow tourne.
- Ajout du node `zone_filter` dans `NODE_DEFINITIONS`.

### Frontend - Editeur polygonal Zone Filter
- Remplacement du textarea JSON par un editeur SVG visuel.
- Creation/suppression de zones.
- Ajout de points directement sur le canvas.
- Deplacement des points par drag.
- Suppression d'un point par double-clic.
- Affichage compact des points et coordonnees.
- Normalisation du format envoye au backend: `{ name, points: [[x, y], ...] }`.

### Frontend - Projection LiveView
- Projection des zones du workflow selectionne au-dessus du flux live.
- Mode edition dans LiveView avec selection de zone, ajout/deplacement/suppression de points.
- Sauvegarde des zones editees via `workflowsApi.update()`.

### Backend - ZoneFilterNode
- Nouveau fichier `backend/app/engine/nodes/zone_filter_node.py`.
- Filtre les detections par zones polygonales via `sv.PolygonZone.trigger()`.
- Union des masques si plusieurs zones sont definies.
- Skip gracieux si `supervision` est indisponible ou si les points sont insuffisants.
- Enregistrement dans `node_registry.py`.

### Corrections liees
- Correction TypeScript du helper SVG `NodeIcon`.
- `api.delete<T>()` accepte les endpoints DELETE retournant un payload JSON.
- `DashboardPage` est chargee en lazy route pour finaliser le code splitting.
- Correction layout plein ecran:
  - `html`, `body` et `#root` occupent maintenant tout le viewport;
  - suppression des largeurs maximales des pages principales;
  - shell applicatif force en `w-screen`;
  - echelle typographique Tailwind legerement augmentee pour eviter l'effet "dezoome".

## Fichiers modifies

- `frontend/src/pages/WorkflowBuilderPage.tsx`
- `frontend/src/pages/LiveViewPage.tsx`
- `frontend/src/pages/DashboardPage.tsx`
- `frontend/src/pages/SourcesPage.tsx`
- `frontend/src/pages/EventsPage.tsx`
- `frontend/src/pages/ModelsPage.tsx`
- `frontend/src/components/Layout.tsx`
- `frontend/src/index.css`
- `frontend/tailwind.config.js`
- `frontend/src/api/client.ts`
- `frontend/src/App.tsx`
- `backend/app/engine/nodes/zone_filter_node.py`
- `backend/app/engine/node_registry.py`
- `docs/progress/2026-05-22-node-redesign-zone-filter.md`

## Validations

- `npm.cmd run build` : OK, plus de warning chunk > 500 kB.
- `python -m pytest tests -q` : 31 passed, 18 warnings.
- `python -m compileall app` : OK.
- Smoke UI Playwright : `/workflows` et `/live` OK, surfaces `Add node` et `Zones` visibles.
- `npm.cmd run build` : OK apres correction layout plein ecran.

## Checklist mise a jour

- [x] Redesign visuel des nodes React Flow.
- [x] Icones SVG inline par type de node.
- [x] Stripe coloree verticale + handles personnalises.
- [x] Selection avec glow ring.
- [x] Palette groupee par categorie.
- [x] Toggle switch CSS.
- [x] NumberField avec track slider colore.
- [x] Inspector sticky header + sections.
- [x] Boutons Run/Stop workflow dans la sidebar.
- [x] Animation des edges synchronisee avec l'etat running.
- [x] Zone Filter node backend.
- [x] Editeur polygonal visuel Zone Filter dans le Workflow Builder.
- [x] Route/API de validation workflow avant sauvegarde.
- [x] Validation integree dans WorkflowBuilderPage.
- [x] UI erreurs de demarrage workflow dans LiveViewPage.
- [x] UI erreurs creation source dans SourcesPage.
- [x] Bulk delete events.
- [x] Cleanup frames.
- [x] Bouton `Clear all` dans EventsPage.
- [x] Tests backend automatises.
- [x] Smoke UI workflow builder/live view.
- [x] Code splitting frontend.
- [x] Projection/edition des zones sur la page LiveView avec image live reelle.
- [x] Layout frontend plein ecran, sans contenu contraint en haut a gauche.
