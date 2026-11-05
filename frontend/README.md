# Interface de codeguard

Application React 19 servie par `codeguard ui`. Le build est versionné dans
`src/codeguard/ui/static` : installer le paquet Python ne demande donc pas Node.

## Développement

Lance d'abord le serveur Python, puis copie le jeton affiché dans son lien :

```bash
codeguard ui --no-browser
```

Dans un autre terminal, depuis `frontend/` :

```bash
npm ci
CODEGUARD_TOKEN=<jeton> npm run dev
```

| Commande | Rôle |
|---|---|
| `npm run dev` | Serveur de développement, avec `/api` relayé vers Python |
| `npm test` | Tests Vitest |
| `npm run typecheck` | Vérification des types |
| `npm run lint` | Règles ESLint |
| `npm run build` | Vérifie les types et regénère `src/codeguard/ui/static` |

Après une modification, commite aussi le résultat de `npm run build` : c'est lui que les
utilisateurs reçoivent.

## Organisation

| Dossier | Contenu |
|---|---|
| `src/api` | Types du contrat avec Python, client HTTP et hooks de données |
| `src/ui` | Composants génériques, sans connaissance du métier |
| `src/features` | Fonctionnalités : projet, identifiants, analyses, résultats |
| `src/layout`, `src/pages` | Structure générale et écrans |
| `src/fx` | Pont vers Idéothèque |
| `src/styles` | Variables de design et styles de base |

## Couleurs

Le papier chaud et le vert sauge sont faiblement saturés : ils limitent la fatigue lors
d'une longue lecture. Toutes les couleurs sont des variables `light-dark()` dans
`src/styles/tokens-colors.css`, ce qui évite de maintenir deux palettes séparées.

## Idéothèque

La bibliothèque est copiée dans `public/vendor/ideotheque`, en version 0.3.1. Lis la fiche
d'un effet avant de l'utiliser, et applique ces règles :

- N'utilise `data-fx` que sur des effets qui ne déplacent pas les enfants gérés par React,
  ou sur un élément vide.
- Un effet qui réécrit son contenu, comme `copy-morph`, se reproduit en React, avec la même
  durée et le nom de l'effet en commentaire.
- Ne change pas `className` après le montage d'un élément à effet d'entrée : React effacerait
  la classe `fx-entrance`.
- Passe toujours par `useFx`, qui appelle `FX.init` sur le parent de l'élément.

## Sécurité

Le contenu d'un dépôt relu est hostile par principe. Il ne devient jamais du HTML :
`dangerouslySetInnerHTML` est interdit par ESLint et contrôlé par les tests Python. La
politique CSP du serveur interdit les scripts en ligne et toute ressource externe.
