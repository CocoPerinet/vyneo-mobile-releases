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
