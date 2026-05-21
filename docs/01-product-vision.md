# 01 — Vision produit

## But du projet

Le projet est une plateforme locale de supervision vidéo/image.

L’utilisateur doit pouvoir brancher une caméra, une vidéo ou une source RTSP, créer un workflow visuel avec des nodes, définir ce qu’il veut surveiller, puis obtenir des événements et des statistiques.

## Vision simple

```
sources vidéo → workflows par nodes → détections → événements → statistiques
```

## Exemples d’usage

* Détecter des voitures dans une zone.
* Compter des personnes.
* Surveiller un flux RTSP.
* Détecter un objet spécifique avec un modèle YOLO custom.
* Déclencher un événement si une classe dépasse un seuil de confiance.
* Analyser les événements par heure, source, zone ou classe.

## Positionnement

Le projet n’est pas seulement une interface YOLO.

La valeur principale est :

* la connexion de sources multiples ;
* la création de workflows visuels ;
* le déclenchement d’événements ;
* la visualisation temps réel ;
* les statistiques ;
* le fonctionnement local.

## Fonctionnement local

La plateforme doit fonctionner en local sur PC.

Par défaut :

* pas de cloud obligatoire ;
* pas d’envoi d’image externe ;
* stockage local ;
* modèles locaux ;
* base SQLite locale.

## MVP attendu

Le MVP doit permettre :

1. Ajouter une source webcam ou vidéo.
2. Appliquer YOLO.
3. Voir les détections en live.
4. Créer des événements.
5. Sauvegarder les événements.
6. Voir les statistiques simples.
