# Vynéo Desktop — interface indépendante (0.2.0)

**Prototype en validation : aucune release 0.2.0 publiée.**

Vynéo Desktop charge notre frontend Svelte/TypeScript compilé localement
dans Tauri. Il n'exécute plus le client Web Jellyfin. Jellyfin sur le
N100 fournit seulement ses API médias, comptes et métadonnées.

## Fonctions implémentées

- Navigation propre à Vynéo : Accueil, Films, Séries, Animés, Ma liste et Univers.
- Authentification directe par l'API HTTPS Jellyfin, identité revérifiée.
- Catalogue, recherche, favoris, reprises, épisodes à suivre et collections.
- Hero cinématique, sections 16:9, fiches, Top 10 des œuvres les mieux
  notées et rotation hebdomadaire des genres visibles dans la bibliothèque.
- Première version locale de Pour vous, basée sur les genres vus/favoris.
  Ce n'est PAS encore le moteur LLM G7y.
- Affiches obtenues avec un en-tête Authorization. Aucun jeton dans leur
  URL. Cache mémoire de 76 images maximum, trois requêtes simultanées.
- Fenêtre sans barre native, réouverture à chaud en zone de notification,
  signature d'updates et installateurs Windows/Mac conservés.

## Code source

- frontend/src/App.svelte : frontend visuel Vynéo local.
- frontend/src/api.ts : API Jellyfin sécurisée et lecture de métadonnées.
- frontend/src/discover.ts : rayons locaux déterministes et leur rotation.
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
ouvrir le BFF privé sans authentification.

Le lecteur MPV/GPU, HDR et autoqualité réelle G6u ne sont pas encore
connectés à des flux autorisés. Les fiches le signalent.

## Validation et publication

Depuis desktop/, exécuter :
    npm ci
    npm run check
    npm test

Le premier valide l'architecture, TypeScript/Svelte et le build Vite.
Le second teste l'API en mémoire et les manifestes/updaters existants.

Les builds natifs et la parité visuelle restent à valider sur Windows/Mac
avant tout tag desktop-v0.2.0. Les manifestes publics auto-update restent
en version 0.1.1. Mobile Android 0.3.4 est inchangé.
