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
