# Vignettes Leclerc

PWA gratuite pour cocher sa collection de vignettes Leclerc, suivre ses doubles et échanger avec ses potes via QR code.
Pas de compte, pas de serveur : tout est stocké dans le navigateur (`localStorage`).

## Fonctionnalités

- Grille de vignettes : un tap = +1 (mode « Retirer » pour corriger), filtres manquantes / possédées / doubles.
- Doubles et manquantes, avec un bouton pour copier / partager les listes.
- Échange : chaque appli génère un QR code (lien `#/s/<édition>/<comptes>/<prénom>`). L'autre le scanne (appli ou appareil photo), choisit les vignettes à échanger et confirme : sa collection se met à jour, puis un QR de confirmation (`#/x/…`) permet à l'autre de cocher l'échange de son côté. Annulation possible.
- Sauvegarde : export / import JSON.
- Visuels : les images des cartes sont dans `img/cartes/` (`001.webp`… `108.webp`, puis `109.webp`… pour les fixeez). Sans image, une silhouette générique est affichée.
- Plusieurs éditions (une par année) via `collections/`.

## Ajouter la liste des vignettes de l'année

Éditer `collections/2026.json` :

```json
{
  "id": "2026",
  "title": "Disney 2026",
  "items": [
    { "n": 1, "name": "Mickey" },
    { "n": 2, "name": "Minnie", "type": "brillante" }
  ]
}
```

Les fixeez (autocollants non numérotés) : `"fixeezTotal": 24`, puis des items `{ "n": 109, "kind": "fixeez", "name": "…" }` (n = nombre de cartes + rang). Sans nom, ils s'affichent F1, F2…

## Nouvelle année

1. Créer `collections/2027.json` (même format, nouvel `id`).
2. L'ajouter dans `collections/index.json` et mettre `default` sur la nouvelle édition.
3. Incrémenter la version dans `version.js` (affichée dans Sauvegarde et utilisée pour le cache) pour que les installations existantes se mettent à jour.

Les anciennes éditions restent consultables via le sélecteur en haut ; les progressions sont conservées par édition.

## Développement local

Le service worker et la caméra demandent `localhost` ou HTTPS :

```
npx serve .
```

## Déploiement (GitHub Pages)

Repo → Settings → Pages → Deploy from a branch → `main` / `(root)`.
L'appli est ensuite sur `https://mariekathline.github.io/leclerc-disney/`.

## Licences des librairies embarquées (`lib/`)

- [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) (MIT)
- [jsQR](https://github.com/cozmo/jsQR) (Apache-2.0)
