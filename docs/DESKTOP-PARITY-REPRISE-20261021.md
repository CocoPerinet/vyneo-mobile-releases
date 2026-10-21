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

## Suite soirée : « Tendances » réel via le proxy TMDb du serveur

Commits `0ae72bc`, `4ac7ed6` de la PR #9.

### Écart factuel confirmé

L'accueil Jellyfin authentifié observé comporte « Tendances » après les
sept Univers. Desktop n'avait pas cette section, seulement un « Top 10 »
basé sur les notes IMDb/TMDb, **qui n'est pas un indicateur de popularité
en ce moment**. Le thème Jellyfin lui-même refuse de fabriquer des
« Tendances » avec les seules notes ou dates.

Vérification non-invasive de l'infrastructure existante : le proxy
hébergé **sur le même domaine épinglé Jellyfin**, route
`/tmdb/discover/movie` / `/tmdb/discover/tv`, renvoie bien le JSON de
classement `popularity.desc`. Les ressources publiques ne nécessitent
aucun nouveau token ni API payante.

### Implémentation native privée et bornée

- `getTrendingRanks` demande jusqu'à **3 pages de 20 résultats** pour
  films et séries (6 GET publics), en arrière-plan, sans ralentir le
  premier écran. Deux requêtes au maximum simultanées.
- **Séparation des secrets :** la méthode ne réutilise *jamais* le client
  JSON Jellyfin authentifié ; elle envoie seulement `Accept:
  application/json`, aucun header `Authorization`, `credentials:
  omit`, ni jeton dans l'URL. L'hôte et le chemin sont construits à
  partir du serveur autorisé, sans URL tiers injecté.
- Limites : 6 secondes par appel, 512 KiB maximum de JSON par réponse,
  20 résultats maximum, identifiants numériques validés, exclusion des
  contenus marqués adultes, validation de l'identité session avant et
  après chargement.
- `matchTrending` compare les ID TMDb **uniquement** avec les films et
  séries déjà renvoyés par les requêtes Jellyfin autorisées de la session
  (96 récents + jusqu'à 512 candidats). Il filtre les œuvres vues,
  conserve l'ordre de popularité par type, mélange films/séries,
  dédoublonne les éditions d'une œuvre et privilégie un visuel existant.
  Aucune donnée TMDb externe n'est traitée comme nouvel accès catalogue.
- Si moins de 3 œuvres autorisées concordent, le rayon « Tendances »
  est absent. Il ne tombe pas silencieusement sur « mieux notés ».
  L'ancien Top 10 conserve sa logique propre ; le Hero n'attribue le
  badge « TENDANCE » que si le titre provient de ce vrai rayon.
- L'appel TMDb et l'échantillon Jellyfin restent **optionnels et
  asynchrones**, indépendants du premier affichage Reprendre/À suivre.
  Après changement de compte, les résultats de l'ancienne session sont
  rejetés et l'état Tendances vidé.

### Limites précises

L'échantillon autorisé de 512 éléments ne parcourt pas tout le
catalogue Jellyfin (jusqu'à 6 000 objets possibles). Le résultat
« Tendances » peut donc avoir une couverture plus faible que la
version Jellyfin et ne constitue pas encore une parité exacte de
tous les contenus visibles. Le matching n'est pas un filtrage par
droit que TMDb pourrait garantir : le contrôle de droit vient
*exclusivement* de Jellyfin pour le profil de session.

### Vérification Windows COCO

Commit `4ac7ed6` : **130/130 tests frontend Vitest**, **25 tests
Node exécutables** (6 ignorés spécifiques POSIX), **0 erreur /
0 avertissement TypeScript/Svelte**, build Vite PASS et Playwright
Chromium complet PASS. Le scénario navigateur vérifie :
classement TMDb récupéré sans headers sensibles, 18 cartes Tendances
réellement reconnues par l'échantillon Jellyfin synthétique, ordre
`À suivre → Nouvelles saisons et suites → Univers → Tendances`,
Hero 16 bannières et badges source exacts.

Les tests sont synthétiques, même si la disponibilité du proxy TMDb
a été vérifiée sur le vrai serveur N100. Les IDs/captures propres
à une session réelle du compte Vynéo restent à comparer (bloc D
`side-by-side` et `real-library` **toujours PENDING**).
La version signée `desktop-v0.2.4` n'est pas touchée.

## Suite du 21 octobre, 19 h 50 : header Collections et Playlists

Commits `84eb225`, `658e79e`, `717e75a`, `154977b`,
`7271ada` dans la PR #9 brouillon.

### Source : écran Jellyfin réellement connecté

L'onglet Brave Jellyfin connecté montre la séquence initiale
`Reprendre la lecture / À suivre / Nouvelles saisons et suites /
Univers / Tendances / Pour vous` et les boutons header
`Animes / Films / Séries / Collections / Playlists / Ma liste`.
La source observée en lecture seule (libellés et décomptes DOM) est
archivée dans `desktop/parity/live-home-reference.json`. Les tests
Playwright vérifient l'ordre exact des six premières sections, et
n'acceptent plus une simple présence plus loin dans l'accueil.
Le rayon de recommandations retrouve le libellé **« Pour vous »**
exactement, au lieu du sous-titre promotionnel Desktop.

### Collections et Playlists sans application supplémentaire

Les nouvelles pages sont purement natives Svelte dans l'application
existante. Index, fiches et boutons « Afficher davantage » utilisent
les API Jellyfin **de l'utilisateur authentifié**, jamais une liste
globale administrateur :

- `GET /Users/{userId}/Items?IncludeItemTypes=BoxSet` ou `Playlist`,
  `StartIndex`, `Limit=48`, pagination via `TotalRecordCount`.
- Une collection `BoxSet` s'ouvre avec
  `GET /Users/{userId}/Items?ParentId={boxSetId}&Recursive=false`,
  types de médias `Movie,Series,Episode` uniquement.
- Une playlist utilise `GET /Playlists/{playlistId}/Items?userId={userId}`
  en lecture seule, sans création, suppression, édition ni endpoint PUT.
- Identifiants de collection validés en GUID, limites de pagination
  1..60, contrôle de session avant/après chaque requête, tentative
  interdite et erreur 403 sans affichage des contenus.
- Une collection ou playlist vide affiche un état explicite. Un épisode
  ouvre la fiche déjà implémentée, sans inventer une lecture native.
- Lors d'un changement de compte, la liste, le détail et les requêtes
  en vol sont invalidés. Retour clavier vers la collection d'origine,
  puis focus restitué après fermeture de la fiche.
- En écran 390 px, les 7 onglets restent accessibles par navigation
  horizontale, avec recentrage du lien sélectionné et sans
  débordement de la page.

**Limite Jellyfin à surveiller :** la liste `ParentId` d'une
collection peut ne pas inclure tous les médias à cause des droits
ou d'un comportement du serveur. Vynéo n'élève pas les privilèges,
ne remplace pas cette réponse par une requête administrateur et
ne prétend pas que l'absence d'une œuvre prouve son inexistence.
La validation sur les **mêmes droits du même compte** reste à faire.

### Résultats exécutés

Commit `154977b` : **136/136 Vitest**, **26 Node réussis**
(**6 ignorés POSIX**), `svelte-check` **0 erreur / 0 avertissement**,
build Vite PASS, Playwright Chromium PASS. Le navigateur automatisé
vérifie 53 collections en deux pages, retour depuis une collection
et une fiche, 3 playlists et leurs membres, API strictement
lecture seule, plus les scénarios précédents des Univers et de
l'accueil.

Commit `7271ada` : revalidation CSS et Playwright PASS,
avec navigation Collections/Playlists/Ma liste/Accueil testée à
390 px. Ces scénarios utilisent encore un serveur et des contenus
**synthétiques**. Seul le menu de référence Jellyfin a été observé
avec une session réelle, pas le compte candidat sous test.

La stable Desktop `0.2.4` n'a pas été mise à jour.
La PR #9 reste en brouillon. Les attestations obligatoires du bloc D
`side-by-side` et `real-library` restent **pending** avant une
version stable signée.


## Bloc expérimental du 21 octobre : première lecture native MP4

La candidate apporte un lecteur HTML5 à l'intérieur de la **même** application
Svelte/Tauri. Il ne réutilise pas Jellyfin Web, ne lance pas de navigateur externe,
n'installe pas une seconde application et ne modifie pas le coffre de la version
stable 0.2.4.

### Architecture d'authentification et de streaming

- Le client authentifié demande /Items/{id}/PlaybackInfo et sélectionne
  exclusivement une source dont l'ID Jellyfin est validé, le conteneur
  MP4/M4V, la piste vidéo H.264/AVC, les pistes audio AAC/MP3 et le droit
  SupportsDirectPlay=true. Un HEVC/MKV, DTS/AC3 ou une source non prouvée
  reçoit un refus explicite ; on ne prétend pas l'avoir rendu lisible.
- Une commande native Tauri crée un **ticket temporaire aléatoire**
  détenu en mémoire Rust, lié à un ID de média/source et au jeton de la
  session courante. Seul le ticket 128 bits figure dans la balise video,
  jamais le jeton Jellyfin, le chemin du fichier ou la vraie URL
  du contenu. Sur Windows, l'adresse localisée est
  http://vyneo-media.localhost/stream/{ticket} (interception native
  WebView2), **pas un serveur HTTP réellement exposé sur le réseau**.
- Le handler interne transfère les plages HTTP Range par blocs limités
  à 2 Mio et à 8 appels simultanés, via HTTPS vers **un seul domaine
  Jellyfin épinglé**. Il ne suit aucune redirection. Une réponse d'erreur,
  un contenu non vidéo ou une plage incompatible ne doit pas devenir un
  flux vidéo accepté.
- Aucun jeton n'est dans une URL publique, le stockage du navigateur,
  les logs de QA ou le dépôt. La session arrête son ticket à la fermeture
  du lecteur et révoque tous les tickets lors de la déconnexion.
- Le composant tente la lecture après la sélection et laisse les
  commandes HTML5 faire le démarrage lorsque l'autoplay est refusé.
  La reprise locale est calculée à partir de
  UserData.PlaybackPositionTicks si disponible, sinon d'un
  pourcentage de lecture seulement lorsque celui-ci est crédible.

### Limites bloquantes pour la stable

Ce lecteur constitue un **socle expérimental**, pas encore un produit
prêt à publier :

- Les tests TypeScript/Playwright sont synthétiques ; ils démontrent
  entre autres la séparation de la candidate web non native.
  L'interface WebView2 réelle n'a pas encore rendu de première image
  validée avec le compte Jellyfin propriétaire.
- Les sous-titres, pistes audio multiples, qualité adaptative,
  transcodage HLS et codecs modernes nécessitent encore une
  implémentation dédiée. L'absence de piste de sous-titres sur ce
  prototype reste une limite d'accessibilité signalée.
- Le reporting automatique Sessions/Playing, Progress et
  Stopped n'est pas encore implémenté. Une lecture dans cette
  candidate ne doit **pas** être présentée comme synchronisée dans
  « Reprendre la lecture » côté Jellyfin.
- Les médias .strm qui demandent un redirect HTTP vers un
  hébergeur tiers sont volontairement bloqués : aucun jeton ne
  doit être transmis par redirection. Le support de ce cas
  nécessitera une analyse et des protections supplémentaires.
- Les critères du bloc D restent pending, y compris la lecture
  réelle avec même compte, capture et contrôle des droits.
  La stable 0.2.4, la clé de mise à jour signée et l'identité
  de l'application ne changent pas.

### Vérifications

Au commit c57d929, **les tests Rust du protocole sont exécutés et
validés par le job Windows GitHub Actions** avant la fabrication
de l'installeur. 139 tests Vitest, 28 tests Node exécutés,
6 ignorés POSIX, tests Playwright complets PASS sur COCO ;
le correctif 321791c rétablit 0 erreur et 0 avertissement Svelte.
La vérification de lecture effective de fichiers locaux ou .strm
n'est **pas** encore attestée et reste obligatoire.

## Suite : HLS Jellyfin pour la bibliothèque STRM, sans deuxième application

### Audit réel et non intrusif du serveur (21 octobre 2026)

- Base Jellyfin consultée en lecture seule : **49 896 objets vidéo .strm** de
  type film ou épisode, soit 4 010 films et 45 886 épisodes. Ces chiffres
  ne sont pas les contenus autorisés d'un utilisateur particulier.
- Les **18 références STRM examinées** pointent vers l'endpoint
  HTTPS du proxy cocojellyfin.duckdns.org:38443/proxy. Trois contrôles
  HEAD renvoient video/x-matroska. Une sonde ffprobe avec limite de temps
  confirme HEVC et E-AC3 sur un exemple, les autres ne concluent pas.
- L'accélération Intel QSV est activée dans encoding.xml et le périphérique
  /dev/dri est visible dans Jellyfin. Il s'agit de configuration,
  **pas de la preuve d'un encodage fonctionnel en lecture utilisateur**.

### Nouvelle voie de lecture HLS, candidate uniquement

- La lecture directe MP4/H.264/AAC reste disponible pour les sources
  compatibles et autorisées. Les MKV, HEVC et STRM dont Jellyfin
  autorise le transcodage peuvent désormais prendre une seconde voie HLS.
- hls.js 1.7.3 est épinglé et chargé sur demande, sans charger le
  lecteur sur le premier écran d'accueil.
- Le client crée un ticket temporaire de type HLS dans le même programme
  Tauri ; la playlist main.m3u8 est demandée au domaine Jellyfin
  épinglé, avec une cible H.264/AAC, 1080p et 8 Mb/s vidéo. Jellyfin
  réalise le transcodage et décide de son utilisation matérielle.
- Le Rust natif réécrit les playlists et les sous-ressources en URLs
  locales aléatoires. Les URLs de segments en amont restent uniquement
  dans la mémoire native, **sans exposer le jeton Jellyfin dans le DOM,
  l'adresse du média ou les logs**.
- Sont refusés : domaines/schémas/ports externes, chemins sortant de
  l'item, clés HLS AES/DRM, redirections, réponses HTML/JSON,
  marqueurs de jeton restants dans une playlist, segments anormalement
  volumineux et playlists exigeant des BYTERANGE non gérés.
- Bornes : 512 Kio de manifeste, 16 Mio par fragment, 4 096 références
  au maximum, 8 requêtes simultanées, tickets expirant au bout de 4 h
  et révocation à la déconnexion.
- Il s'agit d'un protocole interne WebView2/Tauri, **pas d'un serveur
  HTTP supplémentaire ouvert sur le réseau**.

### Ce qui reste obligatoire pour la publication

Les tests frontend et Rust peuvent valider la cohérence du client,
les règles de sécurité du proxy et la compilation. Ils ne valident
pas encore **la première image avec une session Jellyfin réelle**,
les sous-titres, les multiples pistes audio, les flux .strm défaillants,
la qualité automatique, le son ni le suivi de lecture Jellyfin via
Sessions/Playing et Progress et Stopped.

La version stable desktop-v0.2.4 n'est pas modifiée. Une seule
application reste installée sur COCO. La PR #9 demeure en brouillon,
les critères D side-by-side et real-library restent PENDING,
et le pipeline refuse une publication stable sans preuves réelles.

## Suite 21 octobre : positions et historique de lecture Jellyfin

Le prototype MP4/HLS savait ouvrir un flux vidéo, mais ne transmettait
pas encore ses événements de lecture à Jellyfin. Il manquait donc
le mécanisme serveur qui actualise les sections **Reprendre la lecture**
et **À suivre** après un véritable visionnage.

### Contrat implémenté, sans lecture réelle automatique

- Le client **n'écrit absolument aucune position** lors de l'ouverture
  d'une fiche, de la consultation PlaybackInfo, d'une lecture refusée ou
  si la vidéo n'a jamais émis l'événement HTML5 `playing`.
- Après le premier `playing`, le composant envoie
  `POST /Sessions/Playing` avec les GUID Jellyfin validés du média
  et de sa source, le PlaySessionId seulement s'il est exploitable,
  la méthode DirectPlay ou Transcode et la position exacte en ticks.
- Une progression est transmise toutes les 15 secondes de temps de
  lecture en fonctionnement normal, ainsi qu'à la pause, reprise
  et après un déplacement manuel. Les POST sont **strictement
  sérialisés**, pour ne jamais envoyer un arrêt avant le démarrage.
- `POST /Sessions/Playing/Stopped` est envoyé **une seule fois** à
  la fermeture du lecteur ou à la fin du média. Un arrêt avant la
  première image réellement jouée ne crée aucun historique.
- Les volumes sont arrondis sur des **entiers 0..100** dans les corps
  de requêtes : Jellyfin attend un entier, pas un pourcentage flottant.
  Les ticks sont conservés sous forme d'entiers exacts.
- Les réponses HTTP 204 sans corps sont valides. Les refus serveur
  n'interrompent pas le flux vidéo : l'interface indique que le
  visionnage reste possible mais que la progression n'a pas été
  synchronisée. Le suivi serveur n'est jamais déclaré réussi en cas
  d'échec réseau ou d'authentification.
- Si la session Jellyfin change avant le retour du serveur,
  la requête est rejetée comme obsolète. Aucun événement d'un ancien
  compte ne doit basculer vers le nouveau.
- Après arrêt ou fin d'une vidéo ayant réellement commencé, l'accueil
  du **compte actuellement authentifié** est rechargé à partir des
  résultats API Jellyfin. Aucune entrée À suivre n'est inventée
  localement.

### Tests exécutés, preuves et limites

La suite Windows COCO du commit f3482f8 a exécuté **149 tests
frontend**, **29 tests Node** (+6 ignorés), svelte-check à
**0 erreur et 0 avertissement**, le build Vite et la QA
Playwright complète, tous réussis. Les nouveaux tests simulent
le premier `playing`, l'ordre Start/Progress/Stopped, le délai
de 15 secondes, les pauses, les recherches, la fin naturelle,
le refus HTTP, le volume entier, les réponses HTTP 204, et
les sessions périmées après déconnexion.

Références du contrat serveur : SDK Jellyfin
https://typescript-sdk.jellyfin.org/functions/generated-client.SessionApiFp.html
et compte-rendu du problème de volume fractionnaire :
https://github.com/jellyfin/jellyfin-desktop/issues/1209.

**Ne pas confondre ces tests avec une lecture réelle sur le N100.**
Il faut encore lancer et fermer un film/épisode `.strm`
dans le WebView2 authentifié, puis comparer l'ID, la nouvelle
position et À suivre/Resume côté serveur avec le même compte.
L'audio, les sous-titres et la charge du transcodeur restent
aussi à certifier. Aucun de ces critères n'est marqué
comme vérifié dans le bloc D.

La stable desktop-v0.2.4 et son application Windows unique
restent intactes. La PR #9 reste brouillon jusqu'à la validation
réelle et une mise à jour signée distribuée par l'application
existante.

## 21 octobre, suite : négociation serveur et vrai décodage HLS synthétique

### Cause identifiée dans la première voie HLS

Le client employait auparavant GET /Items/{id}/PlaybackInfo sans
profil codec, puis reconstruisait de manière approximative une URL
/videos/{id}/main.m3u8 avec des paramètres choisis localement.
Ce chemin pouvait diverger de la décision réelle de Jellyfin, notamment
pour les vidéos STRM/Matroska HEVC + E-AC3 nécessitant un transcodage.
La référence de l'API officielle est PlaybackInfoDto / DeviceProfile
(Jellyfin SDK), et les exemples de réponses serveur comportent
une TranscodingUrl vers master.m3u8 avec PlaySessionId, MediaSourceId,
codec, conteneur et paramètres de transcodage.

### Correctif à identité et installation uniques

- Le bouton de lecture déclenche désormais POST
  /Items/{id}/PlaybackInfo (la lecture seule du panneau diagnostic
  continue d'utiliser GET). Ce POST annonce strictement le profil
  de compatibilité WebView2 + hls.js : DirectPlay MP4 H.264/AAC/MP3 ;
  HLS MPEG-TS H.264/AAC, 2 canaux, bitrate plafond 8,192 Mb/s.
  HEVC/E-AC3 et les sous-titres ne sont pas annoncés comme lus
  directement par WebView2.
- Le client n'invente plus la playlist HLS. Il exploite l'URL
  TranscodingUrl NEGOCIÉE par Jellyfin uniquement lorsqu'elle
  correspond à la source sélectionnée et au PlaySessionId.
  Les paramètres sensibles ApiKey/access_token sont supprimés
  en mémoire ; seules des URLs relatives, sans authentification,
  entrent dans le ticket natif Tauri.
- Le Rust natif vérifie INDEPENDAMMENT l'origine HTTPS épinglée,
  l'identité item/source, le master.m3u8, les codecs H.264/AAC,
  le conteneur TS et l'absence de tout paramètre de jeton avant
  de conserver l'URL en mémoire. Il conserve les autres paramètres
  calculés par Jellyfin tels que Tag, PlaySessionId, index audio
  et raisons de transcodage.
- Le pipeline de streaming réécrit les manifestes récursivement
  en capacités temporaires locales, sans charger de scripts
  externes ni exposer de token dans la balise vidéo.
- Une initialisation HLS échouée révoque immédiatement les
  capacités natives, au lieu de laisser un ticket temporaire
  actif. Aucune modification de l'installateur stable ni du
  coffre système.

### Tests réels du décodeur, sans fausse validation du serveur

Le 21/10, un flux HLS VOD artificiel a été généré localement avec
ffmpeg : trois segments MPEG-TS, codec vidéo H.264, piste AAC,
durée totale 6,04 s. Les fichiers font moins de 300 Kio et ne
contiennent aucun média privé de l'utilisateur.

Le test Playwright Chromium headless (COCO) a réellement demandé
le master M3U8, le manifeste VOD, puis les trois segments et
a décodé les images dans un élément HTMLVideoElement. Son résultat
est VYNEO_HLS_CHROMIUM_FIRST_FRAME_PASS : 320x180,
0,77 seconde lue, readyState=4, 22 frames décodées,
aucune erreur HLS fatale. Capture archivée localement dans
qa-shots/hls-codec-smoke-first-frame.png, vérifiée visuellement.
Ce contrôle est lancé par npm run qa:hls-first-frame et ajouté
au job Windows PR avant la compilation de l'installeur.

La QA UI/contrats du commit 79c45bb a passé 153 tests frontend,
29 tests Node (+6 SKIP), zéro erreur/avertissement Svelte,
Vite et Playwright. Les tests Rust de validation d'URL et
le contrôle CI du dernier commit restent à vérifier avant
tout statut vert définitif.

**Reste impérativement à valider en réel :** première image
et son dans l'application Tauri WebView2 connectée au vrai
compte Jellyfin, comportement des médias STRM accessibles,
transcodage QSV sous charge, sous-titres/pistes audio,
consistance des positions réellement enregistrées par
le serveur et comparaison des captures du même compte.
Le bloc D reste PENDING. Aucune deuxième application
n'a été installée ni démarrée sur COCO.

## 21 octobre, 23 h : premier décodage dans WebView2/Tauri réel sans installation

### Vérification de bout en bout native sur COCO

Le commit `492a42b` a introduit un exécutable de QA **portable** et non
installé, compilé avec la feature Rust facultative `native-e2e-qa`.
La feature est absente de tout build stable, et ses fichiers HLS fictifs
sont intégrés uniquement au binaire de test, jamais aux versions
signées. La configuration de QA utilise l'identité indépendante
`fr.visyren.vyneo.desktop.jellyfinqa`, un répertoire d'assets isolé,
aucun fournisseur de credentials réels et un endpoint de mise à jour
désactivé.

Première tentative en SSH Session 0 : WebView2 refuse d'initialiser
sa fenêtre (HRESULT 0x80070578, handle de fenêtre invalide).
Une tâche Windows avec `InteractiveToken`, créée temporairement
par le runner sur la session utilisateur, a résolu ce blocage.
La fenêtre de QA reste masquée et n'ajoute aucun raccourci,
paquet Windows, icône système ou nouvelle installation. La tâche
est stoppée et supprimée automatiquement à la fin du contrôle.

Au commit **`29ccd8f`**, commande
`npm run qa:native-webview2`, le test a retourné :

```
VYNEO_WEBVIEW2_NATIVE_SCHEME_FIRST_FRAME_PASS
width=320 height=180 readyState=4 decodedFrames=19
currentTime=0.65 duration=6.04 paused=false
nativeProtocol=true drm=false
QA_ZERO_INSTALLER_ZERO_REAL_CREDENTIALS
```

Le flux **H.264/AAC de test** suit vraiment le protocole Tauri
`http://vyneo-media.localhost/hls/...` : commande native de création
du ticket temporaire, accès au master HLS, réécriture du manifeste et
des URLs de trois fragments TS vers des capacités mémoire Rust,
décodage par hls.js dans le WebView2 embarqué, puis révocation
du ticket via `stop_native_stream_ticket`.

Contrôles complémentaires réalisés après exécution : **une seule**
installation Vynéo version `0.2.4` est enregistrée, un seul processus
Vynéo en cours (celui de l'application stable dans la session Windows 1),
aucune tâche `VyneoNativeMediaQA*` restante. La QA n'a jamais
réutilisé le jeton ou l'historique du compte Jellyfin.

**Portée exacte :** la chaîne native et son premier décodage sont
désormais prouvés pour un flux synthétique. Ce n'est **pas** encore une
preuve de lecture d'un média réel .strm protégé, des pistes audio,
des sous-titres, du transcodage QSV ni des rapports de progression
réellement reçus par Jellyfin. Le bloc D réel reste `PENDING`.
Aucune publication stable n'est autorisée tant que ce dernier
contrôle n'a pas été réalisé avec le même compte que Jellyfin.

### QA native complémentaire : pause, saut dans la timeline et reprise

Le commit `88ca2ba` renforce la même session QA WebView2 masquée :
le lecteur doit décoder les premières images du flux HLS, se mettre
réellement en pause, accepter un saut au temps **3,2 secondes**, puis
reprendre la lecture et décoder au moins trois images supplémentaires.

Résultat exécuté sur COCO dans la session Windows interactive :

```
VYNEO_WEBVIEW2_NATIVE_PAUSE_SEEK_RESUME_PASS
width=320 height=180 readyState=4
decodedFrames=66 framesBeforeSeek=20
currentTime=3.79 duration=6.04
paused=false pauseVerified=true seekVerified=true
seekTargetSeconds=3.2 nativeProtocol=true drm=false
QA_ZERO_INSTALLER_ZERO_REAL_CREDENTIALS
```

Après le second passage, vérification des ressources : installation
enregistrée = Vynéo `0.2.4` uniquement, processus Vynéo présent =
application stable uniquement en session 1, tâche QA temporaire restante =
**0**. Aucune interaction souris/clavier ou changement de focus n'a
été nécessaire.

Cela valide la capacité du code natif à **lire, mettre en pause,
rechercher et reprendre** un flux HLS synthétique dans le WebView2
réel. Cela ne certifie toujours pas le bon transcodage d'un vrai
`.strm` Jellyfin, l'audio audible, la qualité QSV, les sous-titres
ou la progression serveur de l'utilisateur. Le bloc D réel demeure
`PENDING` et bloque toujours le release stable.

## 22 octobre : remux des sources STRM, robustesse HLS et limites du serveur

### Correctifs fonctionnels réalisés

- Commit `7e5bb63` : le test WebView2 utilise désormais
  **enableWorker=true** et exactement les paramètres de buffering
  HLS du lecteur Vynéo destiné à la production. Le contrôle COCO
  a passé 66 images décodées, une pause, un saut et une reprise,
  via le protocole Tauri réel, sans installation supplémentaire.
- Commit `2df79f9` : l'indicateur `IsRemote` des MediaSources
  Jellyfin est maintenant conservé dans le modèle local,
  sans divulguer le chemin ni l'URL du fichier. Un MP4 H.264/AAC
  **distant** n'est plus envoyé vers la voie DirectPlay
  `stream.mp4?Static=true` qui pourrait demander une redirection
  bloquée par la sécurité ; une négociation HLS est préférée.
- Commit `fe3e857` : erreurs UI précises pour accès Jellyfin
  refusé, limite de transcodage, absence de playlist HLS,
  défaut réseau, et codec refusé par WebView2. Les diagnostics
  n'affichent jamais les URL de lecture ni un jeton d'accès.
- Commit `5fee1d1` : une source Jellyfin avec
  `SupportsDirectStream=true`, `SupportsTranscoding=false`
  **et une TranscodingUrl HLS validée** est désormais acceptée.
  Cela permet le remux serveur sans forcer un réencodage vidéo.
  La validation des IDs, de la playlist, des codecs et de
  l'origine HTTPS épinglée reste obligatoire. Les événements
  Jellyfin peuvent désormais utiliser `PlayMethod=DirectStream`,
  au lieu de déclarer un transcodage absent.

### Tests exécutés sur COCO (commit 5fee1d1)

- **157 tests frontend et 30 tests Node** réussis ; 6 tests Node
  correspondant à d'autres contextes de déploiement ignorés.
- Svelte-check : **0 erreur et 0 avertissement** ;
  compilation frontend Vite réussie.
- QA de parité visuelle Chromium et décodage HLS synthétique
  réussis. QA native dans WebView2/Tauri :
  `VYNEO_WEBVIEW2_NATIVE_PAUSE_SEEK_RESUME_PASS`,
  65 images décodées, 19 avant saut, lecture à 3,8 s,
  pause/reprise et décodage via Web Worker HLS activé,
  sans accès à la bibliothèque réelle.

### Préconditions bloquantes du vrai test

- Les métadonnées du coffre Windows consultées sans lire
  ni extraire de secret n'ont montré aucune entrée QA distincte
  pour Vynéo. Le coffre de la version stable n'a **pas** été
  consulté ou contourné.
- Le serveur N100 expose `/dev/dri/renderD128` en
  lecture/écriture depuis Jellyfin, la configuration QSV
  est active et jellyfin-ffmpeg annonce bien
  `qsv`, `h264_qsv` et `hevc_qsv`. Cela ne prouve
  toujours pas le transcodage effectif d'un STRM.
- Lors du contrôle à 00:11, le conteneur Jellyfin consommait
  environ **195 % CPU** sur un N100 à 4 cœurs, avec charge
  système supérieure à 4 et sans processus ffmpeg détecté.
  Aucun transcodage d'essai lourd n'a été ajouté au serveur
  déjà occupé. Une lecture intégrale sur compte réel
  attend une fenêtre de charge plus faible et une session
  de QA authentifiée autorisée.

L'installation unique Vynéo `0.2.4` reste intacte et la PR #9
reste brouillon. Le bloc D `real-library` et `side-by-side`
ne change PAS de statut. Il ne faut pas publier une stable
sur la seule foi des tests synthétiques.

## 22 octobre, suite : décodage audio AAC, durée STRM, sécurité QA et QSV

### Décodage audio réellement mesuré dans WebView2 natif

Les commits `65a1b66`, `ae2e6cb` et `b639b99` ont renforcé
le banc de test portable Tauri/WebView2 avec un nœud WebAudio
`MediaElementAudioSourceNode` et un `AnalyserNode`. La source
est décodée par le vrai lecteur HLS WebView2, mais transite
**uniquement vers un GainNode à gain zéro** pour éviter tout son
sur les enceintes de l'utilisateur durant les tests invisibles.

Le test vérifie maintenant obligatoirement un AudioContext actif,
au moins trois acquisitions du signal et une amplitude RMS
supérieure ou égale à 0,008 sur la piste AAC synthétique de
440 Hz. La commande locale `npm run qa:native-webview2`,
réexécutée à COCO au commit `d5d90f6`, est **PASS** :
64 images vidéo décodées, pause/seek/reprise OK, audioContext
`running`, `audioAnalyserSamples=10`,
`audioRmsPeak=0.062772`. Aucun utilisateur ni média
Jellyfin privé n'a été employé.

Le signal PCM décodé dans WebView2 est ainsi prouvé avec ce
média synthétique. Cela ne démontre PAS que les pistes audio
E-AC3/AC3 et multilingues des STRM réels sont négociées
correctement avec Jellyfin.

### Reprise d'un média distant sans durée sur l'item

Le commit `51fa77a` conserve le `RunTimeTicks` de la
`MediaSource` après `PlaybackInfo`. Jellyfin peut fournir
la durée du fichier distant à ce niveau alors que la fiche
STRM de la bibliothèque n'en possède aucune. L'ordre de
priorité est désormais :
1. durée navigateur `video.duration` si elle est finie ;
2. durée `MediaSource.RunTimeTicks` validée en ticks ;
3. aucune reprise automatique si ces deux mesures manquent.

L'application vérifie la plage `seekable` et peut réessayer
une seule reprise au moment des événements `loadedmetadata`,
`durationchange` ou `canplay`, afin de ne pas perdre la
position quand l'API MSE/HLS annonce sa durée tardivement.
Les cas de valeurs Infinity/NaN, durées incohérentes et
avances trop proches de la fin sont couverts par tests.

### Preuve QSV synthétique sur le vrai Jellyfin du N100

Contrôle préalable : charge serveur ~0,78 et CPU du conteneur
Jellyfin ~3,6 % au démarrage. Test ffmpeg matériel de 48
images synthétiques à 320 × 180, fréquence 24 i/s, avec
`vaapi=iHD`, `qsv=qs@va`, upload matériel et
`h264_qsv`, sortie `null` sans fichier écrit.
Exécution bornée à 25 secondes, achevée sans erreur :
`frame=48, time=00:00:01.87, speed=21.1x`.

Ce test prouve une **capacité d'encodage QSV fonctionnelle**
dans le conteneur Jellyfin, et NON une performance en 1080p
avec des vidéos distantes et sous-titres ASS brûlés.

### Récupération d'une QA interrompue par SSH

Une coupure de la connexion SSH pendant une QA avait laissé
une tâche temporaire `VyneoNativeMediaQA*` et un binaire QA
masqué actifs. Cette tâche et ce binaire ont été arrêtés
explicitement et la version stable n'a pas été touchée.

Les commits `d5d90f6` et `712cc95` :
- ajoutent un temps d'exécution maximal de **2 minutes** aux
  tâches temporaires de QA ;
- suppriment au démarrage les tâches orphelines uniquement
  lorsque leur action pointe vers **l'exécutable QA exact** ;
- font fermer automatiquement le binaire **QA uniquement**
  après validation et révocation du ticket média ;
- vérifient statiquement que la logique de sortie n'est
  accessible qu'à la feature `native-e2e-qa`.

Au terme du test Windows : **0 tâche QA restante**, **1 seul
processus Vynéo stable** et **1 installation 0.2.4**
toujours enregistrée. Une déconnexion du relais de commande
ne doit plus laisser un processus de test exécuté indéfiniment.

### Validation logicielle et restriction de publication

Sur COCO au commit `712cc95` : **158 tests frontend
Vitest PASS**, **30 tests Node PASS** (6 autres ignorés selon
contexte), zéro erreur ni avertissement Svelte,
compilation Vite, QA Playwright et décodage HLS Chromium
PASS. Le test natif HLS WebView2 du commit `d5d90f6`
a aussi été exécuté après le durcissement du lecteur audio.

La PR #9 et le bloc D `real-library`/`side-by-side`
restent **PENDING** : il manque toujours une session QA
Jellyfin explicitement autorisée, la lecture d'un vrai .strm
dans Vynéo, le son audible réel, les sous-titres,
la progression effectivement enregistrée sur le serveur et
la comparaison du même compte dans Jellyfin et Vynéo.
Il n'y a aucun tag ni publication stable signée.

## 22 octobre, suite : connexion sécurisée Jellyfin Quick Connect

### Motif

Le serveur Jellyfin a confirmé publiquement
`GET /QuickConnect/Enabled -> true (HTTP 200)`.
La QA ne possède pas de compte Jellyfin supplémentaire autorisé :
aucun jeton de la version stable ne doit être copié dans un second
exécutable ni dans une trace de débogage. Un véritable contrôle
sur un profil déterminé doit donc passer par une **approbation
explicite de l'utilisateur** sans lui demander de transmettre
son mot de passe ou son jeton.

### Implémentation candidate uniquement (commits 8805d21 et 1c9b347)

- Dans l'écran de connexion Vynéo : bouton facultatif
  **Connexion avec Quick Connect**, en complément des champs
  classiques utilisateur/mot de passe inchangés.
- Après clic : `POST /QuickConnect/Initiate` à l'hôte Jellyfin
  fixe, avec en-tête client/DeviceId validé. Le backend transmet
  `Code` à l'UI, conserve `Secret` exclusivement en mémoire.
  Aucun paramètre d'URL ni stockage navigateur pour le secret.
- L'utilisateur saisit lui-même le code dans son Jellyfin déjà
  authentifié, sous les paramètres Quick Connect, puis clique
  **J'ai autorisé le code** dans Vynéo.
- `POST /Users/AuthenticateWithQuickConnect` transmet le Secret
  seulement dans le corps JSON, pas dans un GET, pas dans l'URL.
  Le client valide le UserId, le nouveau jeton et **/Users/Me**
  avant d'accepter cette session. Un refus ou code pas encore
  autorisé ne connecte personne.
- Le bouton d'annulation invalide toute demande en attente.
  Le numéro de génération empêche une réponse retardée d'un
  précédent compte de reprendre une session périmée.
- Une fois connecté, la préférence existante **Rester connecté**
  peut enregistrer le jeton dans le coffre natif chiffré de
  **l'identité Vynéo utilisée**, en conservant l'architecture
  établie. Aucun second installeur et aucune modification du
  coffre de l'application stable n'ont eu lieu.
- Le libellé du bouton secondaire évite une ambiguïté avec le
  bouton `Se connecter` existant, trouvée et corrigée
  automatiquement lors de la QA Playwright.

### Validations exécutées et portée

- 3 tests unitaires Quick Connect : initialisation sans jeton,
  secret en POST seulement, connexion après approbation
  simulée, rejet de la tentative anticipée, session/motif de
  compte erroné, annulation pendant une requête différée.
- QA Playwright en navigateur (fixture uniquement) :
  code temporaire affiché, secret absent du DOM, tentative
  d'échange non autorisée retournant une erreur sûre, code
  conservé pour retenter, annulation sans session et parcours
  de connexion classique encore fonctionnel. Marqueur :
  `VYNEO_QUICK_CONNECT_PRIVATE_UNAPPROVED_CANCEL_PASS`.
- Windows COCO, commit `139bb34` : **161 tests Vitest PASS**,
  **30 tests Node PASS** (+6 ignorés), Svelte zéro erreur /
  zéro avertissement, build Vite, QA complète et navigation
  sur l'interface Jellyfin de test réussis. Le protocole
  native HLS déjà validé reste inchangé.
- L'API Quick Connect est confirmée par l'implémentation de
  clients Jellyfin, et le serveur réel rapporte la fonction
  activée. En revanche, **aucun vrai code Quick Connect n'a
  été soumis à l'utilisateur et aucune véritable autorisation
  n'a été accordée** : les tests utilisent des secrets fictifs.

La PR #9 reste en brouillon, la stable 0.2.4 reste l'unique
application installée. Les critères **D side-by-side et
D real-library restent PENDING** en attendant l'approbation
manuelle d'une session QA authentifiée, puis les tests en
lecture réelle et de progression.
