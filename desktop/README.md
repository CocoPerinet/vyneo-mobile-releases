# Vynéo Desktop — interface indépendante (0.2.0)

**Version stable 0.2.0 publiée le 20 octobre 2026.** Le client natif reste fonctionnellement incomplet : lecteur MPV et G7y/Qwen3 non raccordés. [Release signée](https://github.com/CocoPerinet/vyneo-mobile-releases/releases/tag/desktop-v0.2.0).

Vynéo Desktop charge notre frontend Svelte/TypeScript compilé localement
dans Tauri. Il n'exécute plus le client Web Jellyfin. Jellyfin sur le
N100 fournit seulement ses API médias, comptes et métadonnées.

## Fonctions implémentées

- Navigation propre à Vynéo : Accueil, Films, Séries, Animés, Ma liste et Univers.
- Authentification directe par l'API HTTPS Jellyfin, identité revérifiée.
- Catalogue, recherche, favoris, reprises, épisodes à suivre et collections.
- Hero cinématique, sections 16:9, fiches, Top 10 des œuvres les mieux
  notées et jusqu’à dix rayons éditoriaux quotidiens fondés sur 45 recettes
  documentées. Ces rayons exploitent au maximum les 96 titres récents
  récupérés, et non l’intégralité du catalogue Jellyfin.
- Première version locale de Pour vous, basée sur les genres vus/favoris.
  Jusqu'à 512 métadonnées Jellyfin non visionnées sont explorées par
  quatre requêtes maximum, dont les archives facultatives bornées à 1,5 s.
  Ce n'est PAS encore le moteur LLM G7y.
- Affiches obtenues avec un en-tête Authorization. Aucun jeton dans leur
  URL. Cache mémoire de 76 images maximum, trois requêtes simultanées.
- Fenêtre sans barre native, réouverture à chaud en zone de notification,
  signature d'updates et installateurs Windows/Mac conservés.

## Code source

- frontend/src/App.svelte : frontend visuel Vynéo local.
- frontend/src/api.ts : API Jellyfin sécurisée et lecture de métadonnées.
- frontend/src/discover.ts : rayons locaux déterministes et leur rotation.
- frontend/src/candidate-pages.ts : échantillonnage hebdomadaire de 512 candidats maximum.
- frontend/src/g7y-contract.ts : validation des métadonnées G7y (pont non connecté).
- frontend/src/artwork.ts : images en Blob et cache mémoire borné.
- src-tauri/src/main.rs : cadre Tauri local et updater signé.
- ui/ : ancien écran d'attente, conservé pour rollback, NON exécuté.

La source visuelle de référence est le Jellyfin personnalisé sur N100,
notamment ses anciens skin.css et inject.js. Aucun de ces fichiers n'est
importé comme script ou stylesheet par le nouveau frontend.

## Limites de cette alpha

Les sessions sont en mémoire : fermeture par la croix = conservation du
DOM et du compte dans le tray ; Quitter complètement ou redémarrer
nécessite pour l'instant une nouvelle connexion. Aucune donnée personnelle
n'est montrée avant authentification à un nouveau lancement.

L'intégration LLM G7y requiert encore un contrat natif sécurisé pour
associer le compte Jellyfin et les droits à la réponse du serveur
protégé par Cloudflare Access. La fenêtre IA distincte n'est plus le
design visé. Ne pas contourner Cloudflare, exporter des cookies ou
ouvrir le BFF privé sans authentification. Décision et prérequis détaillés :
`../docs/NATIVE-G7Y-ACCESS-BRIDGE.md`.

Le lecteur MPV/GPU, HDR et autoqualité réelle G6u ne sont pas encore
connectés à des flux autorisés. Les fiches le signalent.

## Validation et publication

Depuis desktop/, exécuter :
    npm ci
    npm run check
    npm test

Le premier valide l'architecture, TypeScript/Svelte et le build Vite.
Le second teste l'API en mémoire et les manifestes/updaters existants.

Le tag stable `desktop-v0.2.0` a été construit et signé en CI.
L'updater Windows public annonce désormais 0.2.0, ce qui permet aux
clients 0.1.1/0.1.2 de se mettre à jour à leur prochain **démarrage complet**.
Le 0.1.x effectue encore une installation silencieuse ; à partir de
la 0.2.0, les mises à jour suivantes demandent confirmation Oui/Non.
La compatibilité 0.1.2 → 0.2.0 a été vérifiée sur les identifiants,
la clé publique et les endpoints ; le résultat d'installation réelle
sur le PC utilisateur reste à confirmer. Android 0.3.4 est inchangé.
