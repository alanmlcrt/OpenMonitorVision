# 10 — Règles de développement

## Simplicité

Ne pas complexifier trop tôt.

À éviter dans le MVP :

- Kafka ;
- Redis ;
- PostgreSQL ;
- microservices ;
- architecture distribuée ;
- Docker complexe ;
- TensorRT ;
- multi-GPU ;
- authentification avancée.

## Séparation des responsabilités

Les routes FastAPI ne doivent pas contenir de logique métier.

Structure attendue :

```
routes → services → engine/runtime → db
```

## Nodes indépendants

Chaque node doit faire une seule chose.

Bon exemple :

```text
YOLO Detection Node → détecte
Tracker Node → suit les objets
Class Filter Node → filtre par classe
Zone Filter Node → filtre par zone
Save Event Node → sauvegarde
Overlay Node → annote la frame
```

Mauvais exemple :

```text
un node unique qui détecte, track, filtre, sauvegarde et affiche
```

## Utilisation propre de Supervision

Le code `supervision` doit être centralisé dans :

```
backend/app/services/supervision_service.py
```

Ne pas disperser les appels `sv.*` partout.

## Format de données propre

Toujours utiliser :

* Pydantic côté backend ;
* types TypeScript côté frontend ;
* JSON stable entre backend et frontend.

Ne jamais exposer directement :

* objets OpenCV ;
* objets Ultralytics ;
* objets Supervision ;
* objets SQLAlchemy.

## Device CUDA/CPU

La logique de sélection dudevice doit être centralisée dans :

```
backend/app/core/device.py
```

Ordre de priorité :

1. CUDA si disponible ;
2. CPU sinon.

Le système doit fonctionner même sans GPU.

Remarque : Suivre les recommandations de la stack `roboflow/supervision` pour la compatibilité des versions et l'installation des dépendances. README : https://raw.githubusercontent.com/roboflow/supervision/refs/heads/develop/README.md

## Robustesse vidéo

Le backend doit gérer :

* source inaccessible ;
* frame vide ;
* RTSP déconnecté ;
* caméra déjà utilisée ;
* fichier vidéo introuvable ;
* modèle absent ;
* CUDA indisponible ;
* GPU saturé ;
* fallback CPU.

## Performance

Limiter :

* FPS envoyé au frontend ;
* taille des frames ;
* nombre de messages WebSocket ;
* nombre d’événements écrits par seconde.

Le backend doit rester utilisable sur un PC classique.

## Privacy by design

Par défaut :

* tout reste local ;
* ne pas envoyer d’image vers le cloud ;
* ne pas faire de reconnaissance faciale ;
* ne pas identifier des personnes ;
* permettre de désactiver la sauvegarde des frames ;
* prévoir la suppression des événements.

## Définition de Done

Une tâche est terminée seulement si :

* le code fonctionne localement ;
* l’API est testable ;
* le frontend affiche correctement les données ;
* les erreurs principales sont gérées ;
* le code est lisible ;
* les types sont propres ;
* les changements importants sont documentés.

## Priorité générale

Toujours privilégier :

```
simple → fonctionnel → propre → extensible
```

Ne pas chercher l’architecture parfaite avant d’avoir un MVP fonctionnel.
