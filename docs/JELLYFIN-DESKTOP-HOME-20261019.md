# Vynéo Desktop : compatibilité de l'accueil Jellyfin personnalisé

Date : 19 octobre 2026.

## Interface choisie

L'interface principale de Vynéo Desktop continue de charger le client
Jellyfin **déjà personnalisé** à l'origine de production. Le vrai
`index.html` est un point d'entrée Jellyfin Web et non le squelette
Svelte de Vynéo Next. Il importe `vyneo/skin.css` et
`vyneo/inject.js`.

L'accueil natif Jellyfin contient déjà « Reprendre », « À suivre »,
« Tendances », « Pour vous » et différentes sections de découverte.
G7y/LLM, ses univers et son Top 10 sont pour le moment accessibles
depuis le menu natif **dans une fenêtre sécurisée distincte**.
Ce n'est pas encore une fusion de ces rayons dans le DOM Jellyfin.

## Correctif ciblé dans le frontend Jellyfin actif

Le fichier de personnalisation avait une erreur à la finalisation
du tableau `sections` dans `async function buildSections(...)` :
l'expression étalait `...stagePourVousV2`, variable **jamais définie**.
Ce défaut ne produisait pas d'erreur de syntaxe mais pouvait interrompre
la construction/caching final des rayons d'accueil.

Correctif minimal dans `/opt/zurg/jellyfin-vyneo/web/inject.js` :
retirer seulement l'étalement de ce nom inexistant, sans modifier
`stagePourVous`, les autres sections, ni le lecteur.

- Sauvegarde locale réversible :
  `/opt/zurg/backups/vyneo-home-v2-undefined-20261019-225318/`
  (fichiers `inject.js` et `index.html`).
- Ancien `inject.js` SHA-256 :
  `9882b578b5b351635e01bed2e0d2a8d21c87be156eefb1b4392700699a2a5b48`.
- Nouveau SHA-256 :
  `8c134b53787e1d0f1363e5af667c7101304b5fa71017d175e441334ae9569876`.
- Le nouveau JavaScript est servi par le Jellyfin HTTP réel
  (empreinte distante et source identiques).
- `node --check` a réussi ; Acorn a analysé l'IIFE complète et
  trouvé **1 constructeur d'accueil**, sans variable locale
  `stage*` non déclarée.
- Jellyfin répond HTTP 200 et son conteneur Docker reste `healthy`.
  Aucun redémarrage du conteneur ou des services G7y n'a été effectué.

**Attention au cache :** le vrai `index.html` est un bind-mount
Docker en lecture seule **fichier par fichier**. Le fichier côté hôte
porte déjà la requête versionnée `...-208`, mais l'index servi par
le conteneur garde `...-207` jusqu'au prochain remount/restart.
Ne pas redémarrer Jellyfin pendant une lecture active pour seulement
invalider cet ancien cache. Le code corrigé est déjà disponible sous
l'URL JavaScript, mais les anciens clients ayant un cache immutable
peuvent nécessiter un rechargement forcé jusqu'à la maintenance.

## Frontières conservées

Aucune donnée de lecture, aucun token, ni aucune URL de média n'a été
copiée vers la préproduction G7y. Les cookies Jellyfin et Cloudflare
Access restent séparés ; aucune permission Tauri distante n'est
ajoutée. L'évaluation visuelle authentifiée du nouvel accueil reste
à réaliser. Le module G6u de choix de qualité est toujours isolé.

### Restauration

Pour annuler ce changement, restaurer seulement les deux fichiers
depuis le dossier de sauvegarde, et vérifier `node --check`.
Un changement de l'index bind-mounté demande un remount/redémarrage
Docker contrôlé ; **aucun redémarrage automatique** ne doit se
produire pendant une lecture réelle.
