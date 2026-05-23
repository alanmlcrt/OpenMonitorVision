# 2026-05-23 - Satellite monitoring MVP

## Objectif

Ajouter une premiere capacite de monitoring d'images satellite :

- definir des zones geographiques a surveiller ;
- importer des scenes satellite au format STAC ;
- conserver les metadonnees utiles des scenes ;
- declencher des evenements quand une scene intersecte une zone ;
- visualiser les zones, footprints, scenes et evenements dans une page dediee ;
- exposer les briques dans le workflow engine.

## Actions realisees

Backend :

- Ajout des modeles `SatelliteArea` et `SatelliteScene`.
- Ajout des schemas Pydantic satellite.
- Ajout d'un service satellite pour les AOI, scenes, import STAC, recherche STAC, monitoring et stats.
- Ajout des routes `/api/satellite/*`.
- Ajout du type de source `satellite`.
- Ajout des nodes `satellite_scene` et `geo_zone_trigger`.
- Ajout de tests backend dedies au monitoring satellite.

Frontend :

- Ajout des types TypeScript satellite.
- Ajout du client API `frontend/src/api/satellite.ts`.
- Ajout de la page `/satellite`.
- Ajout d'une carte SVG locale pour visualiser AOI, footprints et evenements sans dependance cloud.
- Ajout des entrees de navigation et du type de source satellite.
- Ajout des nodes satellite/geozone dans le Workflow Builder.

Documentation :

- Mise a jour de `docs/05-workflow-engine.md` avec les nodes satellite.
- Ajout de cette synthese de progression.
- Mise a jour de `docs/CONTRIBUTIONS.md`.

## Validations

- `backend\venv\Scripts\python.exe -m compileall app tests`
- `backend\venv\Scripts\python.exe -m pytest tests\test_satellite.py -q --basetemp=.tmp\pytest -p no:cacheprovider`
- `backend\venv\Scripts\python.exe -m pytest tests -q --basetemp=.tmp\pytest -p no:cacheprovider`
- `npx tsc --noEmit`
- `npm run build`
- Smoke UI local sur `/satellite` et `/workflows`.

Resultat des validations :

- 3 tests satellite passes.
- 76 tests backend passes.
- TypeScript OK.
- Build frontend OK.
- Smoke UI OK : page satellite chargee, carte presente, import STAC present, nodes workflow visibles.

## Limites actuelles

- Le monitoring satellite fonctionne sur les metadonnees STAC et les footprints.
- La recherche STAC est exposee cote backend, mais l'integration Copernicus/Data Space reelle doit encore etre branchee avec les endpoints et eventuels identifiants retenus.
- Le rendu raster GeoTIFF / COG n'est pas encore implemente dans la page.
- L'analyse visuelle de l'image satellite par modele CV n'est pas encore connectee a ce nouveau flux.

## Checklist restante

- [x] Modeliser les zones geographiques et scenes satellite.
- [x] Importer des items STAC.
- [x] Declencher des evenements geolocalises depuis les intersections AOI/scene.
- [x] Ajouter une page de monitoring satellite avec carte.
- [x] Ajouter les nodes workflow satellite.
- [x] Valider backend, frontend et smoke UI.
- [ ] Brancher un fournisseur reel type Copernicus Data Space / STAC avec configuration utilisateur.
- [ ] Ajouter le telechargement ou streaming de rasters GeoTIFF / COG.
- [ ] Ajouter une couche d'analyse image satellite avec modeles CV adaptes.
- [ ] Ajouter une carte tuiles plus complete si le besoin depasse la carte SVG locale.
