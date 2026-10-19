# Décision produit Vynéo : frontend propriétaire (20 octobre 2026)

L'utilisateur voulait reproduire visuellement son Jellyfin personnalisé,
pas embarquer l'interface Jellyfin Web dans un logiciel Tauri.
L'architecture Desktop 0.1.x était donc une mauvaise interprétation.

## Sources visuelles de référence, lecture seule

- /opt/zurg/jellyfin-vyneo/index.html
- /opt/zurg/jellyfin-vyneo/web/skin.css
- /opt/zurg/jellyfin-vyneo/web/inject.js

La V2 réutilise dans son propre CSS les tokens visuels de l'ancienne
interface : fond #0a0c11, second plan #10131b, cartes #161a24,
texte #f0f3f9, accents #e4572e et #ffb347, typo Inter/Segoe UI,
hero cinématique et cartes paysage 16:9.

Elle n'importe AUCUN runtime, CSS injecté ou fichier Web Jellyfin.

## Nouveau frontend Desktop 0.2.0 en branche isolée

- desktop/frontend/ : Svelte 5, Vite, fichier HTML packagé localement.
- App.svelte : connexion, navbar, hero, carousel, bibliothèque, recherche,
  collections et fiches.
- api.ts : serveur Jellyfin HTTPS épinglé ; login avec vérification par
  Users/Me, token en mémoire, endpoints bornés et credentials omit.
- artwork.ts : images avec Authorization HTTP et Blob URL ; cache mémoire
  borné, purge en cas de déconnexion.
- discover.ts : premiers rayons personnels déterministes, Top 10 basé sur
  CommunityRating et recettes éditoriales quotidiennes (pas du LLM).
- src-tauri/ : uniquement le cadre natif, tray et updater cryptographiquement
  signé, sans charger Jellyfin Web par URL externe.

## Sécurité : recommandations G7y

Le BFF existant est protégé par Cloudflare Access, cookies HttpOnly et
contrôles same-origin. L'app locale ne doit pas contourner ces règles.
La future API native devra recouper chaque requête avec l'identité
Jellyfin et les droits de contenu du même utilisateur, puis retourner
les sections LLM comme des métadonnées structurées dans l'accueil local.
Ce raccordement n'est PAS encore fonctionnel en 0.2.0.

La lecture vidéo et la commutation adaptative G6u sont également
des travaux distincts, soumis aux tests de codec et d'accès média.

## Release et rollback

La branche 0.2.0 n'a aucun tag public et ne remplace aucun client.
Les manifestes d'auto-update Windows/Mac restent en 0.1.1, et le
manifeste Mobile Android 0.3.4 est inchangé. Les services du serveur
Jellyfin et du BFF Vynéo ne sont pas modifiés.

## Bibliothèque locale de recettes éditoriales G7x

Le client 0.2.0 reprend **45 recettes publiques** de la taxonomie
G7x (21 genres, 14 croisements, formats, décennies, nouveautés,
classiques, notes et favoris non commencés). Une recette supplémentaire
« saga » est volontairement exclue : le schéma actuel n'a pas les
identifiants de collection nécessaires à une classification fiable.
Les recettes studios/univers/« thème IA » exigent des preuves serveur
supplémentaires et ne sont pas inventées localement.

Jusqu'à **10 sections éditoriales par jour**, avec 3 à 5 œuvres
chacune et sans réutilisation d'un même titre entre ces rayons,
peuvent être proposées **si le catalogue actuellement chargé le
permet**. Le score est stable pour un utilisateur et un jour UTC,
mais change lorsque la fenêtre quotidienne change ; les droits et
genres proviennent de la réponse authentifiée Jellyfin.

**Limite réelle :** ces rayons se fondent encore sur le lot
récent (96 titres maximum) et ne prétendent pas parcourir les
800+ animés, séries ou films du serveur. L'algorithme serveur G7y,
qui explore 512 œuvres et consulte le cache Qwen3, sera raccordé
seulement après conception de l'authentification native sécurisée.
