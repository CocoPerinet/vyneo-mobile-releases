# Vynéo Desktop 0.2.1 : rendu, recommandations, sessions

## Retours de l'utilisateur (20 octobre 2026)
Captures de Vynéo Desktop 0.2.0 réel :
- Le Top 10 montrait principalement des titres anciens à forte note :
  import récent dans Jellyfin ≠ œuvre sortie récemment.
- Numéros du top dépassant les affiches.
- Rangées « Films récemment ajoutés » / « Séries récemment ajoutées »
  peu intéressantes et envahissantes.
- « Pour vous » se contentait d'un genre large Action/Aventure :
  classement trompeusement personnalisé.
- Le clic sur l'avatar provoquait immédiatement `logout()`.
- Chaque redémarrage/mise à jour complète effaçait la session Jellyfin.

## Correctifs développés
- `discover.ts` : suppression des rangées « récemment ajoutés » ;
  classement récent basé sur **l'année de production 2024 à 2026**
  (fenêtre 2 années avant l'année courante), note communauté >=6,5,
  non visionné, sélection bornée. Si moins de 10 titres, l'app montre
  « Les mieux notés · Sorties récentes », **sans inventer un Top 10**.
- `MediaCard.svelte` + `styles.css` : chiffres placés dans les images
  et bornés à celles-ci ; textes et menu profil mieux lisibles ;
  bannière légèrement raccourcie pour laisser de l'espace aux rangées.
- `personalized.ts` : similarité pondérée des synopsis (français/
  anglais), tags, studios et genres avec IDF, documents favoris
  prioritaires, historique visionné, classement diversifié et contrôle
  de preuve. Une catégorie isolée comme « Action » ne suffit pas.
  Les raisons sont des **titres réellement visionnés ou favoris** :
  « Dans l'esprit de « X » » ou « Proche de votre favori « X » ».
  Sans preuve crédible : « À explorer dans votre bibliothèque »
  sans affirmation de personnalisation.
- **Limite importante** : il s'agit d'un moteur local fondé sur les
  métadonnées utilisateur Jellyfin, pas de Qwen3/G7y ni de
  recommandation collaborative ou par embeddings certifiés.
- `App.svelte` : clic avatar => menu profil, logout uniquement en
  action explicite, fermeture par Escape ou clic extérieur.
- `src-tauri/src/credentials.rs` + `credential-vault.ts` :
  session Jellyfin sauvegardée **dans Windows Credential Manager ou
  le trousseau macOS**, uniquement quand « Rester connecté » est
  coché. Aucun token dans localStorage, URLs, manifestes ou fichiers
  de configuration. Appareil Preview et Stable ont deux entrées
  séparées. Restore appelle **GET /Users/Me** pour confirmer
  identité/politique, supprime le secret si la session a expiré,
  rejette changement de compte et réponses tardives.
  Logout explicite supprime l'entrée du coffre.
- L'utilisateur actuellement en 0.2.0 devra se reconnecter
  **une dernière fois** en 0.2.1 afin de créer le premier secret.
  Les installations précédentes ne stockaient pas ce jeton :
  impossible de le « migrer » sans l'avoir conservé.

## Validation
- N100 : compilation Svelte 0 erreur/avertissement, Vite PASS ;
  Vitest 75 PASS lors d'une exécution isolée avec 1 worker.
  La suite Node 27 PASS. Les commandes de suite combinée peuvent
  échouer occasionnellement sur N100 avec `EAGAIN`/pids lorsque
  d'autres services saturent le budget de processus ; ne pas confondre
  avec un test de code échoué.
- Windows COCO : npm ci, 21 tests Node PASS + 75 Vitest PASS ;
  6 tests POSIX ignorés sur Windows mais exécutés sur N100.
  `npm run check` PASS.
- Chrome headless Windows **avec données Jellyfin fictives et
  sans voler le focus** : titres d'archives 512 candidats, bannière,
  navigation 27 épisodes, piste vidéo fictive, 390/1280/1920 px
  sans débordement, Top 10 inclus dans la vignette, absence de
  sections « récemment ajoutés », justification par titre,
  avatar ouvrant le menu sans déconnexion, logout explicite,
  absence de secrets dans URLs, responsive PASS.
- CI PR [a0448bd](https://github.com/CocoPerinet/vyneo-mobile-releases/commit/a0448bd)
  : Verify et NSIS Windows QA ont **SUCCESS**. Le correctif
  complémentaire limite le coffre au `identifier` spécifique de
  Stable ou Preview. La version 0.2.1 et la compilation finale
  macOS/Windows doivent être vérifiées avant tag et publication.

## Conditions de publication
- Publier `desktop-v0.2.1` uniquement après compilation et
  tests CI des trois cibles et vérification de la clé de signature.
- Aucun changement à Jellyfin, Cloudflare Access, G7y/Arr/CocoDL,
  Mobile Android 0.3.4 ni aux manifestes Preview.
- La 0.2.0 ne propose pas l'actualisation en arrière-plan en continu.
  Au prochain **démarrage complet** de 0.2.0, la 0.2.1 signée doit
  être présentée dans une boîte Oui/Non ; observer le comportement.
- Une fois installée, cocher « Rester connecté », puis tester un
  redémarrage complet et confirmer la restauration du même compte.

