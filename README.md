# Blockfacho

Extension Brave / Chrome qui bloque sur X, Instagram, TikTok, Facebook et
YouTube les comptes listés par l'annuaire
https://onbloquelextremedroite.fun, en passant par tes sessions déjà ouvertes.
La liste, propositions validées comprises, est relue sur l'annuaire à chaque
ouverture du panneau. Aucun mot de passe ne quitte ton navigateur.

L'annuaire contient aujourd'hui ~1580 comptes X, ~825 Instagram, ~810
Facebook, ~380 YouTube et ~360 TikTok (3961 au total le 28/10/2026 — le site
grossit, les chiffres du panneau font foi). D'autres plateformes envisageables
(Bluesky, Threads, Mastodon, Snapchat) n'y figurent pas : l'extension ne peut
bloquer que ce que l'annuaire référence.

## Installation

1. Ouvre `brave://extensions` (ou `chrome://extensions`).
2. Active le mode développeur.
3. « Charger l'extension non empaquetée » et choisis ce dossier.

## Utilisation

Clique sur l'icône de l'extension, clique « Vérifier mes connexions » (détecte
chaque session et propose « Se connecter » si besoin), coche les plateformes
puis les catégories, puis « Lancer ».
Fais d'abord un essai « À blanc » sur 3 comptes.

Par défaut le « combo » est actif : pas intéressé sur le dernier post/vidéo,
puis muet/masqué, puis blocage (X, TikTok, Facebook). TikTok ouvre d'abord la
1re vidéo du profil pour le « pas intéressé » (Partager → Pas intéressé, repli
via la voie officielle Signaler → Autre → « ne m'intéresse pas », sans jamais
choisir un motif d'abus), puis retourne au profil pour muet + blocage : compte
~3 pages par compte TikTok, donc petits lots. Instagram fait blocage direct :
muet/restreindre avant serait redondant et déclencherait les limites pour rien.
YouTube fait « désabonner + ne plus recommander la chaîne + pas intéressé +
dislike », PUIS « Bloquer l'utilisateur » en dernier — le blocage n'est jamais
sauté, c'est le but du tool.
Aucun signalement automatique d'abus, volontairement : c'est le moyen le plus
rapide de faire limiter ton compte.

## Comptes & connexions

« Vérifier mes connexions » ouvre chaque réseau en arrière-plan et indique
connecté (avec l'identité quand c'est lisible : @pseudo X/Instagram/TikTok,
nom de chaîne YouTube) ou NON CONNECTÉ avec un bouton « Se connecter ».

YouTube multi-comptes (4 max : principal + 3) : l'extension ne change jamais
de compte Google pour toi. Change de compte dans YouTube, clique « Vérifier »,
l'identité détectée devient active avec sa propre progression, et
« Ajouter le compte YouTube détecté » l'enregistre pour le suivi. Les anciens
statuts YouTube sont conservés comme progression du compte « principal ».

## Multi-comptes et limites : oui, ça ajoute du risque

Chaque compte garde ses propres limites, mais Google relie les comptes (même
navigateur, même IP, infos de récupération) : des séquences de blocages
identiques et rapprochées sur plusieurs comptes ressemblent à une opération
coordonnée et peuvent limiter tous les comptes d'un coup (vérifications,
blocages d'actions). Le volume total depuis la même IP augmente aussi les
429/CAPTCHA, et les comptes récents sont plus stricts.
Règles : un seul compte par lancement, des heures d'intervalle, petits lots,
jamais en parallèle, et un vrai besoin par identité (chacun sa blocklist).
Si un seul de tes canaux a besoin d'un fil propre, reste sur un seul compte.

X limite les actions en rafale : garde des pauses de plusieurs secondes et pas plus
de 40 comptes par lancement, sinon le compte peut être verrouillé temporairement.
Instagram, TikTok et Facebook sont encore plus stricts : traite-les par petits
lots (10-15), avec des pauses de 15-30 s.
