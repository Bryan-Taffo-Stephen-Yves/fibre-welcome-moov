// Branchement du serveur simulé dans le navigateur : stockage local, verrou entre onglets,
// synchronisation temps réel (BroadcastChannel), mode hors ligne par onglet et file d'attente terrain.
import { createBackend, memoryStorage } from '../server/backend.js';
import { cloud, cloudState } from './cloud.js';

const React = window.React;

function browserStorage() {
  try {
    const ls = window.localStorage; ls.setItem('fw:probe', '1'); ls.removeItem('fw:probe');
    return {
      get: k => { try { return ls.getItem(k); } catch { return null; } },
      set: (k, v) => { try { ls.setItem(k, v); } catch (e) { toast('Stockage du navigateur plein : supprimez un espace de test.', true); throw e; } if (k.startsWith('fw:bk:')) cloud.noteBackupWrite(k); },
      remove: k => { try { ls.removeItem(k); } catch {} },
      keys: () => { try { return Object.keys(ls); } catch { return []; } },
    };
  } catch { return memoryStorage(); }
}
const tabStore = (() => { try { const s = window.sessionStorage; s.setItem('fw:p', '1'); return s; } catch { const m = {}; return { getItem: k => m[k] ?? null, setItem: (k, v) => { m[k] = String(v); }, removeItem: k => { delete m[k]; } }; } })();
export const tabGet = (k, d) => { try { const v = tabStore.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } };
export const tabSet = (k, v) => { try { tabStore.setItem(k, JSON.stringify(v)); } catch {} };

export const storage = browserStorage();
const listeners = new Set();
let changeCount = 0;
const emitLocal = () => { changeCount++; for (const l of listeners) l(changeCount); };
let chan = null;
try { chan = new BroadcastChannel('fibre-welcome'); chan.onmessage = () => emitLocal(); } catch {}
try { window.addEventListener('storage', e => { if (e.key && (e.key.startsWith('fw:wsv:') || e.key.startsWith('fw:wsn:'))) emitLocal(); }); } catch {}

// Verrou d'écriture : entre onglets (navigator.locks), puis entre appareils quand l'espace est partagé.
// Le choix (partagé ou non) se fait une fois le verrou obtenu : le partage a pu (re)démarrer pendant l'attente.
export const tabLock = typeof navigator !== 'undefined' && navigator.locks && navigator.locks.request ? (name, fn) => navigator.locks.request(name, () => fn()) : (name, fn) => Promise.resolve().then(fn);
const lock = (name, fn) => tabLock(name, () => cloud.run(name.slice(3), fn));
export const api = createBackend({ storage, lock, onChange: () => { emitLocal(); try { chan && chan.postMessage({ t: Date.now() }); } catch {} } });
export { cloud, cloudState };
export function useCloud() {
  const [, s] = React.useState(0);
  React.useEffect(() => cloud.on(() => s(x => x + 1)), []);
  return cloudState;
}

export function useTick() {
  const [n, setN] = React.useState(changeCount);
  React.useEffect(() => { const f = x => setN(x); listeners.add(f); return () => listeners.delete(f); }, []);
  return n;
}
export const refresh = emitLocal;

// ---------- Réseau simulé (par personnage) ----------
// Couper le réseau du téléphone du technicien ne coupe pas celui du client ou de la conseillère ouverts à côté.
const offlineSince = new Map();
export const isOnline = token => !offlineSince.has(token);
export const netSince = token => offlineSince.get(token) || Date.now();
const netListeners = new Set();
export function setOnline(v, token) {
  if (v) offlineSince.delete(token); else offlineSince.set(token, Date.now());
  for (const l of netListeners) l(); emitLocal();
  if (v) replay(token, { quiet: true });
}
// Sans jeton : vrai si au moins un personnage ouvert est hors ligne (pastille de l'en-tête).
export function useOnline(token) { const [, s] = React.useState(0); React.useEffect(() => { const f = () => s(x => x + 1); netListeners.add(f); return () => netListeners.delete(f); }, []); return token ? isOnline(token) : offlineSince.size === 0; }

// ---------- Lecture : hors ligne, on garde les dernières données reçues (CL-20) ----------
const lastGood = new Map();
export function useQ(token, name, args = {}) {
  useTick();
  const key = token + '|' + name + '|' + JSON.stringify(args);
  if (!token) return { error: { message: 'Aucune session.' } };
  if (!isOnline(token) && lastGood.has(key)) return { ...lastGood.get(key), offline: true };
  try {
    const data = api.q(token, name, args);
    const v = { data, at: Date.now() };
    lastGood.set(key, v);
    return v;
  } catch (e) { return { error: { code: e.code, message: e.message } }; }
}

// ---------- Écriture ----------
export async function call(token, cmd, args = {}, opts = {}) {
  if (!isOnline(token)) {
    if (cmd === 'wo.action') return enqueue(token, cmd, args, opts.meta);
    const error = { code: 'hors_ligne', message: 'Vous êtes hors ligne : rien n’a été envoyé. Réessayez après reconnexion.' };
    if (!opts.silent) toast(error.message, true);
    return { ok: false, error };
  }
  const r = await api.exec(token, cmd, args, opts);
  if (!r.ok && !opts.silent) toast(r.error.message, true);
  return r;
}

// File locale de l'application terrain : une clé unique par action, rejouée une seule fois (TE-07).
// La file appartient au personnage (espace + utilisateur), pas à l'onglet : fermer l'onglet ne perd rien.
const qKey = token => { try { const s = api.session(token); return 'fw:queue:' + s.wsId + ':' + s.userId; } catch { return 'fw:queue:' + token; } };
export const readQueue = token => { try { return JSON.parse(storage.get(qKey(token)) || '[]'); } catch { return []; } };
const writeQueue = (token, q) => { try { storage.set(qKey(token), JSON.stringify(q)); } catch {} emitLocal(); };
function enqueue(token, cmd, args, meta = {}) {
  const q = readQueue(token);
  const item = { id: 'act_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), cmd, args, at: Date.now(), status: 'en attente de réseau', ...meta };
  q.push(item); writeQueue(token, q);
  toast('Hors ligne : action gardée sur le téléphone. Elle partira au retour du réseau.');
  return { ok: true, queued: true, data: null };
}
const replaying = new Set();
export async function replay(token, { quiet = false } = {}) {
  if (!token || !isOnline(token) || replaying.has(token)) return;
  const q = readQueue(token);
  if (!q.some(it => isWaitingStatus(it.status))) { if (!quiet) toast('Rien à synchroniser.'); return; }
  replaying.add(token);
  try { await replayNow(token, q); } finally { replaying.delete(token); }
}
const isWaitingStatus = s => s === 'en attente de réseau' || s === 'à réessayer';
async function replayNow(token, q) {
  let changed = false, busy = null;
  for (const it of q) {
    if (it.status !== 'en attente de réseau' && it.status !== 'à réessayer') continue;
    const r = await api.exec(token, it.cmd, it.args, { idemKey: it.id });
    // Un autre onglet garde encore des actions sur cet espace : rien n'est refusé, on réessaiera plus tard, dans l'ordre.
    if (!r.ok && r.error && r.error.code === 'occupe') { busy = r.error.message; break; }
    changed = true;
    if (r.ok) { it.status = r.replayed ? 'déjà synchronisé (aucun doublon)' : 'synchronisé'; it.syncedAt = Date.now(); }
    else { it.status = 'refusé'; it.error = r.error.message; it.code = r.error.code; }
    // Les actions suivantes dépendent de la nouvelle version : on les recale.
    // Uniquement pour la même mission : une autre mission a sa propre version.
    if (r.ok && it.args.expectedVersion != null) for (const nx of q) if (nx !== it && nx.status === 'en attente de réseau' && nx.args.woId === it.args.woId && nx.args.expectedVersion === it.args.expectedVersion) nx.args.expectedVersion = it.args.expectedVersion + 1;
  }
  if (changed) writeQueue(token, q);
  const refused = q.filter(x => x.status === 'refusé').length;
  if (busy) toast(busy, true);
  else if (changed) toast(refused ? refused + ' action(s) refusée(s) : voir les brouillons.' : 'Synchronisation terminée.', !!refused);
}
export function updateQueue(token, fn) { const q = fn(readQueue(token)); writeQueue(token, q); }
// À l'ouverture de l'application terrain (nouvel onglet, rechargement) : ce qui attendait part tout seul.
const watched = new Set();
export function watchQueue(token) { if (!token || watched.has(token)) return; watched.add(token); setTimeout(() => replay(token, { quiet: true }), 600); }

// ---------- Toasts ----------
const toastL = new Set();
export function toast(msg, err = false) { for (const l of toastL) l({ id: Math.random(), msg, err }); }
export function useToasts() {
  const [list, setList] = React.useState([]);
  React.useEffect(() => { const f = t => { setList(l => [...l.slice(-3), t]); setTimeout(() => setList(l => l.filter(x => x.id !== t.id)), 5200); }; toastL.add(f); return () => toastL.delete(f); }, []);
  return list;
}

// ---------- Sessions de l'onglet ----------
// Le propriétaire d'un espace de démo obtient une session par personnage (CDC 7.3 : changement de rôle
// possible dans son espace démo uniquement). Les sessions sont gardées dans l'onglet.
export function tokenFor(ownerToken, userId) {
  if (!ownerToken) return null;
  let s; try { s = api.session(ownerToken); } catch { return null; }
  const key = 'fw:tok:' + s.wsId;
  const map = tabGet(key, {});
  if (map[userId]) { try { const x = api.session(map[userId]); if (x.userId === userId) return map[userId]; } catch {} }
  try { const t = api.switchUser(ownerToken, userId); map[userId] = t; tabSet(key, map); return t; } catch { return null; }
}

export function fileToThumb(file, max = 220) {
  return new Promise(resolve => {
    if (!file.type.startsWith('image/')) return resolve(null);
    const r = new FileReader();
    r.onload = () => { const img = new Image(); img.onload = () => { try { const k = Math.min(1, max / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); resolve(c.toDataURL('image/jpeg', 0.7)); } catch { resolve(null); } }; img.onerror = () => resolve(null); img.src = r.result; };
    r.onerror = () => resolve(null);
    r.readAsDataURL(file);
  });
}

// ---------- Photothèque de l'espace (pièces et photos de chantier) ----------
// Une photo de téléphone pèse souvent 3 à 8 Mo : on l'allège avant l'envoi (1 280 px, JPEG), comme le ferait
// une vraie application, et on garde une vignette minuscule dans le dossier. L'image elle-même est rangée à part :
// dans ce navigateur (IndexedDB) et sur le serveur de partage (tout de suite, ou après l'envoi suivant si le partage
// est coupé : cloud.js la garde dans sa file).
export function prepareImage(file) {
  return new Promise(resolve => {
    if (!file || !file.type || !file.type.startsWith('image/')) return resolve(null);
    const r = new FileReader();
    r.onload = () => {
      const img = new Image();
      img.onload = () => {
        try {
          const draw = (max, q) => { const k = Math.min(1, max / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k)); const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height); return c.toDataURL('image/jpeg', q); };
          let full = draw(1280, 0.72);
          if (full.length > 230000) full = draw(1024, 0.62);
          if (full.length > 230000) full = draw(800, 0.55);
          resolve({ full, thumb: draw(72, 0.55), width: img.width, height: img.height, bytes: Math.round(full.length * 0.75), quality: measure(img) });
        } catch { resolve(null); }
      };
      img.onerror = () => resolve(null);
      img.src = r.result;
    };
    r.onerror = () => resolve(null);
    r.readAsDataURL(file);
  });
}
// Mesures simples d'une photo, faites sur le téléphone : taille, lumière moyenne (0 à 255) et netteté (0 à 100,
// d'après les contours : une photo floue a des contours doux). Le serveur en tire « floue », « trop sombre »…
export function measure(img) {
  try {
    const k = Math.min(1, 320 / Math.max(img.width, img.height));
    const w = Math.max(3, Math.round(img.width * k)), h = Math.max(3, Math.round(img.height * k));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h).data;
    const y = new Float32Array(w * h); let sum = 0;
    for (let i = 0; i < w * h; i++) { const v = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]; y[i] = v; sum += v; }
    let n = 0, m = 0, m2 = 0;
    for (let r = 1; r < h - 1; r++) for (let x = 1; x < w - 1; x++) { const i = r * w + x; const l = 4 * y[i] - y[i - 1] - y[i + 1] - y[i - w] - y[i + w]; n++; m += l; m2 += l * l; }
    const v = n ? m2 / n - (m / n) * (m / n) : 0;
    return { w: img.width, h: img.height, bright: Math.round(sum / (w * h)), sharp: Math.round(Math.min(100, Math.sqrt(Math.max(0, v)) * 2)) };
  } catch { return null; }
}
// Mêmes règles que le serveur (domain.js, photoCheck), pour prévenir le client avant l'envoi.
export function photoIssues(q) {
  if (!q) return [];
  const out = [];
  if (Math.min(q.w, q.h) < 480) out.push('trop petite');
  if (q.bright < 55) out.push('trop sombre'); else if (q.bright > 235) out.push('trop claire (reflet)');
  if (q.sharp < 12) out.push('floue');
  return out;
}

// Heure de l'espace « maintenant » : l'horloge simulée avance au rythme réel entre deux écritures.
export const liveClock = ws => (ws ? ws.clock + Math.max(0, Date.now() - (ws.lastReal || Date.now())) : Date.now());
// Re-rendu régulier (compte à rebours, trajet du technicien, durée d'un appel).
export function useNow(ms = 1000) {
  const [n, setN] = React.useState(() => Date.now());
  React.useEffect(() => { const i = setInterval(() => setN(Date.now()), ms); return () => clearInterval(i); }, [ms]);
  return n;
}

const imgMem = new Map();
let idbP = null;
function idb() {
  if (idbP) return idbP;
  idbP = new Promise(res => { try { const r = indexedDB.open('fibre-welcome-img', 1); r.onupgradeneeded = () => r.result.createObjectStore('img'); r.onsuccess = () => res(r.result); r.onerror = () => res(null); r.onblocked = () => res(null); } catch { res(null); } });
  return idbP;
}
async function idbDo(mode, fn) { const d = await idb(); if (!d) return null; return new Promise(res => { try { const t = d.transaction('img', mode); const q = fn(t.objectStore('img')); t.oncomplete = () => res(q && 'result' in q ? q.result : null); t.onerror = () => res(null); t.onabort = () => res(null); } catch { res(null); } }); }
const newImgId = () => { const a = 'abcdefghijkmnpqrstuvwxyz23456789'; const b = new Uint8Array(16); (globalThis.crypto || {}).getRandomValues ? crypto.getRandomValues(b) : b.forEach((_, i) => { b[i] = Math.random() * 256; }); return 'img_' + [...b].map(x => a[x % a.length]).join(''); };
export async function putImage(wsId, dataUrl) {
  const id = newImgId();
  imgMem.set(id, dataUrl);
  await idbDo('readwrite', st => st.put(dataUrl, wsId + ':' + id));
  try { await cloud.putImage(wsId, id, dataUrl); } catch {}
  return id;
}
// Image gardée dans ce navigateur seulement (pour l'envoyer plus tard).
export async function localImage(wsId, id) {
  if (imgMem.has(id)) return imgMem.get(id);
  return (await idbDo('readonly', st => st.get(wsId + ':' + id))) || null;
}
export async function getImage(wsId, id) {
  if (imgMem.has(id)) return imgMem.get(id);
  let v = await idbDo('readonly', st => st.get(wsId + ':' + id));
  if (!v && cloud.isShared(wsId)) { v = await cloud.getImage(wsId, id); if (v) idbDo('readwrite', st => st.put(v, wsId + ':' + id)); }
  if (v) imgMem.set(id, v);
  return v || null;
}
// Image d'une pièce ou d'une photo, après contrôle des droits par le serveur simulé.
export function useImage(token, img) {
  const [st, setSt] = React.useState({ src: img ? imgMem.get(img) || null : null, loading: !!img, denied: false });
  const tick = useTick();
  const [again, setAgain] = React.useState(0);
  const tries = React.useRef({ img: null, n: 0 });
  React.useEffect(() => {
    if (!img || !token) { setSt({ src: null, loading: false, denied: false }); return; }
    let ok = false, wsId = null;
    try { ok = api.q(token, 'image.allowed', { img }); wsId = api.session(token).wsId; } catch {}
    if (!ok) { setSt({ src: null, loading: false, denied: true }); return; }
    if (imgMem.has(img)) { setSt({ src: imgMem.get(img), loading: false, denied: false }); return; }
    if (tries.current.img !== img) tries.current = { img, n: 0 };
    let live = true, t = null;
    if (!tries.current.n) setSt(x => ({ ...x, loading: true }));
    getImage(wsId, img).then(src => {
      if (!live) return;
      setSt({ src, loading: false, denied: false, missing: !src });
      // Espace partagé : la photo peut arriver après le dossier (l'autre appareil l'envoie juste après). On la redemande
      // toutes les 3 s pendant une minute, puis toutes les 15 s pendant dix minutes.
      const n = ++tries.current.n;
      if (!src && n <= 60 && cloud.isShared(wsId)) t = setTimeout(() => { if (live) setAgain(x => x + 1); }, n <= 20 ? 3000 : 15000);
    });
    return () => { live = false; if (t) clearTimeout(t); };
  }, [token, img, src_retry(tick, img), again]);
  return st;
}
// Une image absente (partage en cours d'envoi depuis l'autre appareil) est redemandée au fil des mises à jour.
const src_retry = (tick, img) => (img && !imgMem.has(img) ? tick : 0);
