# Vynéo Desktop 0.1.2 (alpha, en validation)

Le client conserve **l'interface Jellyfin personnalisée d'origine** depuis
`https://cocojellyfin.duckdns.org:38443/web/index.html`. Les sections,
le classement, les univers et « Pour vous » issus de Jellyfin utilisent le
**cache existant par utilisateur** de `vyneo/inject.js` (localStorage,
IndexedDB et mémoire de la WebView2). Aucune copie non chiffrée de
l'historique ou du catalogue personnel n'est créée par Tauri.

## Fenêtre native et démarrage

- Plus de menu Windows « Bibliothèque Jellyfin / Découvrir avec l'IA » au-dessus
  du site. Un lien « ✦ Découvrir avec l'IA » discret est inséré **dans** le
  frontend Jellyfin après connexion, en dehors de la lecture. Il ouvre la
  fenêtre distincte G7y/Top 10 sous Cloudflare Access, sans divulguer
  la session Jellyfin.
- Tauri fournit un unique cadre Windows/macOS avec deux WebViews internes.
  Une **coquille locale** sans réseau, CSS/HTML empaquetés dans l'application,
  apparaît immédiatement. La véritable WebView Jellyfin démarre en parallèle
  mais reste invisible tant que le document de connexion ou d'accueil
  n'est pas prêt **et** que l'updater n'a pas terminé sa vérification.
  Le changement se fait à l'intérieur du même cadre : aucun spinner ou
  écran blanc du chargement réseau n'est montré à l'utilisateur.
- En fermant Vynéo par la croix, l'application est masquée dans la zone de
  notification et sa WebView **reste entièrement en mémoire**, DOM et
  défilement compris. Une nouvelle ouverture du raccourci Vynéo réactive
  cette fenêtre via le plugin Tauri single-instance, sans recharger Jellyfin.
  La lecture HTML5 est mise en pause lorsque la fenêtre est masquée.
  Menu de l'icône : **Ouvrir Vynéo / Découvrir avec l'IA / Quitter complètement**.
- Une sortie explicite ou un redémarrage Windows termine la session mémoire.
  Au prochain démarrage à froid, l'utilisateur voit l'habillage local sécurisé,
  puis Jellyfin exploite son cache disque WebView2/IndexedDB existant.
  Aucun programme ne peut garantir un *catalogue fonctionnel en ligne*
  immédiatement sans réseau ni authentification. La coquille locale
  n'affiche donc pas de titres personnels avant validation du compte.
- Hors ligne, la coquille conserve un accès à une tentative de reconnexion.
  Elle ne remplace jamais un échec réseau par une page WebView2 blanche.

## Authentification et isolation

La WebView Jellyfin conserve le profil WebView2 existant, propre à
l'identifiant `fr.visyren.vyneo.desktop`. L'application ne lit,
n'exporte ni ne réutilise directement ses cookies/JWT, ne copie pas le
mot de passe, et ne transforme pas une page publique en contenu privé.
La reconnexion n'est automatique que si la session Jellyfin sauvegardée
par Jellyfin reste valide.

Un script Rust-owned injecte le bouton IA seulement si l'origine de
la page est exactement
`https://cocojellyfin.duckdns.org:38443`. Les navigations vers
G7y déclenchent l'ouverture de la **fenêtre séparée** :
`https://vyneo-preview.visyren.fr/app/secure.html`. L'authentification
Cloudflare Access se déroule normalement, sans bypass ni token transféré.

La configuration Tauri conserve `withGlobalTauri:false` et
`capabilities:[]`. Les pages externes n'ont aucun droit IPC Tauri.
Le bootstrap local utilise une CSP restrictive (pas de JavaScript
local, pas de réseau/fetch, pas d'iframe).

## Mises à jour

L'updater Rust garde les signatures minisign et son contrôle
`requireSignedVersion`, avec refus des downgrades. Au premier
démarrage, l'interface locale s'affiche **pendant** le contrôle
(timeout 3 s), puis pendant un éventuel téléchargement vérifié
(timeout 30 s). L'utilisateur ne commence pas la lecture avant
qu'une installation de nouvelle version ait été traitée.

Les fichiers Windows et macOS sont publiés séparément sous les tags
`desktop-vX.Y.Z`, avec manifestes propres à chaque système.
Android 0.3.4, `update-manifest.json`, Jellyfin sur le N100 et G7y
ne sont pas modifiés par cette refonte Desktop.

Les builds GitHub sont nécessaires pour valider Tauri Windows/macOS,
le multiwebview, single-instance et la zone de notification. **Aucune
release 0.1.2 n'est annoncée utilisable sans compilation CI verte et
vérification interactive de la page et du comportement de fermeture.**

## Fonctions non encore livrées

- Fusion DOM des sections G7y/LLM directement dans l'accueil Jellyfin.
  Le bouton IA ouvre toujours une seconde fenêtre sécurisée.
- Lecteur libmpv/CEF, HDR matériel et qualité automatique réelle.
  Les politiques G6u Rust sont isolées et testées sans flux vidéo réel.
- Mode bibliothèque totalement hors ligne : ce n'est pas un cache
  réutilisable sans contrôle des droits des comptes.
- Une capture fidèle de la dernière page après **extinction complète** de
  l'application. Seule la fenêtre maintenue en mémoire dans la zone de
  notification conserve réellement l'écran précédent et son état interactif.

Depuis `desktop/`, exécuter `npm ci && npm run check && npm test`
pour les validations de configuration/JS. Les compilations natives sont
faites par la CI GitHub Windows/macOS.
