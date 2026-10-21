# Vynéo Desktop 0.2.4 : lot de développement

**Statut : branche de développement, pas une stable publiée.**
Base : stable `desktop-v0.2.3` / commit `c524d22`.
Branche : `feature/desktop-next-v0.2.4`.

## Branding officiel prévu pour la prochaine stable

- Source : logo orange validé de la PR GitHub #7, cherry-pick du commit `cca1bcb`.
- Source PNG `assets/icon.png` 1024 × 1024, SHA-256
  `4bac7ed59f6952e73ea5b1969487f2a2f5d8adf1ace625cd0a78daab0d289de3`.
- `npm run tauri -- icon ../assets/icon.png` génère les icônes Windows/macOS.
  GitHub Actions exécute déjà cette génération pour les builds Desktop.
- Aucune modification de l'APK Android à ce stade. L'application mobile
  est livrée depuis un dépôt différent.

## Améliorations natives

- Favoris et vu/non vu accessibles directement dans les fiches détaillées.
- Un épisode favori modifie uniquement la série parente. Si la parenté
  ne peut pas être certifiée, le bouton favori reste désactivé.
- Le rayon et les fiches reflètent les mutations validées par l'API Jellyfin ;
  les échecs réseau ne sont pas présentés comme réussis.
- Le bouton favori des bannières Hero est vérifié côté serveur avant activation.
- Option de réaffichage des éléments masqués depuis le menu du profil, isolée
  par identifiant utilisateur.
- Recherche : les réponses anciennes ne peuvent plus remplacer une recherche
  plus récente, ni désactiver son indicateur de chargement.

## Contrôles réels sur COCO

- Node : 22 PASS et 6 tests de publication POSIX ignorés sous Windows.
- Vitest : 98 PASS sur 19 suites, dont 4 nouveaux tests de mutations.
- Svelte/TypeScript : zéro erreur, zéro avertissement ; Vite build PASS.
- Playwright Chromium headless : 264 éléments À suivre simulés, vérification
  des actions de fiche (favori série mère, vu/non vu), récupération des
  éléments masqués, recherche en concurrence, défilement des rayons, univers,
  responsive 390/1280/1920 pixels et aucune erreur navigateur.
- Rust `cargo test --release --locked --offline` : 7/7 PASS.
- `npm run tauri -- icon ../assets/icon.png` : génération des icônes PASS.
- Build NSIS QA : `Vynéo Jellyfin QA_0.2.4-qa.1_x64-setup.exe` (3 436 698 octets),
  SHA-256 `dd026fb2a684f1d0bc0c9ff222fcd8e69cb02f780ab5859d409b7676d760cc86`.
- Installation silencieuse QA sur COCO : code 0, version native et registre
  `0.2.4-qa.1` vérifiés, la stable installée reste `0.2.3` avec empreinte
  binaire inchangée.
- Les données de Playwright sont synthétiques ; aucune validation de ces
  actions n'a encore été effectuée avec le compte Jellyfin réel.

## Reste avant la prochaine publication stable

- Tests utilisateur de la nouvelle QA avec le compte Jellyfin authentifié,
  les véritables affiches et le comportement des favoris.
- Reproduction des interactions encore manquantes du thème Jellyfin.
- Lecteur natif et gestion des pistes/qualité toujours incomplets.
- Univers gérés par le LLM G7z et chronologies MCU/Star Wars non raccordés.
- Relancer l'ensemble des tests et les builds signés sur un nouveau tag
  `desktop-v0.2.4` uniquement quand ces vérifications seront satisfaisantes.
- Ne pas modifier la stable `0.2.3`, son manifeste de mise à jour, l'Android
  ni le serveur Jellyfin pour développer cette branche.

## Correctifs visuels remontés le 21 octobre (lot suivant)

- **Placeholder d'image** : chaque élément `img` lazy est masqué tant
  qu'il n'a pas chargé une image décodable (`data-vy-art-ready`). Si le
  navigateur échoue sur un Blob JPG/PNG corrompu, la source est retirée et
  le fond dégradé du composant reste visible, sans icône d'image cassée.
- **Top 10** : rang numérique en bas à gauche, badges
  `Nouveau film`/`Nouvelle saison` en haut à droite.
  Vérification Playwright par intersection de rectangles réels.
- **Navigation** : plus d'onglet `Univers` dans le header. Les tuiles de
  l'accueil ouvrent toujours les univers. `Accueil` reste l'onglet actif
  lorsque l'utilisateur explore un univers, et le bouton
  `Tous les univers` reste disponible.
- **Sept univers** : ajout de `Nouveau DCU` distinct de `DC`, en
  conservant l'ordre exact de la skin Jellyfin (MCU, Disney, Pixar,
  DreamWorks, Star Wars, DC, Nouveau DCU). Le logo `dcu.png` a été copié
  depuis le thème Jellyfin en lecture seule, et garde sa couleur bleue.
  Titres connus Star Wars sans studio Lucasfilm et films DC ciblés
  rattrapés sans inventer de contenus absents de la bibliothèque.
- **Tuiles** : contraintes de largeur et hauteur des sept logos pour
  empêcher DC et Nouveau DCU de déborder de leurs cartes.

### Résultats réellement obtenus

- 99/99 Vitest sur COCO, 22 Node PASS (6 SKIP spécifiques POSIX).
- `npm run check` : 0 erreur Svelte/TypeScript, build Vite PASS.
- Playwright headless `npm run qa:parity` : PASS sur COCO. Il couvre
  désormais un PNG volontairement corrompu, l'absence d'icône cassée,
  les badges Top 10 sans chevauchement, les logos des sept univers
  dans leurs tuiles et la navigation mobile. Scénarios synthétiques
  uniquement, pas d'accès au compte Jellyfin réel.
- Source finale de ce lot : `0fc69cf` et descendants de la même branche.
- **Objectif single app** : ne pas multiplier les installations QA.
  La livraison au public doit passer par la stable signée `0.2.4`
  et son manifeste Tauri auto-updater, sans téléchargement manuel.
  L'identité QA installée sera supprimée séparément lorsque la stable
  signée sera prête ; aucune suppression de la stable autorisée.
