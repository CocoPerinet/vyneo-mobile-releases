# Vynéo Desktop : canal Preview opt-in (Windows)

État au 20 octobre 2026 : **Vynéo Preview 0.2.0-beta.1 Windows publiée et signée**.
[GitHub prerelease](https://github.com/CocoPerinet/vyneo-mobile-releases/releases/tag/desktop-preview-v0.2.0-beta.1).
La version stable installée n'est pas automatiquement remplacée.

## Comportement attendu

- Stable : identifiant `fr.visyren.vyneo.desktop`, nom Vynéo,
  version publique 0.1.x, manifestes signés
  `main/desktop-{target}-{arch}.json`.
- Preview : identifiant `fr.visyren.vyneo.desktop.preview`,
  nom **Vynéo Preview**, version `0.2.0-beta.1` et manifestes
  **distincts** `main/desktop-preview-{target}-{arch}.json`.
- Installation Preview **une fois à la main, volontairement** :
  deux applications côte à côte, deux identités d'installation.
  Les jetons Jellyfin de ce client restent uniquement en mémoire.
- Une fois une Preview signée installée, ses lancements consultent
  uniquement le flux Preview. Les versions suivantes (`beta.2`,
  `beta.3`, etc.) sont proposées par un dialogue Oui/Non ;
  elles ne sont téléchargées/installées qu'après acceptation.
- Les versions stables continuent de consulter uniquement leur
  propre flux. Une Preview ne peut ni remplacer Stable, ni
  exploiter une URL d'updater mobile Android.
- La vérification des signatures minisign et le refus des
  downgrades restent actifs, même sur Preview.

## Pipeline de publication (aucun tag déclenché par défaut)

1. Modifier `desktop/src-tauri/tauri.preview.conf.json`
   pour la nouvelle version, par exemple `0.2.0-beta.2`.
   Conserver l'identifiant et le préfixe du flux Preview.
2. Sur la branche de développement, faire tourner
   `npm run check && npm test` et la QA CI Windows **unsigned**.
   Ne jamais joindre la clé privée aux builds issus de PR.
3. Un mainteneur prépare un commit validé et pousse explicitement
   `desktop-preview-v0.2.0-beta.N` pointant sur ce commit.
   Le workflow `.github/workflows/desktop-preview.yml` :
   - exige un tag Preview correspondant exactement à la config ;
   - vérifie et teste, crée une **GitHub prerelease** ;
   - construit l'installateur Windows NSIS Preview, signé par la
     clé privée déjà utilisée pour le canal Desktop stable ;
   - refuse de publier en l'absence de clé ou de signature ;
   - publie uniquement le manifeste
     `desktop-preview-windows-x86_64.json` sur main, après
     validation du tag, de la signature, de la version et
     de la monotonie. Un manifeste stable ne sera pas modifié.
4. Vérifier le statut complet du workflow, inspecter l'asset,
   sa signature et le manifeste Preview distant. Installer
   l'asset Preview sur une machine de test, sans déplacer Stable.
5. Confirmer lors de la **bêta suivante** que le dialogue
   automatique se déclenche, peut être refusé, puis qu'une
   acceptation télécharge uniquement l'asset Preview signé.
   Aucune preuve de ce scénario complet avant les deux versions.

## Portée et restrictions

- **Windows x64 uniquement** pour la signature et le flux Preview
  de cette première CI. L'installateur NSIS bêta 1 (3,2 Mo) a été
  publié avec son `.sig` et le manifeste Preview indépendant.
  SHA256 EXE : `2389ea06aba5132d43ece598494293bf3ee8aea5aede17e7930f8dfd3afcb6a0`. Le support Preview macOS nécessite son
  propre job signé et le manifeste de sa plate-forme.
- Les builds de PR restent unsigned et ne sont jamais envoyés
  vers les manifestes updater. CI du tag bêta 1 :
  [39419153653](https://github.com/CocoPerinet/vyneo-mobile-releases/actions/runs/39419153653) **SUCCESS**.
- La signature est vérifiée cryptographiquement par Tauri
  à l'installation, pas par le test synthétique de manifeste.
  Les tests Node vérifient le format et la liaison de version.
- Le workflow Stable `desktop.yml` et le script
  `release-manifest.mjs` continuent de refuser un tag bêta.
- L'ancien installateur 0.1.1 possède toujours son propre
  updater silencieux. Le nouveau dialogue n'existe que dans
  les **binaires construits avec cette modification**.
  Il est impossible de lui injecter cette fonctionnalité
  sans une mise à jour signée de sa propre édition.
- Une prerelease `desktop-v0.1.2` existe déjà sur GitHub
  mais les trois manifestes **stable** publics ont été
  observés sur `0.1.1`. Aucun flux n'a été modifié
  pendant cet audit ; cela nécessite un diagnostic
  séparé avant toute décision de publier sur Stable.
- Ne pas publier `desktop-v0.2.0` tant que le lecteur
  natif et le raccordement G7y ne sont pas validés.

