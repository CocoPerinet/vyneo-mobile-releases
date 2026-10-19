# Vynéo Mobile — téléchargements

Ce dépôt public contient uniquement les versions installables de Vynéo Mobile
et le manifeste utilisé par l'application pour signaler les mises à jour.

## Android

Téléchargez l'APK depuis la section
[Releases](https://github.com/CocoPerinet/vyneo-mobile-releases/releases/latest).
Android peut demander d'autoriser l'installation depuis le navigateur ou le
gestionnaire de fichiers. Cette confirmation système est normale.

Play Protect peut aussi proposer d'analyser un APK distribué hors Play Store.
Il est recommandé d'accepter cette analyse et de garder Play Protect activé.
L'avertissement « application inconnue » peut persister tant que l'application
n'est pas diffusée par Google Play ou suffisamment reconnue par Google.

Les APK sont signés avec la clé stable Vynéo. Une version installée depuis ce
canal pourra donc accepter les versions suivantes sans être désinstallée.
La connexion au serveur est intégrée à l'application : aucun réglage d'URL, de
DNS privé ou de VPN n'est demandé aux utilisateurs.

## iOS

Le lien TestFlight ou App Store sera ajouté après activation du compte Apple
Developer et validation de l'application par Apple.

Le code source et les secrets de signature ne sont pas stockés dans ce dépôt.

## Windows et macOS : Vynéo Desktop (en préparation)

Le projet natif Tauri se trouve dans [`desktop/`](desktop/).
**Changement d'architecture :** Vynéo 0.2.0 possède maintenant son
**propre frontend Svelte local**, inspiré visuellement de notre Jellyfin
personnalisé. Jellyfin sert uniquement les médias et leurs métadonnées
via son API. Plus de chargement de Jellyfin Web ni de fenêtre IA annexe
comme fondement de l'interface. Les moteurs G7y/LLM restent à raccorder
à une API native authentifiée avant une publication utilisable.

Les releases `desktop-vX.Y.Z` doivent contenir les installateurs
Windows et macOS accompagnés de **signatures vérifiées**. Le client
vérifie automatiquement un manifeste Desktop propre à chaque OS au
démarrage et installe une nouvelle version si elle est disponible.
Les fichiers `desktop-*.json` sont distincts de
[`update-manifest.json`](update-manifest.json), dont les anciennes
applications Android continuent de dépendre.

**Le lecteur MPV et la bascule réelle automatique de qualité ne sont
pas encore livrés.** Voir [la portée réelle de Desktop](desktop/README.md)
et [les canaux de publication](docs/RELEASE-CHANNELS.md).
