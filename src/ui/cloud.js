// Partage entre appareils.
// Deux façons de partager, avec les mêmes gestes (doc.get, set, acquire, onSnapshot) :
// - dans l'aperçu en ligne (claude.ai), la petite base de l'aperçu (capacité « db » des Artifacts), un seul espace commun ;
// - partout ailleurs (lien public, fichier index.html), le serveur de démonstration (server-db.js), par « salle » :
//   un code de 8 lettres, dans le lien (?salle=CODE), que l'on ouvre sur un autre appareil ou que l'on scanne en QR.
// L'espace de test y est recopié : les appareils de la même salle voient le même espace, les mêmes dossiers et les mêmes pièces.
// Chaque action relit la dernière version, s'applique, puis renvoie le nouvel état. Sur le serveur, l'envoi n'est accepté
// que si personne n'a écrit entre-temps (sinon on relit et on rejoue l'action). Les autres appareils reçoivent la nouvelle
// version en quelques secondes. Sans réseau, rien ne bloque : tout continue dans ce navigateur et repart à la reconnexion.
// Pour chaque espace, ce navigateur garde la version commune sur laquelle il s'appuie (« base ») : une copie locale
// différente de sa base contient une action pas encore envoyée. Les actions pas encore envoyées sont gardées par l'onglet
// qui les a faites (il les rejoue si un autre appareil a écrit entre-temps) ; les autres onglets le laissent faire.
// Les photos et sauvegardes faites sans partage attendent dans une file (fw:upq) et partent après l'envoi suivant.
import { serverDb } from './server-db.js';
import { SERVER } from './server-config.js';
import { gzipSync, gunzipSync, strToU8, strFromU8 } from './vendor/fflate.js';

const K = { ws: id => 'fw:ws:' + id, v: id => 'fw:wsv:' + id, n: id => 'fw:wsn:' + id, bk: (id, n) => 'fw:bk:' + id + ':' + n, base: id => 'fw:wsbase:' + id, room: id => 'fw:wsroom:' + id, own: id => 'fw:wsown:' + id, q: id => 'fw:upq:' + id, dev: 'fw:dev' };
const P = { ptr: () => (cloudState.mode === 'server' ? 'fw/room/' + cloudState.room : 'fw/shared'), ws: id => 'fwws/' + id, lock: id => 'fwws/' + id + '/lock/main', img: (id, i) => 'fwws/' + id + '/img/' + i, bk: (id, n) => 'fwws/' + id + '/bk/' + (n % 10) };
const MAX_DOC = 240000, MAX_JSON = 6e6, MAX_UNSENT = 200;
// Un onglet qui garde des actions pas encore envoyées le signale toutes les 5 s ; sans signal depuis 2 min, il est
// considéré fermé (un onglet en arrière-plan peut n'être réveillé qu'une fois par minute par le navigateur).
const BEAT = 5000, LIVE = 120000;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rid = (n = 10) => { const a = 'abcdefghijkmnpqrstuvwxyz23456789'; const b = new Uint8Array(n); try { crypto.getRandomValues(b); } catch { for (let i = 0; i < n; i++) b[i] = Math.random() * 256; } let s = ''; for (const x of b) s += a[x % a.length]; return s; };
const holder = 'tab_' + rid(8);

// status : off (pas d'aperçu en ligne), connecting, on, local (lecture seule ou indisponible)
// mode : artifact (aperçu en ligne) ou server (serveur de démonstration) ; room : code de la salle (mode server).
// msgKind : offline (réseau coupé), refused (le serveur refuse l'envoi), big (espace trop gros), busy (écritures croisées).
export const cloudState = { status: 'off', mode: null, room: null, wsId: null, message: '', msgKind: '', lastSync: 0, pending: false };
const listeners = new Set();
const emit = () => { for (const l of listeners) { try { l(cloudState); } catch {} } };
const set = patch => { Object.assign(cloudState, patch); emit(); };

let db = null, deps = null, unsubWs = null, unsubPtr = null, inTx = 0, pendingPtr = null, fetchingBk = 0, halted = false;
// Actions faites dans cet onglet et pas encore envoyées, dans l'ordre : { fn, from, v, r, live } (version avant et après ;
// live : action en cours, dont le résultat est attendu). Elles sont rejouées sur la version commune si un autre appareil
// a écrit entre-temps.
const unsent = new Map();
const OFFLINE_MSG = 'Connexion instable : la dernière action est gardée sur cet appareil et partira dès que le réseau revient.';
const FORK_MSG = 'Une action faite sans réseau sur cet appareil n’a pas pu être rejouée : un autre appareil avait modifié l’espace entre-temps. Refaites-la si besoin.';
const BUSY_MSG = 'Plusieurs appareils écrivent en même temps : votre action est gardée sur cet appareil et repartira dans un instant.';
const BIG_MSG = 'Espace trop volumineux pour être partagé (trop d’historique) : vos actions restent sur cet appareil. Réinitialisez-le dans le Labo.';
const TAB_MSG = 'Un autre onglet de ce navigateur a une action pas encore envoyée : la vôtre n’a pas été enregistrée. Continuez dans cet onglet-là, ou réessayez dans un instant.';
const RESET_MSG = 'L’espace vient d’être réinitialisé depuis un autre appareil : votre action n’a pas été enregistrée. Refaites-la si besoin.';
const RESET_LOST_MSG = 'L’espace a été réinitialisé depuis un autre appareil : les actions faites ici sans réseau ne s’y appliquent plus.';
const DROP_MSG = 'Suppression impossible pour le moment (serveur injoignable) : rien n’a été effacé. Réessayez dans un instant.';
const err = (code, message) => Object.assign(new Error(message), { code });

// ---------- Compression (l'état tient alors dans un seul document) ----------
function b64(bytes) { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); }
function unb64(s) { const bin = atob(s); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
const tooBig = () => err('invalide', 'Données reçues trop volumineuses.');
async function pack(str) {
  if (typeof CompressionStream === 'function') {
    try { const buf = await new Response(new Blob([str]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer(); return { enc: 'gz64', z: b64(new Uint8Array(buf)) }; } catch {}
  }
  try { return { enc: 'gz64', z: b64(gzipSync(strToU8(str))) }; } catch {}
  return { enc: 'json', z: str };
}
// Décompression avec une taille maximale : un document piégé ne peut pas saturer la mémoire du navigateur.
async function unpack(d) {
  if (d.enc !== 'gz64') { const s = String(d.z || ''); if (s.length > MAX_JSON) throw tooBig(); return s; }
  const bytes = unb64(String(d.z || ''));
  if (typeof DecompressionStream === 'function') {
    const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
    const parts = []; let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_JSON) { try { reader.cancel(); } catch {} throw tooBig(); }
      parts.push(value);
    }
    const all = new Uint8Array(total); let o = 0; for (const p of parts) { all.set(p, o); o += p.length; }
    return new TextDecoder().decode(all);
  }
  // Navigateurs plus anciens (Safari avant 16.4, Firefox avant 113) : décompression en JavaScript.
  const n = bytes.length;
  const size = n >= 4 ? (bytes[n - 4] | (bytes[n - 3] << 8) | (bytes[n - 2] << 16) | (bytes[n - 1] << 24)) >>> 0 : 0;
  if (size > MAX_JSON) throw tooBig();
  return strFromU8(gunzipSync(bytes));
}
// Un état reçu d'ailleurs ne doit pas pouvoir toucher aux objets de base du navigateur.
const unsafe = json => /"__proto__"\s*:/.test(json);
// Accusés de réception d'un document : pour chaque navigateur qui a écrit, son dernier envoi contenu dans ce document
// ([navigateur, envoi], le plus récent d'abord, 30 navigateurs au plus). Un navigateur dont la réponse s'est perdue y
// retrouve son envoi, même si d'autres appareils ont écrit par-dessus de nombreuses fois.
const MAX_ACKS = 30;
const cleanAcks = a => (Array.isArray(a) ? a.filter(x => Array.isArray(x) && x.length === 2 && typeof x[0] === 'string' && typeof x[1] === 'string' && x[0].length <= 20 && x[1].length <= 20).slice(0, MAX_ACKS) : []);
// Identifiant de ce navigateur (commun à ses onglets, qui partagent la base et la liste des envois en cours).
function dev() {
  let d = deps.storage.get(K.dev);
  if (!d || !/^[a-z0-9]{8,20}$/.test(d)) { d = rid(12); try { deps.storage.set(K.dev, d); } catch {} }
  return d;
}

// ---------- Version locale et base commune ----------
const localV = id => { const v = deps.storage.get(K.v(id)); return v == null ? -1 : Number(v); };
const localGen = id => { try { const raw = deps.storage.get(K.ws(id)); return raw ? JSON.parse(raw).generation : null; } catch { return null; } };
const getBase = id => { try { return JSON.parse(deps.storage.get(K.base(id)) || 'null'); } catch { return null; } };
const setBase = (id, b) => { try { deps.storage.set(K.base(id), JSON.stringify(b)); } catch {} };
// Une action locale pas encore envoyée : la copie locale n'est plus celle de la base.
const isDirty = id => { const v = localV(id); if (v < 0) return false; const b = getBase(id); return !b || v !== b.v; };
const roomOf = id => deps.storage.get(K.room(id)) || null;
// Ce navigateur peut envoyer cet espace : connecté, et l'espace est celui suivi ou a déjà été partagé (base connue).
const canSend = id => !!db && !halted && !!deps && cloudState.status === 'on' && !!id && (id === cloudState.wsId || !!getBase(id));
// Remplace la copie locale. Le numéro aléatoire (fw:wsn) prévient les autres onglets, même si la version garde le même numéro.
function writeLocal(id, json, v) { deps.forget(id); deps.storage.set(K.ws(id), json); deps.storage.set(K.v(id), String(v)); deps.storage.set(K.n(id), rid(8)); }

// ---------- Onglet qui garde les actions pas encore envoyées ----------
const ownerOf = id => { try { return JSON.parse(deps.storage.get(K.own(id)) || 'null'); } catch { return null; } };
const ownedElsewhere = id => { const o = ownerOf(id); return !!o && o.tab !== holder && Date.now() - o.at < LIVE; };
// Chaque page garde un verrou du navigateur tant qu'elle vit. Une page fermée de force (onglet tué par le téléphone
// pendant une photo, sans « pagehide ») le perd aussitôt : ses actions gardées ne bloquent plus la page rouverte.
const webLocks = () => (typeof navigator !== 'undefined' && navigator.locks && typeof navigator.locks.query === 'function' ? navigator.locks : null);
function holdTab() { const l = webLocks(); if (l) { try { l.request('fw-tab:' + holder, () => new Promise(() => {})).catch(() => {}); } catch {} } }
async function reap(id) {
  const o = ownerOf(id), l = webLocks();
  if (!o || o.tab === holder || !l) return;
  try {
    const s = await l.query();
    if ((s.held || []).some(x => x.name === 'fw-tab:' + o.tab)) return;
    const now = ownerOf(id);
    if (now && now.tab === o.tab) deps.storage.remove(K.own(id));
  } catch {}
}
function claim(id) { try { deps.storage.set(K.own(id), JSON.stringify({ tab: holder, at: Date.now() })); } catch {} }
function release(id) { const o = ownerOf(id); if (o && o.tab === holder) deps.storage.remove(K.own(id)); }
let beatT = null;
function beat() {
  if (beatT || halted) return;
  beatT = setTimeout(() => {
    beatT = null;
    let any = false;
    for (const id of [...unsent.keys()]) {
      // Espace supprimé entre-temps (sa base a disparu) : plus rien à envoyer.
      if (!getBase(id)) { unsent.delete(id); release(id); continue; }
      trimStale(id);
      if (!unsent.has(id)) continue;
      any = true;
      if (!ownedElsewhere(id)) claim(id);
    }
    if (any) beat();
  }, BEAT);
}
// Note une action qui vient de changer la copie locale. Si la chaîne est rompue (changement fait ailleurs entre-temps),
// les actions plus anciennes ne peuvent plus être rejouées seules : on repart de celle-ci.
// clean : la copie était celle de la base avant l'action. Les actions qu'un autre onglet garderait encore sont alors déjà
// dans la version commune : cet onglet devient celui qui garde les actions de l'espace.
function record(id, item, clean) {
  trimStale(id);
  let u = unsent.get(id);
  if (!u || !u.items.length || u.items[u.items.length - 1].v !== item.from || u.items.length >= MAX_UNSENT) u = { items: [] };
  u.items.push(item);
  unsent.set(id, u);
  if (clean || !ownedElsewhere(id)) claim(id);
  beat();
}
// Les actions déjà contenues dans la version commune (jusqu'à la version v) ne sont plus à envoyer. Sans action à
// garder, l'onglet laisse la main aux autres.
function trimUnsent(id, v) {
  const u = unsent.get(id);
  if (u) { u.items = u.items.filter(it => it.v > v); if (!u.items.length) unsent.delete(id); }
  if (!unsent.has(id)) release(id);
}
// Les versions ne font que monter : une action dont la version est déjà atteinte par la base y est contenue
// (envoyée depuis un autre onglet), ou a déjà été signalée perdue par l'onglet qui a reçu la nouvelle version.
function trimStale(id) { const b = getBase(id); if (b && unsent.has(id)) trimUnsent(id, b.v); }
function forgetWs(id) {
  unsent.delete(id); release(id);
  deps.storage.remove(K.base(id)); deps.storage.remove(K.room(id)); deps.storage.remove(K.q(id));
}
// Nouvelle génération (réinitialisation) : les sauvegardes de l'ancienne ne valent plus.
function clearBackups(id) {
  for (const k of deps.storage.keys()) if (k.startsWith('fw:bk:' + id + ':')) deps.storage.remove(k);
  writeQ(id, readQ(id).filter(e => e.k !== 'bk'));
}

// Avant de rejouer les actions pas encore envoyées sur une version reçue : les sauvegardes que ces actions avaient faites
// ici (absentes de la version reçue, ou différentes sous le même numéro) sont oubliées. Rejouées, elles se refont sous
// leur nouveau numéro ; jamais une ancienne copie n'écrase la sauvegarde d'un autre appareil.
function dropUnsentBackups(wsId, json) {
  let mine = [], theirs = [];
  try { mine = (JSON.parse(deps.storage.get(K.ws(wsId)) || '{}').backups) || []; theirs = (JSON.parse(json).backups) || []; } catch { return; }
  const same = new Set(theirs.map(b => JSON.stringify(b)));
  const drop = mine.filter(b => b && !same.has(JSON.stringify(b))).map(b => b.n);
  if (!drop.length) return;
  for (const n of drop) deps.storage.remove(K.bk(wsId, n));
  writeQ(wsId, readQ(wsId).filter(e => !(e.k === 'bk' && drop.includes(e.n))));
}

// ---------- File des photos et sauvegardes à envoyer ----------
// Gardée dans le navigateur (commune aux onglets, elle survit à un rechargement) : { k: 'img', id, gen } ou { k: 'bk', n }.
const MAX_Q = 100;
const readQ = id => { try { const q = JSON.parse(deps.storage.get(K.q(id)) || '[]'); return Array.isArray(q) ? q.filter(e => e && (e.k === 'img' || e.k === 'bk')) : []; } catch { return []; } };
function writeQ(id, q) { try { if (q.length) deps.storage.set(K.q(id), JSON.stringify(q.slice(-MAX_Q))); else deps.storage.remove(K.q(id)); } catch {} }
const qKey = e => e.k + ':' + (e.k === 'bk' ? e.n : e.id);
function enqueue(id, e) { writeQ(id, [...readQ(id).filter(x => qKey(x) !== qKey(e)), e]); }

// Applique l'état reçu du serveur. Réponses : absent, deleted, same (rien de nouveau), invalid, deferred (un autre onglet
// garde des actions à rejouer : il s'en occupe), updated.
async function applyRemote(wsId, snap) {
  await reap(wsId);
  const d = snap && snap.exists ? snap.data() : null;
  const base = localV(wsId) >= 0 ? getBase(wsId) : null;
  trimStale(wsId);
  if (!d) {
    // Document effacé sur le serveur (nettoyage d'un espace inactif) : le prochain envoi le recrée.
    if (base && base.rev != null) setBase(wsId, { ...base, rev: null, pend: [] });
    return 'absent';
  }
  if (d.deleted) { forgetWs(wsId); deps.onDeleted(wsId); return 'deleted'; }
  const rev = snap.rev != null ? Number(snap.rev) : null;
  const acks = cleanAcks(d.acks);
  const pend = (base && base.pend) || [];
  if (base) {
    const own = d.sid && pend.find(p => p.sid === d.sid);
    if (own) {
      // Notre propre envoi, dont la réponse s'était perdue en route.
      const purge = base.gen != null && d.gen !== base.gen ? d.gen : base.purge ?? null;
      setBase(wsId, { sid: d.sid, acks, rev, v: Number(d.v), gen: d.gen, pend: [], purge });
      trimUnsent(wsId, Number(d.v));
      return 'same';
    }
    if (d.sid ? d.sid === base.sid : !base.sid && Number(d.v) === base.v) { if (rev != null && (base.rev == null || rev > base.rev)) setBase(wsId, { ...base, rev }); return 'same'; }
    if (rev == null ? Number(d.v) < base.v : base.rev != null && rev <= base.rev) return 'same';
  }
  // Un appareil a pu partir de notre envoi (réponse perdue) avant d'écrire : les actions jusque-là sont déjà dedans.
  let start = base ? base.v : -1;
  const mine = acks.find(a => a[0] === dev());
  const hit = mine && pend.find(p => p.sid === mine[1]);
  if (hit) { start = hit.v; trimUnsent(wsId, start); }
  const vBefore = localV(wsId);
  const ahead = !!base && vBefore >= 0 && vBefore !== start;
  if (ahead && ownedElsewhere(wsId)) return 'deferred';
  const json = await unpack(d);
  if (unsafe(json)) return 'invalid';
  const genBefore = localGen(wsId);
  // Un autre appareil a réinitialisé l'espace depuis notre version commune : nos actions d'avant ne s'appliquent plus.
  // Une réinitialisation faite ici est rejouée comme les autres actions ; si elle est déjà dans la version reçue (réponse
  // perdue), la génération de référence est celle de notre envoi.
  const fromGen = hit && hit.gen !== undefined ? hit.gen : base ? base.gen : null;
  const resetElsewhere = !!base && fromGen != null && d.gen !== fromGen;
  // Nouvelle génération reçue : ce navigateur aussi fera le ménage de l'ancienne (le serveur ne l'accepte que si l'espace
  // est toujours à cette génération). Un ménage en attente qui vaut encore est gardé.
  const purge = base && base.gen != null && d.gen !== base.gen ? d.gen : base && base.purge != null && base.purge === d.gen ? base.purge : null;
  const u = unsent.get(wsId);
  const items = u ? u.items : [];
  if (ahead) dropUnsentBackups(wsId, json);
  writeLocal(wsId, json, d.v);
  setBase(wsId, { sid: d.sid || null, acks, rev, v: Number(d.v), gen: d.gen, pend: [], purge });
  set({ lastSync: Date.now() });
  // Copie locale en avance (actions faites sans réseau) : on rejoue ces actions, dans l'ordre, sur la version reçue.
  // Un changement de la copie qui n'est pas dans la liste (page rechargée entre-temps) est perdu : on prévient.
  let lost = false;
  if (ahead) {
    if (!(items.length && items[0].from === start && items[items.length - 1].v === vBefore)) lost = true;
    if (resetElsewhere) {
      for (const it of items) { if (it.live) it.dropped = true; else lost = true; }
      unsent.delete(wsId);
    } else if (items.length) {
      for (const it of items) {
        it.from = localV(wsId);
        let r; try { r = await it.fn(); } catch (e) { if (it.live) it.e = e; r = { ok: false, error: { code: e && e.code, message: e && e.message } }; }
        it.v = localV(wsId); it.r = r;
        if (r && r.ok === false && !it.live) lost = true;
      }
      u.items = items.filter(it => it.v !== it.from);
      if (!u.items.length) unsent.delete(wsId);
    }
  } else unsent.delete(wsId);
  if (!unsent.has(wsId)) release(wsId);
  if (lost) deps.notify(resetElsewhere ? RESET_LOST_MSG : FORK_MSG, true);
  if (resetElsewhere || (genBefore != null && localGen(wsId) !== genBefore)) { clearBackups(wsId); deps.onGeneration(wsId); }
  deps.changed();
  if (purge != null) drain(wsId);
  return 'updated';
}
async function pull(wsId) { return applyRemote(wsId, await db.doc(P.ws(wsId)).get()); }

// Envoie la copie locale si elle contient une action nouvelle. Réponses : clean, pushed, conflict, absent.
// force : écrase l'état commun sans condition (partager un espace). Les sauvegardes et le ménage qui suivent l'envoi
// ne le font jamais passer pour raté : en cas d'échec, ils sont repris plus tard.
async function push(wsId, { force = false } = {}) {
  const json = deps.storage.get(K.ws(wsId)); if (!json) return 'absent';
  if (!force && !isDirty(wsId)) { unsent.delete(wsId); release(wsId); drain(wsId); return 'clean'; }
  const base = getBase(wsId);
  const v = localV(wsId);
  let gen = null; try { gen = JSON.parse(json).generation; } catch {}
  const packed = await pack(json);
  if (packed.z.length > MAX_DOC) throw err('trop_gros', BIG_MSG);
  // On note l'envoi avant de le faire : si la réponse se perd, on reconnaîtra notre propre version. La même version
  // locale renvoyée garde le même numéro d'envoi (son contenu est le même) : la liste ne grossit pas à chaque essai.
  const pend = (base && base.pend) || [];
  const again = pend.length && pend[pend.length - 1].v === v ? pend[pend.length - 1] : null;
  const sid = again ? again.sid : rid(12);
  const acks = [[dev(), sid], ...cleanAcks(base && base.acks).filter(a => a[0] !== dev())].slice(0, MAX_ACKS);
  const recreate = cloudState.mode === 'server' && !!base && base.rev == null;
  if (base && !again) setBase(wsId, { ...base, pend: [...pend, { sid, v, gen }].slice(-MAX_UNSENT) });
  const opts = cloudState.mode === 'server' && !force ? { expected: base && base.rev != null ? base.rev : 0 } : undefined;
  const res = await db.doc(P.ws(wsId)).set({ v, gen, sid, acks, ...packed, at: Date.now(), by: holder }, opts);
  if (res && res.conflict) return 'conflict';
  // Après une réinitialisation, les images et sauvegardes de l'ancienne génération sont à effacer du serveur.
  const purge = base && base.gen != null && gen !== base.gen ? gen : base ? base.purge ?? null : null;
  setBase(wsId, { sid, acks, rev: res && res.rev != null ? res.rev : null, v, gen, pend: [], purge });
  trimUnsent(wsId, v);
  // Espace effacé par le nettoyage puis recréé : son code de salle aussi, s'il est libre.
  if (recreate && roomOf(wsId) === cloudState.room) { try { await db.doc(P.ptr()).set({ wsId, at: Date.now(), by: holder }, { expected: 0 }); } catch {} }
  set({ lastSync: Date.now() });
  drain(wsId);
  return 'pushed';
}
// Après un envoi, en arrière-plan (jamais pendant une action, pour qu'une connexion faible ne la ralentisse pas) :
// effacer les restes d'une ancienne génération, puis envoyer les photos et sauvegardes en attente. Un seul envoi à la fois
// par espace dans tout le navigateur ; en cas d'échec, nouvel essai de plus en plus espacé.
const draining = new Map(), drainT = new Map(), side = new Map();
let sideTries = 0;
function drain(wsId) {
  if (halted || !deps || !wsId) return;
  const cur = draining.get(wsId);
  if (cur) { cur.again = true; return; }
  const job = { again: false };
  draining.set(wsId, job);
  deps.lockLocal('q:' + wsId, () => drainNow(wsId)).then(() => {
    sideTries = 0;
    if (side.delete(wsId) && msgFrom === 'side') showSide();
  }, e => {
    // Le ménage d'une ancienne génération se refait sans rien afficher : seules les photos et sauvegardes en attente
    // sont signalées.
    if (e && e.quiet) { if (side.delete(wsId) && msgFrom === 'side') showSide(); }
    else {
      side.set(wsId, { e, what: (e && e.what) || 'la photo ou la sauvegarde est gardée' });
      if (msgFrom !== 'tx' || !cloudState.message) showSide();
    }
    drainLater(wsId, e);
  }).finally(() => { draining.delete(wsId); if (job.again) drain(wsId); });
}
function drainLater(wsId, e) {
  if (halted) return;
  const steps = kindOf(e) === 'refused' ? [30, 60, 120, 300] : [5, 10, 20, 30];
  const ms = steps[Math.min(sideTries++, steps.length - 1)] * 1000;
  clearTimeout(drainT.get(wsId));
  drainT.set(wsId, setTimeout(() => { drainT.delete(wsId); drain(wsId); }, ms));
}
async function drainNow(wsId) {
  if (!canSend(wsId)) return;
  const b = getBase(wsId);
  // Rien ne part tant que la copie contient des actions pas encore envoyées : rejouées sur une autre version, elles
  // peuvent renuméroter leurs sauvegardes (ou une réinitialisation changer la génération). Le prochain envoi relance la file.
  if (!b || isDirty(wsId) || localGen(wsId) !== b.gen) return;
  let purgeErr = null;
  if (b.purge != null) {
    // Seuls les documents d'une autre génération sont effacés, et seulement si l'espace est toujours à celle-ci.
    if (b.gen !== b.purge) setBase(wsId, { ...b, purge: null });
    else {
      try { if (db.purge) await db.purge(wsId, b.purge); const nb = getBase(wsId); if (nb && nb.purge === b.purge) setBase(wsId, { ...nb, purge: null }); }
      catch (e) { purgeErr = e; }
    }
  }
  await flushQueue(wsId);
  if (purgeErr) throw Object.assign(purgeErr, { quiet: true });
}
// Chaque élément de la file part seul ; un élément d'une ancienne génération, ou disparu de ce navigateur, est oublié.
// Réseau coupé : on s'arrête au premier échec. Refus du serveur pour un élément : les autres partent quand même.
async function flushQueue(wsId) {
  const gen = localGen(wsId);
  let nums = null; try { nums = new Set(((JSON.parse(deps.storage.get(K.ws(wsId)) || '{}').backups) || []).map(b => b.n)); } catch {}
  let first = null;
  for (const e of readQ(wsId)) {
    let path = null, doc = null;
    if (e.k === 'bk') {
      const raw = nums && nums.has(e.n) ? deps.storage.get(K.bk(wsId, e.n)) : null;
      let bgen = null; try { bgen = raw ? JSON.parse(raw).generation : null; } catch {}
      if (raw && bgen === gen) { const p = await pack(raw); if (p.z.length <= MAX_DOC) { path = P.bk(wsId, e.n); doc = { n: e.n, gen, ...p, at: Date.now() }; } }
    } else if (e.gen === gen && deps.loadImage) {
      let data = null; try { data = await deps.loadImage(wsId, e.id); } catch {}
      if (typeof data === 'string' && data.length <= MAX_DOC) { path = P.img(wsId, e.id); doc = { d: data, gen, at: Date.now() }; }
    }
    try { if (path) await db.doc(path).set(doc); }
    catch (x) {
      const what = e.k === 'img' ? 'la photo est gardée' : 'la sauvegarde est gardée';
      if (kindOf(x) === 'offline') throw Object.assign(x, { what });
      if (!first) first = Object.assign(x, { what });
      continue;
    }
    writeQ(wsId, readQ(wsId).filter(x => qKey(x) !== qKey(e)));
  }
  if (first) throw first;
}
// Sauvegardes faites sur un autre appareil : on les rapatrie avant une action (restauration possible partout).
// Seulement celles de la génération en cours : une sauvegarde d'avant une réinitialisation n'est jamais reprise.
async function fetchMissingBackups(wsId) {
  let ws; try { ws = JSON.parse(deps.storage.get(K.ws(wsId)) || 'null'); } catch { return; }
  for (const b of (ws && ws.backups) || []) {
    const key = K.bk(wsId, b.n);
    if (deps.storage.get(key)) continue;
    try {
      const s = await db.doc(P.bk(wsId, b.n)).get();
      if (!s.exists) continue;
      const d = s.data();
      if (Number(d.n) !== Number(b.n) || (d.gen != null && d.gen !== ws.generation)) continue;
      const raw = await unpack(d);
      if (unsafe(raw)) continue;
      const o = JSON.parse(raw);
      if (!o || o.id !== wsId || o.generation !== ws.generation) continue;
      fetchingBk++; try { deps.storage.set(key, raw); } finally { fetchingBk--; }
    } catch {}
  }
}

// Publier un espace. S'il a déjà été partagé (base connue) et qu'il est encore sur le serveur, on part de la dernière
// version commune : ce qu'un autre appareil y a écrit entre-temps est gardé. Sinon on l'y dépose tel quel.
async function publish(wsId) {
  if (getBase(wsId)) {
    for (let i = 0; ; i++) {
      const got = await pull(wsId);
      if (got === 'deleted') return 'absent';
      if (got === 'deferred') throw err('occupe', TAB_MSG);
      if (got === 'absent' || got === 'invalid') break;
      const r = await push(wsId);
      if (r !== 'conflict') return r;
      if (i >= 2) throw err('conflit', BUSY_MSG);
      await sleep(150 + Math.random() * 250);
    }
  }
  return push(wsId, { force: true });
}

// ---------- Ce qui empêche un envoi ----------
const REFUSED = ['invalid_argument', 'not_granted', 'resource_exhausted', 'quota_exceeded', 'revoked', 'capability_disabled', 'capability_removed', 'transform_error'];
// offline : réseau coupé ou serveur momentanément indisponible ; refused : le serveur répond mais refuse.
function kindOf(e) {
  if (e && e.code === 'trop_gros') return 'big';
  if (e && e.code === 'conflit') return 'busy';
  if (e && (REFUSED.includes(e.code) || (e.status >= 400 && e.status < 500))) return 'refused';
  return 'offline';
}
// Raison lisible d'un refus du serveur de démonstration.
function reason(e) {
  const m = String((e && e.message) || '');
  if (/serveur plein|quota/i.test(m)) return 'le serveur de démonstration est plein';
  if (/trop de demandes|resource/i.test(m)) return 'trop d’envois depuis cette connexion';
  if (/espace inconnu/i.test(m)) return 'cet espace n’existe plus sur le serveur';
  if (/fw_docs_size|taille|too large/i.test(m)) return 'données trop volumineuses';
  if (/trop d.images/i.test(m)) return 'trop d’images dans cet espace';
  return 'refus du serveur';
}
let fails = 0, lastKind = null;
// Un envoi n'a pas pu partir : message adapté, puis nouvel essai de plus en plus espacé.
// Message affiché : venu d'une action (tx) ou d'une photo / sauvegarde en attente (side).
let msgFrom = null;
const say = (message, msgKind, from) => { msgFrom = from; set({ message, msgKind }); };
function showSide() {
  const s = [...side.values()][0];
  if (!s) { if (msgFrom === 'side') { msgFrom = null; set({ message: '', msgKind: '' }); } return; }
  const kind = kindOf(s.e) === 'refused' ? 'refused' : 'offline';
  say(kind === 'refused' ? 'Envoi refusé (' + reason(s.e) + ') : ' + s.what + ' sur cet appareil. Nouvel essai dans quelques minutes.'
    : 'Connexion instable : ' + s.what + ' sur cet appareil et partira dès que le réseau revient.', kind, 'side');
}
function problem(wsId, e) {
  const kind = kindOf(e);
  fails++; lastKind = kind;
  const message = kind === 'big' ? BIG_MSG : kind === 'busy' ? BUSY_MSG
    : kind === 'refused' ? 'Envoi refusé (' + reason(e) + ') : la dernière action est gardée sur cet appareil. Nouvel essai dans quelques minutes.'
    : OFFLINE_MSG;
  say(message, kind, 'tx');
  const steps = { offline: [5, 10, 20, 30], busy: [1.5, 3, 6, 12], refused: [30, 60, 120, 300], big: [300] }[kind];
  flushLater(wsId, steps[Math.min(fails - 1, steps.length - 1)] * 1000);
}
function fine() { fails = 0; if (side.size) showSide(); else if (cloudState.message) { msgFrom = null; set({ message: '', msgKind: '' }); } }

// ---------- Bail : en général, un seul appareil écrit à la fois ----------
async function lease(wsId) {
  const ref = db.doc(P.lock(wsId));
  const t0 = Date.now();
  while (Date.now() - t0 < 12000) {
    try {
      const r = await ref.acquire({ holder, ttlMs: 4000 });
      if (r && r.acquired) return true;
      const left = r && r.expiresAt ? Date.parse(r.expiresAt) - Date.now() : 400;
      await sleep(Math.min(1200, Math.max(120, left)) + Math.random() * 120);
    } catch (e) {
      if (e && ['capability_removed', 'capability_disabled', 'invalid_argument', 'transform_error', 'not_granted', 'revoked'].includes(e.code)) return false;
      // Réseau coupé ou trop lent (chaque demande peut attendre 10 s) : on n'insiste pas, l'action partira plus tard.
      return kindOf(e) === 'offline' ? 'offline' : false;
    }
  }
  return false;
}
// Pas de verbe « libérer » : on renouvelle pour 1 s, le bail tombe aussitôt après.
function unlease(wsId) { db.doc(P.lock(wsId)).acquire({ holder, ttlMs: 1000 }).catch(() => {}); }

// Transaction partagée autour d'une écriture du serveur simulé (appelée sous le verrou de l'onglet).
// L'action est notée avant l'envoi : si l'envoi est refusé parce qu'un autre appareil a écrit, la relecture la rejoue
// sur la dernière version (trois essais) ; si le réseau manque, elle part plus tard, sans jamais être faite deux fois.
// bg : envoi en arrière-plan (flushLater), pas une action de l'utilisateur.
async function tx(wsId, fn, bg = false) {
  // La dernière demande au serveur n'a pas abouti (réseau coupé ou très lent) : l'action est faite et gardée tout de
  // suite, sans attendre le serveur ; un envoi en arrière-plan l'emporte dans les 15 s au plus.
  if (!bg && fails > 0 && lastKind === 'offline' && getBase(wsId)) { const r = await local(wsId, fn); flushLater(wsId, 15000); return r; }
  inTx++;
  set({ pending: true });
  let leased = false;
  const item = { fn, from: 0, v: 0, r: undefined, live: true };
  // Résultat de l'action : celui de son dernier passage (elle a pu être rejouée sur une version plus récente).
  const result = () => { if (item.dropped) throw err('conflit', RESET_MSG); if (item.e) throw item.e; return item.r; };
  try {
    const got = await lease(wsId);
    leased = got === true;
    // Le serveur ne répond pas : ni lecture ni envoi (encore 10 s chacun), l'action est gardée ici.
    const cut = got === 'offline';
    for (let attempt = 0; ; attempt++) {
      let pulled = null, offline = cut;
      if (!cut) { try { pulled = await pull(wsId); if (attempt === 0) await fetchMissingBackups(wsId); } catch { offline = true; } }
      if (pulled === 'deleted') { lostFollowed(wsId); throw err('session', 'Cet espace a été supprimé depuis un autre appareil.'); }
      // Un autre onglet garde des actions à rejouer : on ne mélange pas les siennes et les nôtres.
      if (pulled === 'deferred') throw err('occupe', TAB_MSG);
      if (item.dropped) return result();
      if (attempt === 0) {
        // La copie contient des actions qu'un autre onglet n'a pas pu envoyer. Si personne n'a écrit entre-temps, on les
        // envoie telles quelles d'abord ; sinon (ou sans réseau) c'est à cet onglet-là de les rejouer.
        if (isDirty(wsId)) await reap(wsId);
        if (isDirty(wsId) && ownedElsewhere(wsId)) {
          let r = null;
          if (!offline) { try { r = await push(wsId); } catch {} }
          if (r !== 'pushed') throw err('occupe', TAB_MSG);
        }
        const clean = !isDirty(wsId);
        item.from = localV(wsId);
        item.r = await fn();
        item.v = localV(wsId);
        if (item.v !== item.from) record(wsId, item, clean);
      }
      let res;
      try { if (cut) throw err('hors_ligne', OFFLINE_MSG); res = await push(wsId); }
      catch (e) { problem(wsId, e); return result(); }
      if (res !== 'conflict') { fine(); return result(); }
      if (attempt >= 2) { problem(wsId, err('conflit', BUSY_MSG)); return result(); }
      await sleep(150 + Math.random() * 250);
    }
  } finally {
    item.live = false;
    if (leased) unlease(wsId);
    inTx--;
    if (!inTx) {
      set({ pending: false });
      // Un changement de salle arrivé pendant l'écriture est traité maintenant.
      if (pendingPtr) { const p = pendingPtr; pendingPtr = null; setTimeout(() => onPointer(p), 0); }
    }
  }
}
// Action faite pendant que le partage est coupé (page ouverte sans réseau, serveur injoignable) sur un espace déjà
// partagé : elle est notée pour être rejouée au retour, si un autre appareil a écrit entre-temps.
// Comme dans tx, un onglet n'ajoute jamais ses actions à celles qu'un autre onglet garde encore.
async function local(wsId, fn) {
  if (!deps || halted || !getBase(wsId)) return fn();
  if (isDirty(wsId)) await reap(wsId);
  if (isDirty(wsId) && ownedElsewhere(wsId)) throw err('occupe', TAB_MSG);
  const clean = !isDirty(wsId);
  const item = { fn, from: localV(wsId), v: 0, r: undefined, live: false };
  item.r = await fn();
  item.v = localV(wsId);
  if (item.v !== item.from) record(wsId, item, clean);
  return item.r;
}

// Envoi en attente (réseau coupé, refus, onglet occupé) : on réessaie seul, sans attendre la prochaine action.
// Un minuteur par espace : un onglet peut garder des actions sur un espace qu'il ne suit pas (ouvert depuis le Labo).
const flushT = new Map();
let tabTries = 0;
function flushLater(wsId, ms = 5000) {
  if (halted || !wsId) return;
  const at = Date.now() + ms, cur = flushT.get(wsId);
  if (cur) { if (at >= cur.at) return; clearTimeout(cur.t); }
  const t = setTimeout(() => {
    flushT.delete(wsId);
    if (!canSend(wsId)) return;
    if (!isDirty(wsId) && !(cloudState.message && msgFrom === 'tx')) return;
    deps.lockLocal(wsId, () => tx(wsId, () => null, true)).then(() => { tabTries = 0; }, e => {
      if (e && e.code === 'occupe') flushLater(wsId, Math.min(60000, 10000 * 2 ** tabTries++));
    });
  }, ms);
  flushT.set(wsId, { t, at });
}
// Retour du partage : tout ce que cet onglet garde encore repart (y compris sur un espace qu'il ne suit pas).
function resume() {
  for (const id of unsent.keys()) flushLater(id, 0);
  // Copie suivie en avance sans action notée ici (page rechargée avant l'envoi) : elle part aussi.
  if (cloudState.wsId && isDirty(cloudState.wsId)) flushLater(cloudState.wsId, 0);
  for (const id of side.keys()) drain(id);
  if (cloudState.wsId) drain(cloudState.wsId);
}
// L'espace suivi a été supprimé ailleurs : on ne le suit plus. Le plus souvent, l'appareil qui l'a supprimé partage
// aussitôt un nouvel espace (et on le suit) ; sinon, ce navigateur repartage le sien après quelques secondes.
function lostFollowed(wsId) {
  if (cloudState.wsId !== wsId) return;
  if (unsubWs) { try { unsubWs(); } catch {} unsubWs = null; }
  set({ wsId: null });
  setTimeout(rejoin, 4000 + Math.random() * 3000);
}
async function rejoin() {
  if (halted || !db || cloudState.wsId || cloudState.status !== 'on') return;
  set({ status: 'connecting' });
  const ep = roomEpoch;
  try { await connect(); } catch (e) { if (ep === roomEpoch) unreachable(e); }
}

function subscribe(wsId) {
  if (unsubWs) { try { unsubWs(); } catch {} unsubWs = null; }
  unsubWs = db.doc(P.ws(wsId)).onSnapshot(snap => {
    if (!snap.exists || (snap.metadata && snap.metadata.hasPendingWrites)) return;
    // Sous le verrou de l'onglet : jamais au milieu d'une action en cours.
    deps.lockLocal(wsId, async () => {
      if (cloudState.wsId !== wsId) return;
      const r = await applyRemote(wsId, snap);
      if (r === 'deleted') lostFollowed(wsId);
      else if (isDirty(wsId) || r === 'deferred') flushLater(wsId, 0);
    }).catch(() => {});
  }, e => {
    if (e && e.code === 'revoked') { set({ status: 'local', message: 'Partage interrompu : vos actions restent sur cet appareil.', msgKind: 'refused' }); return; }
    setTimeout(() => { if (cloudState.wsId === wsId && !halted) subscribe(wsId); }, 4000);
  });
}
// Nouvel espace désigné par la salle. Si la lecture échoue (réseau), on réessaie de plus en plus espacé.
let ptrWant = null, ptrTries = 0, ptrT = null;
function onPointer(d) {
  if (halted || !d || d.deleted || !d.wsId || d.wsId === cloudState.wsId) return;
  const id = d.wsId;
  ptrWant = id;
  if (ptrT) { clearTimeout(ptrT); ptrT = null; }
  follow(id).then(() => { if (ptrWant === id) { ptrWant = null; ptrTries = 0; } }, () => {
    if (ptrWant !== id) return;
    ptrT = setTimeout(() => { ptrT = null; if (ptrWant !== id) return; if (inTx) pendingPtr = d; else onPointer(d); }, Math.min(30000, 2000 * 2 ** ptrTries++));
  });
}
function watchPointer() {
  if (unsubPtr) return;
  unsubPtr = db.doc(P.ptr()).onSnapshot(snap => {
    const d = snap.exists ? snap.data() : null;
    if (inTx) { pendingPtr = d; return; }
    onPointer(d);
  }, () => { unsubPtr = null; setTimeout(() => { if (!halted) watchPointer(); }, 5000); });
}
// Rejoindre l'espace partagé désigné par le pointeur.
async function follow(wsId, ep = roomEpoch) {
  const r = await deps.lockLocal(wsId, () => pull(wsId));
  if (ep !== roomEpoch || r === 'absent' || r === 'deleted' || r === 'invalid') return false;
  const token = deps.adopt(wsId);
  if (cloudState.mode === 'server') deps.storage.set(K.room(wsId), cloudState.room);
  set({ wsId, status: 'on', message: '', msgKind: '' });
  subscribe(wsId);
  deps.onOwner(token);
  resume();
  return true;
}

// ---------- Salles (serveur de démonstration) ----------
// Augmente à chaque changement de salle par code : une connexion commencée avant ne touche plus à rien.
let roomEpoch = 0;
const ROOM_ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const cleanRoom = c => { const x = String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); return /^[A-Z0-9]{8}$/.test(x) ? x : null; };
function newRoom() { const r = new Uint8Array(8); crypto.getRandomValues(r); let s = ''; for (const b of r) s += ROOM_ALPHA[b % ROOM_ALPHA.length]; return s; }
function roomFromUrl() { try { return cleanRoom(new URLSearchParams(location.search).get('salle')); } catch { return null; } }
function storedRoom() { try { return cleanRoom(localStorage.getItem('fw:salle')); } catch { return null; } }
// La salle est gardée dans ce navigateur et écrite dans l'adresse : recharger ou partager le lien garde la même salle.
function rememberRoom(code) {
  try { localStorage.setItem('fw:salle', code); } catch {}
  try { const u = new URL(location.href); if (u.searchParams.get('salle') !== code) { u.searchParams.set('salle', code); history.replaceState(history.state, '', u.toString()); } } catch {}
}
function stopWatch() {
  if (unsubWs) { try { unsubWs(); } catch {} unsubWs = null; }
  if (unsubPtr) { try { unsubPtr(); } catch {} unsubPtr = null; }
}
// Rejoindre l'espace de la salle (ou de l'aperçu). Réponses : joined, unknown (code d'un autre appareil sans espace), shared.
// Seule une salle créée sur cet appareil reçoit un espace : un code venu d'un lien ne publie jamais rien.
async function connect({ foreign = false } = {}) {
  const ep = roomEpoch;
  const ptr = await db.doc(P.ptr()).get();
  if (ep !== roomEpoch) return 'stale';
  const p = ptr.exists ? ptr.data() : null;
  if (p && p.wsId && !p.deleted && await follow(p.wsId, ep)) { watchPointer(); return 'joined'; }
  if (ep !== roomEpoch) return 'stale';
  if (foreign) return 'unknown';
  let wsId = deps.currentWsId();
  // Un espace déjà partagé dans une autre salle n'est jamais relié à une deuxième : on en crée un neuf.
  if (cloudState.mode === 'server') { const tied = roomOf(wsId); if (tied && tied !== cloudState.room) wsId = deps.freshWsId(); }
  if (!(await cloud.share(wsId, ep))) { if (ep !== roomEpoch) return 'stale'; throw new Error('partage impossible'); }
  watchPointer();
  return 'shared';
}
// Code reçu par un lien (?salle=) et pas encore vérifié.
let foreignRoom = null;
async function enter() {
  const ep = roomEpoch;
  try { await enterRoom(ep); } catch (e) { if (ep === roomEpoch) throw e; }
}
async function enterRoom(ep) {
  if (foreignRoom) {
    const code = foreignRoom;
    const r = await connect({ foreign: true });
    if (ep !== roomEpoch) return;
    foreignRoom = null;
    if (r === 'joined') { rememberRoom(code); return; }
    deps.notify('Aucun espace avec le code ' + code + ' : vous retrouvez votre propre espace.', true);
    const room = storedRoom() || newRoom();
    rememberRoom(room);
    set({ room });
  }
  await connect();
}
let retryT = null;
// Serveur injoignable, ou qui refuse (plein, trop de demandes) : on reste sur cet appareil et on réessaie plus tard.
function unreachable(e) {
  stopWatch();
  const refused = kindOf(e) === 'refused';
  set({ status: 'local', wsId: null, msgKind: refused ? 'refused' : 'offline', message: refused
    ? 'Partage refusé pour le moment (' + reason(e) + ') : vos actions restent sur cet appareil. Nouvel essai dans quelques minutes.'
    : 'Serveur injoignable pour le moment : vos actions restent sur cet appareil. Nouvel essai automatique dans quelques secondes.' });
  if (!retryT && !halted) retryT = setTimeout(retry, refused ? 180000 : 15000);
}
async function retry() {
  if (retryT) { clearTimeout(retryT); retryT = null; }
  if (halted || !db || cloudState.mode !== 'server' || cloudState.status === 'on' || cloudState.status === 'connecting') return;
  set({ status: 'connecting' });
  try { await enter(); } catch (e) { unreachable(e); }
}

async function startArtifact(c) {
  set({ status: 'connecting', mode: 'artifact' });
  try { db = await c.use('db'); } catch { db = null; }
  if (!db) { set({ status: 'off', mode: null }); return; }
  let canWrite = null;
  try { const u = await c.use('user'); if (u && typeof u.can === 'function') canWrite = await u.can('data.write'); } catch {}
  if (canWrite === false) { db = null; set({ status: 'local', message: 'Vous pouvez regarder, mais vos actions restent sur cet appareil (accès en lecture seule).', msgKind: 'refused' }); return; }
  try { await connect(); }
  catch (e) { db = null; set({ status: 'local', message: 'Partage indisponible pour le moment : vos actions restent sur cet appareil.', msgKind: 'offline' }); }
}
async function startServer() {
  const cfg = (typeof window !== 'undefined' && window.FW_SERVER) || SERVER;
  if (!cfg || !cfg.url || typeof fetch !== 'function' || (typeof window !== 'undefined' && window.FW_NO_SERVER)) return;
  db = serverDb(cfg);
  const fromUrl = roomFromUrl(), mine = storedRoom();
  let room;
  if (fromUrl && fromUrl !== mine) { foreignRoom = fromUrl; room = fromUrl; }
  else { room = mine || newRoom(); rememberRoom(room); }
  set({ mode: 'server', room, status: 'connecting', message: '', msgKind: '' });
  if (typeof window !== 'undefined') window.addEventListener('online', () => { if (cloudState.status === 'on') { fails = 0; sideTries = 0; if (cloudState.wsId) flushLater(cloudState.wsId, 0); resume(); } else retry(); });
  try { await enter(); } catch (e) { unreachable(e); }
}

// ---------- API ----------
export const cloud = {
  state: cloudState,
  on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  isShared: wsId => !!db && !halted && cloudState.status === 'on' && wsId === cloudState.wsId,
  tx,
  // Toute écriture du serveur simulé passe par ici (sous le verrou de l'onglet) : partagée dès que possible (même un
  // espace partagé que cet onglet ne suit pas, ouvert depuis le Labo), sinon gardée pour plus tard.
  run(wsId, fn) { return canSend(wsId) ? tx(wsId, fn) : local(wsId, fn); },
  // Une sauvegarde vient d'être écrite dans ce navigateur : elle partira avec le prochain envoi de son espace
  // (même s'il n'est partagé que plus tard).
  noteBackupWrite(key) {
    if (fetchingBk || !deps || !key.startsWith('fw:bk:')) return;
    const [, , id, n] = key.split(':');
    if (id && /^\d+$/.test(n || '')) enqueue(id, { k: 'bk', n: Number(n) });
  },

  // deps : { storage, adopt(wsId) → jeton, currentWsId() → id de l'espace ouvert, freshWsId() → id d'un espace neuf,
  //   onOwner(jeton), onGeneration(wsId), onDeleted(wsId), changed(), markShared(wsId), forget(wsId) (oublier le cache),
  //   lockLocal(wsId, fn) (verrou de l'onglet), notify(message, erreur), loadImage(wsId, id) → image gardée ici }
  async start(d) {
    deps = d;
    holdTab();
    if (typeof window !== 'undefined' && window.addEventListener) {
      // Page fermée : ses actions pas encore envoyées disparaissent avec elle, un autre onglet peut prendre le relais.
      window.addEventListener('pagehide', () => { for (const id of unsent.keys()) release(id); });
      window.addEventListener('pageshow', e => { if (e && e.persisted && unsent.size) { for (const id of unsent.keys()) if (!ownedElsewhere(id)) claim(id); beat(); } });
    }
    const c = typeof window !== 'undefined' && window.claude;
    if (c && typeof c.use === 'function') return startArtifact(c);
    return startServer();
  },
  // Arrêt complet (fermeture de la page, tests) : plus aucun échange, les actions gardées sont abandonnées.
  stop() {
    halted = true;
    stopWatch();
    for (const t of [beatT, retryT, ptrT]) if (t) clearTimeout(t);
    beatT = retryT = ptrT = null;
    for (const f of flushT.values()) clearTimeout(f.t);
    for (const t of drainT.values()) clearTimeout(t);
    flushT.clear(); drainT.clear();
    if (deps) for (const id of unsent.keys()) release(id);
    unsent.clear();
    set({ status: 'off', wsId: null });
  },
  // Lien à ouvrir sur un autre appareil pour rejoindre la salle (mode serveur).
  roomLink() {
    if (cloudState.mode !== 'server' || !cloudState.room) return null;
    let base = null;
    try { if (/^https?:$/.test(location.protocol)) base = location.origin + location.pathname; } catch {}
    if (!base) base = SERVER.publicUrl || '';
    return base ? base + '?salle=' + cloudState.room : null;
  },
  // Rejoindre une autre salle par son code. Un code inconnu ne crée rien : on reste dans la salle actuelle.
  async joinRoom(code) {
    const c = cleanRoom(code);
    if (!c) return { ok: false, message: 'Le code fait 8 lettres ou chiffres, par exemple K7MP2QXR.' };
    if (!db || cloudState.mode !== 'server') return { ok: false, message: 'Le partage n’est pas disponible ici.' };
    if (c === cloudState.room && cloudState.status === 'on') return { ok: true };
    let p = null;
    try { const s = await db.doc('fw/room/' + c).get(); p = s.exists ? s.data() : null; }
    catch { return { ok: false, message: 'Serveur injoignable : réessayez dans un instant.' }; }
    if (!p || !p.wsId || p.deleted) return { ok: false, message: 'Aucun espace avec ce code. Vérifiez les lettres.' };
    const prev = cloudState.room;
    const ep = ++roomEpoch;
    stopWatch();
    foreignRoom = null;
    set({ room: c, wsId: null, status: 'connecting', message: '', msgKind: '' });
    let r = 'error';
    try { r = await connect({ foreign: true }); } catch {}
    // Un autre code a été tapé entre-temps : c'est lui qui compte.
    if (ep !== roomEpoch) return { ok: false, message: '' };
    if (r === 'joined') { rememberRoom(c); return { ok: true }; }
    // Échec : on revient dans la salle d'avant.
    stopWatch();
    set({ room: prev, status: 'connecting' });
    try { await connect(); } catch (e) { unreachable(e); }
    return { ok: false, message: r === 'unknown' ? 'Aucun espace avec ce code. Vérifiez les lettres.' : 'Serveur injoignable : réessayez dans un instant.' };
  },
  // Faire de cet espace l'espace commun à tous les appareils de la salle (ou de l'aperçu).
  // ep : la salle n'a pas changé depuis (sinon on n'écrit rien dans le code de la nouvelle salle).
  async share(wsId, ep = roomEpoch) {
    if (!db || !wsId) return false;
    const ptrPath = P.ptr();
    try {
      const r = await deps.lockLocal(wsId, () => publish(wsId));
      if (r === 'absent' || ep !== roomEpoch) return false;
      await db.doc(ptrPath).set({ wsId, at: Date.now(), by: holder });
    } catch (e) {
      // Plus aucun espace suivi (juste après une suppression) : on repasse « sur cet appareil » et on réessaie seul.
      if (!cloudState.wsId && !halted && ep === roomEpoch) unreachable(e);
      throw e;
    }
    if (ep !== roomEpoch) return false;
    if (cloudState.mode === 'server') deps.storage.set(K.room(wsId), cloudState.room);
    msgFrom = null;
    set({ wsId, status: 'on', message: '', msgKind: '' });
    subscribe(wsId);
    deps.markShared(wsId);
    deps.onOwner(deps.adopt(wsId));
    resume();
    return true;
  },
  // Suppression de l'espace commun : il disparaît aussi des autres appareils, avec ses images et ses sauvegardes.
  // La marque « supprimé » doit d'abord arriver sur le serveur : sans réseau, rien n'est effacé (erreur à afficher).
  async drop(wsId) {
    if (!this.isShared(wsId)) return;
    await deps.lockLocal(wsId, async () => {
      try { await db.doc(P.ws(wsId)).set({ deleted: true, v: 1e12, at: Date.now() }); }
      catch (e) {
        // La réponse a pu se perdre alors que la suppression est passée : on vérifie avant de dire que rien n'est effacé.
        let gone = null;
        if (kindOf(e) !== 'refused') { try { const s2 = await db.doc(P.ws(wsId)).get(); gone = !!(s2.exists && s2.data().deleted); } catch {} }
        if (gone === null) throw err('hors_ligne', 'Suppression incertaine (serveur injoignable) : réessayez dans un instant.');
        if (!gone) throw err(kindOf(e) === 'refused' ? 'refuse' : 'hors_ligne', DROP_MSG);
      }
      if (unsubWs) { try { unsubWs(); } catch {} unsubWs = null; }
      set({ wsId: null, status: 'on' });
    });
    try {
      if (db.purge) await db.purge(wsId, null);
      else {
        // Aperçu en ligne : on efface une à une les images et sauvegardes connues.
        const json = deps.storage.get(K.ws(wsId)) || '';
        const ids = new Set(json.match(/img_[a-z0-9]{16}/g) || []);
        for (const i of ids) { const ref = db.doc(P.img(wsId, i)); await (ref.delete ? ref.delete() : ref.set({ d: null })).catch(() => {}); }
        for (let n = 0; n < 10; n++) { const ref = db.doc('fwws/' + wsId + '/bk/' + n); await (ref.delete ? ref.delete() : ref.set({ z: '' })).catch(() => {}); }
      }
    } catch {}
    // Si le code de salle n'est pas mis à jour, les appareils qui l'ouvrent trouvent l'espace supprimé et en partagent un autre.
    try { await db.doc(P.ptr()).set({ wsId: null, deleted: true, at: Date.now() }); } catch {}
    forgetWs(wsId);
  },
  // Une photo vient d'être gardée dans ce navigateur. Elle attend dans la file (gardée même si la page se ferme) et part
  // en arrière-plan dès que l'espace est partagé et à jour sur le serveur : prendre une photo n'attend jamais le réseau,
  // même lent. Les images portent la génération de l'espace : une réinitialisation efface celles d'avant.
  async putImage(wsId, id, dataUrl) {
    if (!deps || typeof dataUrl !== 'string' || dataUrl.length > MAX_DOC) return false;
    enqueue(wsId, { k: 'img', id, gen: localGen(wsId) });
    if (canSend(wsId)) { if (isDirty(wsId)) flushLater(wsId, 0); else drain(wsId); }
    return false;
  },
  async getImage(wsId, id) { if (!this.isShared(wsId)) return null; try { const s = await db.doc(P.img(wsId, id)).get(); return s.exists ? s.data().d || null : null; } catch { return null; } },
};
