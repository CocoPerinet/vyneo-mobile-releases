# Vynéo Desktop 0.2.0 : contrat de raccordement natif G7y
20 octobre 2026. **Décision : aucune activation du BFF G7y dans Tauri
avant établissement d'une identité Cloudflare Access native vérifiable.**

## Constat vérifié dans le code existant
- Le frontend Svelte natif utilise exclusivement l'origine Jellyfin
  `https://cocojellyfin.duckdns.org:38443`. Les jetons Jellyfin vivent
  en mémoire et sont transmis dans les en-têtes `Authorization`.
- G7y/G7w est servi par le BFF privé
  `https://vyneo-preview.visyren.fr`. Sa route
  `POST /secure/rotating-sections` impose un JWT Cloudflare Access
  signé à l'origine, une session G7h HttpOnly/SameSite=Strict liée au
  même sujet, une vérification de compte Jellyfin et un jeton CSRF.
- Le frontend Tauri est d'origine locale (tauri://localhost ou
  http://tauri.localhost selon OS). Il ne possède pas et ne doit
  pas copier les cookies / JWT du navigateur Access. Une requête
  cross-origin directe n'est pas une authentification.
- Les champs BFF `userEntitlementVerified=false`,
  `realPlaybackAuthorized=false`, `playableUrls=0` et
  `mediaBytesRead=0` décrivent des **métadonnées seulement** :
  jamais une permission de lancer un lecteur.
- Les endpoints existants ne fournissent pas un contrat OAuth/device
  pour le Desktop. Aucune conversion magique cookie → token natif
  n'est postulée.

## Livraison préparatoire effectivement développée
1. `frontend/src/candidate-pages.ts` :
   exploration privée d'au plus **512 métadonnées** Jellyfin en
   quatre pages maximum (0, 128, moyenne, ancienne). Pages d'archive
   choisies de manière stable par semaine UTC et compte utilisateur.
   Une page facultative a un timeout de 1,5 s. Le catalogue récent
   fonctionne même si une archive est indisponible. Sans
   `TotalRecordCount`, le premier lot demeure l'unique preuve.
2. `frontend/src/api.ts` :
   GET uniquement sur l'origine épinglée et le même compte,
   `Filters=IsUnplayed`, pas d'URL vidéo, de session ou de chemin
   de fichiers. Les IDs mal formés, doubles et totaux incohérents
   ne deviennent pas des suggestions. Déconnexion et rotation de
   compte invalident les résultats tardifs.
3. `frontend/src/g7y-contract.ts` :
   parseur **pur, non connecté**, qui reconnaît le schéma G7x/G7y,
   rejette les données et déclarations d'autorisation inattendues,
   les champs secrets et les titres non présents dans le catalogue
   Jellyfin **déjà validé localement pour la session courante**.
   Il remplace titres et métadonnées BFF par les objets locaux.
   Ceci ne remplace PAS une authentification cryptographique.

## Piste officielle identifiée : Cloudflare Managed OAuth
La documentation Cloudflare (consultée le 20/10/2026) décrit **Managed OAuth**
pour les applications Access auto-hébergées et les clients non-navigateurs :
https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/managed-oauth/

- Flux OAuth 2.0 avec navigateur de l'utilisateur et politiques Access
  inchangées ; support RFC 8707 et redirections localhost/loopback
  configurables (PKCE recommandé pour un client Desktop public).
- Jeton OAuth **opaque** remis au client, résolu par Cloudflare en
  assertion `Cf-Access-Jwt-Assertion` signée à l'origine. Aucun JWT
  d'identité n'est exporté vers le frontend.
- Option **désactivée par défaut** sur les applications Access
  auto-hébergées existantes ; activer cette option est une mutation
  de sécurité qui exige une revue distincte et un test isolé.
- L'authentification Access seule ne crée **pas** la session G7h
  Jellyfin/CSRF. Le BFF aura besoin d'un parcours natif explicite
  de consentement, de preuve de compte et de rotation/révocation.
- Il faut vérifier que Managed OAuth ne remplace pas un
  `WWW-Authenticate` attendu par d'autres consommateurs.
- **Aucune configuration Cloudflare n'a été modifiée.** Ne pas
  ouvrir un CORS global ni embarquer une clé client secrète.

## Préconditions du vrai pont natif
1. Choisir et vérifier avec Cloudflare **un flux client natif
   pris en charge** qui satisfait la même policy Access et les
   vérifications JWT à l'origine. Aucune route d'échange publique
   hors Access, aucun service token statique dans le logiciel.
2. Obtenir l'autorisation explicite de l'utilisateur avant de
   connecter le compte Jellyfin au contexte Access ; vérifier
   `/Users/Me` côté serveur. Prouver la correspondance exacte entre
   l'identité Access validée, la session G7h et le compte Jellyfin.
3. Introduire un transport dédié côté BFF, avec limitation de durée,
   audience, anti-rejeu, protection CSRF/cross-site et révocation.
   Aucun cookie/JWT/jeton Jellyfin ne sort des compartiments qui
   les possèdent. Ne pas ouvrir CORS globalement.
4. Le frontend ne consomme que des **métadonnées structurées** après
   confirmation cryptographique et consultation Jellyfin personnelle ;
   toute suggestion de titre reste revalidée sous le compte courant.
   La sortie native est purgée à la déconnexion ou à l'expiration.
5. Test de refus obligatoire : sans Access, mauvaise audience,
   sujet différent, session expirée, consentement absent, compte
   Jellyfin B non autorisé, ID media étranger, replay, retour
   après logout, réseau hors ligne, champ média ou secret injecté.
   L'ancien accueil local doit rester disponible en repli.

## Décision de livraison
- **Aujourd'hui :** recommandations locales explicables et
  exploration 512 candidats, module G7y en lecture seule **non
  appelé**. Aucun navigateur Access ou worker Qwen3 n'est relié.
- **NO GO :** déployer un BFF modifié, injecter des cookies Access,
  exposer un token dans l'URL, activer un lecteur ou publier la 0.2.0.
- **Prochain gate :** preuve d'un flux Access natif officiellement
  supporté, testée sur une identité fictive de bout en bout dans
  un environnement isolé. Seulement ensuite qualification sur
  une vraie session autorisée, sans divulguer d'identifiants.

## 20/10/2026 : G7z, preuve de rattachement native sans déploiement

Le travail se poursuit sur le serveur N100 dans la worktree dédiée
`/home/coco/Projects/vyneo-g7z-native-bridge`
(branche `feature/g7z-native-oauth-bridge`), sans modifier le
service Vynéo G7c actif ni la stable Desktop 0.2.2.

- Un protocole de liaison G7z en mémoire réalise PKCE, code à 12
  caractères, consentement **browser G7h/CSRF**, double association
  Access subject / compte Jellyfin, jetons délégués de 15 minutes,
  rotation sans rejeu, révocation lors du logout, et les réponses
  G7w/G7y sont réutilisées telles quelles, sans fichiers vidéo.
- L'application navigateur G7h a son interface d'approbation isolée
  et testée sur un serveur HTTPS/Jellyfin fictifs.
- `frontend/src/g7z-secure-shelves.ts` et
  `frontend/tests/g7z-secure-shelves.test.ts` préparent la
  **frontière de réception des seules métadonnées autorisées par
  le compte utilisateur courant**. L'adaptateur n'est pas appelé
  par l'accueil : la connexion native OAuth réelle n'existe pas encore.
- Cloudflare Managed OAuth est toujours **désactivé** pour
  `vyneo-preview.visyren.fr`. Il faut encore coder le client OAuth
  public dans Tauri, confirmer le comportement des headers Access,
  qualifier l'identité/CSRF et tester une vraie mise à jour signée
  avant d'envisager l'activation.
- Voir `docs/G7Z-NATIVE-OAUTH-ACCESS-BRIDGE.md` **dans le dépôt
  serveur** pour les gates, tests, cas de refus et rollback.
- Aucun secret utilisateur, cookie ou jeton Access n'est ajouté
  au frontend ni au dépôt Git. La stable 0.2.2 conserve sa
  connexion Jellyfin durable validée.

## 20/10/2026 : transport OAuth natif G7z et vérification Jellyfin concordante
- Branche dédiée `feature/g7z-desktop-client` : `g7z_oauth.rs`
  utilise **Cloudflare Managed OAuth** (authorization code + PKCE S256,
  client public enregistré dynamiquement, découverte serveur OAuth,
  `resource` RFC 8707, redirect loopback sur `127.0.0.1`),
  validation stricte des origines et réponses HTTP sans redirections ;
  aucun jeton OAuth ou code vérificateur n'est transmis au frontend.
- `g7z_native.rs` : coffre OS G7z **distinct du coffre Jellyfin**,
  association à un seul utilisateur, code temporaire de 12 caractères,
  renouvellement à jeton tournant, refus d'une session périmée, révocation
  best effort hors ligne et nettoyage du coffre au logout.
- `g7z-client.ts` : seul le client Tauri appelle les commandes du
  transport. Le profil propose une association explicite au navigateur,
  jamais une connexion Jellyfin forcée. En l'absence de G7z, l'ancien
  accueil demeure fonctionnel.
- `g7y-verified-pages.ts` et `api.getG7yVerificationCandidates()`
  corrigent l'incohérence entre les fenêtres de pagination de G7y
  sur le N100 (`PremiereDate`, SHA256 semaine ISO, 4 pages/512 titres)
  et le catalogue Desktop (`DateCreated` auparavant). Chaque résultat
  G7w/G7y est recoupé avec les métadonnées consultables directement
  avec le jeton Jellyfin du compte courant. Aucun droit d'accès n'est
  déduit des réponses du BFF.
- Tests ciblés : **11 tests pages et Jellyfin**, 18 tests IPC/adaptateurs
  supplémentaires sur la version initiale ; compilation Svelte, typage
  0 erreur/0 avertissement. Les tests globaux Vitest côté N100 ont
  rencontré une limite temporaire de threads, pas un échec fonctionnel
  identifié. Suite intégrale à exécuter sur COCO.
- **Blocage d'activation** : `oauth_configuration.enabled=false`
  sur l'application Access actuelle. Valider l'injection du JWT d'origine
  et le traitement du header Authorization dans un environnement
  staging, ainsi que le navigateur/Keychain sur macOS. Aucun changement
  d'Access, de BFF live, d'updater ou de stable 0.2.2 à ce stade.
