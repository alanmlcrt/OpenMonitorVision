# 04 — Frontend

## Stack frontend

- React
- TypeScript
- Vite
- Tailwind CSS
- React Flow
- Konva / React-Konva
- Recharts
- WebSockets

## Structure frontend

```
frontend/
└── src/
    ├── api/
    ├── components/
    ├── pages/
    │   ├── DashboardPage.tsx
    │   ├── SourcesPage.tsx
    │   ├── WorkflowBuilderPage.tsx
    │   ├── LiveViewPage.tsx
    │   ├── EventsPage.tsx
    │   ├── ModelsPage.tsx
    │   └── TrainingPage.tsx
    │
    ├── features/
    │   ├── workflow/
    │   ├── sources/
    │   ├── events/
    │   ├── live/
    │   ├── models/
    │   └── zones/
    │
    ├── hooks/
    ├── stores/
    ├── types/
    └── utils/
```

## Pages attendues

### DashboardPage

Vue globale :

* événements du jour ;
* événements par classe ;
* événements par source ;
* événements par heure ;
* état des sources ;
* état des workflows ;
* derniers événements.

### SourcesPage

Gestion des sources :

* ajouter une source ;
* modifier une source ;
* tester une source ;
* activer/désactiver ;
* supprimer ;
* afficher une preview.

### WorkflowBuilderPage

Canvas de création de workflow avec React Flow.

Fonctions :

* ajouter des nodes ;
* connecter les nodes ;
* configurer chaque node ;
* sauvegarder le workflow ;
* valider le workflow ;
* lancer/arrêter le workflow.

### LiveViewPage

Affichage temps réel :

* flux vidéo ;
* bounding boxes ;
* labels ;
* confiance ;
* tracker_id ;
* zones ;
* derniers événements.

### EventsPage

Consultation des événements :

* tableau ;
* filtres par date ;
* filtres par source ;
* filtres par classe ;
* filtres par zone ;
* export CSV.

### ModelsPage

Gestion des modèles :

* liste des modèles ;
* upload `.pt` ;
* test modèle ;
* modèle par défaut.

### TrainingPage

Prévue pour plus tard :

* import dataset ;
* configuration entraînement ;
* logs ;
* sauvegarde modèle.

## Types TypeScript principaux

Créer des types propres dans `src/types`.

Exemples :

```ts
export type Detection = {
  class_id: number;
  class_name: string;
  confidence: number;
  tracker_id?: number | null;
  bbox: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  };
  zone_name?: string | null;
};

export type Event = {
  id: number;
  timestamp: string;
  source_id: number;
  workflow_id: number;
  class_name: string;
  confidence: number;
  tracker_id?: number | null;
  zone_name?: string | null;
};
```

## Règles frontend

* Garder les composants simples.
* Ne pas mettre de logique API directement dans le JSX.
* Utiliser des types TypeScript propres.
* Isoler les appels backend dans `src/api`.
* Éviter les composants trop gros.
* Garder l’UI claire avant de chercher un design complexe.

## Inspiration UI

L’interface doit rester propre et moderne — s'inspirer d'OpenChamber pour l'esthétique et l'ergonomie : tableau de bord minimal, typographie claire, couleurs sobres, navigation latérale, et composants de contrôle nets. Utiliser Tailwind CSS et composants modulaires pour obtenir ce rendu.
