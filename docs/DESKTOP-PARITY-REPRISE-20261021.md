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

## Suite du 21 octobre : NextUp, nouveauté et vrais groupes Univers

Source incrémentale : commits `92630c8` à `482a47d` sur
`feature/desktop-audit-parity-v025`, sans modifier la release signée
`desktop-v0.2.4`.

### Bloc C : progression et saisons

- Métadonnées parentales vérifiées pour **600 séries autorisées distinctes**
  au lieu de 300 ; requêtes `Ids` par groupes de 60 et **concurrence limitée
  à 3**. Test de bout en bout API simulé à 450 séries réelles distinctes.
- Les saisons S2E1 sorties récemment (60 jours, série engagée au moins 15 %)
  restent dans « Nouvelles saisons et suites », tandis que les saisons E1
  anciennes sont repoussées en **fin** de « À suivre ».
- `DateCreated` ne sert pas à identifier une nouvelle saison. Un épisode
  sans `SeasonId` ne peut hériter arbitrairement du dernier badge série.
- Une saga TMDb ne propose pas le volet le plus récent si un film antérieur
  de la même collection reste non vu dans le catalogue **déjà autorisé
  et chargé**. La couverture des unions Tvdb et liens de titres du thème
  Jellyfin avancé reste un travail distinct.
- « Reprendre la lecture » : interroger jusqu'à 100 positions Jellyfin
  puis exclure côté client les objets déjà vus ou ≥95 %, même si leur état
  backend n'a pas été actualisé par un lecteur STRM. Aucun marquage serveur
  automatique de « vu » n'est ajouté.

### Bloc C : reprise des Univers tels que Jellyfin les présente

- Le système de regroupement vient de la vraie fonction `groupesUnivers`
  de `inject.js:13480-13775`, pas de la feuille de style hypothétique.
- Les 7 univers ont maintenant leurs listes détaillées (vignette, date,
  durée de film/nb de saisons quand disponible, note, synopsis, états),
  actions favoris/vu et **onglets accessibles au clavier**.
- MCU : phases 1-6 avec coupure du **1er juin 2025** entre les phases 5
  et 6, pas une approximation par année. Chronologie Star Wars fondée sur
  la liste d'œuvres explicites du thème ; les œuvres reconnues mais sans
  classification sont conservées dans « Autres aventures Star Wars ».
- Disney/Pixar/DreamWorks/DC : décennies. DCU : chapitre 1. Une œuvre
  dont l'année est inconnue n'est pas supprimée du catalogue.
- L'affichage Univers reste pour l'instant une page native indépendante,
  **pas encore la popup modale exactement calquée** sur Jellyfin : le
  mécanisme d'ouverture/fermeture, les animations et la conservation de la
  ligne à la réouverture font encore partie du bloc D visuel.
- Le catalogue autorisé (jusqu'à 6000 objets) est demandé à concurrence
  maximale de 3 pages, au lieu de 30 pages séquentielles possibles.
  Cas synthétique : 1450 titres, 8 pages, aucun doublon ou ID extérieur
  et rejet quand Jellyfin refuse une page. Gain réel de latence non mesuré.

### Revalidation Windows

Au 21 octobre, commit `482a47d` : **112/112 Vitest** et **25 tests Node
réussis** (6 réservés à POSIX ignorés), contrôle Svelte/TypeScript
**0 erreur/0 avertissement**, build Vite OK et QA Playwright complète
PASS. Scénario du navigateur avec 264 cartes « À suivre » et liste Pixar
multi-décennies, clics favoris/vu, onglets clavier, affiches manquantes
et responsive 390/1280/1920 : PASS.

Ces chiffres attestent la version de développement testée sur données
**synthétiques** ; ils ne constituent pas une validation de parité réelle
contre la bibliothèque connectée et la UI Jellyfin en direct.

### Prochain verrou avant release

Captures Jellyfin actif vs Vynéo (même profil, même contenu, viewport, scroll),
contrôles sur ID réels « À suivre », règles Tvdb des suites, groupes avancés
et interactions de modale. Les items `side-by-side` et `real-library`
restent `pending`. La stable 0.2.4 et son système de mise à jour restent
intacts ; aucune seconde app n'est installée.

## Suite du 21 octobre : modal Univers et franchise TVDb

Commits `0d96e1b` à `6dd4319` sur la branche de parité.

### Modal Univers identique en structure au thème Jellyfin

L'ancien écran indépendant Vynéo « Univers » ne reproduisait pas l'usage
réel : `inject.js` affiche un **modal centré** sur le Home. Il a été
remplacé par une fenêtre Svelte indépendante, sans dépendance au DOM
Jellyfin Web, fond `rgba(6,4,3,.88)`, panneau max 1080 px / hauteur
86vh, fermeture extérieure, Échap, titre sous forme de logo et mêmes
onglets chronologiques. Le Home derrière reste intact : aucun changement
de tab, aucun retour à scroll=0. Les états/onglets et la ligne sélectionnée
sont restaurés après ouverture/fermeture d'une fiche media.

Accessibilité vérifiée : focus initial sur la fermeture, Tab/Shift-Tab
confinés au modal, navigation clavier des onglets, Escape pour refermer
la fiche sans fermer le modal sous-jacent, retour du focus sur la tuile
d'origine après fermeture. Repli mobile à 390 px, sans débordement.

### Réels identifiants TVDbCollection, prudence sur les fausses franchises

L'audit de la base Jellyfin en lecture seule (sans lecture des tokens, noms
d'utilisateurs ou journaux de lecture) a confirmé l'existence de collections
`TvdbCollection` sur films et séries, avec **valeurs multiples séparées
par point-virgule**. Le Desktop ne normalisait que `TmdbCollection` :
c'était une raison structurelle à l'absence de certaines suites/dérivés.

La nouvelle logique reprend la sauvegarde du faux-positif du thème :
association TVDb non suffisante, au moins trois membres observés dans
le catalogue autorisé, tag dominant commun à au moins 70 %, fréquence
globale limitée, et tag commun porté **à la fois** par une œuvre vue et la
suite candidate. Le système ne propose pas de film bonus non tagué Anime
sur la seule base d'une série Anime engagée ; quatre propositions au plus
par groupe et au plus une par sous-saga TMDb.

Ce regroupement exploite seulement les éléments **déjà récupérés du
compte Jellyfin** : il ne prétend pas reconstituer un catalogue complet
sans droit et n'ajoute aucun appel tiers. Les liens par titre, plus
risqués, du thème original ne sont toujours pas repris par défaut.

### Validation

Sur PC Windows COCO, commit `ad4a130` : **116 tests Vitest réussis,
25 tests Node réussis, 6 ignorés POSIX**, 0 erreur/avertissement
Svelte/TypeScript, build Vite et QA Chromium Playwright PASS.
Le test navigateur `e4416a0` démontre aussi l'affichage effectif d'un
dérivé TVDb cohérent dans la section « Nouvelles saisons et suites ».
Le scénario `6dd4319` vérifie le focus Tab/Shift-Tab et Échap.
Les vrais contenus Jellyfin sont seulement inventoriés en lecture seule ;
les résultats Playwright demeurent **synthétiques**.

**Bloc D : toujours non validé.** On n'a ni utilisé la session chiffrée
d'un compte pour contourner le login, ni installé une 2e app. La
comparaison des ID et des captures *avec le même profil connecté*
doit être effectuée avant de marquer les deux exigences `real-validated`
et avant toute nouvelle version stable. Le pipeline publication est
toujours strictement bloqué.

## Reprise de 18 h : synchronisation après mutation et couverture réelle

Commits `8361c3b`, `8b5ca6e` sur la PR #9 en brouillon.

### Correction de cohérence après lecture

Le code d'origine de Vynéo Desktop rechargeait uniquement `/Shows/NextUp`
après l'action « Vu / non vu ». Or le rayon « Nouvelles saisons et suites »
dépend également de la progression de la **série parente** et de la date
réelle de sortie de sa saison. Une action prise sur un épisode pouvait donc
laisser affichée la mauvaise nouveauté jusqu'au prochain rafraîchissement.

Un rafraîchissement borné, asynchrone et propre au compte demande maintenant
`getNextUp`, `getResume`, `getWatched`, `getRecentSeasons`, puis,
seulement pour les nouveaux résultats de NextUp, `getNextUpSeries`.
L'actualisation des favoris est indépendante et n'impose pas ce traitement.
Les réponses arrivent par résultats individuels : une erreur transitoire ne
vide pas les rayons déjà valides. Les tickets de synchronisation, les
générations de session et l'invalidation d'un ancien refresh Home empêchent
une réponse antérieure de remplacer une mutation confirmée plus récente.

Playwright sous COCO vérifie les cinq familles de nouvelles requêtes après
l'action « Marquer vu », et les tests précédents valident la conservation
des boutons et des contenus. **Cela ne prouve pas encore les identifiants
de vrais épisodes d'un profil connecté.**

### Parité de filtrage avec l'injecteur Jellyfin

`belongsToUniverse` applique dorénavant les exclusions globales d'œuvres
promotionnelles de `inject.js` (avant-premières, coulisses, making-of,
featurettes, comic-con, tapis rouge), les exclusions spécifiques MCU
(y compris Werewolf by Night, LEGO, Legends et spéciaux de fêtes) et
le périmètre initial des studios Disney / DreamWorks. Deux tests Vitest
additionnels comparent des faux positifs par studio et titres.

### Inventaire réel en lecture seule, sans identité de profil

La base SQLite **de production** Jellyfin (`mode=read-only`) a été
interrogée sans extraction de token, compte, mot de passe ou historique
de visionnage. Cet inventaire est **GLOBAL à toutes les bibliothèques
du serveur** et son contenu peut évoluer pendant les scans :

- 5 536 objets film/série en base au moment du contrôle :
  4 006 films et 1 530 séries.
- Les règles `universeItems` réellement exécutées sur leurs tags,
  studios, titres et dates identifient globalement :
  MCU 69, Disney 105, Pixar 34, DreamWorks 56, Star Wars 29,
  DC 55, Nouveau DCU 4.
- Ces chiffres indiquent des **candidats sur métadonnées**, pas les
  bibliothèques visibles par le compte propriétaire, ni les fichiers
  jouables ni les rangées réelles affichées. Ils ne valident donc **aucun
  des deux critères D**.

### Résultat du cycle tests

Windows COCO, commit `8b5ca6e` : **118/118 Vitest**, **25/25 tests
Node exécutables**, 6 ignorés POSIX, **0 erreur / 0 avertissement
Svelte/TypeScript**, build Vite et QA Playwright PASS. Les contrôles du
modal, des images corrompues et du stockage des identifiants sont toujours
exécutés, aucune seconde application Vynéo n'a été installée.

Il reste à comparer **les mêmes IDs À suivre et les captures au même
viewport/scroll d'une session Jellyfin réellement authentifiée** à
l'application Desktop candidate et à faire vérifier la lecture réelle
avant de lever les blocages de publication stable du bloc D.

## Reprise soirée : Jellyfin authentifié observé et Hero visuel

Source de la vérification : onglet **Jellyfin** ouvert dans le navigateur
Brave connecté, sur `https://cocojellyfin.duckdns.org:38443/web/#/home`,
inspecté **en lecture seule** via le contexte de l'onglet. Aucune interaction
de lecture, modification de statut, token ni cookie n'a été exporté.

### Référence DOM réelle, non-identifiante

À la date du 21 octobre 2026, la portion d'accueil effectivement rendue
dans cet onglet contient :

| Structure de l'accueil Jellyfin | Noeuds constatés |
|---|---:|
| Contrôles de bannières | 15 |
| Cartes avec image dans « Reprendre la lecture » | 2 |
| Cartes avec image dans « À suivre » | 41 |
| Cartes dans « Nouvelles saisons et suites » | 1 |
| Boutons Univers distincts | 7 |

Ces décomptes **ne sont ni les totaux API ni des preuves d'identité des
titres** : le contexte navigateur expose du contenu DOM et pas les ID
internes complets, les droits de lecture ni une capture comparable à la
candidate. Ils ne valident pas les deux critères obligatoires du bloc D.

### Correction effective du Hero

L'ancien Vynéo Desktop plafonnait artificiellement la sélection du Hero
à cinq, avec un maximum forcé de sept titres même si l'appelant demandait
davantage. Le thème Jellyfin a une cible éditoriale `VY_HERO_TAILLE=16`
et inclut toutes les nouvelles saisons/suites confirmées au-delà du quota.

Commit `553e5d7` : sélection cible **16**, équilibrée par passages entre
nouveautés, tendances, recommandations, rayons éditoriaux ; réservation
des nouveautés réelles même si elles dépassent 16, dédoublonnage par série
et exclusion des titres déjà vus. En cas de manque d'éléments éligibles,
fallback borné sur les sources natives « Ma liste », « Reprendre » et « À
suivre ». Le kicker du Hero dépend de la provenance effective, sans inventer
une origine IA ou une nouveauté.

### Correction d'un vrai défaut CSS constaté par Playwright

Avec 16 bannières, les indicateurs du carrousel étaient partiellement
couverts par les premières cartes, conséquence du `margin-top:-150px`
des rayons et du stacking context de `.vy-shelves` au-dessus du Hero.
Le test d'un clic réel sur une bannière a échoué malgré la présence de son
bouton dans le DOM, ce qui a révélé ce problème oublié dans les tests
précédents.

Commit `f2f716d` : repositionnement des indicateurs **en dehors des
150 px de chevauchement**, adapté au responsive 390 px / 1280 px / 1920
px. QA `e1cc7d5` : assertion `document.elementFromPoint` sur le
premier et le dernier indicateur à ces trois largeurs, navigation
effective par clic, contrôles labels provenance « Nouveau » et
« Nouvelle saison ». **PASS.**

Résultat PC COCO après correction : **122/122 Vitest**, 25 tests Node
réussis, 6 ignorés spécifiques POSIX, zéro erreur/avertissement
Svelte/TypeScript, build Vite et QA Playwright complète PASS. Les
contrôles CSS et les interactions sont synthétiques, pas les captures du
compte Jellyfin réel.

### Blocage D maintenu

Comparer à l'identique les IDs NextUp, les droits propres au compte,
les images au même contenu/viewport/scroll et la lecture réelle de
l'installation finale. La candidate n'a pas été installée séparément :
l'application signée `desktop-v0.2.4` reste intacte. Aucune release
stable n'est autorisée tant que cette validation n'est pas documentée.
