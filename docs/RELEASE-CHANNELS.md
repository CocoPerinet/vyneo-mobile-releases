# Vynéo : canaux Mobile et Desktop sans interférence

## Dépôts

- **Code Mobile :** `CocoPerinet/vyneo-mobile` (privé, Expo/React
  Native). Version de départ Android 0.3.4, signature stable existante.
- **Desktop et releases publiques :**
  `CocoPerinet/vyneo-mobile-releases`. Le sous-dossier `desktop/`
  contient Tauri 2 Windows/macOS. Le même dépôt distribue déjà les
  APK Mobile et leur manifeste public.

## Publications

| Distribution | Tag | Artifact | Mise à jour |
| --- | --- | --- | --- |
| Android | `mobile-vX.Y.Z` | APK signé | `update-manifest.json` |
| Windows x64 | `desktop-vX.Y.Z` | NSIS .exe signé minisign | `desktop-windows-x86_64.json` |
| macOS Apple Silicon | `desktop-vX.Y.Z` | DMG + archive .app.tar.gz | `desktop-darwin-aarch64.json` |
| macOS Intel | `desktop-vX.Y.Z` | DMG + archive .app.tar.gz | `desktop-darwin-x86_64.json` |

Un tag Desktop n'exécute **pas** la construction Android.
Un tag Mobile dans le dépôt privé n'exécute **pas** Desktop.
Les numéros de version évoluent indépendamment.

Le fichier `update-manifest.json` Mobile **ne doit pas être édité**
pour un build Desktop. Sa version et son SHA-256 de départ sont
conservés. Les manifests Desktop et le mécanisme de publication
ne dépendent pas du quota des artefacts temporaires GitHub Actions :
chaque runner met directement ses binaires signés dans les
GitHub Releases publiques du même dépôt.

## Préconditions de la première release

- Mettre le secret GitHub Actions `TAURI_SIGNING_PRIVATE_KEY`
  avec la clé privée minisign Desktop, différente de l'APK Android.
  Aucune clé privée dans le dépôt, logs CI ou assets installables.
- Créer et pousser un tag exact `desktop-v0.1.0` **uniquement après**
  validation d'une compilation Windows/MSVC et de la navigation.
- Les workflows de tags génèrent les signatures et les trois
  manifestes de plateforme. Le plugin Rust Tauri refuse les
  mises à jour falsifiées (signature absente ou incohérente).
- Un échec d'update ou une déconnexion Internet n'empêche pas
  l'ouverture de Jellyfin : le client continue sa version installée.
- Les DMG macOS nécessiteront une signature Apple et une
  notarisation pour une distribution sans avertissement Gatekeeper.

## Intégration Jellyfin et G7y

Le Desktop lance d'abord le **Jellyfin personnalisé réel**, avec
son `index.html`, `skin.css` et `inject.js` actuels. Le menu
« Découvrir avec l'IA » ouvre G7y dans une seconde fenêtre
via Cloudflare Access, avec session distincte. Cela rend les
recommandations disponibles dans Vynéo, mais pas encore
incrustées dans l'accueil Jellyfin.

La **politique de bascule G6u** est portée comme module Rust
pur, testable indépendamment des flux, avec délai de sécurité,
preuves de même master aligné, trois observations avant montée,
priorité au mode manuel et arrêt après deux candidatures refusées.
Elle n'est **pas reliée au lecteur réel**. Le G6u original
repose encore sur des fichiers HLS de laboratoire : ni lecture
adaptative réelle 1080p/4K ni preuve de bascule en production. Prochaines étapes : preuve
de session réelle, adaptation du moteur de rayons vers Jellyfin,
puis lecteur libmpv/GPU avec autorisation et bascules mesurées.

**Les services actifs Jellyfin, Vynéo Next et G7v sur le N100
ne doivent pas être modifiés par ces workflows de distribution.**

## Séparation de confiance GitHub Actions (19/10/2026)

Le workflow Vynéo Desktop sépare maintenant les jobs :

- `verify`, `windows_preview` et `macos_preview` :
  accès GitHub **`contents: read`**, aucun secret de signature,
  aucune création de release. L'exécution d'une PR ne peut
  donc pas disposer de la permission de publication.
- `prepare`, `windows_release`, `macos_release` :
  uniquement après un tag `desktop-vX.Y.Z`, avec
  `contents: write` pour publier la release et ses manifestes.
- Les appels `actions/checkout` désactivent
  `persist-credentials` pour ne pas laisser le token GitHub
  en clair dans la configuration Git des builds.
- Les dépendances critiques sont alignées sur la CI validée :
  CLI Tauri **2.12.3**, crate Tauri **2.12.4**,
  plugin Updater **2.14.0**, tauri-build **2.7.3**.
  Un verrouillage complet des dépendances transitives Rust
  par `Cargo.lock` reste souhaitable avant une distribution stable.

**Toujours absent :** le secret GitHub Actions de la clé privée
Desktop. Une PR verte n'entraîne jamais à elle seule une
publication signée. Le système Android existant reste séparé.
