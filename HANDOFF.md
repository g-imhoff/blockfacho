# Handoff — Blockfacho (contexte pour la prochaine session)

Projet : extension MV3 (Brave/Chrome/Helium, `manifest_version: 3`) qui bloque sur
X, Instagram, TikTok, Facebook et YouTube les comptes de l'annuaire
https://onbloquelextremedroite.fun, via les sessions déjà connectées.
Version actuelle : **2.8** (`manifest.json`). Repo : public GitHub (voir remote `origin`).

## Fichiers (racine du repo = extension, chargeable non-empaquetée)
- `manifest.json` — v2.8, permissions `scripting`+`storage`, host_permissions x.com,
  instagram.com, tiktok.com, facebook.com, youtube.com + annuaire.
- `background.js` — ouvre `panneau.html` au clic sur l'icône.
- `panneau.html` — UI : Plateformes, Comptes & connexions, Catégories, Rythme.
- `panneau.js` — tout le métier (~1300 lignes). `README.md` — install + limites.

## Architecture (panneau.js)
- Annuaire : `accounts.js` (X uniquement) + `api/accounts` (5 plateformes), fusion avec
  retraits (`removal`), dédup par `cle = plateforme:identifiant`.
- 1 injecteur autonome par plateforme (`agirX`, `agirInstagram`, `agirTiktok`,
  `agirFacebook`, `agirYoutubeCanal/Video/Carte/Bloquer`) + orchestrateurs
  multi-pages (`traiterCompteYoutube` chaîne→vidéo→recherche→blocage,
  `traiterCompteTiktok` profil→vidéo→profil).
- Ordre imposé : signaux faibles d'abord (pas intéressé, muet), **blocage TOUJOURS
  en dernier, jamais sauté** (vérification serveur : re-ouvre le menu, exige
  « Débloquer »). YouTube : désabonner + « ne plus recommander » + dislike AVANT
  le blocage final. Aucun signalement d'abus automatisé (volontaire).
- Combo ON/OFF (`#combo`), À blanc ON/OFF (`#aBlanc`). 3 erreurs de suite = stop.
- `etat` global (x/ig/tt/fb) + `yt_etat` par identité YouTube (multi-comptes :
  principal + 3, détection via menu avatar, jamais de bascule auto).
- Pré-contrôle « Vérifier mes connexions » : détecteurs injectés par plateforme
  (`detecterX/Instagram/Tiktok/Facebook/Youtube`, avec attentes de rendu SPA
  15 s + garde-fous fail-closed + 1 retry + sonde `{titre, longueur}` en cas
  d'échec). Exécutés via `chrome.scripting` : **aucune réf externe autorisée**
  dans ces fonctions (vérifié par scan).
- États : `bloque|deja|introuvable|serait_bloque|deconnecte|limite|erreur:*`.

## Preuves de test (2026-10-28, Helium headless + CDP, profil vierge)
- Panel : charge l'annuaire live (3961 comptes), 0 erreur console/page.
- Lancer : chemins `deconnecte` (skip plateforme), 3-strikes stop, `Terminé`,
  `serait_bloque`, `erreur: blocage non confirmé` — tous exercés.
- Vérifier : 5× NON CONNECTÉ correct en profil vierge, 0 erreur.
- **Limites du bac à sable** : x.com injoignable (erreur réseau → pas d'injection
  possible), aucune session réelle testée ici. Les chemins connectés + détecteurs
  positifs n'ont été validés que par relecture, PAS en live.

## Points ouverts au moment du handoff
1. L'utilisateur signale que « Vérifier » dit NON CONNECTÉ partout alors que
   X/IG/TT/YT sont connectés (FB non connecté, correct). Cause probable trouvée :
   détecteurs sans attente de rendu SPA → tous réécrits avec waits (v2.7) +
   fail-closed durci (v2.6). **À valider dans son Helium réel** : recharger
   l'extension, fermer/rouvrir le panneau, Vérifier, lire les sondes
   `(page : … — N caractères)` du journal.
2. « aucun post visible » systématique sur X → race timeline/en-tête. Fix v2.8 :
   `attendre(article, 10 s)` (X, FB, listers TikTok/YouTube). Note : sur un profil
   X, « Pas intéressé » n'existe quasiment jamais (contrôle réservé au fil For You)
   → le message attendu devient « pas intéressé absent (normal hors For You) ».
   **À valider en live.**
3. Vidéo d'install (HyperFrames, textes FR) : projet scaffoldé (CLI 0.8.212) +
   2 captures réelles, musique NON résolue (`media-use resolve --type bgm`
   a échoué en local-only). Rien de rendu. Le dossier du projet vidéo n'est PAS
   dans ce repo (était sous /tmp sur l'autre machine).

## ID extension
`idclamibcadmoaaifbnknlgjamjoamaa` (installée non-empaquetée depuis ce dossier
dans le profil Helium `Default`).
