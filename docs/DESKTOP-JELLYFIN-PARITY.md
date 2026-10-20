# Vynéo Desktop : parité avec le thème Jellyfin, prototype

## Références réelles
- Branche feature/desktop-jellyfin-parity, à partir de stable desktop-v0.2.2.
- Source Jellyfin consultée en lecture seule sur N100 : /opt/zurg/jellyfin-vyneo/index.html, web/skin.css, web/inject.js, web/logos.
- L'index.html charge la skin et inject.js, qui dépend de l'interface interne Jellyfin React. Portage en Svelte, pas inclusion du runtime Jellyfin.

## Développements
- Header et Hero : vraie icône SVG de recherche, géométrie du champ, arrière-plan transparent au sommet, boutons ronds centrés, héros plus immersif, vraie photo avatar Jellyfin par API authentifiée.
- ShelfRail : carrousels horizontaux avec flèches de navigation, titres sans compteurs sur accueil, compteurs conservables dans Ma liste.
- MediaCard / HoverPreview : progression, badges, résumé, boutons play (fiche native et options de lecture), favoris et vu/non vu avec POST/DELETE Jellyfin, informations, téléchargement clairement indisponible, masquage local pour À suivre.
- À suivre : requêtes Jellyfin jusqu'à 600 éléments en pages de 300 et suppression de l'ancien plafond de 22 dans le rayon.
- Nouvelles saisons et suites : premières émissions S2E1 non commencées sur séries engagées >=15 %, vraies dates PremiereDate récentes <=60 jours et IDs de saison/série concordants. Suites de films proposées uniquement lorsque TMDbCollection est partagé avec un film déjà vu et nouvelle sortie <=60 jours.
- Badges : Nouveau film <=6 mois calendaires, Nouvelle saison Sx / Nouvel anime / Nouvelle série <=60 jours, jamais depuis DateCreated.
- Univers : six logos MCU / Disney / Pixar / DreamWorks / Star Wars / DC repris de la skin, regroupements studios et tags, pagination Jellyfin propre au compte. Le LLM G7z n'est PAS encore branché. Les phases MCU et la chronologie Star Wars avancées ne sont pas encore reproduites.
- Les changements de frontend restent dans un fichier CSS isolé et composants Svelte ; aucune altération des services Jellyfin, du projet G7z, ni de la stable 0.2.2.

## Validation
- TypeScript/Svelte 0 erreur / 0 avertissement, frontend construit sur N100.
- Test startup-shell mis à jour pour vérifier le composant ShelfRail où la logique top10 a été extraite.
- Trois suites ciblées new-seasons.test.ts, jellyfin-parity-api.test.ts, universes.test.ts avec données simulées et vérification des droits Jellyfin.
- Un npm test global sur N100 a rencontré une limite de création de threads (pids), pas un échec prouvé du code ; les tests globaux seront exécutés isolément sur COCO.
- Restant : QA Chrome headless multi-résolution, vérification des actions, tests complets Node/Vitest Windows, tests manuels avec compte connecté, puis PR brouillon. Ne pas publier stable sans ces validations.

## Compléments QA (21 octobre)
- Popup : enrichissement différé des métadonnées via /Users/{uid}/Items/{id}, cache borné et isolé par compte. Pour un épisode, le coeur reflète la série mère, et non l'épisode ; bouton temporairement verrouillé pendant la vérification.
- Univers : pagination élargie jusqu'à 6 000 entrées autorisées, en différé, pour ne pas tronquer les médiathèques importantes.
- Installeur QA prévu sous une identité indépendante fr.visyren.vyneo.desktop.jellyfinqa, coffre Windows distinct des versions stable et Preview. Aucune mise à jour automatique QA depuis les canaux de production.
- Build QA Windows : depuis desktop/, générer d'abord les icônes avec npm run tauri -- icon ../assets/icon.png ; installer en version indépendante avec npm run tauri -- build --bundles nsis --config src-tauri/tauri.jellyfin-qa.conf.json.
- Le CLI Tauri peut normaliser tauri-build en table TOML équivalente : les contrôles verrouillent toujours la version 2.7.3 exacte, sous les deux écritures.

## Résultat QA Windows, 21 octobre 2026
- Branche de validation : feature/desktop-jellyfin-parity, commit 559867a ou descendant.
- Node : 21 tests exécutés et réussis, 6 tests de publication ignorés car Windows/environnement non release.
- Frontend Vitest : 94 tests réussis sur 18 fichiers.
- Rust en release : 7 tests exécutés et réussis, notamment isolement des coffres credential stable/Preview/QA.
- npm run check : contrat UI natif, TypeScript/Svelte (0 erreurs, 0 warning), build Vite réussis.
- Playwright headless local sur COCO : 264 cartes à suivre dans les données simulées, flèches et scrolling, popup SVG/favoris sur série mère, 6 univers, recherche alignée, responsive 390/1280/1920 px, absence de débordement horizontal et d'exception navigateur.
- NSIS Windows x64 : VYNEO-JELLYFIN-QA-0.2.3-qa.1-x64-setup.exe, 3 351 116 octets, SHA-256 6ECEE071C0FC1A527BBC4BCDD89C06296AA098AA73E261FE836D43BD286688C5.
- Packaging QA validé sur COCO. Signé : NON (outil Authenticode NotSigned), aucun déploiement ni installation automatisée. C'est une construction de validation, pas une version finale.
- Blocage de départ résolu : icônes Tauri Windows manquantes générées à partir de assets/icon.png ; ancienne vérification Cargo.toml rendue compatible avec la normalisation Tauri sans déverrouiller tauri-build.
- À vérifier avant promotion : test avec le véritable compte et le rendu des affiches, branchement G7z LLM pour Univers, lecteur et téléchargements natifs, moteur complet des univers (phases MCU/Star Wars).
