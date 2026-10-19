# Vynéo Desktop (Windows / macOS)

**Version 0.1.0, socle natif Tauri 2.**

## Interface et fonctions disponibles

La fenêtre principale ouvre **le véritable Jellyfin personnalisé** :
`https://cocojellyfin.duckdns.org:38443/web/index.html`.
La page réellement utilisée sur le N100 est celle qui charge
`vyneo/skin.css` et `vyneo/inject.js`, avec le design, les
fonctionnalités Jellyfin et le lecteur actuel de Vynéo.

Le **menu natif** « Découvrir avec l'IA · Top 10 » ouvre
une fenêtre distincte sur la préproduction privée
`https://vyneo-preview.visyren.fr/app/secure.html`, pour accéder
aux 46+ sections, au Top 10, aux univers et aux recommandations
locales G7y déjà créées. Les deux interfaces ne partagent **pas**
leurs cookies ni leurs authentifications. Cette séparation évite
d'exposer les jetons Jellyfin à l'interface distante et préserve
le Jellyfin de production.

**Limitations :** G7y apparaît actuellement dans une fenêtre
distincte, pas dans les rayons de l'accueil Jellyfin. La fusion
visuelle nécessite un adaptateur serveur sécurisé et des tests.
Le changement automatique de qualité G6u a désormais un
**moteur de décision Rust indépendant et testable**
(`src-tauri/src/quality_policy.rs`). Il conserve la priorité
aux choix manuels, l'anti-oscillation, le changement d'une
qualité à la fois, les profils du même master alignés, et le
refus de deux transitions consécutives non confirmées.
Il ne reçoit **aucun flux réel** et ne change aucun décodeur :
le lecteur actuel n'est pas connecté à cette politique.
MPV natif, commutation effective des qualités,
HDR natif, audio passthrough et TV/manette restent **non intégrés**.
Ne pas assimiler une fenêtre Tauri à ces fonctionnalités.

## Mises à jour Windows / macOS

Le moteur Tauri Updater fonctionne **côté Rust**, sans permission
JS accordée à Jellyfin ou au portail IA. À chaque lancement,
il recherche brièvement une version nouvelle sur des manifestes
publics strictement HTTPS, puis vérifie la **signature minisign**
avant installation. Les vérifications ont lieu avant l'ouverture
du lecteur, afin de ne pas interrompre une vidéo en cours.

Manifestes par plateforme, séparés de l'application Android :

- `desktop-windows-x86_64.json`
- `desktop-darwin-aarch64.json`
- `desktop-darwin-x86_64.json`

Ils sont hébergés dans le dépôt public
`CocoPerinet/vyneo-mobile-releases` et pointent vers les
installateurs de ses GitHub Releases `desktop-vX.Y.Z`.
Les exécutables NSIS Windows sont accompagnés de leur signature ;
macOS utilise une archive signée `.app.tar.gz` pour la mise à
jour et un DMG pour l'installation initiale.

**Condition de mise en production :** la clé de signature privée
doit être configurée dans le secret GitHub Actions
`TAURI_SIGNING_PRIVATE_KEY` de CE dépôt public. Elle n'est
jamais enregistrée en Git ni remise au navigateur. Si absente,
le build de Release échoue avant de publier un binaire non signé.
La première installation se fait depuis GitHub ; les suivantes
s'installent au lancement de l'app, sans nouvelle installation
manuelle. Les builds PR peuvent compiler sans signer ni publier.

La signature Tauri ne remplace pas la réputation SmartScreen
ni la signature/notarisation Apple : les premières versions peuvent
donc déclencher un avertissement Windows/macOS.

## Développement

Depuis `desktop/` :

```bash
npm ci
npm run check
npm test
npm run tauri -- icon ../assets/icon.png
npm run tauri -- build --bundles nsis
```

Le build est prévu sur GitHub Actions, Windows/MSVC et macOS.
Sans Rust, le SDK de développement Tauri et MSVC/Xcode,
les tests Node ne valident **pas** le binaire. Ne pas activer
de capacités Tauri `remote` : elles donneraient au code serveur
un accès local qu'il n'a pas aujourd'hui.

Le sous-dossier `desktop/` est maintenu dans ce dépôt public
de distribution ; l'application Mobile reste développée dans
le dépôt privé `CocoPerinet/vyneo-mobile`. Son manifeste de
mise à jour 0.3.4 et sa signature Android ne sont pas modifiés.
