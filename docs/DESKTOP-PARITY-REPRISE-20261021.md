# Reprise obligatoire de l'audit Jellyfin personnalisé

Date : 21 octobre 2026. Branche de travail : `feature/desktop-audit-parity-v025`.
Base stable intacte : `desktop-v0.2.4` (`7fdcdb6`).

## Sources de vérité et règles

- Audit original **sans réécriture** : `docs/AUDIT-PARITE-JELLYFIN-20261020.md` ;
  12 critères A/B/C/D suivis par `desktop/parity/audit-traceability.json`.
- Référence VISUELLE effective : `/opt/zurg/jellyfin-vyneo/web/skin.css`,
  `index.html` et `web/inject.js` (lecture seule sur N100). Hashes SHA-256
  archivés dans la matrice, à renouveler si la skin change.
- Réutilisation avant duplication : `/home/coco/vyneo-next/beta-web/src/secure/`.
  Notamment `SecureApp.svelte`, `skin-parity.css`,
  `screenshot-parity.css`, `universe-manifest.ts`. Ces feuilles Vynéo Next
  contiennent parfois des *choix alternatifs* : seule la skin Jellyfin active
  fait autorité pour les mesures CSS de la présente version.
- Architecture inchangée : frontend Svelte/Tauri indépendant, Jellyfin est
  uniquement une source autorisée de métadonnées/API. Ne jamais embarquer
  Jellyfin Web, son React ou `inject.js` dans Desktop.
- CI : `desktop/scripts/check.mjs` vérifie désormais la présence, l'empreinte
  normalisée et les 12 critères de l'audit. Un tag `desktop-v*` déclenche
  en plus le blocage si les validations réelles D ne sont pas attestées.

## Bloc A : différences mesurées et corrigées

| Élément | Jellyfin `skin.css` (source) | Desktop avant | Contrôle Desktop après |
| --- | --- | --- | --- |
| Header | 74 px + padding 14/40/8 | min 83 px | 74 px à 1650 |
| Onglets | pillule 999 px, 16.5 px, 10/20 px | rectangle 7 px, 15 px, 8/13 | rayon 999 px, 16.5 px |
| Recherche | largeur max 320, hauteur 46, texte 15 px | max 308, h43, texte 13 | 320 × 46, texte 15 |
| Hero | `min(78vh,820px)`, recouvrement 150 px | `min(91vh,875px)`, 119 px | 725.4 px à 930 h ; 150 px |
| Cartes | largeur 340 px, espacement 13 px | largeur max 310, gap 12 | 340 px et gap 13 |
| Titres des sections | 21 px, graisse 800 | 19 px, graisse 900 | 21 px, graisse 800 |

Tests automatiques Playwright supplémentaires sur COCO : géométrie à
1650×930, responsive à 1280×800 et 1920×1080, navigation des bannières,
capture Hero depuis scroll=0, absence de débordement horizontal.
Aucune validation de fidélité pixel à pixel face à une vraie capture
Jellyfin n'a été affirmée.

## Bloc B : popup et interactions

- Popup ajustée à **320 px**, boutons ronds **34 px**, typographie et marges
  dérivées de `skin.css:772-822`. Les couleurs globales suivent de nouveau
  les tokens de `skin.css` au lieu de surcharges divergentes.
- Actions déjà existantes Jellyfin via API, vérification du favori de la
  série parente, fermeture à la souris et sur erreur réseau préservées.
- Nouveau : Flèche bas sur une carte pour ouvrir son aperçu, focus réel dans
  ses commandes, Tab entre les actions, Échap ferme et restaure le focus.
- Nouveau : flèches gauche/droite sur les cartes déplacent le focus entre
  contenus du rayon et font défiler le conteneur horizontal au besoin.
- Test Playwright du popup proche du bord droit, focus et touche Échap réussi.
- Manques explicites : lecture native et téléchargements non disponibles,
  comportement complet des badges rapides sur carte et animations du Hero
  restant à comparer à une session Jellyfin réellement connectée.

## Bloc C : fonctions métiers encore incomplètes

- `À suivre` : Desktop utilise `/Shows/NextUp` paginé à 300 jusqu'à 600,
  contre l'appel initial de 300 de `inject.js`. Les tests synthétiques
  valident 264 épisodes, **pas une parité prouvée sur les ID réels**.
- Saisons, badges : des fonctions spécifiques existent dans
  `new-seasons.ts` mais aucune comparaison cas par cas avec la sortie réelle
  de `vyClassifieSaisonsNextUp` n'est encore validée.
- Univers : 7 tuiles, y compris Nouveau DCU. Le regroupement LLM
  et les chronologies MCU/Star Wars du manifeste avancé restent à porter.
- Vynéo Next a une gestion distincte de dedup des sections ; audit restant
  avant reprise éventuelle, sans importer ses API privilégiées non validées.

## Bloc D : bloquant pour la prochaine stable

1. Comparer Jellyfin et Vynéo avec le **même compte, mêmes titres,
   même viewport et même scroll**, puis consigner écarts et captures.
2. Comparer explicitement les ID réels `À suivre`, les états des séries,
   les badges et actions avec autorisations réelles, sans exposer tokens.
3. Mettre à jour les deux critères `side-by-side` et `real-library` en
   `real-validated` avec attestation `real:` vérifiable uniquement après
   ces tests.
4. Alors seulement lancer un tag stable `desktop-v0.2.5` et la signature
   des manifestes. **Aucune installation parallèle QA n'est prévue**.

## Résultats et portée

Sur COCO : 99 tests Vitest, 24 tests Node réussis (6 spécifiques POSIX
ignorés), 0 erreur/avertissement Svelte/TypeScript, build Vite OK,
QA Playwright complète au 21 octobre. Le compte Jellyfin du propriétaire
n'a pas été utilisé par ces tests ; images fictives, serveur simulé.
`0.2.4` installée et publication stable inchangées.
