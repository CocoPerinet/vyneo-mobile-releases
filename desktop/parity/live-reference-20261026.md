# Vynéo Desktop : état de la référence Jellyfin au 26 octobre 2026

> **Portée :** mesure de parité en lecture seule, associée à la PR #9 (`feature/desktop-audit-parity-v025`).
> Ce document complète l'audit du 20 octobre ; il **ne remplace pas** les empreintes historiques ni les preuves d'acceptation. Aucun comportement de production n'est modifié.

## 1. Référence réelle et dérive des sources

Les quatre empreintes ci-dessous ont été vérifiées en lecture seule sur le N100 le 26/10/2026. Les empreintes « audit » proviennent de `desktop/parity/audit-traceability.json` au commit `4bf180273d4705ad337243586614a81b0a92acbc`.

| Source | SHA-256 enregistré dans l'audit | SHA-256 actuellement servi | État |
| --- | --- | --- | --- |
| `/opt/zurg/jellyfin-vyneo/web/inject.js` | `8c134b53787e1d0f1363e5af667c7101304b5fa71017d175e441334ae9569876` | `0a848a07f62d09ee10264d4bfad81dc3b050406c664f1e99709e5b43033f9237` | Dérive |
| `/opt/zurg/jellyfin-vyneo/index.html` | `9615a19a629a821953acdb7a4958cef1e786c20d01f25125006986aa2463edda` | `4a1695f7f15cf2545f6896a62a4cd30576eb697a2210ba9b1be439c5cfd861e2` | Dérive |
| `/opt/zurg/jellyfin-vyneo/web/skin.css` | `dd443b05161aa48bc8b414a168df1fe83df674c5d583a99798f1af579d1e08fa` | Identique | Conforme |
| `/home/coco/vyneo-next/beta-web/src/secure/SecureApp.svelte` | `39f724aadc5163d7e64f2c812f1e436beea33358818db2897d97a11cea8c013d` | Identique | Conforme |

Le fichier `inject.js` actuellement servi indique une modification le 24/10. Le fait que deux SHA diffèrent prouve une modification des **octets**, pas une régression du comportement. Le diff exhaustif de ces deux sources par rapport aux anciens octets n'a pas été obtenu : **ne pas interpréter la nouvelle empreinte comme une nouvelle approbation de référence**.

### Hover : cause réellement vérifiée

Dans la version actuelle de `inject.js`, `wireHover()` n'arme pas le popup lorsque le pointeur entre sur un bouton de la carte (`button`, `a.cardOverlayButton`, `.cardOverlayFab-primary`, `[data-vy-play]`). Ailleurs, la temporisation est de 420 ms, puis les données sont chargées avant l'affichage.

Contre-test sur la fiche **Captain Tsubasa** : depuis une zone non interactive de la vignette, attente d'environ 1,3 seconde, **popup riche visible** dans le navigateur Jellyfin. L'apparente absence de popup précédemment provenait du pointeur placé sur le bouton Lecture intégré. Le popup riche de Desktop **n'a pas besoin d'être supprimé** pour ce motif.

## 2. Parité réelle, même compte et même écran

COCO-QA-VM, résolution physique de l'écran : **1366 × 768**. Même compte Jellyfin authentifié dans Microsoft Edge et dans le binaire Tauri **QA lecture seule** `4bf1802`. Les deux applications utilisent la même bibliothèque et la même illustration Hero de **Black Clover** lorsqu'on sélectionne la première bannière.

Les géométries ci-dessous ont été lues via `getBoundingClientRect()` sur les **viewports CSS réels**, et non estimées sur une capture :

| Mesure en pixels CSS | Jellyfin dans Edge maximisé | Tauri QA maximisé |
| --- | ---: | ---: |
| Viewport `innerWidth × innerHeight` | 1358 × 636 | 1366 × 697 |
| Hauteur du Hero | 742 | 669 |
| Début du premier bloc de rangées (origine contenu) | 622 | 667 |
| Haut du groupe d'indicateurs Hero | 712 | 587 |

**Limite méthodologique :** la même résolution d'écran physique ne donne **pas le même viewport CSS**, à cause des barres de navigation d'Edge et de la fenêtre Tauri. Une comparaison de coordonnées brutes ou un diff pixel-à-pixel des captures complètes serait trompeur sans normalisation/alignement de ces viewports.

Constats qualitatifs : le fond de Black Clover et le titre sont présents des deux côtés. Desktop affiche un synopsis et ses indicateurs de carrousel dans la zone visible ; sur cette diapositive, Jellyfin n'affiche pas de synopsis et ses indicateurs se trouvent sous le bas du viewport. Il s'agit de **différences réelles de présentation**, mais la préférence produit pour des indicateurs visibles et un synopsis ne constitue pas automatiquement une régression. La barre d'en-tête Desktop expose en outre Collections/Playlists là où le thème Jellyfin expose d'autres entrées : ne pas supprimer ces fonctions uniquement pour obtenir une capture identique.

## 3. Vérifications déjà réalisées

- **Rangée Reprendre** : mêmes quatre contenus et même ordre (Avatar S01E07, South Park S05E01, Captain Tsubasa S01E16, Tomb Raider King S01E01). Largeur des cartes voisine de 340 px.
- **Souris** : popup riche de Captain Tsubasa sur une zone non interactive, après temporisation, confirmé sur le vrai Jellyfin.
- **Clavier Tauri réel** : `ArrowDown` ouvre le popup et focalise l'action principale ; `Tab` passe au contrôle suivant sans l'activer ; `Escape` ferme et restaure le focus ; `ArrowRight` passe à la carte suivante.
- **Lecteur QA** : Gotham S01E10, HLS 1080p, sous-titres français/anglais visibles, seek et arrêt réel précédemment validés. Ce binaire ne modifie pas volontairement la progression Jellyfin.
- **Preview installée** : authentification Quick Connect, conservation de session après sortie complète et déconnexion suivie d'un nouveau lancement vérifiées. L'installation stable sur l'hôte reste inchangée.

Les captures privées et le rapport détaillé sont conservés **dans la VM uniquement** :
`C:\Users\chatgpt-qa\Documents\QA-Workspace\Projects\vyneo-desktop-qa\artifact\ab-20261026\`.
Ne pas les publier sur un dépôt public sans revue.

## 4. Critères qui ne doivent pas être promus

Les deux critères du bloc D dans `desktop/parity/audit-traceability.json` restent **`pending`** :

- `side-by-side` : synchroniser également les **viewports CSS** et compléter la comparaison des rangées, des identifiants, des états et des interactions, puis qualifier les deltas acceptables.
- `real-library` : audio réellement audible sur un périphérique physique, puis tests `Playing/Progress/Stopped` sur une instance **entièrement jetable, explicitement autorisée**, distincte de la bibliothèque familiale. La configuration de cette médiathèque avait été bloquée par une règle d'outil : ne pas contourner cette interdiction.

Le contrôle de release stable dans `desktop/scripts/parity-gate.mjs` doit rester actif. **Aucune fusion, signature ni publication stable n'est autorisée sur la base de cette seule note.**
