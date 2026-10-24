# Vynéo Desktop : audit de parité avec le Jellyfin personnalisé

Date : 20 octobre 2026. **Statut : audit visuel préliminaire, non audité sur fichiers source.**

## Périmètre et décision d'architecture

L'application Vynéo doit rester une application indépendante Svelte/TypeScript dans Tauri, avec Jellyfin comme fournisseur de données et de lecture. **Ne pas incorporer Jellyfin Web ni exécuter `inject.js` en production dans Vynéo Desktop.** Réutiliser visuellement et fonctionnellement les composants du thème personnalisé après étude de leurs implémentations.

Fichiers de référence à lire sur le N100 :

- `/opt/zurg/jellyfin-vyneo/index.html`
- `/opt/zurg/jellyfin-vyneo/web/skin.css`
- `/opt/zurg/jellyfin-vyneo/web/inject.js`

Code Vynéo Desktop à comparer :

- `/home/coco/Projects/vyneo-release-worktree/desktop/frontend/src/App.svelte`
- `/home/coco/Projects/vyneo-release-worktree/desktop/frontend/src/styles.css`
- `/home/coco/Projects/vyneo-release-worktree/desktop/frontend/src/api.ts`
- `/home/coco/Projects/vyneo-release-worktree/desktop/frontend/src/discover.ts`
- `/home/coco/Projects/vyneo-release-worktree/desktop/frontend/src/personalized.ts`

Services Vynéo Next existants à **auditer avant de réimplémenter** :

- `/home/coco/vyneo-next/beta-web/src/secure/SecureApp.svelte`
- `/home/coco/vyneo-next/beta-web/src/secure/universe-ui.css`
- `/home/coco/vyneo-next/beta-web/src/secure/universe-manifest.ts`
- `/home/coco/vyneo-next/beta-web/src/secure/rotating-shelves.css`
- `/home/coco/vyneo-next/beta-web/src/secure/skin-parity.css`
- `/home/coco/vyneo-next/beta-web/src/secure/screenshot-parity.css`

Branche Desktop de développement au dernier contrôle : `feature/g7z-desktop-client`, PR #5 brouillon ; **ne pas modifier la stable 0.2.2** et ne pas lier cette refonte aux prérequis Cloudflare de G7z.

## Comparaison visuelle des captures fournies

Sources : `image(20261020-210323).png` (Vynéo actuel) et `image(20261020-210532).png` à `image(20261020-210654).png` (Jellyfin personnalisé), environ 1900 pixels de largeur. Les dimensions suivantes sont des estimations visuelles, pas des mesures DOM.

| Élément | État visible Vynéo | Référence Jellyfin | Critère d'acceptation |
| --- | --- | --- | --- |
| Header | Recherche compacte ; icône loupe et texte décalés ; avatar simple | Barre élargie, icônes groupées, avatar illustré | Alignement iconographique exact dans les contrôles, hauteurs et espacements homogènes |
| Hero | Bannière plus basse, visuel recadré et moins immersif | Hero nettement plus haut, fondu progressif jusqu'aux premiers rayons | Mesurer ratios et gradients réels depuis `skin.css`, puis égaliser à largeur de fenêtre égale |
| Boutons ronds | Icônes d'actions parfois visuellement décentrées | Disques identiques avec glyphes centrés | `display:grid;place-items:center`, dimensions et `line-height`, viewBox/transform vérifiés |
| Sections | `12 titres`, `22 titres` visibles dans titres | Pas de compteur apparent dans sections illustrées | Supprimer les compteurs partout sauf Ma liste / wishlist si utile |
| Défilement horizontal | Cartes au-delà du viewport sans flèches explicites | Navigation horizontale et comportements maison | Flèches gauche/droite superposées au rayon, disabled aux bornes, clavier et scroll-snap, sans couper le focus |
| À suivre | Ordre et quantité différents, contenu caché potentiel | Beaucoup plus d'épisodes ou séries visibles dans le carrousel | Comparer les ID réels, droits et routes Jellyfin ; prouver la parité des séries et de leurs prochains épisodes |
| Popup au survol | Pas de popup complète équivalente | Carte agrandie avec boutons, titres, notes, description, genres, badges | Hover card interactive avec délai, edge collision, fermeture, navigation clavier et action réellement raccordée |
| Nouvelles saisons et suites | Section absente | Section dédiée, saison récente mise en évidence | Réutiliser règles de détection Jellyfin / Vynéo Next, tester franchises et séries longues |
| Univers | Section absente de l'accueil | Rangée avec logos Marvel, Disney, Pixar, DreamWorks, Star Wars, DC | Reprendre logos, univers et navigation, LLM uniquement en complément d'évidence vérifiable |
| Badges nouveautés | Pas d'indicateur comparable | `Nouveau film`, `Nouvelle série`, `Nouvelle saison S2`, etc. | Calcul fondé sur dates et saisons, sans identifier comme nouveauté un film ancien récemment importé |
| Hero actions | Deux boutons principaux | Fiche plus petits boutons ronds contextuels | Actions conditionnées aux droits effectifs : favoris, vu/non vu, détails, lecture, etc. |

## Blocs de correction recommandés (ordre)

### Bloc A : parité du design et des interactions communes

1. Extraire seulement les paramètres CSS de référence : palette, dimensions, positions, breakpoints, gradient Hero, ratio des backdrops, taille et espacement des cartes.
2. Corriger le header et les alignements optiques : loupe, avatar, badges, glyphes dans les pastilles ; vérifier à 1280, 1600 et 1920 pixels de largeur.
3. Harmoniser la bannière Hero et les fondues sans importer le DOM React de Jellyfin.
4. Supprimer les compteurs visibles des rayons (conserver éventuellement wishlist).
5. Créer un composant Svelte `MediaRail` commun avec flèches, overflow, scroll-snap, navigation au clavier et accessibilité.

### Bloc B : carte de contenu, popup au survol

1. Inventorier les événements `inject.js` : hover, click, délais, fermeture, agrandissement, orientation et actions.
2. Implémenter un composant Svelte partagé `MediaHoverCard` avec un seul portail/popup actif, positionnement relatif au viewport et délais annulables.
3. Raccorder les opérations sur le compte Jellyfin courant via les routes existantes. La lecture ne doit pas être simulée : si lecteur indisponible, indiquer l'indisponibilité.
4. Tester le clavier, la souris, les titres proches des bords et la fermeture pendant une requête tardive.

### Bloc C : sections et données métiers

1. **À suivre** : comparer l'algorithme Jellyfin actuel et l'appel Desktop (`/Shows/NextUp` ou route existante), filtres bibliothèque, pagination, épisodes masqués, séries récemment vues, droits et déduplication. Construire une comparaison des IDs plutôt que compter uniquement les éléments affichés.
2. **Nouvelles saisons et suites** : reprendre la logique existante de détection de suites/saisons, distinguer ajout bibliothèque de date de sortie et vérifier qu'un nouvel épisode seul n'est pas étiqueté à tort `nouvelle saison`.
3. **Univers** : porter manifeste, logos et UI de Vynéo Next ; classification LLM comme enrichissement au sein des éléments effectivement reconnus, avec justification métadonnée et vérification stricte avant affichage.
4. **Badges** : une fonction de classement unique renvoyant type/numéro de saison/ancienneté, avec tests sur séries, anime, films et collections.
5. Conserver le fallback local des rayons personnalisés si G7w/G7y n'est pas disponible.

### Bloc D : QA sur le rendu réel

- Captures à même résolution et même état de scroll : Jellyfin original versus Desktop modifié.
- Tests automatisés CSS, clavier, hover, pagination, actions et navigation.
- Tester en application sur COCO sans voler le focus du bureau principal ; ne pas modifier la session 0.2.2 stable.
- Commits distincts par bloc, `npm run check`, `npm test`, tests Rust si changement natif et builds PR Windows/macOS sans release signée.
- Publier uniquement après validation manuelle des fonctions métier et de la fidélité visuelle.

## État au moment de cet audit

Le connecteur N100 était indisponible. Les trois fichiers source Jellyfin n'ont **pas** pu être lus ; aucune différence CSS ou JS n'a été attribuée à une règle source non vérifiée. **Aucun correctif n'a été appliqué** et aucun test de cette nouvelle demande n'a été exécuté. Ce document prépare la reprise et évite de déclarer comme implémentées les fonctions décrites dans les captures.
