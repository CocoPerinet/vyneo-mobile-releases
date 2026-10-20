# Vynéo Desktop 0.2.2 : navigation sticky et statut de session véridique

## Contexte
Le 20/10/2026, vérification en lecture seule de Windows COCO :
- Vynéo Desktop **0.2.1 installé et en cours d'exécution**, exécutable
  et entrée Windows Uninstall indiquant 0.2.1 ; process PID 26832.
- Mise à jour signée du canal stable correctement publiée avec trois
  manifestes (Windows x64, macOS ARM/Intel) version 0.2.1.
- Captures réelles de la nouvelle interface : « Pour vous » affiche
  des correspondances par titre (Silent Voice, Bohemian Rhapsody,
  Les Infiltrés, Backrooms), « Top 10 · Sorties récentes » avec rangs
  à l'intérieur des vignettes.
- **Régression d'ergonomie découverte** : à 1300px de défilement
  dans Chrome Windows simulant Vynéo, l'en-tête sticky remontait à
  `top=-1300px` au lieu de rester à `top=0`. Cause confirmée :
  `.vy-app { overflow-x:hidden }` calcule implicitement
  `overflow-y:auto` et devient l'ancêtre de défilement du sticky.

## Correction
- `styles.css` : racine de l'application avec
  `overflow-x:clip; overflow-y:visible` ; `.vy-header` conserve
  `position:sticky; top:0; z-index:40`. Les rails de contenus
  continuent de défiler horizontalement individuellement.
- `layout-sticky.test.ts` : nouveau contrat de non-régression
  sur l'absence de conteneur de scroll parasite, testé en CI.
- `App.svelte` : l'état « connexion mémorisée » n'est plus
  déduit de la case « Rester connecté » (cochée par défaut).
  Il devient vrai uniquement après `nativeVault.save()` réussi ou
  `nativeVault.read()` + `api.restore()` validés.
  En absence de preuve, le profil affiche « Session active,
  non mémorisée », ou l'avertissement du coffre natif s'il échoue.
  L'action « Se déconnecter » réinitialise cet indicateur.
- Bump cohérent des versions Cargo, Tauri, package npm/lock,
  protocole Jellyfin et contrat de build à **0.2.2**.
- Pas de changement des endpoints Jellyfin, des clés signées,
  de l'identifiant d'application, de Preview, Mobile Android,
  des autorisations réseau ou des services serveur.

## Tests réellement exécutés avant publication
- Avant correction, Chrome headless Windows, même QA : 
  `scrollY=1300`, header `top=-1300`,
  `overflowX=hidden`, `overflowY=auto`. **Échec reproduit**.
- Après correction, Chrome headless Windows :
  `scrollY=1300`, header `top=0`,
  `overflowX=clip`, `overflowY=visible`.
  QA complète réussie sur 390/1280/1920 px, films, séries,
  épisodes, recherche, artworks, recommandations, rangs,
  favoris, menu profil sans logout.
- N100 : 76 tests Vitest PASS, 4 tests release CI ciblés PASS,
  svelte-check 0 erreur/avertissement et build Vite PASS.
- Session OS réelle après redémarrage et mise à jour : **encore
  à valider sur l'installation interactive** ; les tests de la
  version 0.2.1 ne couvraient qu'un coffre mocké côté navigateur.

## Suivi
Publier stable `desktop-v0.2.2` après builds QA signés et vérifier
chaque manifeste et signature. La version Windows 0.2.1 installée
servira au test grandeur nature de rétention de session lors de
l'auto-update 0.2.1 → 0.2.2.

