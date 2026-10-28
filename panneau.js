const ANNUAIRE = 'https://onbloquelextremedroite.fun';
const TERMINES = ['bloque', 'deja', 'introuvable'];
const LIBELLES = { bloque: 'bloqué', deja: 'déjà bloqué', introuvable: 'introuvable ou suspendu', serait_bloque: 'serait bloqué' };

// Ordre d'affichage + libellés. L'annuaire fournit aujourd'hui ces 5 plateformes :
// x (1421), instagram (825), facebook (811), youtube (384), tiktok (363).
const PLATEFORMES = {
  x: 'X',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  facebook: 'Facebook',
  youtube: 'YouTube',
};

const $ = (id) => document.getElementById(id);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let comptes = [];
let etat = {};
let arret = false;

// YouTube multi-comptes : 4 max (principal + 3). Chaque identité Google/YouTube
// détectée garde sa propre progression, car un blocage ne vaut que pour le
// compte connecté qui l'a fait. On ne bascule jamais de compte à ta place.
const YT_MAX_COMPTES = 4;
const YT_PRINCIPAL = 'principal';
let ytComptes = []; // [{ id, label }]
let ytEtat = {}; // { [accountId]: { [cle]: statut } }
let ytActif = YT_PRINCIPAL;
let connexions = {}; // { [plateforme]: { connecte, identite } }
let ytDetecte = null; // dernière identité YouTube détectée { id, label }

const lireEtat = (c) => {
  if (c.plateforme === 'youtube') return (ytEtat[ytActif] ?? {})[c.cle];
  return etat[c.cle];
};
const ecrireEtat = (c, v) => {
  if (c.plateforme === 'youtube') {
    ytEtat[ytActif] ??= {};
    ytEtat[ytActif][c.cle] = v;
  } else {
    etat[c.cle] = v;
  }
};
const estTermine = (c) => TERMINES.includes(lireEtat(c));
async function sauverEtats() {
  await chrome.storage.local.set({ etat, yt_comptes: ytComptes, yt_etat: ytEtat });
}

function log(texte, classe = '') {
  const ligne = document.createElement('div');
  ligne.textContent = texte;
  ligne.className = classe;
  $('journal').append(ligne);
  $('journal').scrollTop = $('journal').scrollHeight;
}

async function recuperer(chemin) {
  const reponse = await fetch(ANNUAIRE + chemin, { cache: 'no-store' });
  if (!reponse.ok) throw new Error(`${chemin} : HTTP ${reponse.status}`);
  return reponse;
}

// ---------- Extraction des identifiants par plateforme ----------

const PAGES_X = new Set(['home', 'explore', 'search', 'notifications', 'messages', 'settings', 'compose', 'i', 'login', 'logout', 'signup', 'account', 'tos', 'privacy']);
const handleXDepuisUrl = (url) => url?.match(/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/(\w{1,15})/i)?.[1] ?? null;
const handleXValide = (h) => typeof h === 'string' && /^\w{1,15}$/.test(h) && !PAGES_X.has(h.toLowerCase());

const PAGES_IG = new Set(['p', 'reel', 'reels', 'stories', 'explore', 'direct', 'accounts', 'about', 'embeds', 'tv', 'login', 'signup', 'challenge', 'oauth']);
const pseudoIGDepuisUrl = (url) => url?.match(/^https?:\/\/(?:www\.)?instagram\.com\/([A-Za-z0-9._]{1,30})/i)?.[1]?.replace(/\/$/, '') ?? null;
const pseudoIGValide = (h) => typeof h === 'string' && /^[A-Za-z0-9._]{1,30}$/.test(h) && !PAGES_IG.has(h.toLowerCase());

const pseudoTTDepuisUrl = (url) => url?.match(/^https?:\/\/(?:www\.)?tiktok\.com\/@([A-Za-z0-9._]{1,24})/i)?.[1] ?? null;
const pseudoTTValide = (h) => typeof h === 'string' && /^[A-Za-z0-9._]{1,24}$/.test(h);

const PAGES_FB = new Set(['login', 'settings', 'messages', 'watch', 'marketplace', 'groups', 'events', 'pages']);
const slugFBDepuisUrl = (url) => {
  const m = url?.match(/^https?:\/\/(?:www\.|m\.)?facebook\.com\/(?:profile\.php\?id=(\d+)|([^/?#]+))/i);
  return m?.[1] ?? m?.[2] ?? null;
};
const slugFBValide = (h) => typeof h === 'string' && h.length >= 1 && h.length <= 100 && !PAGES_FB.has(h.toLowerCase()) && !h.includes('.php');

// YouTube : on garde le suffixe canonique (@pseudo, channel/ID, c/nom, user/nom)
// et on navigue vers l'URL d'origine, qui est déjà canonique.
const suffixeYTDepuisUrl = (url) => url?.match(/^https?:\/\/(?:www\.|m\.)?youtube\.com\/(@[^/?#]+|channel\/[^/?#]+|c\/[^/?#]+|user\/[^/?#]+)/i)?.[1] ?? null;

function compteDepuisEntree(e) {
  const plateforme = e.platform;
  if (!PLATEFORMES[plateforme]) return null;
  const nom = e.name ?? '';
  const categorie = typeof e.category === 'string' && e.category ? e.category : 'Autres';
  if (plateforme === 'x') {
    const handle = handleXDepuisUrl(e.profile_url);
    if (!handleXValide(handle)) return null;
    return { cle: `x:${handle.toLowerCase()}`, plateforme, identifiant: handle, url: `https://x.com/${handle}`, name: nom, category: categorie };
  }
  if (plateforme === 'instagram') {
    const pseudo = pseudoIGDepuisUrl(e.profile_url);
    if (!pseudoIGValide(pseudo)) return null;
    return { cle: `instagram:${pseudo.toLowerCase()}`, plateforme, identifiant: pseudo, url: `https://www.instagram.com/${pseudo}/`, name: nom, category: categorie };
  }
  if (plateforme === 'tiktok') {
    const pseudo = pseudoTTDepuisUrl(e.profile_url);
    if (!pseudoTTValide(pseudo)) return null;
    return { cle: `tiktok:${pseudo.toLowerCase()}`, plateforme, identifiant: '@' + pseudo, url: `https://www.tiktok.com/@${pseudo}`, name: nom, category: categorie };
  }
  if (plateforme === 'facebook') {
    const slug = slugFBDepuisUrl(e.profile_url);
    if (!slugFBValide(slug)) return null;
    return { cle: `facebook:${String(slug).toLowerCase()}`, plateforme, identifiant: slug, url: e.profile_url, name: nom, category: categorie };
  }
  if (plateforme === 'youtube') {
    const suffixe = suffixeYTDepuisUrl(e.profile_url);
    if (!suffixe) return null;
    return { cle: `youtube:${suffixe.toLowerCase()}`, plateforme, identifiant: suffixe, url: e.profile_url, name: nom, category: categorie };
  }
  return null;
}

// Même fusion que le site : la liste de base (X uniquement), complétée par les
// décisions validées de l'API. Chaque entrée API = un compte sur une plateforme.
// Sans l'API on s'arrête : les retraits y sont, la liste de base seule pourrait
// bloquer un compte retiré.
async function chargerComptes() {
  // accounts.js est du JS : on n'exécute jamais son code, on extrait le tableau en JSON.
  const js = await (await recuperer('/accounts.js')).text();
  const base = JSON.parse(js.slice(js.indexOf('['), js.lastIndexOf(']') + 1));
  const parId = new Map();
  for (const c of base) {
    if (!handleXValide(c.handle)) continue;
    const handle = c.handle;
    parId.set(
      String(c.id ?? 'x:' + handle).toLowerCase(),
      { cle: `x:${handle.toLowerCase()}`, plateforme: 'x', identifiant: handle, url: `https://x.com/${handle}`, name: c.name ?? '', category: c.category ?? 'Autres' },
    );
  }
  const { entries } = await (await recuperer('/api/accounts')).json();

  for (const e of entries) {
    if (e.type === 'removal') continue;
    if (e.type !== 'new') continue;
    const idCle = String(e.id ?? '').toLowerCase();
    const existant = parId.get(idCle);
    // Une entrée X de l'API peut compléter une entrée de base (même id) ;
    // sinon chaque entrée crée son propre compte plateforme.
    if (existant && e.platform === 'x') {
      const handle = handleXDepuisUrl(e.profile_url);
      if (handleXValide(handle)) {
        existant.identifiant = handle;
        existant.url = `https://x.com/${handle}`;
        existant.cle = `x:${handle.toLowerCase()}`;
      }
      if (e.name) existant.name = e.name;
    } else if (!existant) {
      const compte = compteDepuisEntree(e);
      if (compte) parId.set(idCle, compte);
    }
  }
  for (const e of entries) {
    if (e.type === 'removal') parId.delete(String(e.target_id ?? '').toLowerCase());
  }

  // Déduplique par (plateforme, identifiant) : même fusion que le site.
  const vus = new Map();
  for (const c of parId.values()) {
    if (!vus.has(c.cle)) vus.set(c.cle, c);
  }
  return [...vus.values()];
}

const nonTermines = (liste) => liste.filter((c) => !estTermine(c));

function afficherResume() {
  const faits = comptes.filter(estTermine).length;
  const parPlat = Object.entries(PLATEFORMES)
    .map(([p, nom]) => {
      const total = comptes.filter((c) => c.plateforme === p).length;
      return total ? `${nom} : ${total}` : null;
    })
    .filter(Boolean)
    .join(' · ');
  $('resume').textContent = `${comptes.length} comptes dans l'annuaire (${parPlat}), ${faits} déjà traités.`;
}

function afficherPlateformes() {
  $('plateformes').replaceChildren(
    ...Object.entries(PLATEFORMES).map(([p, nom]) => {
      const liste = comptes.filter((c) => c.plateforme === p);
      const restants = nonTermines(liste).length;
      const coche = Object.assign(document.createElement('input'), { type: 'checkbox', checked: restants > 0, value: p });
      coche.disabled = liste.length === 0;
      const label = document.createElement('label');
      label.append(coche, `${nom} (${restants} sur ${liste.length} à bloquer)`);
      if (p === 'youtube') label.title = 'YouTube : signaux recos (désabonner + ne plus recommander + pas intéressé + dislike) puis « Bloquer l’utilisateur » en dernier, jamais sauté.';
      return label;
    }),
  );
}

function afficherCategories() {
  // Object.groupBy (ES2024, Chrome 117+) avec repli pour les Chromium plus anciens.
  const parCat = typeof Object.groupBy === 'function'
    ? Object.groupBy(comptes, (c) => c.category)
    : comptes.reduce((acc, c) => { (acc[c.category] ??= []).push(c); return acc; }, {});
  $('categories').replaceChildren(
    ...Object.entries(parCat).map(([cat, liste]) => {
      const restants = nonTermines(liste).length;
      const coche = Object.assign(document.createElement('input'), { type: 'checkbox', checked: restants > 0, value: cat });
      const label = document.createElement('label');
      label.append(coche, `${cat} (${restants} sur ${liste.length} à bloquer)`);
      return label;
    }),
  );
}

// ---------- Comptes & connexions : pré-contrôle + YouTube multi-comptes ----------
// Chaque détecteur est autonome (injecté via chrome.scripting) et rend
// { connecte, identite }. identite = '@pseudo' normalisé quand c'est pas cher,
// sinon null : le pré-contrôle reste indicatif, agir* tranche au moment du blocage.
const ACCUEIL = {
  x: 'https://x.com/home',
  instagram: 'https://www.instagram.com/',
  tiktok: 'https://www.tiktok.com/',
  facebook: 'https://www.facebook.com/',
  youtube: 'https://www.youtube.com/',
};
const CONNEXION_URL = {
  x: 'https://x.com/login',
  instagram: 'https://www.instagram.com/accounts/login/',
  tiktok: 'https://www.tiktok.com/login',
  facebook: 'https://www.facebook.com/login/',
  youtube: 'https://accounts.google.com/ServiceLogin?service=youtube',
};
const ORIGINES = {
  x: 'https://x.com/*',
  instagram: 'https://www.instagram.com/*',
  tiktok: 'https://www.tiktok.com/*',
  facebook: 'https://www.facebook.com/*',
  youtube: 'https://www.youtube.com/*',
};
// Cookies posés seulement quand une session est ouverte. Ils ne dépendent ni de
// la langue ni de la mise en page, contrairement aux marqueurs DOM. chrome.cookies
// lit aussi les HttpOnly (sessionid, auth_token…).
const COOKIES_SESSION = {
  x: ['auth_token'],
  instagram: ['sessionid'],
  tiktok: ['sessionid', 'sessionid_ss', 'sid_tt'],
  facebook: ['c_user'],
  youtube: ['SID', '__Secure-1PSID', '__Secure-3PSID', 'SAPISID', '__Secure-3PAPISID'],
};

// Rend le nom du premier cookie de session trouvé, sinon null.
async function cookieDeSession(p) {
  for (const name of COOKIES_SESSION[p]) {
    const c = await chrome.cookies.get({ url: ACCUEIL[p], name });
    if (c?.value) return name;
  }
  return null;
}

// NOTE : aucune constante de ce fichier n'est visible des fonctions injectées
// (chrome.scripting ne transporte que la fonction). Chaque détecteur / acteur
// embarque donc ses propres listes en local.

async function detecterX() {
  const attendre = async (test, ms) => {
    const debut = Date.now();
    while (Date.now() - debut < ms) {
      const r = test();
      if (r) return r;
      await new Promise((r) => setTimeout(r, 300));
    }
    return null;
  };
  // La page est une SPA : on attend le rendu (marqueur connecté OU déconnecté).
  await attendre(() => (document.body?.innerText?.length ?? 0) > 200, 15000);
  const btn = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]');
  if (!btn) return { connecte: false, identite: null };
  const m = (btn.innerText ?? '').match(/@(\w{1,15})/);
  return { connecte: true, identite: m ? '@' + m[1].toLowerCase() : null };
}

async function detecterInstagram() {
  const attendre = async (test, ms) => {
    const debut = Date.now();
    while (Date.now() - debut < ms) {
      const r = test();
      if (r) return r;
      await new Promise((r) => setTimeout(r, 300));
    }
    return null;
  };
  const corps = () => document.body?.innerText ?? '';
  const brut = () => document.body?.textContent ?? '';
  // SPA : on attend le rendu (formulaire login OU barre de nav) avant de trancher.
  // textContent plutôt que innerText : insensible à la mise en page (onglet en arrière-plan).
  await attendre(
    () =>
      brut().length > 200 ||
      document.querySelector('input[name="username"]') ||
      document.querySelector('nav a[href], div[role="navigation"] a[href]'),
    15000,
  );
  if (document.querySelector('input[name="username"]') && /log in|se connecter/i.test(corps())) {
    return { connecte: false, identite: null };
  }
  // Liste locale : la fonction injectée doit rester autonome (aucune réf externe).
  // Tient la même liste que PAGES_IG (chemins non-profil à ne jamais prendre pour un pseudo).
  const EXCLUS = new Set(['p', 'reel', 'reels', 'stories', 'explore', 'direct', 'accounts', 'about', 'embeds', 'tv', 'login', 'signup', 'challenge', 'oauth']);
  const extraire = (ancres) => ancres
    .map((a) => (a.getAttribute('href') ?? '').match(/^\/([A-Za-z0-9._]{1,30})\/$/)?.[1])
    .find((h) => h && !EXCLUS.has(h.toLowerCase()));
  // 1. Identité : bouton profil de la barre latérale (vrai <nav>, conteneur ARIA ou <header>).
  let identite = null;
  try {
    const zones = ['nav a[href]', 'div[role="navigation"] a[href]', 'header a[href]'];
    for (const z of zones) {
      const ancres = [...document.querySelectorAll(z)];
      if (!ancres.length) continue;
      const pseudo = extraire(ancres);
      if (pseudo) { identite = '@' + pseudo.toLowerCase(); break; }
    }
  } catch { /* identité facultative */ }
  if (identite) return { connecte: true, identite };
  // 2. Marqueurs de session sans identité : la messagerie et la création
  // n'existent que connecté (le runtime agirInstagram tranche au blocage).
  const marqueur =
    document.querySelector('a[href="/direct/inbox/"], a[href^="/direct/"]') ||
    [...document.querySelectorAll('a[href]')].find((a) => /^(créer|create)$/i.test(((a.innerText ?? a.textContent) ?? '').trim()));
  if (marqueur) return { connecte: true, identite: null };
  // 3. Repli : textes de la barre latérale (Accueil + Recherche/Messages/…).
  try {
    const navTxt = [...document.querySelectorAll('nav a, div[role="navigation"] a')]
      .map((a) => ((a.innerText ?? a.textContent) ?? '').trim().toLowerCase());
    if (navTxt.some((t) => t === 'accueil' || t === 'home') &&
        navTxt.some((t) => ['recherche', 'search', 'messages', 'notifications', 'créer', 'create', 'profil', 'profile'].includes(t))) {
      return { connecte: true, identite: null };
    }
  } catch { /* repli facultatif */ }
  return { connecte: false, identite: null };
}

async function detecterTiktok() {
  const attendre = async (test, ms) => {
    const debut = Date.now();
    while (Date.now() - debut < ms) {
      const r = test();
      if (r) return r;
      await new Promise((r) => setTimeout(r, 300));
    }
    return null;
  };
  const texte = (el) => ((el.innerText ?? el.textContent) ?? '').trim();
  // Pas de nav-profile : il existe aussi déconnecté (href="/@").
  const MARQUEURS = '[data-e2e="nav-inbox"], [data-e2e="profile-icon"], a[href="/messages/"], a[href="/messages"], a[href="/inbox"]';
  // SPA : on attend le rendu (bouton login OU marqueurs de session) avant de trancher.
  await attendre(
    () =>
      document.querySelector('[data-e2e="top-login-button"]') ||
      [...document.querySelectorAll('a, button')].find((b) => /^(log in|se connecter)$/i.test(texte(b))) ||
      document.querySelector(MARQUEURS) ||
      (document.body?.textContent?.length ?? 0) > 500,
    15000,
  );
  // Le JSON de réhydratation contient l'utilisateur connecté (vide si déconnecté).
  let identite = null;
  try {
    const donnees = JSON.parse(document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__')?.textContent ?? '{}');
    const pseudo = donnees?.__DEFAULT_SCOPE__?.['webapp.app-context']?.user?.uniqueId;
    if (pseudo) identite = '@' + String(pseudo).toLowerCase();
  } catch { /* identité facultative */ }
  // Marqueurs ensuite. Sur l'accueil déconnecté, les liens /@ des vidéos du fil
  // existent aussi : ils ne prouvent rien et ne donnent jamais l'identité.
  if (identite || document.querySelector(MARQUEURS)) {
    try {
      const m = document.querySelector('[data-e2e="nav-profile"]')?.getAttribute('href')?.match(/^\/@([A-Za-z0-9._]{1,24})/);
      if (!identite && m) identite = '@' + m[1].toLowerCase();
    } catch { /* identité facultative */ }
    return { connecte: true, identite };
  }
  const login =
    document.querySelector('[data-e2e="top-login-button"], a[href*="login"]') ||
    [...document.querySelectorAll('a, button')].find((b) => /^(log in|se connecter)$/i.test(texte(b)));
  if (login) return { connecte: false, identite: null };
  return { connecte: false, identite: null };
}

async function detecterFacebook() {
  const attendre = async (test, ms) => {
    const debut = Date.now();
    while (Date.now() - debut < ms) {
      const r = test();
      if (r) return r;
      await new Promise((r) => setTimeout(r, 300));
    }
    return null;
  };
  const MARQUEURS = 'a[aria-label="Your profile"], a[aria-label*="ton profil" i], a[aria-label*="votre profil" i], a[aria-label*="your profile" i], a[aria-label*="tu perfil" i], a[href="/me/"], div[role="feed"]';
  // SPA : on attend le rendu (formulaire login OU marqueurs de session) avant de trancher.
  await attendre(
    () =>
      document.querySelector('input#email, input[name="email"]') ||
      document.querySelector(MARQUEURS) ||
      (document.body?.textContent?.length ?? 0) > 500,
    15000,
  );
  const corps = document.body?.innerText ?? '';
  if (document.querySelector('input#email, input[name="email"]') && /log in|se connecter|mot de passe/i.test(corps)) {
    return { connecte: false, identite: null };
  }
  // CurrentUserInitialData (script de la page) : USER_ID "0" si déconnecté, sinon le nom du compte.
  let identite = null;
  let userId = false;
  try {
    const source = [...document.scripts].map((s) => s.textContent ?? '').find((t) => t.includes('"CurrentUserInitialData"')) ?? '';
    const m = source.match(/"CurrentUserInitialData",\[\],\{[^}]*?"USER_ID":"(\d+)"[^}]*?"NAME":"((?:[^"\\]|\\.)*)"/);
    if (m && m[1] !== '0') {
      userId = true;
      identite = JSON.parse(`"${m[2]}"`) || null;
    }
  } catch { /* identité facultative */ }
  // Cookie c_user (identifiant numérique, lisible en JS) = preuve de session.
  let sessionCookie = false;
  try { sessionCookie = /(?:^|;\s*)c_user=\d+/.test(document.cookie ?? ''); } catch { /* cookies indisponibles */ }
  const marqueur = document.querySelector(MARQUEURS);
  if (marqueur || sessionCookie || userId) return { connecte: true, identite };
  return { connecte: false, identite: null };
}

async function detecterYoutube() {
  const attendre = async (test, ms) => {
    const debut = Date.now();
    while (Date.now() - debut < ms) {
      const r = test();
      if (r) return r;
      await new Promise((r) => setTimeout(r, 300));
    }
    return null;
  };
  const corps = () => document.body?.innerText ?? '';
  const texte = (el) => ((el.innerText ?? el.textContent) ?? '').trim();
  // #avatar-btn seulement : ytd-topbar-menu-button-renderer est aussi le bouton « Paramètres » déconnecté.
  const AVATAR = '#avatar-btn button, button#avatar-btn';
  // On attend le rendu (avatar OU écran de connexion OU mur consentement) avant de trancher.
  await attendre(
    () =>
      document.querySelector(AVATAR) ||
      document.querySelector('a[href*="ServiceLogin"]') ||
      /avant de continuer|before you continue/i.test(corps()) ||
      (document.body?.textContent?.length ?? 0) > 500,
    15000,
  );
  // Mur consentement Google (UE) : accepter puis attendre le vrai rendu.
  if (/avant de continuer|before you continue/i.test(corps()) && !document.querySelector(AVATAR)) {
    try {
      const accepter = [...document.querySelectorAll('button')].find((b) => /tout accepter|accept all|alle akzeptieren/i.test(texte(b)));
      if (accepter) {
        accepter.click();
        await attendre(() => document.querySelector(AVATAR), 12000);
      }
    } catch { /* consentement facultatif */ }
  }
  if ((document.body?.textContent?.length ?? 0) < 50) return { connecte: false, identite: null };
  // ytcfg écrit LOGGED_IN dans un script de la page, quelle que soit la langue.
  const logue = [...document.scripts].some((s) => (s.textContent ?? '').includes('"LOGGED_IN":true'));
  if (!logue && document.querySelector('a[href*="ServiceLogin"]') && /sign in|se connecter/i.test(corps())) {
    return { connecte: false, identite: null };
  }
  const avatar = await attendre(() => document.querySelector(AVATAR), 5000);
  if (!avatar) return { connecte: logue, identite: null };
  avatar.click();
  await attendre(() => document.querySelector('ytd-active-account-header-renderer #account-name'), 8000);
  let identite = null;
  try {
    const handle = document.querySelector('ytd-active-account-header-renderer #channel-handle')?.textContent?.trim() ?? '';
    const nom = document.querySelector('ytd-active-account-header-renderer #account-name')?.textContent?.trim() ?? '';
    const h = (handle.match(/@?([A-Za-z0-9._-]{1,50})/) ?? [])[1] ?? (nom || null);
    if (h) identite = { id: String(h).replace(/^@/, '').toLowerCase(), label: handle.startsWith('@') ? handle : '@' + h };
  } catch { /* identité facultative */ }
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  document.body.click();
  return { connecte: true, identite };
}

const DETECTEURS = { x: detecterX, instagram: detecterInstagram, tiktok: detecterTiktok, facebook: detecterFacebook, youtube: detecterYoutube };

function nomYtActif() {
  const connu = ytComptes.find((c) => c.id === ytActif);
  if (connu) return connu.label;
  if (ytDetecte && ytDetecte.id === ytActif) return ytDetecte.label;
  return ytActif === YT_PRINCIPAL ? 'principal' : '@' + ytActif;
}

function progresYt(id) {
  const carte = ytEtat[id] ?? {};
  const liste = comptes.filter((c) => c.plateforme === 'youtube');
  const faits = liste.filter((c) => TERMINES.includes(carte[c.cle])).length;
  return { faits, total: liste.length };
}

function afficherConnexions() {
  const conteneur = $('connexions');
  const plateformes = Object.keys(PLATEFORMES).filter((p) => comptes.some((c) => c.plateforme === p));
  if (!Object.keys(connexions).length) {
    conteneur.replaceChildren(Object.assign(document.createElement('p'), { className: 'note', textContent: 'Non vérifié : clique pour détecter chaque session avant de lancer.' }));
    return;
  }
  conteneur.replaceChildren(
    ...plateformes.map((p) => {
      const etatCnx = connexions[p];
      const ligne = document.createElement('div');
      const txt = !etatCnx ? `${PLATEFORMES[p]} : non vérifié` : etatCnx.connecte ? `${PLATEFORMES[p]} : connecté${etatCnx.identite ? ` (${typeof etatCnx.identite === 'string' ? etatCnx.identite : etatCnx.identite.label})` : ''}` : `${PLATEFORMES[p]} : NON CONNECTÉ`;
      ligne.textContent = txt;
      ligne.className = !etatCnx ? 'gris' : etatCnx.connecte ? 'ok' : 'err';
      if (etatCnx && !etatCnx.connecte) {
        const btn = Object.assign(document.createElement('button'), { textContent: 'Se connecter' });
        btn.onclick = () => chrome.tabs.create({ url: CONNEXION_URL[p] });
        ligne.append(' ', btn);
      }
      return ligne;
    }),
  );
}

function afficherYtComptes() {
  const conteneur = $('yt-comptes');
  const enregistres = ytComptes.slice(0, YT_MAX_COMPTES);
  const actif = document.createElement('div');
  actif.textContent = `Compte YouTube actif : ${nomYtActif()} (progression isolée)`;
  actif.className = 'gris';
  const liste = document.createElement('div');
  if (!enregistres.length) {
    liste.textContent = 'Aucun compte YouTube enregistré.';
    liste.className = 'gris';
  } else {
    liste.replaceChildren(
      ...enregistres.map((c) => {
        const { faits, total } = progresYt(c.id);
        const ligne = document.createElement('div');
        ligne.textContent = `${c.id === ytActif ? '● ' : '○ '}${c.label} — ${faits}/${total} traités`;
        ligne.className = c.id === ytActif ? 'ok' : '';
        if (c.id !== ytActif) {
          const suppr = Object.assign(document.createElement('button'), { textContent: 'Retirer' });
          suppr.onclick = async () => {
            ytComptes = ytComptes.filter((x) => x.id !== c.id);
            try { await sauverEtats(); } catch { /* stockage indisponible */ }
            afficherYtComptes();
          };
          ligne.append(' ', suppr);
        }
        return ligne;
      }),
    );
  }
  const ajouter = Object.assign(document.createElement('button'), { textContent: 'Ajouter le compte YouTube détecté' });
  const peutAjouter = ytDetecte && ytComptes.length < YT_MAX_COMPTES && !ytComptes.some((c) => c.id === ytDetecte.id);
  ajouter.disabled = !peutAjouter;
  ajouter.title = !ytDetecte ? 'Clique d’abord « Vérifier mes connexions »' : ytComptes.length >= YT_MAX_COMPTES ? `${YT_MAX_COMPTES} comptes max` : `Ajouter ${ytDetecte.label}`;
  ajouter.onclick = async () => {
    if (!ytDetecte || ytComptes.length >= YT_MAX_COMPTES) return;
    if (!ytComptes.some((c) => c.id === ytDetecte.id)) ytComptes.push({ ...ytDetecte });
    ytActif = ytDetecte.id;
    try {
      await sauverEtats();
      log(`Compte YouTube enregistré : ${ytDetecte.label}.`, 'ok');
    } catch { log('Stockage local indisponible.', 'err'); }
    afficherYtComptes();
    afficherPlateformes();
    afficherCategories();
    afficherResume();
  };
  conteneur.replaceChildren(actif, liste, ajouter);
}

// Sonde minimale : titre + volume de texte. Injectée après un négatif pour
// dire POURQUOI (page d'erreur / page vide / rendue mais sans marqueur).
function sonderPage() {
  return {
    titre: document.title ?? '',
    longueur: document.body?.innerText?.length ?? 0,
    url: location.href,
  };
}

async function verifierConnexions() {
  const plateformes = [...document.querySelectorAll('#plateformes input:checked')].map((i) => i.value);
  if (!plateformes.length) {
    log('Coche au moins une plateforme avant de vérifier.', 'err');
    return;
  }
  // Appelé avant tout await, pendant le clic : si l'accès à un site a été retiré
  // (réglage « Accès aux sites »), le navigateur propose de le rendre.
  const demandeAcces = chrome.permissions.request({ origins: plateformes.map((p) => ORIGINES[p]) }).catch(() => false);
  $('verifier').disabled = true;
  log(`Vérification des sessions : ${plateformes.map((p) => PLATEFORMES[p]).join(', ')}…`, 'gris');
  await demandeAcces;
  const fenetre = await chrome.windows.create({ url: 'about:blank', focused: false });
  const tabId = fenetre.tabs[0].id;
  // Le cookie de session fait foi : les repères de page se trompent dans les deux
  // sens (mise en page, langue, boutons présents déconnecté). La page ne sert
  // qu'à lire l'identité, et de repli si le navigateur refuse la lecture des cookies.
  const essayer = async (p) => {
    await chargerOnglet(tabId, ACCUEIL[p]);
    let page = null;
    let erreur = '';
    try {
      page = await executer(tabId, DETECTEURS[p], []);
    } catch (e) {
      erreur = e?.message ?? String(e);
    }
    let cookie = null;
    let cookiesLisibles = true;
    try {
      cookie = await cookieDeSession(p);
    } catch {
      cookiesLisibles = false;
    }
    const connecte = cookiesLisibles ? !!cookie : !!page?.connecte;
    return { page, erreur, cookie, cookiesLisibles, connecte };
  };
  try {
    for (const p of plateformes) {
      try {
        if (!(await chrome.permissions.contains({ origins: [ORIGINES[p]] }))) {
          connexions[p] = { connecte: false, identite: null };
          log(`${PLATEFORMES[p]} : le navigateur refuse l'accès de Blockfacho à ce site. Page des extensions → Blockfacho → Détails → Accès aux sites → « Sur tous les sites », puis revérifie.`, 'err');
        } else {
          let r = await essayer(p);
          // Un négatif peut venir d'une connexion auto encore en cours : un seul nouvel essai.
          if (!r.connecte) {
            await pause(4000);
            r = await essayer(p);
          }
          const { connecte } = r;
          const identite = connecte ? r.page?.identite ?? null : null;
          connexions[p] = { connecte, identite };
          if (connecte) {
            const nom = typeof identite === 'string' ? identite : identite?.label;
            log(`${PLATEFORMES[p]} : connecté${nom ? ` (${nom})` : ''} [${r.cookie ? `cookie ${r.cookie}` : 'repéré sur la page, cookies illisibles'}].`, 'ok');
            if (p === 'youtube' && identite?.id) {
              ytActif = identite.id;
              ytDetecte = { ...identite };
              if (!ytComptes.some((c) => c.id === identite.id)) {
                log(`YouTube détecté : ${identite.label} (non enregistré — bouton « Ajouter » disponible, ${YT_MAX_COMPTES} max).`, 'gris');
              }
            }
          } else {
            let sonde = '';
            try {
              const s = await executer(tabId, sonderPage, []);
              sonde = ` ; page : ${s?.titre ?? '?'} — ${s?.longueur ?? 0} caractères`;
            } catch { /* sonde facultative */ }
            const cause = r.cookiesLisibles ? `aucun cookie ${COOKIES_SESSION[p].join('/')}` : 'cookies illisibles, aucun repère de session';
            const contradiction = r.cookiesLisibles && r.page?.connecte ? ' ; la page semble pourtant connectée' : '';
            const panne = r.erreur ? ` ; injection : ${r.erreur}` : '';
            log(`${PLATEFORMES[p]} : NON CONNECTÉ (${cause}${contradiction}${sonde}${panne}). Utilise « Se connecter » ci-dessus.`, 'err');
          }
        }
      } catch (e) {
        connexions[p] = { connecte: false, identite: null };
        log(`${PLATEFORMES[p]} : vérification impossible (${e?.message ?? e}).`, 'err');
      }
      afficherConnexions();
      afficherYtComptes();
      afficherPlateformes();
      afficherCategories();
      afficherResume();
      await pause(1500 + Math.random() * 1500);
    }
    log('Connexions vérifiées.', 'gris');
  } finally {
    await chrome.windows.remove(fenetre.id).catch(() => {});
    $('verifier').disabled = false;
  }
}

// Si la page ne finit jamais de charger, on rend la main quand même : agir* remontera l'erreur.
function chargerOnglet(tabId, url) {
  return new Promise((resolve) => {
    const fin = () => {
      clearTimeout(minuteur);
      chrome.tabs.onUpdated.removeListener(ecoute);
      resolve();
    };
    const ecoute = (id, info) => id === tabId && info.status === 'complete' && fin();
    const minuteur = setTimeout(fin, 30000);
    chrome.tabs.onUpdated.addListener(ecoute);
    chrome.tabs.update(tabId, { url });
  });
}

// ---------- Scripts injectés : un par plateforme, chacun autonome ----------
// Chacun prend (bloquer, avecSignaux) et rend { s, d } :
// s = bloque|deja|introuvable|serait_bloque|deconnecte|limite|erreur:... ; d = détail des signaux.
// Ordre imposé par la recherche : signaux faibles d'abord (pas intéressé,
// muet/masquer), blocage en dernier — après un blocage le profil se referme.
// Aucun signalement automatique (trop risqué pour le compte).

// X : pas intéressé sur le dernier post, puis muet, puis blocage.
async function agirX(bloquer, avecSignaux) {
  const q = (s) => document.querySelector(s);
  const qa = (s) => [...document.querySelectorAll(s)];
  const attendre = async (test, ms) => {
    const debut = Date.now();
    while (Date.now() - debut < ms) {
      const r = test();
      if (r) return r;
      await new Promise((r) => setTimeout(r, 250));
    }
    return null;
  };
  const fermerMenu = () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    document.body.click();
  };
  const etapes = [];
  if (!(await attendre(() => q('[data-testid="SideNav_AccountSwitcher_Button"]'), 15000))) {
    return { s: q('[data-testid="loginButton"], a[href="/login"]') ? 'deconnecte' : 'limite', d: 'session introuvable' };
  }
  if (/try again later|rate limit|temporarily blocked|action blocked|réessaie plus tard|nous limitons/i.test(document.body?.innerText ?? '')) {
    return { s: 'limite', d: 'limite anti-rafale' };
  }
  const statut = await attendre(
    () =>
      (q('[data-testid$="-unblock"]') && 'deja') ||
      (q('[data-testid="userActions"]') && 'a_bloquer') ||
      (q('[data-testid="emptyState"]') && 'introuvable'),
    20000,
  );
  if (statut === 'deja') return { s: 'deja', d: etapes.join(' ; ') || 'déjà bloqué' };
  if (statut === 'introuvable') return { s: 'introuvable', d: 'profil introuvable' };
  if (statut !== 'a_bloquer') return { s: 'erreur: page de profil non reconnue', d: '' };

  if (avecSignaux) {
    // 1. « Pas intéressé » sur le dernier post du profil. La timeline se charge
    // après l'en-tête : on attend son rendu avant de conclure qu'il n'y a rien.
    // (Absent hors For You : normal, X ne propose ce contrôle que sur le fil.)
    try {
      const post = await attendre(() => document.querySelector('article[data-testid="tweet"]'), 10000);
      const caret = post?.querySelector('[data-testid="caret"]');
      if (caret) {
        caret.click();
        const item = await attendre(
          () => qa('[role="menuitem"]').find((el) => /not interested|show less|moins souvent|m-intéresse|m'interesse/i.test(el.textContent ?? '')),
          6000,
        );
        if (item) {
          if (!bloquer) { etapes.push('pas intéressé détecté'); }
          else { item.click(); etapes.push('pas intéressé ok'); await pauseIn(1200); }
        } else etapes.push('pas intéressé absent (normal hors For You)');
        fermerMenu();
      } else etapes.push('aucun post visible');
    } catch { etapes.push('pas intéressé échec (non bloquant)'); }
    fermerMenu();
    // 2. Muet (poids négatif le plus fort, invisible pour la cible).
    try {
      q('[data-testid="userActions"]').click();
      const muet = await attendre(
        () => q('[data-testid="mute"]') || qa('[role="menuitem"]').find((el) => /mute|mettre en sourdine|^muet/i.test(el.textContent ?? '')),
        8000,
      );
      if (muet) {
        if (!bloquer) etapes.push('muet détecté');
        else {
          muet.click();
          await attendre(() => q('[data-testid="confirmationSheetConfirm"]'), 5000)?.click?.();
          etapes.push('muet ok');
          await pauseIn(1000);
        }
      } else etapes.push('muet absent');
      fermerMenu();
    } catch { etapes.push('muet échec (non bloquant)'); }
    fermerMenu();
  }
  if (!bloquer) return { s: 'serait_bloque', d: etapes.join(' ; ') };
  // 3. Blocage, en dernier.
  async function pauseIn(ms) { await new Promise((r) => setTimeout(r, ms)); }
  q('[data-testid="userActions"]')?.click?.();
  const menu = await attendre(() => q('[data-testid="block"]'), 10000);
  if (!menu) return { s: 'erreur: entrée Bloquer absente du menu', d: etapes.join(' ; ') };
  menu.click();
  const confirmer = await attendre(() => q('[data-testid="confirmationSheetConfirm"]'), 10000);
  if (!confirmer) return { s: 'erreur: confirmation absente', d: etapes.join(' ; ') };
  confirmer.click();
  const ok = await attendre(() => q('[data-testid$="-unblock"]'), 5000);
  return { s: ok ? 'bloque' : 'erreur: blocage non confirmé', d: etapes.join(' ; ') };
}

// Instagram : le blocage subsume muet/restreindre (les faire avant gaspille des
// actions et déclenche les limites). Combo = blocage direct (+ explication).
// « Pas intéressé » n'existe que sur le suggéré, pas sur un profil : on ne tente
// pas d'ouvrir le post (risquerait de quitter le profil avant le blocage).
async function agirInstagram(bloquer, _avecSignaux) {
  const attendre = async (test, ms) => {
    const debut = Date.now();
    while (Date.now() - debut < ms) {
      const r = test();
      if (r) return r;
      await new Promise((r) => setTimeout(r, 300));
    }
    return null;
  };
  const texte = (el) => ((el.innerText ?? el.textContent) ?? '').trim();
  const corps = () => document.body?.innerText ?? '';
  await attendre(() => (document.body?.innerText?.length ?? 0) > 50, 15000);
  if (document.querySelector('input[name="username"]') && /log in|se connecter/i.test(corps())) return { s: 'deconnecte', d: '' };
  if (/sorry, this page isn't available|cette page n’est pas disponible|cette page n'est pas disponible/i.test(corps())) return { s: 'introuvable', d: '' };
  if (/try again later|réessaie plus tard|checkpoint|nous limitons/i.test(corps())) return { s: 'limite', d: '' };
  const boutonOptions = await attendre(
    () =>
      document.querySelector('header button[aria-label*="ption" i], header button[aria-label*="ore" i], header button[aria-label*="lus" i]') ||
      [...document.querySelectorAll('header button')].find((b) => /…|\.\.\./.test(b.textContent ?? '')),
    15000,
  );
  if (!boutonOptions) return { s: 'erreur: bouton d’options introuvable (peut-être déconnecté)', d: '' };
  const detail = 'muet/restreint sautés (redondants avec bloquer) ; pas intéressé réservé au suggéré';
  boutonOptions.click();
  const entree = await attendre(() => {
    const dialogue = document.querySelector('[role="dialog"]');
    if (!dialogue) return null;
    const boutons = [...dialogue.querySelectorAll('button')];
    return (
      (boutons.find((b) => /^(débloquer|debloquer|unblock)$/i.test(texte(b))) && 'deja') ||
      boutons.find((b) => /^(bloquer|block)$/i.test(texte(b))) ||
      null
    );
  }, 10000);
  if (entree === 'deja') { document.body.click(); return { s: 'deja', d: detail }; }
  if (!entree) return { s: 'erreur: entrée Bloquer absente du menu', d: detail };
  if (!bloquer) { document.body.click(); return { s: 'serait_bloque', d: detail }; }
  entree.click();
  const confirmer = await attendre(() => {
    const dialogue = document.querySelector('[role="dialog"]');
    if (!dialogue) return null;
    return [...dialogue.querySelectorAll('button')].find((b) => /^(bloquer|block)$/i.test(texte(b)));
  }, 10000);
  if (!confirmer) return { s: 'erreur: confirmation absente', d: detail };
  confirmer.click();
  await new Promise((r) => setTimeout(r, 1500));
  // Vérifie côté serveur : le menu doit maintenant proposer « Débloquer ».
  document.body.click();
  const reOptions = await attendre(
    () =>
      document.querySelector('header button[aria-label*="ption" i], header button[aria-label*="ore" i], header button[aria-label*="lus" i]') ||
      [...document.querySelectorAll('header button')].find((b) => /…|\.\.\./.test(b.textContent ?? '')),
    8000,
  );
  let verifie = false;
  if (reOptions) {
    reOptions.click();
    verifie = !!(await attendre(() => {
      const dialogue = document.querySelector('[role="dialog"]');
      if (!dialogue) return null;
      return [...dialogue.querySelectorAll('button')].find((b) => /^(débloquer|debloquer|unblock)$/i.test(texte(b)));
    }, 8000));
    document.body.click();
  }
  return verifie ? { s: 'bloque', d: `${detail} ; bloqué confirmé` } : { s: 'erreur: blocage non confirmé', d: detail };
}

// TikTok (étape profil) : muet via Partager (silencieux, réversible), puis
// blocage en dernier. Le « pas intéressé » vidéo est fait avant, sur la page
// vidéo, par agirTiktokVideo — ici on ne le refait pas.
async function agirTiktok(bloquer, avecSignaux) {
  const attendre = async (test, ms) => {
    const debut = Date.now();
    while (Date.now() - debut < ms) {
      const r = test();
      if (r) return r;
      await new Promise((r) => setTimeout(r, 300));
    }
    return null;
  };
  const texte = (el) => ((el.innerText ?? el.textContent) ?? '').trim();
  const corps = () => document.body?.innerText ?? '';
  const etapes = [];
  await attendre(() => (document.body?.innerText?.length ?? 0) > 50, 15000);
  if (/couldn't find this account|ce compte est introuvable|utilisateur introuvable/i.test(corps())) return { s: 'introuvable', d: '' };
  if (/try again later|rate limit|action blocked|réessaie plus tard|nous limitons|temporarily blocked|checkpoint/i.test(corps())) return { s: 'limite', d: 'limite anti-rafale' };
  if (avecSignaux) {
    try {
      const partage = document.querySelector('[data-e2e="share"]') ||
        [...document.querySelectorAll('button')].find((b) => /partager|^share$/i.test(texte(b)));
      if (partage) {
        partage.click();
        const muet = await attendre(
          () => [...document.querySelectorAll('button, [role="menuitem"], div[role="button"]')].find((b) => /mute|sourdine/i.test(texte(b))),
          6000,
        );
        if (muet && bloquer) {
          muet.click();
          etapes.push('muet ok');
          await new Promise((r) => setTimeout(r, 800));
        } else {
          etapes.push(muet ? 'muet détecté' : 'muet absent');
        }
        document.body.click();
      } else etapes.push('partage introuvable');
    } catch { etapes.push('muet échec (non bloquant)'); document.body.click(); }
  }
  const plus = await attendre(
    () =>
      document.querySelector('[data-e2e="user-more"]') ||
      [...document.querySelectorAll('button')].find((b) => /…/.test(b.textContent ?? '') && b.offsetParent !== null),
    15000,
  );
  if (!plus) {
    if (/log in|se connecter/i.test(corps())) return { s: 'deconnecte', d: etapes.join(' ; ') };
    return { s: 'erreur: bouton « … » introuvable', d: etapes.join(' ; ') };
  }
  plus.click();
  const entree = await attendre(() => {
    const items = [...document.querySelectorAll('[role="menuitem"], [data-e2e*="block"], button, div[role="button"]')];
    return (
      (items.find((b) => /^(débloquer|debloquer|unblock)$/i.test(texte(b))) && 'deja') ||
      items.find((b) => /^(bloquer|block)$/i.test(texte(b) ?? '') && b.offsetParent !== null) ||
      null
    );
  }, 10000);
  if (entree === 'deja') return { s: 'deja', d: etapes.join(' ; ') };
  if (!entree) return { s: 'erreur: entrée Bloquer absente du menu (connecte-toi puis réessaie)', d: etapes.join(' ; ') };
  if (!bloquer) { document.body.click(); return { s: 'serait_bloque', d: etapes.join(' ; ') }; }
  entree.click();
  const confirmer = await attendre(
    () => [...document.querySelectorAll('[role="dialog"] button, button')].find((b) => /^(bloquer|block|confirmer|confirm)$/i.test(texte(b)) && b.offsetParent !== null),
    10000,
  );
  if (!confirmer) return { s: 'erreur: confirmation absente', d: etapes.join(' ; ') };
  confirmer.click();
  await new Promise((r) => setTimeout(r, 1500));
  // Vérifie côté serveur : le menu doit maintenant proposer « Débloquer ».
  document.body.click();
  const rePlus = await attendre(
    () =>
      document.querySelector('[data-e2e="user-more"]') ||
      [...document.querySelectorAll('button')].find((b) => /…/.test(b.textContent ?? '') && b.offsetParent !== null),
    8000,
  );
  let reVerifie = false;
  if (rePlus) {
    rePlus.click();
    reVerifie = !!(await attendre(() => {
      const items = [...document.querySelectorAll('[role="menuitem"], [data-e2e*="block"], button, div[role="button"]')];
      return items.find((b) => /^(débloquer|debloquer|unblock)$/i.test(texte(b)));
    }, 8000));
    document.body.click();
  }
  const dj = etapes.join(' ; ');
  return reVerifie ? { s: 'bloque', d: `${dj} ; bloqué confirmé` } : { s: 'erreur: blocage non confirmé', d: dj };
}

// Facebook : pas intéressé sur le 1er post, désabonnement, puis blocage.
async function agirFacebook(bloquer, avecSignaux) {
  const attendre = async (test, ms) => {
    const debut = Date.now();
    while (Date.now() - debut < ms) {
      const r = test();
      if (r) return r;
      await new Promise((r) => setTimeout(r, 300));
    }
    return null;
  };
  const texte = (el) => ((el.innerText ?? el.textContent) ?? '').trim();
  const corps = () => document.body?.innerText ?? '';
  const etapes = [];
  await attendre(() => (document.body?.innerText?.length ?? 0) > 50, 15000);
  if (document.querySelector('input#email, input[name="email"]') && /log in|se connecter/i.test(corps())) return { s: 'deconnecte', d: '' };
  if (/this page isn't available|cette page n’est pas disponible|ce contenu n’est pas disponible/i.test(corps())) return { s: 'introuvable', d: '' };
  if (/temporarily blocked|misusing this feature|try again later|réessaie plus tard/i.test(corps())) return { s: 'limite', d: '' };
  if (avecSignaux) {
    // 1. Pas intéressé sur le premier post de la page. Le fil se charge après
    // l'en-tête : on attend son rendu avant de conclure qu'il n'y a rien.
    try {
      const article = await attendre(() => document.querySelector('[role="article"]'), 10000);
      const menuBtn = article?.querySelector('[aria-label*="Actions for this post" i], [aria-label*="Options" i], [aria-label*="See options" i]') ||
        [...(article?.querySelectorAll('div[role="button"], button') ?? [])].find((b) => /^\.\.\.$|^…$/.test(texte(b)));
      if (menuBtn) {
        menuBtn.click();
        const item = await attendre(
          () => [...document.querySelectorAll('[role="menuitem"]')].find((b) => /not interested|hide post|pas int|masquer la publication|ne veux pas/i.test(texte(b))),
          6000,
        );
        if (item) {
          if (bloquer) { item.click(); etapes.push('pas intéressé ok'); }
          else etapes.push('pas intéressé détecté');
          await new Promise((r) => setTimeout(r, 800));
        } else etapes.push('pas intéressé absent');
        document.body.click();
      } else etapes.push('aucun post actionnable');
    } catch { etapes.push('pas intéressé échec (non bloquant)'); }
    // 2. Ne plus suivre (redondant avec bloquer, mais utile si le blocage échoue).
    try {
      const suivi = [...document.querySelectorAll('button, div[role="button"]')].find((b) => /^(suivi\(e\)s?|following)$/i.test(texte(b)));
      if (suivi) {
        if (!bloquer) etapes.push('suivi détecté');
        else {
          suivi.click();
          const unf = await attendre(
            () => [...document.querySelectorAll('[role="menuitem"], button')].find((b) => /^(ne plus suivre|se désabonner|unfollow)/i.test(texte(b))),
            6000,
          );
          if (unf) { unf.click(); etapes.push('ne plus suivre ok'); }
          else etapes.push('ne plus suivre absent');
          document.body.click();
        }
      }
    } catch { etapes.push('ne plus suivre échec (non bloquant)'); }
  }
  const plus = await attendre(
    () =>
      document.querySelector('[aria-label*="More action" i], [aria-label*="Plus" i], [aria-label*="Autre" i]') ||
      [...document.querySelectorAll('div[role="button"], button')].find((b) => /^\.\.\.$|^…$/.test(texte(b)) && b.offsetParent !== null),
    15000,
  );
  if (!plus) return { s: 'erreur: bouton « … » introuvable (peut-être déconnecté)', d: etapes.join(' ; ') };
  plus.click();
  const entree = await attendre(() => {
    const items = [...document.querySelectorAll('[role="menuitem"], [role="button"], button')];
    return (
      (items.find((b) => /^(débloquer|debloquer|unblock)/i.test(texte(b))) && 'deja') ||
      items.find((b) => /^(bloquer|block)/i.test(texte(b)) && b.offsetParent !== null) ||
      null
    );
  }, 10000);
  if (entree === 'deja') return { s: 'deja', d: etapes.join(' ; ') };
  if (!entree) return { s: 'erreur: entrée Bloquer absente du menu', d: etapes.join(' ; ') };
  if (!bloquer) { document.body.click(); return { s: 'serait_bloque', d: etapes.join(' ; ') }; }
  entree.click();
  const confirmer = await attendre(
    () => [...document.querySelectorAll('[role="dialog"] button, button')].find((b) => /^(bloquer|block|confirmer|confirm)/i.test(texte(b)) && b.offsetParent !== null),
    10000,
  );
  if (!confirmer) return { s: 'erreur: confirmation absente', d: etapes.join(' ; ') };
  confirmer.click();
  await new Promise((r) => setTimeout(r, 1500));
  // Vérifie côté serveur : le menu doit maintenant proposer « Débloquer ».
  document.body.click();
  const rePlus = await attendre(
    () =>
      document.querySelector('[aria-label*="More action" i], [aria-label*="Plus" i], [aria-label*="Autre" i]') ||
      [...document.querySelectorAll('div[role="button"], button')].find((b) => /^\.\.\.$|^…$/.test(texte(b)) && b.offsetParent !== null),
    8000,
  );
  let reVerifie = false;
  if (rePlus) {
    rePlus.click();
    reVerifie = !!(await attendre(() => {
      const items = [...document.querySelectorAll('[role="menuitem"], [role="button"], button')];
      return items.find((b) => /^(débloquer|debloquer|unblock)/i.test(texte(b)));
    }, 8000));
    document.body.click();
  }
  const dj = etapes.join(' ; ');
  return reVerifie ? { s: 'bloque', d: `${dj} ; bloqué confirmé` } : { s: 'erreur: blocage non confirmé', d: dj };
}

// ---------- YouTube : signaux recos + blocage final obligatoire ----------
// La recherche montre que « Bloquer l'utilisateur » seul ne touche que le chat
// et les commentaires, pas les recommandations. D'où le combo côté spectateur :
// désabonner + « ne pas recommander la chaîne » + « pas intéressé » + dislike,
// PUIS « Bloquer l'utilisateur » en dernier (jamais sauté).
// Quatre petits scripts mono-page, orchestrés par traiterCompteYoutube.

// 1. Page chaîne : détecte + (désabonne).
async function agirYoutubeCanal(bloquer) {
  const attendre = async (test, ms) => {
    const debut = Date.now();
    while (Date.now() - debut < ms) {
      const r = test();
      if (r) return r;
      await new Promise((r) => setTimeout(r, 300));
    }
    return null;
  };
  const texte = (el) => ((el.innerText ?? el.textContent) ?? '').trim();
  const corps = () => document.body?.innerText ?? '';
  await attendre(() => (document.body?.innerText?.length ?? 0) > 50, 15000);
  if (document.querySelector('a[href*="ServiceLogin"]') && /sign in|se connecter/i.test(corps())) return { s: 'deconnecte', d: '' };
  if (/this page isn't available|cette page n’est pas disponible/i.test(corps())) return { s: 'introuvable', d: '' };
  if (/try again later|rate limit|action blocked|réessaie plus tard|nous limitons|temporarily blocked/i.test(corps())) return { s: 'limite', d: 'limite anti-rafale' };
  const abonne = [...document.querySelectorAll('button')].find((b) => /^(abonné|abonnée|subscribed)$/i.test(texte(b)));
  if (!abonne) return { s: 'ok', d: 'pas abonné' };
  if (!bloquer) return { s: 'ok', d: 'abonnement détecté (serait conservé à blanc)' };
  abonne.click();
  const desabo = await attendre(
    () => [...document.querySelectorAll('button, ytd-menu-service-item-renderer')].find((b) => /désabonner|unsubscribe/i.test(texte(b))),
    8000,
  );
  if (desabo) desabo.click();
  else return { s: 'ok', d: 'désabonnement introuvable (peut-être déjà fait)' };
  await new Promise((r) => setTimeout(r, 1000));
  return { s: 'ok', d: 'désabonné' };
}

// Liste les dernières vidéos visibles sur la page (chaîne ou résultats).
// La grille se charge après l'en-tête : on attend son rendu.
async function listerVideosYoutube() {
  const debut = Date.now();
  while (Date.now() - debut < 10000) {
    const liens = [...document.querySelectorAll('a[href*="/watch?v="], a[href*="/shorts/"]')]
      .map((a) => a.href)
      .filter((h, i, t) => t.indexOf(h) === i);
    if (liens.length) return liens.slice(0, 3);
    await new Promise((r) => setTimeout(r, 300));
  }
  return [...document.querySelectorAll('a[href*="/watch?v="], a[href*="/shorts/"]')]
    .map((a) => a.href)
    .filter((h, i, t) => t.indexOf(h) === i)
    .slice(0, 3);
}

// 2. Page montre : dislike (signal faible mais gratuit, sans quitter la page).
async function agirYoutubeVideo(bloquer) {
  const attendre = async (test, ms) => {
    const debut = Date.now();
    while (Date.now() - debut < ms) {
      const r = test();
      if (r) return r;
      await new Promise((r) => setTimeout(r, 300));
    }
    return null;
  };
  const texte = (el) => ((el.innerText ?? el.textContent) ?? '').trim();
  await attendre(() => (document.body?.innerText?.length ?? 0) > 50, 15000);
  if (/try again later|rate limit|action blocked|réessaie plus tard|nous limitons|temporarily blocked/i.test(document.body?.innerText ?? '')) return { s: 'limite', d: 'limite anti-rafale' };
  const dislike = document.querySelector('ytd-segmented-like-dislike-button-renderer #dislike-button button') ||
    [...document.querySelectorAll('button')].find((b) => /dislike|je n'aime pas/i.test(b.getAttribute('aria-label') ?? ''));
  if (!dislike) return { s: 'ok', d: 'dislike introuvable' };
  if (dislike.getAttribute('aria-pressed') === 'true') return { s: 'ok', d: 'déjà pas aimé' };
  if (!bloquer) return { s: 'ok', d: 'dislike détecté' };
  dislike.click();
  await new Promise((r) => setTimeout(r, 800));
  return { s: 'ok', d: 'dislike ok' };
}

// 3. Page de résultats de recherche : « ne pas recommander la chaîne » sur une
// carte correspondante uniquement (jamais sur une chaîne non reconnue).
async function agirYoutubeCarte(bloquer, indice) {
  const attendre = async (test, ms) => {
    const debut = Date.now();
    while (Date.now() - debut < ms) {
      const r = test();
      if (r) return r;
      await new Promise((r) => setTimeout(r, 300));
    }
    return null;
  };
  const texte = (el) => ((el.innerText ?? el.textContent) ?? '').trim();
  await attendre(() => document.querySelectorAll('ytd-video-renderer, ytd-compact-video-renderer, ytd-channel-renderer').length > 0, 15000);
  if (/try again later|rate limit|action blocked|réessaie plus tard|nous limitons|temporarily blocked/i.test(document.body?.innerText ?? '')) return { s: 'limite', d: 'limite anti-rafale' };
  const [pseudo, nom] = String(indice ?? '').split('|');
  const cartes = [...document.querySelectorAll('ytd-video-renderer, ytd-compact-video-renderer')].slice(0, 15);
  // Appariement strict sur le nœud nom-de-chaîne uniquement (jamais sur tout le
  // texte de la carte : un titre ou une description innocente pourrait contenir
  // le mot recherché). En cas de doute : aucune carte, rien cliqué.
  let cible = null;
  for (const c of cartes) {
    const chEl = c.querySelector('ytd-channel-name yt-formatted-string, #channel-name yt-formatted-string, ytd-channel-name #text');
    const ch = (chEl?.textContent ?? '').trim().toLowerCase();
    if (!ch) continue;
    if ((pseudo && (ch === pseudo || ch === '@' + pseudo)) || (nom && nom.length > 3 && ch === nom)) { cible = c; break; }
  }
  if (!cible) return { s: 'ok', d: 'aucune carte reconnaissable (sécurité : rien cliqué)' };
  const menu = cible.querySelector('ytd-menu-renderer yt-icon-button button, button[aria-label*="Action" i], button[aria-label*="Plus" i]');
  if (!menu) return { s: 'ok', d: 'menu carte introuvable' };
  menu.click();
  const item = await attendre(
    () => [...document.querySelectorAll('ytd-menu-service-item-renderer, [role="menuitem"]')].find((b) => /ne pas recommander|don't recommend|pas intéressé|not interested/i.test(texte(b))),
    8000,
  );
  document.body.click();
  if (!item) return { s: 'ok', d: 'entrée reco introuvable' };
  if (!bloquer) return { s: 'ok', d: 'reco détectée : ' + texte(item).slice(0, 40) };
  item.click();
  const sous = await attendre(
    () => [...document.querySelectorAll('ytd-menu-service-item-renderer, [role="menuitem"], button')].find((b) => /ne pas recommander|don't recommend/i.test(texte(b))),
    5000,
  );
  if (sous) sous.click();
  await new Promise((r) => setTimeout(r, 800));
  return { s: 'ok', d: 'ne plus recommander ok' };
}

// 4. Page chaîne, étape finale : « Bloquer l'utilisateur » (but du tool —
// ne jamais la sauter : les recos seules ne suffisent pas). Côté spectateur,
// ça coupe chat/commentaires/mentions Google-wide ; combiné au désabonnement
// + « ne plus recommander », le compte est à la fois bloqué ET déréférencé.
async function agirYoutubeBloquer(bloquer) {
  const attendre = async (test, ms) => {
    const debut = Date.now();
    while (Date.now() - debut < ms) {
      const r = test();
      if (r) return r;
      await new Promise((r) => setTimeout(r, 300));
    }
    return null;
  };
  const texte = (el) => ((el.innerText ?? el.textContent) ?? '').trim();
  const corps = () => document.body?.innerText ?? '';
  await attendre(() => (document.body?.innerText?.length ?? 0) > 50, 15000);
  if (document.querySelector('a[href*="ServiceLogin"]') && /sign in|se connecter/i.test(corps())) return { s: 'deconnecte', d: '' };
  if (/this page isn't available|cette page n’est pas disponible/i.test(corps())) return { s: 'introuvable', d: '' };
  if (/try again later|rate limit|action blocked|réessaie plus tard|nous limitons|temporarily blocked/i.test(corps())) return { s: 'limite', d: 'limite anti-rafale' };
  const ouvrirMenu = async () => {
    const plus = document.querySelector('button[aria-label*="More" i], button[aria-label*="Plus" i]') ||
      [...document.querySelectorAll('button')].find((b) => /…/.test(b.textContent ?? ''));
    if (!plus) return null;
    plus.click();
    return attendre(
      () => [...document.querySelectorAll('ytd-menu-service-item-renderer, [role="menuitem"], button')].find((b) => /bloquer l.utilisateur|block user|d.bloquer|unblock/i.test(texte(b))),
      8000,
    );
  };
  let entree = await ouvrirMenu();
  if (!entree) return { s: 'erreur: entrée « Bloquer l’utilisateur » absente (connecte-toi puis réessaie)', d: '' };
  if (/d.bloquer|unblock/i.test(texte(entree))) { document.body.click(); return { s: 'deja', d: 'déjà bloqué' }; }
  if (!bloquer) { document.body.click(); return { s: 'ok', d: 'blocage détecté' }; }
  entree.click();
  const confirmer = await attendre(
    () => [...document.querySelectorAll('button')].find((b) => /^(bloquer|block|envoyer|submit|confirmer|confirm)$/i.test(texte(b)) && b.offsetParent !== null),
    8000,
  );
  if (confirmer) confirmer.click();
  await new Promise((r) => setTimeout(r, 1500));
  // Vérifie côté serveur : le menu doit maintenant proposer « Débloquer ».
  document.body.click();
  entree = await ouvrirMenu();
  document.body.click();
  if (entree && /d.bloquer|unblock/i.test(texte(entree))) return { s: 'bloque', d: 'bloqué confirmé' };
  return { s: 'erreur: blocage non confirmé', d: '' };
}
// TikTok : « pas intéressé » sur la 1re vidéo (faible mais réel), puis retour
// profil pour muet + blocage. Deux petits scripts mono-page orchestrés par
// traiterCompteTiktok (même pattern que YouTube).

// Liste les premières vidéos visibles sur le profil. La grille se charge après
// l'en-tête : on attend son rendu (sinon le combo sauterait le « pas intéressé »).
async function listerVideosTiktok() {
  const debut = Date.now();
  while (Date.now() - debut < 10000) {
    const liens = [...document.querySelectorAll('a[href*="/video/"]')]
      .map((a) => a.href)
      .filter((h, i, t) => t.indexOf(h) === i);
    if (liens.length) return liens.slice(0, 3);
    await new Promise((r) => setTimeout(r, 300));
  }
  return [...document.querySelectorAll('a[href*="/video/"]')]
    .map((a) => a.href)
    .filter((h, i, t) => t.indexOf(h) === i)
    .slice(0, 3);
}

// 1. Page vidéo : « pas intéressé » via Partager, repli via
// Signaler → Autre → « ce contenu ne m'intéresse pas » (voie officielle web FR
// pour le feedback d'intérêt, pas un signalement d'abus : on ne choisit jamais
// une autre catégorie). Non bloquant : tout échec rend juste un détail.
async function agirTiktokVideo(bloquer) {
  const attendre = async (test, ms) => {
    const debut = Date.now();
    while (Date.now() - debut < ms) {
      const r = test();
      if (r) return r;
      await new Promise((r) => setTimeout(r, 300));
    }
    return null;
  };
  const texte = (el) => ((el.innerText ?? el.textContent) ?? '').trim();
  const corps = () => document.body?.innerText ?? '';
  await attendre(() => (document.body?.innerText?.length ?? 0) > 50, 15000);
  if (/try again later|rate limit|action blocked|réessaie plus tard|nous limitons|temporarily blocked|checkpoint/i.test(corps())) {
    return { s: 'limite', d: 'limite anti-rafale' };
  }
  if (/couldn't find this account|ce compte est introuvable|utilisateur introuvable|video currently unavailable|vidéo actuellement indisponible/i.test(corps())) {
    return { s: 'ok', d: 'vidéo indisponible (compte à bloquer quand même)' };
  }
  // Voie A : Partager → Pas intéressé → (+ Masquer cet utilisateur / Créateur).
  try {
    const partage = document.querySelector('[data-e2e="share"]') ||
      [...document.querySelectorAll('button')].find((b) => /partager|^share$/i.test(texte(b)));
    if (partage) {
      partage.click();
      const pasInteresse = await attendre(
        () => [...document.querySelectorAll('button, [role="menuitem"], div[role="button"]')].find((b) => /pas intéressé|not interested/i.test(texte(b)) && b.offsetParent !== null),
        6000,
      );
      if (pasInteresse) {
        if (!bloquer) { document.body.click(); return { s: 'ok', d: 'pas intéressé détecté' }; }
        pasInteresse.click();
        const masquer = await attendre(
          () => [...document.querySelectorAll('button, [role="menuitem"], div[role="button"]')].find((b) => /masquer.*utilisateur|hide videos from this user|créateur|creator/i.test(texte(b)) && b.offsetParent !== null),
          6000,
        );
        if (masquer) {
          masquer.click();
          const envoyer = await attendre(
            () => [...document.querySelectorAll('button')].find((b) => /^(envoyer|submit|terminé|done)$/i.test(texte(b)) && b.offsetParent !== null),
            6000,
          );
          if (envoyer) envoyer.click();
        }
        await new Promise((r) => setTimeout(r, 1000));
        document.body.click();
        return { s: 'ok', d: 'pas intéressé ok' };
      }
      document.body.click();
    }
  } catch { document.body.click(); }
  // Voie B (repli officiel web) : Signaler → Autre → « ne m'intéresse pas ».
  try {
    const signaler = [...document.querySelectorAll('button')].find((b) => /signaler|^report$/i.test(texte(b)) && b.offsetParent !== null);
    if (!signaler) return { s: 'ok', d: 'pas intéressé absent' };
    if (!bloquer) return { s: 'ok', d: 'pas intéressé détecté (voie signaler)' };
    signaler.click();
    const autre = await attendre(
      () => [...document.querySelectorAll('button, [role="menuitem"], div[role="button"], label')].find((b) => /^(autre|other)$/i.test(texte(b))),
      6000,
    );
    if (!autre) { document.body.click(); return { s: 'ok', d: 'pas intéressé absent' }; }
    autre.click();
    const motif = await attendre(
      () => [...document.querySelectorAll('button, label, div[role="button"]')].find((b) => /m-intéresse|m'interesse|doesn.t interest/i.test(texte(b))),
      6000,
    );
    if (!motif) { document.body.click(); return { s: 'ok', d: 'motif intérêt absent (rien envoyé)' }; }
    motif.click();
    const envoyer = await attendre(
      () => [...document.querySelectorAll('button')].find((b) => /^(envoyer|submit)$/i.test(texte(b)) && b.offsetParent !== null && !b.disabled),
      6000,
    );
    if (envoyer) envoyer.click();
    await new Promise((r) => setTimeout(r, 1000));
    document.body.click();
    return { s: 'ok', d: 'pas intéressé ok (voie signaler)' };
  } catch { document.body.click(); return { s: 'ok', d: 'pas intéressé échec (non bloquant)' }; }
}

const ACTIONS = { x: agirX, instagram: agirInstagram, tiktok: agirTiktok, facebook: agirFacebook };

function reperesDeLaPage() {
  const testids = [...new Set([...document.querySelectorAll('[data-testid]')].map((e) => e.dataset.testid))].join(', ');
  const e2e = [...new Set([...document.querySelectorAll('[data-e2e]')].map((e) => e.dataset.e2e))].slice(0, 20).join(', ');
  const boutons = [...document.querySelectorAll('button, [role="button"], [role="menuitem"]')]
    .map((b) => (b.innerText ?? b.textContent ?? '').trim().slice(0, 30))
    .filter(Boolean)
    .slice(0, 20)
    .join(' | ');
  return `${document.title} :: testids[${testids}] e2e[${e2e}] boutons[${boutons}]`;
}

async function executer(tabId, func, args = []) {
  const [r] = (await chrome.scripting.executeScript({ target: { tabId }, func, args })) ?? [];
  if (!r) throw new Error('executeScript sans réponse (onglet fermé ou injection refusée)');
  return r.result;
}

const normaliser = (r) => (typeof r === 'string' ? { statut: r, details: '' } : { statut: r?.s ?? 'erreur: réponse vide', details: r?.d ?? '' });

// YouTube : orchestration multi-pages (chaîne → vidéo → recherche → blocage).
// Le blocage final n'est jamais sauté : c'est le but du tool.
async function traiterCompteYoutube(tabId, compte, bloquer, avecSignaux) {
  const details = [];
  await chargerOnglet(tabId, compte.url);
  const canal = normaliser(await executer(tabId, agirYoutubeCanal, [bloquer]));
  if (['deconnecte', 'introuvable', 'limite'].includes(canal.statut)) return canal;
  if (canal.details) details.push(canal.details);
  if (avecSignaux !== false) {
    const videos = (await executer(tabId, listerVideosYoutube, [])) ?? [];
    if (videos.length) {
      await chargerOnglet(tabId, videos[0]);
      const vid = normaliser(await executer(tabId, agirYoutubeVideo, [bloquer]));
      if (vid.statut === 'limite' || vid.statut === 'deconnecte') return { statut: vid.statut, details: [...details, vid.details].filter(Boolean).join(' ; ') };
      if (vid.details) details.push(vid.details);
    }
    const pseudo = compte.identifiant.replace(/^@/, '').toLowerCase();
    const nom = (compte.name ?? '').toLowerCase();
    await chargerOnglet(tabId, `https://www.youtube.com/results?search_query=${encodeURIComponent(compte.name || compte.identifiant)}`);
    const carte = normaliser(await executer(tabId, agirYoutubeCarte, [bloquer, `${pseudo}|${nom}`]));
    if (carte.statut === 'limite') return { statut: 'limite', details: [...details, carte.details].filter(Boolean).join(' ; ') };
    if (carte.details) details.push(carte.details);
    // Retour obligatoire sur la chaîne pour le blocage final.
    await chargerOnglet(tabId, compte.url);
  }
  const bloc = normaliser(await executer(tabId, agirYoutubeBloquer, [bloquer]));
  if (['deconnecte', 'introuvable', 'limite'].includes(bloc.statut)) {
    if (bloc.details) details.push(bloc.details);
    return { statut: bloc.statut, details: details.join(' ; ') };
  }
  if (bloc.details) details.push(bloc.details);
  const d = details.join(' ; ');
  if (bloc.statut === 'deja') return { statut: 'deja', details: d };
  // Les étapes intermédiaires rendent 'ok' : jamais persisté tel quel.
  if (bloc.statut === 'bloque' || bloc.statut === 'ok') return { statut: bloquer ? 'bloque' : 'serait_bloque', details: d || 'recos nettoyées' };
  return { statut: bloc.statut, details: d };
}

// TikTok : orchestration profil → 1re vidéo (pas intéressé) → profil (muet + blocage).
async function traiterCompteTiktok(tabId, compte, bloquer, avecSignaux) {
  const details = [];
  await chargerOnglet(tabId, compte.url);
  if (avecSignaux) {
    const videos = (await executer(tabId, listerVideosTiktok, [])) ?? [];
    if (videos.length) {
      await chargerOnglet(tabId, videos[0]);
      const sig = normaliser(await executer(tabId, agirTiktokVideo, [bloquer]));
      if (sig.statut === 'deconnecte' || sig.statut === 'limite') return sig;
      if (sig.details) details.push(sig.details);
      await chargerOnglet(tabId, compte.url);
    } else {
      details.push('aucune vidéo visible');
    }
  }
  const profil = normaliser(await executer(tabId, agirTiktok, [bloquer, avecSignaux]));
  if (profil.details) details.push(profil.details);
  return { statut: profil.statut, details: details.join(' ; ') };
}

// Après un blocage, certaines interfaces (X en arrière-plan surtout) n'affichent
// pas l'état final sans rechargement : agirX vérifie déjà l'état côté serveur.
async function traiterCompte(tabId, compte, bloquer, avecSignaux) {
  if (compte.plateforme === 'youtube') return traiterCompteYoutube(tabId, compte, bloquer, avecSignaux);
  if (compte.plateforme === 'tiktok') return traiterCompteTiktok(tabId, compte, bloquer, avecSignaux);
  await chargerOnglet(tabId, compte.url);
  const action = ACTIONS[compte.plateforme];
  if (!action) return { statut: `erreur: plateforme ${compte.plateforme} non prise en charge`, details: '' };
  const premier = normaliser(await executer(tabId, action, [bloquer, avecSignaux]));
  return premier;
}

async function lancer() {
  const plateformes = [...document.querySelectorAll('#plateformes input:checked')].map((i) => i.value);
  const categories = [...document.querySelectorAll('#categories input:checked')].map((i) => i.value);
  const max = Number($('max').value);
  const [dMin, dMax] = [Number($('delaiMin').value), Number($('delaiMax').value)];
  const aBlanc = $('aBlanc').checked;
  const avecSignaux = $('combo').checked;
  const aTraiter = comptes
    .filter((c) => plateformes.includes(c.plateforme))
    .filter((c) => categories.includes(c.category))
    .filter((c) => !estTermine(c))
  ;
  const precisionYt = plateformes.includes('youtube') ? ` [YouTube actif : ${nomYtActif()}]` : '';

  log(`${aTraiter.length} comptes restants (${plateformes.map((p) => PLATEFORMES[p]).join(', ')})${precisionYt}${avecSignaux ? ', combo pas-intéressé+muet puis blocage' : ', blocage seul'}${aBlanc ? ' (à blanc)' : ''}.`);
  if (!Object.keys(connexions).length) {
    log('Astuce : « Vérifier mes connexions » détecte chaque session et propose « Se connecter » si besoin.', 'gris');
  }
  if (!aTraiter.length) return;

  arret = false;
  $('lancer').disabled = true;
  $('arreter').disabled = false;
  // Plateformes sans session, ignorées pour ce lancement sans toucher l'état
  // persisté : les comptes restent à traiter au prochain lancement connecté.
  const ignorees = new Set();
  let fenetre = null;

  try {
    fenetre = await chrome.windows.create({ url: 'about:blank', focused: false });
    const tabId = fenetre.tabs[0].id;
    let erreursDeSuite = 0;
    let actions = 0;
    for (const [i, c] of aTraiter.entries()) {
      if (arret || actions >= max) break;
      if (ignorees.has(c.plateforme)) continue;
      const qui = c.plateforme === 'youtube' ? `YouTube ${nomYtActif()}` : PLATEFORMES[c.plateforme];
      const prefixe = `[${i + 1}/${aTraiter.length}] [${qui}] ${c.identifiant} (${c.name})`;
      let result;
      let details;
      try {
        ({ statut: result, details } = await traiterCompte(tabId, c, !aBlanc, avecSignaux));
      } catch (e) {
        result = `erreur: exception inattendue (${e?.message ?? e})`;
        details = '';
      }
      const suffixe = details ? ` — ${details}` : '';

      if (result === 'deconnecte') {
        log(`[${PLATEFORMES[c.plateforme]}] Pas de session dans ce navigateur : connecte-toi sur ${c.plateforme}.com puis relance (comptes ${c.plateforme} ignorés pour ce lancement).`, 'err');
        // On saute cette plateforme plutôt que tout arrêter : les autres restent traitables.
        ignorees.add(c.plateforme);
        try {
          await sauverEtats();
        } catch { /* stockage indisponible : on continue le lancement */ }
        continue;
      }
      if (result === 'limite') {
        log(`[${PLATEFORMES[c.plateforme]}] La plateforme ne charge plus (limite anti-rafale). Attends 30 min avant de relancer.`, 'err');
        break;
      }
      if (result.startsWith('erreur')) {
        ecrireEtat(c, 'erreur');
        erreursDeSuite++;
        log(`${prefixe} : ${result}${suffixe}`, 'err');
        let reperes = '(repères indisponibles)';
        try {
          reperes = await executer(tabId, reperesDeLaPage);
        } catch { /* onglet fermé ou injection refusée : on garde le libellé de secours */ }
        log(`  repères présents : ${reperes}`, 'gris');
      } else if (TERMINES.includes(result) || result === 'serait_bloque') {
        if (result !== 'serait_bloque') ecrireEtat(c, result);
        erreursDeSuite = 0;
        log(`${prefixe} : ${LIBELLES[result] ?? result}${suffixe}`, result === 'bloque' ? 'ok' : 'gris');
      } else {
        ecrireEtat(c, 'erreur');
        erreursDeSuite++;
        log(`${prefixe} : statut inattendu « ${result} » (compté comme erreur)${suffixe}`, 'err');
      }
      try {
        await sauverEtats();
      } catch {
        erreursDeSuite++;
        log(`${prefixe} : stockage local indisponible (${suffixe})`, 'err');
      }

      // Plusieurs échecs d'affilée = limite de débit ou interface changée : insister risque un verrouillage du compte.
      if (erreursDeSuite >= 3) {
        log('3 erreurs de suite, arrêt. Réessaie plus tard.', 'err');
        break;
      }
      if (result === 'bloque' || result === 'serait_bloque') actions++;
      if (actions >= max || i === aTraiter.length - 1 || arret) continue;
      // Un combo fait 2-3 écritures par compte : on espace davantage que le blocage seul.
      const aAgi = result === 'bloque' || result.startsWith('erreur');
      const facteur = avecSignaux ? 1.5 : 1;
      await pause(aAgi ? (dMin + Math.random() * (dMax - dMin)) * 1000 * facteur : (avecSignaux ? 6 + Math.random() * 4 : 3 + Math.random() * 3) * 1000);
    }
  } finally {
    if (fenetre) await chrome.windows.remove(fenetre.id).catch(() => {});
    $('lancer').disabled = false;
    $('arreter').disabled = true;
    log(arret ? 'Arrêté.' : 'Terminé.');
    afficherResume();
    afficherPlateformes();
    afficherCategories();
    afficherYtComptes();
  }
}

$('lancer').onclick = lancer;
$('arreter').onclick = () => {
  arret = true;
  log('Arrêt demandé, fin après le compte en cours.', 'gris');
};
$('verifier').onclick = verifierConnexions;

let initEtat = {};
try {
  initEtat = await chrome.storage.local.get(['etat', 'yt_comptes', 'yt_etat']);
} catch { /* stockage indisponible : on part d'un état vide, persisté au prochain lancement */ }
({ etat = {}, yt_comptes: ytComptes = [], yt_etat: ytEtat = {} } = initEtat);
if (!Array.isArray(ytComptes)) ytComptes = [];
ytComptes = ytComptes.filter((c) => c && typeof c.id === 'string').slice(0, YT_MAX_COMPTES);
if (typeof ytEtat !== 'object' || ytEtat === null) ytEtat = {};
// Migration v1 → v2 : les clés nues (@handle X) deviennent x:@handle.
for (const [k, v] of Object.entries(etat)) {
  if (!k.includes(':')) {
    etat[`x:${k.toLowerCase()}`] = v;
    delete etat[k];
  }
}
// Migration YouTube mono → multi-comptes : les anciens statuts youtube:*
// rejoignent la progression du compte « principal », sans rien perdre.
{
  const legacy = Object.entries(etat).filter(([k]) => k.startsWith('youtube:'));
  if (legacy.length && Object.keys(ytEtat).length === 0) {
    ytEtat[YT_PRINCIPAL] = Object.fromEntries(legacy);
    for (const [k] of legacy) delete etat[k];
    try { await sauverEtats(); } catch { /* persisté au prochain lancement */ }
  }
}
try {
  comptes = await chargerComptes();
  afficherResume();
  afficherPlateformes();
  afficherCategories();
  afficherConnexions();
  afficherYtComptes();
  $('lancer').disabled = false;
} catch (e) {
  $('resume').textContent = `Annuaire injoignable (${e.message}). Recharge la page plus tard.`;
}
