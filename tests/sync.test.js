// Partage entre appareils (src/ui/cloud.js) contre une imitation du serveur de démonstration (mêmes règles que
// supabase/schema.sql). Chaque « appareil » a son propre module cloud.js, son propre stockage et son propre verrou ;
// ils partagent le même serveur. Deux onglets d'un même navigateur partagent le stockage et le verrou.
// Les cas viennent des relectures avant publication : écritures croisées, action faite sans réseau, réponse perdue,
// plusieurs onglets, réinitialisation, suppression, nettoyage du serveur, refus du serveur, sauvegardes, lien piégé,
// données piégées.
import test from 'node:test';
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createBackend, memoryStorage } from '../src/server/backend.js';
import { gunzipSync, strFromU8 } from '../src/ui/vendor/fflate.js';

const realSetTimeout = globalThis.setTimeout, realClearTimeout = globalThis.clearTimeout;
const sleep = ms => new Promise(r => realSetTimeout(r, ms));
// Les minuteries de l'application (suivi du serveur, nouveaux essais) sont arrêtées à la fin des tests.
const appTimers = new Set(); let stopped = false;
globalThis.setTimeout = (f, ms, ...a) => { if (stopped) return 0; const t = realSetTimeout((...x) => { appTimers.delete(t); f(...x); }, ms, ...a); appTimers.add(t); return t; };
globalThis.clearTimeout = t => { appTimers.delete(t); realClearTimeout(t); };
test.after(() => { stopped = true; for (const t of appTimers) realClearTimeout(t); appTimers.clear(); });
// Fenêtre minimale : l'événement « online » (retour du réseau) relance les envois en attente.
globalThis.window = new EventTarget();
// Verrous du navigateur (Web Locks) : chaque page en garde un tant qu'elle vit ; une page tuée le perd.
const heldLocks = new Set();
Object.defineProperty(globalThis, 'navigator', { configurable: true, writable: true, value: { locks: {
  request(name, a, b) { const cb = typeof a === 'function' ? a : b; heldLocks.add(name); return Promise.resolve().then(() => cb({ name })); },
  query: () => Promise.resolve({ held: [...heldLocks].map(name => ({ name })) }),
} } });
const online = () => window.dispatchEvent(new Event('online'));

// ---------- Imitation du serveur ----------
// Chaque appel est rattaché au réseau de l'appareil qui le fait : on peut couper un seul appareil (srv.offline).
const als = new AsyncLocalStorage();
const on = (d, fn) => als.run({ net: d.net }, fn);
const srv = { docs: new Map(), seq: 1000, down: false, offline: new Set(), delay: 0, delayIf: null, log: [], loseIf: null, refuseIf: null, blipIf: null, upBps: {}, stallIf: null };
const PATH = /^(fw\/room\/[A-Z0-9]{8}|fwws\/ws_[a-z0-9]{4,40}(\/(img\/[A-Za-z0-9_-]{1,60}|bk\/[0-9]|lock\/main))?)$/;
const bad = (status, message) => new Response(JSON.stringify({ message }), { status });
const ok = v => new Response(v === undefined ? '' : JSON.stringify(v), { status: 200 });
const copy = x => JSON.parse(JSON.stringify(x));
globalThis.fetch = async (url, opts) => {
  const who = (als.getStore() || {}).net;
  if (srv.down || (who && srv.offline.has(who))) throw new TypeError('Failed to fetch');
  const fn = String(url).split('/rpc/')[1]; const a = JSON.parse(opts.body || '{}');
  await sleep(5);
  // Débit montant limité (srv.upBps[réseau], en bit/s) : la demande n'arrive au serveur qu'une fois entièrement envoyée.
  const bps = srv.upBps[who];
  if (bps) await new Promise((res, rej) => { const t = realSetTimeout(res, (opts.body || '').length * 8 / bps * 1000); opts.signal && opts.signal.addEventListener('abort', () => { realClearTimeout(t); srv.log.push(['aborted', fn, a.p_path]); rej(new DOMException('aborted', 'AbortError')); }); });
  // Réponse dont le début arrive mais dont la suite reste bloquée (connexion morte pendant la réception).
  if (srv.stallIf && srv.stallIf(fn, a, who)) {
    srv.stallIf = null; srv.log.push(['stalled', fn, a.p_path]);
    return new Response(new ReadableStream({ start(c) { opts.signal && opts.signal.addEventListener('abort', () => c.error(new DOMException('aborted', 'AbortError'))); } }), { status: 200 });
  }
  // Coupure d'un instant (une seule fois), refus du serveur (réponse 400 avec un message).
  if (srv.blipIf && srv.blipIf(fn, a, who)) { srv.blipIf = null; throw new TypeError('Failed to fetch'); }
  const refusal = srv.refuseIf && srv.refuseIf(fn, a, who);
  if (refusal) { srv.log.push(['refused', fn, a.p_path || a.p_ws]); return bad(400, refusal); }
  if (fn === 'fw_get') { const d = srv.docs.get(a.p_path); return ok(d ? { rev: d.rev, data: copy(d.data) } : null); }
  if (fn === 'fw_revs') {
    if (a.p_paths.length > 20 || a.p_paths.filter(p => p.startsWith('fw/room/')).length > 1) return bad(400, 'chemins');
    const o = {}; for (const p of a.p_paths) if (srv.docs.has(p)) o[p] = srv.docs.get(p).rev; return ok(o);
  }
  if (fn === 'fw_set') {
    if (srv.delay && (!srv.delayIf || srv.delayIf(a))) { const d = srv.delay; srv.delay = 0; srv.delayIf = null; await sleep(d); }
    const p = a.p_path;
    if (!PATH.test(p) || p.includes('/lock/')) return bad(400, 'chemin');
    if (JSON.stringify(a.p_data).length > 300000) return bad(400, 'violates check constraint "fw_docs_size"');
    if (p.startsWith('fw/room/') && JSON.stringify(a.p_data).length > 400) return bad(400, 'code de salle invalide');
    if (p.startsWith('fw/room/') && a.p_data.wsId != null && !srv.docs.has('fwws/' + a.p_data.wsId)) return bad(400, 'espace inconnu');
    const cur = srv.docs.get(p);
    if (a.p_expected_rev != null && (cur ? cur.rev : 0) !== a.p_expected_rev) { srv.log.push(['conflict', p]); return ok(-1); }
    if (!cur) { const m = p.match(/^(fwws\/ws_[a-z0-9]+)\//); if (m && (!srv.docs.has(m[1]) || srv.docs.get(m[1]).data.deleted)) return bad(400, 'espace inconnu'); }
    // Une seule suite de numéros pour tous les documents (comme la séquence du SQL) : un document recréé repart plus haut.
    const rev = ++srv.seq; srv.docs.set(p, { rev, data: copy(a.p_data) }); srv.log.push(['set', p, rev]);
    // Réponse perdue : le serveur a écrit, mais l'appareil ne reçoit rien.
    if (srv.loseIf && srv.loseIf(a, who)) { srv.loseIf = null; throw new TypeError('Failed to fetch'); }
    return ok(rev);
  }
  if (fn === 'fw_acquire') {
    if (!srv.docs.has(a.p_path.replace(/\/lock\/main$/, ''))) return bad(400, 'espace inconnu');
    const now = Date.now(), ttl = Math.min(Math.max(a.p_ttl_ms, 200), 10000);
    const d = srv.docs.get(a.p_path) || { rev: 0, data: { holder: '', exp: 0 } };
    if (d.data.holder === a.p_holder || d.data.exp < now) { d.data = { holder: a.p_holder, exp: now + ttl }; d.rev = ++srv.seq; srv.docs.set(a.p_path, d); return ok({ acquired: true, expiresAt: new Date(now + ttl).toISOString() }); }
    return ok({ acquired: false, expiresAt: new Date(d.data.exp).toISOString() });
  }
  if (fn === 'fw_purge') {
    // p_gen : génération à garder (null = tout effacer) ; rien n'est effacé si l'espace a déjà changé de génération.
    const w = srv.docs.get('fwws/' + a.p_ws);
    if (a.p_gen != null && !(w && String(w.data.gen) === String(a.p_gen))) { srv.log.push(['purge-skip', a.p_ws, a.p_gen]); return ok(0); }
    let n = 0;
    for (const [k, d] of [...srv.docs]) if (k.startsWith('fwws/' + a.p_ws + '/') && !k.endsWith('/lock/main') && (a.p_gen == null || String(d.data.gen) !== String(a.p_gen))) { srv.docs.delete(k); n++; }
    srv.log.push(['purge', a.p_ws, a.p_gen]); return ok(n);
  }
  return bad(404, 'inconnu');
};

// Adresse de la page : chaque appareil s'ouvre avec ou sans ?salle=CODE.
let search = '';
globalThis.location = { get search() { return search; }, get href() { return 'http://x/' + search; }, protocol: 'http:', origin: 'http://x', pathname: '/' };
globalThis.history = { state: null, replaceState(_s, _t, u) { search = new URL(u).search; } };

// ---------- Appareils ----------
// tabOf : un deuxième onglet du même navigateur (même stockage, même verrou, même salle gardée).
// net : nom du réseau de l'appareil (par défaut son nom ; deux onglets peuvent en avoir chacun un pour les tests).
let n = 0;
const live = [];
// wait : false rend l'appareil avant la fin de sa première connexion (dev.started la termine).
async function device(name, { room = null, storedRoom = null, raw: shared = null, owner = null, tabOf = null, net = null, wait = true } = {}) {
  search = room ? '?salle=' + room : '';
  const ls = tabOf ? tabOf.ls : new Map(); if (storedRoom) ls.set('fw:salle', storedRoom);
  globalThis.localStorage = { getItem: k => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: k => ls.delete(k) };
  const { cloud, cloudState } = await import('../src/ui/cloud.js?dev=' + name + (n++));
  const raw = tabOf ? tabOf.raw : shared || memoryStorage();
  const storage = { ...raw, set: (k, v) => { raw.set(k, v); if (k.startsWith('fw:bk:')) cloud.noteBackupWrite(k); } };
  const chains = tabOf ? tabOf.chains : new Map();
  const imgs = tabOf ? tabOf.imgs : new Map(); // photos gardées dans ce navigateur (IndexedDB dans l'application)
  const lockLocal = (nm, fn) => { const p = (chains.get(nm) || Promise.resolve()).then(() => fn()); chains.set(nm, p.catch(() => {})); return p; };
  const lock = (nm, fn) => lockLocal(nm, () => cloud.run(nm.slice(3), fn));
  const api = createBackend({ storage, lock });
  const dev = { name, net: net || name, cloud, cloudState, api, storage, raw, owner: owner || (tabOf && tabOf.owner) || null, events: [], notes: [], ls, chains, imgs };
  const curWs = () => { try { return api.session(dev.owner).wsId; } catch { return null; } };
  dev.started = on(dev, () => cloud.start({
    storage,
    adopt: id => api.adopt(id),
    currentWsId: () => { const id = curWs(); if (id) return id; const w = api.createWorkspace({ name: 'Espace partagé' }); dev.owner = w.token; return w.wsId; },
    freshWsId: () => api.createWorkspace({ name: 'Espace partagé' }).wsId,
    onOwner: tok => { dev.owner = tok; },
    onGeneration: id => { dev.events.push('generation'); try { dev.owner = api.adopt(id); } catch {} },
    onDeleted: id => { dev.events.push('deleted'); try { const tok = api.ownerToken(id); if (tok) api.deleteWorkspace(tok); } catch {} },
    changed: () => {},
    markShared: id => { const tok = api.ownerToken(id); if (tok) api.markShared(tok).catch(() => {}); },
    forget: id => api.forget(id),
    lockLocal: (id, fn) => lockLocal('fw-' + id, fn),
    notify: msg => dev.notes.push(msg),
    loadImage: (_id, img) => imgs.get(img) || null,
  }));
  if (wait) await dev.started;
  dev.ws = () => api._load(cloudState.wsId);
  dev.room = () => cloudState.room;
  live.push(dev);
  return dev;
}
// Chaque test repart d'appareils neufs, avec un serveur qui répond normalement.
test.afterEach(() => {
  for (const d of live.splice(0)) d.cloud.stop();
  Object.assign(srv, { down: false, delay: 0, delayIf: null, loseIf: null, refuseIf: null, blipIf: null, upBps: {}, stallIf: null });
  srv.offline.clear(); srv.log.length = 0;
});
const until = async (fn, ms = 9000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch {} await sleep(100); } return false; };
const done = r => { assert.equal(r.ok, true, r.error && r.error.message); return r.data; };
const exec = (d, cmd, args = {}, token = d.owner) => on(d, () => d.api.exec(token, cmd, args));
const flag = (d, key, value = true) => exec(d, 'demo.flag', { key, value });
const admin = d => { const u = d.api.q(d.owner, 'me').users.find(x => x.role === 'admin'); return d.api.switchUser(d.owner, u.id); };
const remote = id => { const d = srv.docs.get('fwws/' + id); return d && d.data; };
// État complet gardé sur le serveur (décompressé).
const serverWs = id => { const d = remote(id); return JSON.parse(d.enc === 'gz64' ? strFromU8(gunzipSync(new Uint8Array(Buffer.from(d.z, 'base64')))) : d.z); };
// Plus rien à envoyer : la copie locale est la version commune, et c'est celle du serveur.
const synced = (d, id) => { const b = JSON.parse(d.raw.get('fw:wsbase:' + id) || 'null'); return !!b && b.v === Number(d.raw.get('fw:wsv:' + id)) && remote(id).v === b.v && d.cloudState.message === ''; };
// Photo prise sur un appareil : gardée dans son navigateur, puis confiée au partage (comme platform.putImage).
const photo = (d, id, img, data) => { d.imgs.set(img, data); return on(d, () => d.cloud.putImage(id, img, data)); };
// Le partage d'un espace se termine par une dernière écriture en arrière-plan (espace marqué « partagé ») : on l'attend.
const settled = d => until(() => d.ws().shared === true && synced(d, d.cloudState.wsId));
async function pair() {
  const A = await device('A');
  assert.ok(await settled(A));
  const B = await device('B', { room: A.room() });
  assert.equal(A.cloudState.status, 'on');
  assert.equal(B.cloudState.status, 'on');
  assert.equal(B.cloudState.wsId, A.cloudState.wsId);
  return { A, B, id: A.cloudState.wsId };
}

test('Deux appareils dans la même salle : une action arrive sur l’autre', async () => {
  const { A, B } = await pair();
  assert.match(A.room(), /^[A-Z0-9]{8}$/);
  done(await flag(A, 'saturation'));
  assert.ok(await until(() => B.ws().sim.saturation === true), 'B reçoit l’action de A');
});

test('Envoi lent : deux actions faites en même temps sont gardées toutes les deux', async () => {
  const { A, B, id } = await pair();
  srv.delay = 5000; srv.delayIf = x => x.p_path === 'fwws/' + id; // l'envoi de A met 5 s (bail de 4 s dépassé)
  const pa = flag(A, 'saturation');
  await sleep(1000);
  const pb = flag(B, 'equipmentShortage');
  done(await pa); done(await pb);
  assert.ok(await until(() => A.ws().sim.saturation && A.ws().sim.equipmentShortage && B.ws().sim.saturation && B.ws().sim.equipmentShortage), JSON.stringify([A.ws().sim, B.ws().sim]));
  const r = remote(id); assert.equal(r.sid, JSON.parse(A.storage.get('fw:wsbase:' + id)).sid);
  assert.ok(srv.log.some(x => x[0] === 'conflict'), 'le serveur a refusé l’envoi périmé');
});

test('Action faite sans réseau : elle part au retour du réseau et la pastille se libère', async () => {
  const { A, B } = await pair();
  srv.down = true;
  done(await flag(A, 'degraded'));
  assert.match(A.cloudState.message, /Connexion instable/);
  srv.down = false;
  assert.ok(await until(() => B.ws().sim.degraded === true, 12000), 'B reçoit l’action faite hors ligne');
  assert.ok(await until(() => A.cloudState.message === ''), 'message effacé');
  assert.equal(A.notes.length, 0);
});

test('Action sans réseau pendant qu’un autre appareil écrit : elle est rejouée, rien n’est perdu', async () => {
  const { A, B, id } = await pair();
  done(await flag(B, 'saturation'));
  srv.down = true;
  done(await flag(A, 'degraded'));
  srv.down = false;
  assert.ok(await until(() => B.ws().sim.degraded === true && B.ws().sim.saturation === true, 12000), 'B a les deux actions');
  assert.ok(await until(() => A.ws().sim.saturation === true && A.ws().sim.degraded === true && A.cloudState.message === ''), 'A a les deux actions');
  assert.equal(A.notes.length, 0, A.notes.join(' | '));
  assert.equal(remote(id).v, A.ws().version);
});

test('Action sans réseau qui ne peut plus être rejouée (page rechargée) : on prévient', async () => {
  const { A, B } = await pair();
  done(await flag(B, 'saturation'));
  srv.down = true;
  done(await flag(A, 'degraded'));
  // La page est rechargée avant le retour du réseau : l'ancienne page s'arrête et la liste des actions à rejouer est perdue.
  A.cloud.stop();
  const A2 = await device('A-recharge', { raw: A.raw, owner: A.owner, storedRoom: A.room() });
  srv.down = false;
  online();
  assert.ok(await until(() => A2.notes.some(m => /sans réseau/.test(m)) && A2.cloudState.status === 'on', 20000), A2.notes.join(' | ') + ' ' + A2.cloudState.status);
  assert.ok(await until(() => A2.api._load(B.cloudState.wsId).sim.saturation === true));
});

test('Réinitialisation juste après une action d’un autre appareil : elle est gardée partout', async () => {
  const { A, B, id } = await pair();
  done(await flag(B, 'saturation'));
  done(await flag(B, 'degraded'));
  const gen = A.api._load(id).generation;
  const r = await A.api.resetWorkspace(A.owner); A.owner = r.token;
  assert.equal(remote(id).gen, gen + 1, 'le serveur a la nouvelle génération');
  assert.ok(await until(() => B.ws().generation === gen + 1), 'B passe à la nouvelle génération');
  done(await flag(B, 'failNextActivation'));
  assert.ok(await until(() => A.api._load(id).sim.failNextActivation === true));
  assert.equal(A.api._load(id).generation, gen + 1);
  assert.equal(A.events.includes('generation'), false, 'A ne voit pas de fausse réinitialisation');
});

test('Suppression pendant qu’un autre appareil écrit : il suit le nouvel espace, l’ancien reste effacé', async () => {
  const { A, B, id: old } = await pair();
  srv.delay = 3000; srv.delayIf = x => x.p_path === 'fwws/' + old && x.p_data.v != null && !x.p_data.deleted;
  const pb = flag(B, 'saturation');
  await sleep(600);
  await A.cloud.drop(old);
  A.api.deleteWorkspace(A.owner);
  const w = A.api.createWorkspace({ name: 'Espace partagé' });
  await A.cloud.share(w.wsId); A.owner = w.token;
  await pb;
  assert.ok(await until(() => B.cloudState.wsId === w.wsId, 10000), 'B suit le nouvel espace');
  assert.equal(remote(old).deleted, true, 'l’ancien espace reste supprimé sur le serveur');
});

test('Sauvegarde après réinitialisation : la restauration donne la nouvelle sauvegarde', async () => {
  const { A, B, id } = await pair();
  done(await flag(A, 'saturation'));
  done(await A.api.exec(admin(A), 'backup.create', {}));
  done(await A.api.exec(A.owner, 'demo.clock', { hours: 0 }));
  done(await B.api.exec(B.owner, 'demo.clock', { hours: 0 }));
  assert.ok(B.storage.get('fw:bk:' + id + ':1'), 'B a rapatrié la sauvegarde 1');
  const r = await A.api.resetWorkspace(A.owner); A.owner = r.token;
  assert.ok(await until(() => ![...srv.docs.keys()].some(k => k.startsWith('fwws/' + id + '/bk/'))), 'anciennes sauvegardes effacées du serveur');
  assert.ok(await until(() => B.ws().generation === A.api._load(id).generation));
  done(await flag(A, 'degraded'));
  done(await A.api.exec(admin(A), 'backup.create', {}));
  done(await A.api.exec(A.owner, 'demo.clock', { hours: 0 }));
  assert.ok(await until(() => B.ws().backups.length === 1));
  done(await B.api.exec(B.owner, 'demo.restore', { n: 1 }));
  assert.equal(B.ws().sim.degraded, true);
  assert.equal(B.ws().sim.saturation, false);
});

test('Lien avec un code inconnu : rien n’est publié, on reste dans sa salle', async () => {
  const { A, id } = await pair();
  const mine = A.room();
  const before = srv.docs.size;
  const J = await device('J', { room: 'QQQQ2222', storedRoom: mine });
  assert.equal(srv.docs.has('fw/room/QQQQ2222'), false, 'aucun espace publié sous le code piégé');
  assert.equal(J.room(), mine);
  assert.equal(J.cloudState.wsId, id);
  assert.ok(J.notes.some(m => /Aucun espace avec le code QQQQ2222/.test(m)));
  assert.equal(srv.docs.size, before);
  const r = await J.cloud.joinRoom('ZZZZ9999');
  assert.equal(r.ok, false);
  assert.equal(J.room(), mine);
});

test('Un espace déjà partagé dans une salle n’est jamais relié à une deuxième', async () => {
  const A = await device('A2');
  const id = A.cloudState.wsId, first = A.room();
  // Même navigateur (même stockage, même espace ouvert), mais une autre salle gardée : un espace neuf est créé.
  const A2 = await device('A3', { storedRoom: 'HHHH3333', raw: A.raw, owner: A.owner });
  assert.equal(A2.room(), 'HHHH3333');
  const ptr = srv.docs.get('fw/room/HHHH3333').data.wsId;
  assert.ok(ptr && ptr !== id, 'nouvel espace pour la nouvelle salle');
  assert.equal(srv.docs.get('fw/room/' + first).data.wsId, id, 'la première salle garde son espace');
});

test('Données piégées : un état reçu avec __proto__ est refusé', async () => {
  const { A, B, id } = await pair();
  const r = remote(id);
  const evil = '{"id":"' + id + '","version":999,"generation":' + r.gen + ',"__proto__":{"pollue":1}}';
  srv.docs.set('fwws/' + id, { rev: srv.docs.get('fwws/' + id).rev + 1, data: { v: 999, gen: r.gen, sid: 'piege', enc: 'json', z: evil } });
  await sleep(2500);
  assert.equal(({}).pollue, undefined);
  assert.notEqual(B.ws().version, 999);
});

test('Navigateur sans DecompressionStream : il rejoint quand même la salle', async () => {
  const A = await device('A4');
  done(await flag(A, 'saturation'));
  const DS = globalThis.DecompressionStream;
  globalThis.DecompressionStream = undefined;
  try {
    const B = await device('B4', { room: A.room() });
    assert.equal(B.cloudState.status, 'on');
    assert.equal(B.ws().sim.saturation, true);
  } finally { globalThis.DecompressionStream = DS; }
});

// ---------- Cas de la deuxième relecture ----------

test('Réponse perdue, puis nouvel essai raté : l’action n’est faite qu’une fois', async () => {
  const A = await device('A-perdu');
  const id = A.cloudState.wsId;
  assert.ok(await settled(A));
  const before = A.ws().orders.length;
  // Le serveur enregistre l'envoi, mais le téléphone perd le réseau avant la réponse, et le garde coupé plus de 5 s.
  srv.loseIf = (a, who) => { if (who === A.net && a.p_path === 'fwws/' + id) { srv.offline.add(A.net); return true; } return false; };
  done(await exec(A, 'demo.createOrder'));
  assert.match(A.cloudState.message, /Connexion instable/);
  await sleep(6000);
  srv.offline.delete(A.net);
  online();
  assert.ok(await until(() => synced(A, id), 15000), 'tout est reparti');
  await sleep(1000);
  assert.equal(A.ws().orders.length, before + 1, 'une seule commande sur l’appareil');
  assert.equal(serverWs(id).orders.length, before + 1, 'une seule commande sur le serveur');
  assert.deepEqual(A.notes, []);
});

test('Réponse perdue, puis un autre appareil écrit par-dessus : pas de doublon, rien de perdu', async () => {
  const { A, B, id } = await pair();
  const before = A.ws().orders.length;
  srv.loseIf = (a, who) => { if (who === A.net && a.p_path === 'fwws/' + id) { srv.offline.add(A.net); return true; } return false; };
  done(await exec(A, 'demo.createOrder'));
  // B part de la version envoyée par A (arrivée sur le serveur) et écrit par-dessus.
  done(await flag(B, 'saturation'));
  assert.equal(serverWs(id).orders.length, before + 1);
  srv.offline.delete(A.net);
  online();
  assert.ok(await until(() => synced(A, id) && A.ws().sim.saturation === true, 15000));
  await sleep(1000);
  assert.equal(A.ws().orders.length, before + 1, 'une seule commande sur A');
  assert.equal(serverWs(id).orders.length, before + 1, 'une seule commande sur le serveur');
  assert.equal(serverWs(id).sim.saturation, true);
  assert.deepEqual(A.notes, []);
});

test('Un onglet relit l’espace quand un autre y écrit un état différent sous le même numéro de version', () => {
  const raw = memoryStorage();
  const t1 = createBackend({ storage: raw }), t2 = createBackend({ storage: raw });
  const w = t1.createWorkspace({ name: 'x' });
  const v = t2._load(w.wsId).version;
  // Un onglet applique l'état reçu d'un autre appareil : même numéro de version, contenu différent.
  const other = JSON.parse(raw.get('fw:ws:' + w.wsId)); other.sim.saturation = !other.sim.saturation;
  raw.set('fw:ws:' + w.wsId, JSON.stringify(other)); raw.set('fw:wsn:' + w.wsId, 'autre');
  assert.equal(t2._load(w.wsId).version, v);
  assert.equal(t2._load(w.wsId).sim.saturation, other.sim.saturation);
  assert.equal(t1._load(w.wsId).sim.saturation, other.sim.saturation);
});

test('Deux onglets : l’action faite sans réseau dans l’un n’est ni perdue ni mélangée par l’autre', async () => {
  const { A: T1, B, id } = await pair();
  const T2 = await device('T2', { tabOf: T1, net: 'T2' });
  assert.equal(T2.cloudState.wsId, id);
  const before = T1.ws().orders.length;
  srv.offline.add(T1.net); srv.offline.add(T2.net);
  done(await exec(T1, 'demo.createOrder'));
  // L'autre onglet ne mélange pas ses actions à celles qui attendent : il demande d'attendre.
  const r2 = await flag(T2, 'degraded');
  assert.equal(r2.ok, false); assert.equal(r2.error.code, 'occupe');
  done(await flag(B, 'saturation'));
  // T2 retrouve le réseau le premier et voit l'écriture de B : il laisse T1 rejouer son action.
  srv.offline.delete(T2.net);
  await sleep(4000);
  assert.equal(T2.api._load(id).orders.length, before + 1, 'la commande faite dans T1 est toujours là');
  srv.offline.delete(T1.net);
  online();
  assert.ok(await until(() => synced(T1, id) && serverWs(id).sim.saturation === true && serverWs(id).orders.length === before + 1, 15000), 'T1 a rejoué son action sur la version de B');
  assert.equal(T2.api._load(id).sim.saturation, true, 'T2 voit l’écriture de B');
  assert.equal(T2.api._load(id).orders.length, before + 1);
  assert.ok(await until(() => B.ws().orders.length === before + 1));
  assert.deepEqual([...T1.notes, ...T2.notes, ...B.notes], []);
});

test('Espace effacé par le nettoyage du serveur puis recréé : les autres appareils suivent et leurs actions passent', async () => {
  const { A, B, id } = await pair();
  done(await flag(A, 'saturation'));
  assert.ok(await until(() => B.ws().sim.saturation === true));
  const room = A.room();
  for (const k of [...srv.docs.keys()]) if (k === 'fwws/' + id || k.startsWith('fwws/' + id + '/') || k === 'fw/room/' + room) srv.docs.delete(k);
  done(await flag(A, 'degraded'));
  assert.ok(srv.docs.has('fwws/' + id), 'A recrée l’espace');
  assert.equal(srv.docs.get('fw/room/' + room).data.wsId, id, 'et son code de salle');
  done(await flag(B, 'equipmentShortage'));
  const s = serverWs(id).sim;
  assert.ok(s.saturation && s.degraded && s.equipmentShortage, JSON.stringify(s));
  assert.ok(await until(() => A.ws().sim.equipmentShortage === true));
  assert.deepEqual([...A.notes, ...B.notes], []);
});

test('Changement d’espace dans la salle pendant une coupure : l’autre appareil finit par suivre', async () => {
  const { A, B, id: old } = await pair();
  await A.cloud.drop(old);
  A.api.deleteWorkspace(A.owner);
  const w = A.api.createWorkspace({ name: 'Espace partagé' });
  srv.blipIf = (fn, a, who) => who === B.net && fn === 'fw_get' && a.p_path === 'fwws/' + w.wsId;
  await A.cloud.share(w.wsId); A.owner = w.token;
  assert.ok(await until(() => B.cloudState.wsId === w.wsId, 15000), 'B suit le nouvel espace malgré la coupure');
  done(await flag(A, 'saturation'));
  assert.ok(await until(() => B.ws().sim.saturation === true));
});

test('Envoi refusé par le serveur : message clair, pas d’envoi toutes les 5 s, tout repart ensuite', async () => {
  const { A, B, id } = await pair();
  srv.refuseIf = (fn, a) => fn === 'fw_set' && a.p_path === 'fwws/' + id && 'serveur plein';
  const refused = () => srv.log.filter(x => x[0] === 'refused').length;
  const n0 = refused();
  done(await flag(A, 'saturation'));
  assert.equal(A.cloudState.msgKind, 'refused');
  assert.match(A.cloudState.message, /Envoi refusé \(le serveur de démonstration est plein\)/);
  await sleep(6500);
  assert.equal(refused() - n0, 1, 'pas de nouvel envoi toutes les 5 secondes');
  srv.refuseIf = null;
  done(await flag(A, 'degraded'));
  assert.equal(A.cloudState.message, '');
  assert.ok(await until(() => B.ws().sim.saturation === true && B.ws().sim.degraded === true));
  assert.deepEqual(A.notes, []);
});

test('Sauvegarde refusée par le serveur : l’action est partie une fois, la sauvegarde repart plus tard', async () => {
  const { A, B, id } = await pair();
  srv.refuseIf = (fn, a) => fn === 'fw_set' && a.p_path.startsWith('fwws/' + id + '/bk/') && 'trop de demandes : réessayez dans une heure';
  done(await exec(A, 'backup.create', {}, admin(A)));
  assert.ok(await until(() => A.cloudState.msgKind === 'refused'), A.cloudState.msgKind);
  assert.match(A.cloudState.message, /sauvegarde/);
  assert.equal(remote(id).v, A.ws().version, 'l’action elle-même est sur le serveur');
  done(await flag(B, 'saturation'));
  done(await flag(A, 'degraded'));
  assert.equal(A.ws().backups.length, 1, 'la sauvegarde n’est pas refaite');
  assert.equal(serverWs(id).backups.length, 1);
  srv.refuseIf = null;
  done(await flag(A, 'equipmentShortage'));
  assert.ok(await until(() => A.cloudState.message === '' && srv.docs.has('fwws/' + id + '/bk/1')), A.cloudState.message);
  assert.equal(srv.docs.get('fwws/' + id + '/bk/1').data.gen, A.ws().generation, 'la sauvegarde est arrivée');
  assert.deepEqual(A.notes, []);
});

test('Effacement raté après une réinitialisation : l’ancienne sauvegarde n’est jamais restaurée, le ménage est refait', async () => {
  const { A, B, id } = await pair();
  done(await flag(A, 'saturation'));
  done(await exec(A, 'backup.create', {}, admin(A)));
  const gen1 = A.ws().generation;
  assert.ok(await until(() => srv.docs.has('fwws/' + id + '/bk/1')));
  assert.equal(srv.docs.get('fwws/' + id + '/bk/1').data.gen, gen1);
  // L'effacement des sauvegardes de l'ancienne génération échoue, et la nouvelle sauvegarde n° 1 ne part pas tout de suite.
  srv.refuseIf = (fn, a) => (fn === 'fw_purge' || (fn === 'fw_set' && a.p_path.includes('/bk/'))) && 'indisponible';
  const r = await on(A, () => A.api.resetWorkspace(A.owner)); A.owner = r.token;
  assert.ok(srv.docs.has('fwws/' + id + '/bk/1'), 'l’ancienne sauvegarde est encore sur le serveur');
  done(await flag(A, 'degraded'));
  done(await exec(A, 'backup.create', {}, admin(A)));
  assert.ok(await until(() => B.ws().generation === gen1 + 1));
  done(await flag(B, 'equipmentShortage'));
  assert.equal(B.storage.get('fw:bk:' + id + ':1'), null, 'la sauvegarde d’avant la réinitialisation n’est pas reprise');
  assert.equal((await exec(B, 'demo.restore', { n: 1 })).ok, false);
  srv.refuseIf = null;
  done(await flag(A, 'failNextActivation'));
  assert.ok(await until(() => (srv.docs.get('fwws/' + id + '/bk/1') || { data: {} }).data.gen === gen1 + 1), 'ménage refait et nouvelle sauvegarde envoyée');
  assert.ok(await until(() => srv.log.some(x => x[0] === 'purge' && x[1] === id && x[2] === gen1 + 1)), 'le ménage garde la nouvelle génération');
  done(await flag(B, 'saturation', true));
  done(await exec(B, 'demo.restore', { n: 1 }));
  assert.equal(B.ws().sim.degraded, true);
  assert.equal(B.ws().sim.saturation, false);
});

test('Page ouverte sans réseau : les actions faites en attendant sont rejouées au retour', async () => {
  const { A, B, id } = await pair();
  A.cloud.stop();
  srv.offline.add('A-hors');
  const A2 = await device('A-hors', { raw: A.raw, owner: A.owner, storedRoom: A.room() });
  assert.equal(A2.cloudState.status, 'local');
  done(await flag(A2, 'degraded'));
  done(await flag(B, 'saturation'));
  srv.offline.delete('A-hors');
  online();
  assert.ok(await until(() => A2.cloudState.status === 'on' && synced(A2, id), 15000), A2.cloudState.status + ' ' + A2.cloudState.message);
  const s = serverWs(id).sim;
  assert.ok(s.degraded && s.saturation, JSON.stringify(s));
  assert.ok(await until(() => B.ws().sim.degraded === true));
  assert.deepEqual(A2.notes, []);
});

// ---------- Cas de la troisième relecture ----------

test('Deux onglets : après un envoi raté dans l’un et un envoi réussi dans l’autre, l’action faite ensuite sans réseau est gardée', async () => {
  const { A: T1, B, id } = await pair();
  const T2 = await device('T2', { tabOf: T1, net: 'T2' });
  const before = T1.ws().orders.length;
  // L'envoi de T1 tombe sur une coupure d'un instant ; T2 écrit juste après (il envoie d'abord l'action de T1, telle quelle).
  srv.blipIf = (fn, a, who) => who === T1.net && fn === 'fw_set' && a.p_path === 'fwws/' + id;
  done(await exec(T1, 'demo.createOrder'));
  done(await flag(T2, 'saturation'));
  assert.equal(serverWs(id).orders.length, before + 1);
  assert.equal(serverWs(id).sim.saturation, true);
  // Tout le navigateur perd le réseau ; T2 agit, puis un autre appareil écrit.
  srv.offline.add(T1.net); srv.offline.add(T2.net);
  done(await exec(T2, 'demo.createOrder'));
  done(await flag(B, 'degraded'));
  srv.offline.delete(T1.net); srv.offline.delete(T2.net);
  online();
  assert.ok(await until(() => serverWs(id).orders.length === before + 2 && serverWs(id).sim.degraded === true && synced(T2, id), 20000), JSON.stringify({ orders: serverWs(id).orders.length, before }));
  assert.ok(await until(() => B.ws().orders.length === before + 2));
  assert.deepEqual([...T1.notes, ...T2.notes, ...B.notes], []);
});

test('Réponse perdue, puis plus de 20 actions sans réseau : l’action n’est faite qu’une fois', async () => {
  const { A, B, id } = await pair();
  const before = A.ws().orders.length;
  srv.loseIf = (a, who) => { if (who === A.net && a.p_path === 'fwws/' + id) { srv.offline.add(A.net); return true; } return false; };
  done(await exec(A, 'demo.createOrder'));
  assert.equal(serverWs(id).orders.length, before + 1, 'le serveur a la commande');
  for (let i = 0; i < 21; i++) done(await flag(A, 'saturation', i % 2 === 0));
  srv.offline.delete(A.net);
  online();
  assert.ok(await until(() => synced(A, id), 20000), 'tout est reparti');
  assert.equal(serverWs(id).orders.length, before + 1, 'une seule commande sur le serveur');
  assert.equal(A.ws().orders.length, before + 1);
  assert.equal(serverWs(id).sim.saturation, true, 'la dernière action est là');
  assert.ok(await until(() => B.ws().orders.length === before + 1 && B.ws().sim.saturation === true));
  assert.deepEqual(A.notes, []);
});

test('Réponse perdue, puis plus de 20 écritures d’un autre appareil : pas de doublon', async () => {
  const { A, B, id } = await pair();
  const before = A.ws().orders.length;
  srv.loseIf = (a, who) => { if (who === A.net && a.p_path === 'fwws/' + id) { srv.offline.add(A.net); return true; } return false; };
  done(await exec(A, 'demo.createOrder'));
  for (let i = 0; i < 21; i++) done(await flag(B, 'saturation', i % 2 === 0));
  srv.offline.delete(A.net);
  online();
  assert.ok(await until(() => synced(A, id), 20000));
  await sleep(500);
  assert.equal(serverWs(id).orders.length, before + 1, 'une seule commande sur le serveur');
  assert.equal(A.ws().orders.length, before + 1);
  assert.equal(A.ws().sim.saturation, true, 'A a la dernière écriture de B');
  assert.deepEqual(A.notes, []);
});

test('Réinitialisation dont l’envoi croise une écriture d’un autre appareil : elle est gardée et son lien marche', async () => {
  const { A, B, id } = await pair();
  const gen = A.ws().generation;
  srv.delay = 5000; srv.delayIf = x => x.p_path === 'fwws/' + id && x.p_data.gen === gen + 1; // bail de 4 s dépassé
  const pr = on(A, () => A.api.resetWorkspace(A.owner));
  await sleep(1000);
  const pb = flag(B, 'saturation');
  const r = await pr; done(await pb);
  A.owner = r.token;
  assert.ok(srv.log.some(x => x[0] === 'conflict'), 'les deux envois se sont croisés');
  assert.equal(remote(id).gen, gen + 1, 'le serveur a la réinitialisation');
  assert.equal(A.api.session(r.token).wsId, id, 'le lien donné par la réinitialisation marche');
  assert.equal(A.api._load(id).generation, gen + 1);
  assert.ok(await until(() => B.ws().generation === gen + 1));
  assert.deepEqual(A.notes, []);
  assert.equal(A.events.includes('generation'), false);
});

test('Réinitialisation sur un autre appareil pendant un envoi : l’action est refusée avec un message clair', async () => {
  const { A, B, id } = await pair();
  const gen = A.ws().generation;
  srv.delay = 5000; srv.delayIf = x => x.p_path === 'fwws/' + id && x.p_data.gen === gen;
  const pa = flag(A, 'saturation');
  await sleep(1000);
  const rb = await on(B, () => B.api.resetWorkspace(B.owner)); B.owner = rb.token;
  const ra = await pa;
  assert.equal(ra.ok, false);
  assert.equal(ra.error.code, 'conflit');
  assert.match(ra.error.message, /réinitialisé depuis un autre appareil/);
  assert.equal(remote(id).gen, gen + 1);
  assert.equal(serverWs(id).sim.saturation, false, 'l’action d’avant la réinitialisation n’est pas passée');
  assert.equal(A.api._load(id).generation, gen + 1);
  assert.ok(A.events.includes('generation'));
  assert.deepEqual(A.notes, [], 'pas d’autre alerte : le message vient avec l’action refusée');
});

test('Page ouverte sans réseau dans deux onglets : le deuxième attend, l’action du premier est gardée', async () => {
  const { A, B, id } = await pair();
  A.cloud.stop();
  srv.offline.add('A1'); srv.offline.add('A2');
  const A1 = await device('A1', { raw: A.raw, owner: A.owner, storedRoom: A.room() });
  const A2 = await device('A2', { tabOf: A1, net: 'A2' });
  assert.equal(A1.cloudState.status, 'local'); assert.equal(A2.cloudState.status, 'local');
  const before = A1.api._load(id).orders.length;
  done(await exec(A1, 'demo.createOrder'));
  const r2 = await flag(A2, 'degraded');
  assert.equal(r2.ok, false); assert.equal(r2.error.code, 'occupe');
  done(await flag(B, 'saturation'));
  srv.offline.delete('A1'); srv.offline.delete('A2');
  online();
  assert.ok(await until(() => serverWs(id).orders.length === before + 1 && serverWs(id).sim.saturation === true && A1.cloudState.status === 'on', 25000), A1.cloudState.status + ' ' + serverWs(id).orders.length);
  assert.ok(await until(() => synced(A1, id), 10000));
  assert.deepEqual([...A1.notes, ...A2.notes], []);
});

test('Repartager un espace : ce qu’un autre appareil y a écrit entre-temps est gardé', async () => {
  const { A, B, id: W } = await pair();
  const tokW = A.owner;
  const w2 = A.api.createWorkspace({ name: 'Deuxième' });
  await on(A, () => A.cloud.share(w2.wsId)); A.owner = w2.token;
  const r = await flag(B, 'saturation'); // B est encore sur W pendant un instant
  assert.ok(await until(() => B.cloudState.wsId === w2.wsId, 10000), 'B suit le deuxième espace');
  await on(A, () => A.cloud.share(W)); A.owner = tokW;
  assert.ok(await until(() => B.cloudState.wsId === W, 10000), 'B revient sur le premier');
  if (r.ok) {
    assert.equal(serverWs(W).sim.saturation, true, 'l’action de B est gardée sur le serveur');
    assert.equal(A.api._load(W).sim.saturation, true, 'et A la reçoit');
  }
  assert.deepEqual([...A.notes, ...B.notes], []);
});

test('Ménage en retard d’une ancienne réinitialisation : les sauvegardes de la plus récente restent', async () => {
  const { A, B, id } = await pair();
  const f0 = globalThis.fetch; let slow = true;
  globalThis.fetch = async (url, opts) => { if (slow && String(url).endsWith('/fw_purge')) { slow = false; await sleep(6000); } return f0(url, opts); };
  try {
    const g = A.ws().generation;
    const pa = on(A, () => A.api.resetWorkspace(A.owner)).then(r => { A.owner = r.token; });
    assert.ok(await until(() => remote(id).gen === g + 1 && B.ws().generation === g + 1, 8000));
    await sleep(3000); // le ménage demandé par A est encore en route
    const rb = await on(B, () => B.api.resetWorkspace(B.owner)); B.owner = rb.token;
    done(await exec(B, 'backup.create', {}, admin(B)));
    assert.ok(await until(() => (srv.docs.get('fwws/' + id + '/bk/1') || { data: {} }).data.gen === g + 2));
    await pa;
    assert.ok(await until(() => srv.log.some(x => x[0] === 'purge-skip' && x[1] === id && x[2] === g + 1)), 'le serveur a ignoré le ménage en retard');
    assert.ok(srv.docs.has('fwws/' + id + '/bk/1'), 'la sauvegarde de la génération la plus récente est restée');
    assert.ok(await until(() => A.ws().generation === g + 2, 8000));
    done(await exec(A, 'demo.restore', { n: 1 }));
  } finally { globalThis.fetch = f0; }
});

test('Suppression sans réseau : rien n’est effacé, on peut réessayer ensuite', async () => {
  const { A, B, id } = await pair();
  srv.offline.add(A.net);
  await assert.rejects(on(A, () => A.cloud.drop(id)), /Suppression (impossible|incertaine)/);
  assert.equal(A.cloud.isShared(id), true, 'l’espace est toujours partagé');
  assert.ok(A.api._load(id), 'et toujours là sur l’appareil');
  assert.equal(remote(id).deleted, undefined, 'et sur le serveur');
  srv.offline.delete(A.net);
  await on(A, () => A.cloud.drop(id));
  A.api.deleteWorkspace(A.owner);
  assert.equal(remote(id).deleted, true);
  assert.ok(await until(() => B.events.includes('deleted')), 'l’autre appareil apprend la suppression');
});

test('Suppression puis nouveau partage raté : l’appareil repartage seul dès que le serveur répond', async () => {
  const { A, B, id } = await pair();
  await on(A, () => A.cloud.drop(id));
  A.api.deleteWorkspace(A.owner);
  const w = A.api.createWorkspace({ name: 'Espace partagé' }); A.owner = w.token;
  srv.offline.add(A.net);
  await assert.rejects(on(A, () => A.cloud.share(w.wsId)));
  assert.equal(A.cloudState.status, 'local');
  srv.offline.delete(A.net);
  // Les deux appareils se retrouvent sur un même espace vivant (celui de A, ou celui que B a partagé entre-temps).
  assert.ok(await until(() => A.cloudState.status === 'on' && A.cloudState.wsId && A.cloudState.wsId !== id && B.cloudState.wsId === A.cloudState.wsId, 30000), A.cloudState.status + ' ' + A.cloudState.wsId + ' / ' + B.cloudState.wsId);
  assert.equal(remote(A.cloudState.wsId).deleted, undefined);
});

test('Photo prise pendant que le partage est coupé : elle part au retour et l’autre appareil la voit', async () => {
  const { A, B, id } = await pair();
  A.cloud.stop();
  srv.offline.add('A-photo');
  const A2 = await device('A-photo', { raw: A.raw, owner: A.owner, storedRoom: A.room() });
  assert.equal(A2.cloudState.status, 'local');
  const img = 'img_abcdefghijk23456', data = 'data:image/jpeg;base64,' + 'A'.repeat(400);
  assert.equal(await photo(A2, id, img, data), false, 'pas encore envoyée');
  done(await flag(A2, 'degraded'));
  srv.offline.delete('A-photo');
  online();
  assert.ok(await until(() => srv.docs.has('fwws/' + id + '/img/' + img), 25000), 'la photo est arrivée sur le serveur');
  assert.equal(srv.docs.get('fwws/' + id + '/img/' + img).data.gen, A2.api._load(id).generation);
  assert.equal(await on(B, () => B.cloud.getImage(id, img)), data);
  assert.equal(A2.raw.get('fw:upq:' + id), null, 'la file est vide');
});

test('Photo dont l’envoi échoue : elle repart toute seule', async () => {
  const { A, B, id } = await pair();
  const img = 'img_zyxwvutsrqpn2345', data = 'data:image/jpeg;base64,' + 'B'.repeat(400);
  srv.refuseIf = (fn, a) => fn === 'fw_set' && a.p_path.includes('/img/') && 'indisponible';
  assert.equal(await photo(A, id, img, data), false);
  assert.ok(await until(() => /photo/.test(A.cloudState.message)), A.cloudState.message);
  srv.refuseIf = null;
  done(await flag(A, 'degraded'));
  assert.ok(await until(() => srv.docs.has('fwws/' + id + '/img/' + img) && A.cloudState.message === ''), A.cloudState.message);
  assert.equal(await on(B, () => B.cloud.getImage(id, img)), data);
});

// ---------- Cas de la quatrième relecture ----------

test('Deux onglets : agir sur un ancien espace partagé depuis le Labo ne bloque pas l’autre onglet', async () => {
  const { A: T2, B, id: W } = await pair();
  const T1 = await device('T1', { tabOf: T2, net: 'T1' });
  // Un autre appareil partage un deuxième espace : les deux onglets le suivent, W reste dans le navigateur.
  const W2 = B.api.createWorkspace({ name: 'W2' }).wsId;
  assert.equal(await on(B, () => B.cloud.share(W2)), true);
  assert.ok(await until(() => T1.cloudState.wsId === W2 && T2.cloudState.wsId === W2, 15000));
  const tokW = T1.api.listWorkspaces().find(w => w.id === W).ownerToken;
  done(await exec(T1, 'demo.flag', { key: 'degraded', value: true }, tokW));
  assert.equal(serverWs(W).sim.degraded, true, 'l’action de T1 sur W est partie');
  done(await exec(T2, 'demo.flag', { key: 'saturation', value: true }, tokW));
  assert.equal(serverWs(W).sim.saturation, true, 'l’autre onglet peut agir sur W');
  assert.equal(T1.raw.get('fw:wsown:' + W), null, 'plus aucun onglet ne garde d’action sur W');
  assert.deepEqual([...T1.notes, ...T2.notes], []);
});

test('Réinitialisation dont la réponse se perd, puis un autre appareil écrit : l’action faite ensuite est gardée', async () => {
  const { A, B, id } = await pair();
  const g = A.ws().generation;
  srv.loseIf = (a, who) => { if (who === A.net && a.p_path === 'fwws/' + id && a.p_data.gen === g + 1) { srv.offline.add(A.net); return true; } return false; };
  const r = await on(A, () => A.api.resetWorkspace(A.owner)); A.owner = r.token;
  assert.equal(remote(id).gen, g + 1, 'la réinitialisation est arrivée sur le serveur');
  done(await flag(A, 'degraded'));
  assert.ok(await until(() => B.ws().generation === g + 1));
  done(await flag(B, 'saturation'));
  srv.offline.delete(A.net);
  online();
  assert.ok(await until(() => synced(A, id) && serverWs(id).sim.degraded === true, 20000), 'l’action faite après la réinitialisation est sur le serveur');
  assert.equal(serverWs(id).sim.saturation, true);
  assert.equal(A.api.session(r.token).wsId, id);
  assert.deepEqual(A.notes, []);
  assert.equal(A.events.includes('generation'), false, 'pas de fausse « réinitialisation depuis un autre appareil »');
  assert.ok(await until(() => srv.log.some(x => x[0] === 'purge' && x[1] === id && x[2] === g + 1)), 'le ménage de l’ancienne génération est fait');
});

test('Réinitialisation et invitation faites sans réseau, puis un autre appareil écrit : les liens donnés marchent', async () => {
  const { A, B, id } = await pair();
  const g = A.ws().generation;
  srv.offline.add(A.net);
  const r = await on(A, () => A.api.resetWorkspace(A.owner)); A.owner = r.token;
  done(await flag(A, 'degraded'));
  const inv = await on(A, () => A.api.invite(A.owner, 'U3', 2));
  done(await flag(B, 'saturation'));
  srv.offline.delete(A.net);
  online();
  assert.ok(await until(() => synced(A, id) && serverWs(id).generation === g + 1, 20000));
  assert.equal(A.api.session(r.token).wsId, id, 'le jeton donné par la réinitialisation marche toujours');
  assert.equal(serverWs(id).sim.degraded, true, 'l’action faite après la réinitialisation est gardée');
  assert.ok(await until(() => B.ws().invites.some(i => i.token === inv.token)), 'l’invitation donnée est celle du serveur');
  assert.ok(await on(B, () => B.api.join(id, inv.token)), 'et son lien marche');
  assert.deepEqual(A.notes, []);
});

test('Sauvegarde faite sans réseau puis rejouée : celle de l’autre appareil n’est pas écrasée', async () => {
  const { A, B, id } = await pair();
  const bkSim = n => { const d = srv.docs.get('fwws/' + id + '/bk/' + n); return d ? JSON.parse(strFromU8(gunzipSync(new Uint8Array(Buffer.from(d.data.z, 'base64'))))).sim : null; };
  srv.offline.add(A.net);
  done(await flag(A, 'degraded'));
  done(await exec(A, 'backup.create', {}, admin(A)));
  done(await flag(B, 'saturation'));
  done(await exec(B, 'backup.create', {}, admin(B)));
  assert.ok(await until(() => bkSim(1)));
  const bOne = bkSim(1);
  srv.offline.delete(A.net);
  online();
  assert.ok(await until(() => synced(A, id) && !A.raw.get('fw:upq:' + id) && srv.docs.has('fwws/' + id + '/bk/2'), 20000));
  await sleep(300);
  assert.deepEqual(bkSim(1), bOne, 'la sauvegarde n° 1 du serveur est toujours celle de B');
  assert.equal(bkSim(2).degraded, true, 'celle de A est la n° 2');
  const mine = A.storage.get('fw:bk:' + id + ':1');
  assert.ok(!mine || JSON.parse(mine).sim.degraded === bOne.degraded, 'A n’a plus son ancienne copie n° 1 (au plus celle de B)');
});

test('Suppression dont la réponse se perd : elle est bien faite et un nouvel espace est partagé', async () => {
  const { A, B, id } = await pair();
  srv.loseIf = (a, who) => who === A.net && a.p_path === 'fwws/' + id && a.p_data.deleted === true;
  await on(A, () => A.cloud.drop(id));
  A.api.deleteWorkspace(A.owner);
  const w = A.api.createWorkspace({ name: 'Espace partagé' }); A.owner = w.token;
  await on(A, () => A.cloud.share(w.wsId));
  assert.equal(remote(id).deleted, true);
  assert.ok(await until(() => B.cloudState.wsId === w.wsId, 10000), 'l’autre appareil suit le nouvel espace');
});

test('Suppression puis départ de l’appareil avant le nouveau partage : les autres repartagent seuls', async () => {
  const { A, B, id } = await pair();
  const room = A.room();
  await on(A, () => A.cloud.drop(id));
  A.api.deleteWorkspace(A.owner);
  const w = A.api.createWorkspace({ name: 'Espace partagé' }); A.owner = w.token;
  srv.offline.add(A.net);
  await assert.rejects(on(A, () => A.cloud.share(w.wsId)));
  A.cloud.stop();
  assert.ok(await until(() => B.events.includes('deleted'), 10000));
  assert.ok(await until(() => B.cloudState.status === 'on' && B.cloudState.wsId && B.cloudState.wsId !== id, 20000), B.cloudState.status + ' ' + B.cloudState.wsId);
  const p = srv.docs.get('fw/room/' + room).data;
  assert.equal(p.wsId, B.cloudState.wsId, 'le code de salle mène au nouvel espace');
  const C = await device('C', { room });
  assert.equal(C.cloudState.wsId, B.cloudState.wsId, 'un nouvel appareil qui ouvre le lien le rejoint');
});

test('Connexion faible : des photos qui n’arrivent pas à partir ne ralentissent pas les actions', async () => {
  const { A, id } = await pair();
  const f0 = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (String(url).endsWith('/fw_set') && JSON.parse(opts.body).p_path.includes('/img/')) { await sleep(3000); throw new TypeError('Failed to fetch'); }
    return f0(url, opts);
  };
  try {
    for (let i = 0; i < 3; i++) { A.imgs.set('img_weak' + i + 'abcdefghijk', 'data:image/jpeg;base64,' + 'C'.repeat(400)); on(A, () => A.cloud.putImage(id, 'img_weak' + i + 'abcdefghijk', 'data:image/jpeg;base64,' + 'C'.repeat(400))); }
    await sleep(500);
    for (let k = 0; k < 3; k++) {
      const t0 = Date.now();
      done(await flag(A, 'saturation', k % 2 === 0));
      assert.ok(Date.now() - t0 < 1500, 'action en ' + (Date.now() - t0) + ' ms');
    }
    assert.ok(synced(A, id));
  } finally { globalThis.fetch = f0; }
  assert.ok(await until(() => [0, 1, 2].every(i => srv.docs.has('fwws/' + id + '/img/img_weak' + i + 'abcdefghijk')), 20000), 'les photos partent une fois la connexion revenue');
});

test('Ménage raté après une réinitialisation : il est refait même si un autre appareil écrit entre-temps', async () => {
  const { A, B, id } = await pair();
  const img = 'img_oldgenphotoabcde';
  await photo(A, id, img, 'data:image/jpeg;base64,' + 'D'.repeat(400));
  assert.ok(await until(() => srv.docs.has('fwws/' + id + '/img/' + img)));
  const g = A.ws().generation;
  let once = true;
  srv.refuseIf = fn => fn === 'fw_purge' && once && (once = false, 'indisponible');
  const r = await on(A, () => A.api.resetWorkspace(A.owner)); A.owner = r.token;
  assert.ok(await until(() => B.ws().generation === g + 1));
  done(await flag(B, 'saturation'));
  assert.ok(await until(() => !srv.docs.has('fwws/' + id + '/img/' + img), 20000), 'la photo de l’ancienne génération est effacée du serveur');
  assert.equal(A.cloudState.msgKind === 'refused', false, 'pas de message pour un ménage remis à plus tard');
});

// ---------- Cinquième relecture ----------
const tags = ws => ws.orders.map(o => o.scenario).filter(x => x && x.startsWith('t'));
const order = (d, tag) => exec(d, 'demo.createOrder', { scenario: tag });

test('Page rechargée juste après le retour du réseau : l’action faite sans réseau part quand même', async () => {
  const { A, B, id } = await pair();
  srv.offline.add(B.net);
  done(await order(B, 't1'));
  srv.offline.delete(B.net);
  B.cloud.stop(); // rechargée avant le nouvel essai prévu
  const B2 = await device('B2', { raw: B.raw, owner: B.owner, storedRoom: B.room() });
  assert.equal(B2.cloudState.status, 'on');
  assert.ok(await until(() => tags(serverWs(id)).includes('t1') && synced(B2, id)), 'l’action t1 arrive sur le serveur');
  assert.ok(await until(() => tags(A.ws()).includes('t1')));
  done(await order(A, 't2'));
  assert.ok(await until(() => tags(B2.api._load(id)).join() === 't1,t2'));
  assert.deepEqual(B2.notes, []);
});

test('Page rechargée encore sans réseau, puis réseau revenu : l’action part', async () => {
  const { B, id } = await pair();
  srv.offline.add(B.net);
  done(await order(B, 't1'));
  B.cloud.stop();
  const B2 = await device('B2', { raw: B.raw, owner: B.owner, storedRoom: B.room(), net: B.net });
  assert.equal(B2.cloudState.status, 'local');
  srv.offline.delete(B.net); online();
  assert.ok(await until(() => B2.cloudState.status === 'on', 20000));
  assert.ok(await until(() => tags(serverWs(id)).includes('t1') && synced(B2, id)), 'l’action t1 arrive sur le serveur');
});

test('Réseau qui ne répond plus (demandes bloquées) : l’action est gardée sans attendre 40 s, la suivante tout de suite', async () => {
  const { A, B, id } = await pair();
  const f0 = globalThis.fetch; let hang = true;
  globalThis.fetch = async (url, opts) => {
    if (hang && (als.getStore() || {}).net === B.net) return new Promise((_, rej) => opts.signal.addEventListener('abort', () => rej(new Error('aborted'))));
    return f0(url, opts);
  };
  try {
    const t0 = Date.now();
    const p2 = sleep(200).then(() => order(B, 't2'));
    done(await order(B, 't1'));
    const t1 = Date.now() - t0;
    assert.ok(t1 < 12000, 'première action en ' + t1 + ' ms');
    done(await p2);
    assert.ok(Date.now() - t0 - t1 < 1500, 'deuxième action sans attente');
    const t3 = Date.now(); done(await order(B, 't3'));
    assert.ok(Date.now() - t3 < 1500, 'troisième action sans attente');
    assert.match(B.cloudState.message, /Connexion instable/);
  } finally { hang = false; globalThis.fetch = f0; }
  assert.ok(await until(() => ['t1', 't2', 't3'].every(t => tags(A.ws()).includes(t)), 45000), 'les trois actions arrivent sur le PC');
  assert.equal(serverWs(id).orders.filter(o => o.scenario === 't1').length, 1, 'une seule fois');
});

test('Code tapé pendant la première connexion (réseau lent) : l’espace de l’autre appareil n’est pas remplacé', async () => {
  const A = await device('A');
  assert.ok(await settled(A));
  const wsA = A.cloudState.wsId, roomA = A.room();
  srv.delay = 3000; srv.delayIf = a => /^fwws\/ws_[a-z0-9]+$/.test(a.p_path || '') && a.p_data && a.p_data.v != null; // premier envoi lent
  const B = await device('B', { wait: false });
  await sleep(800);
  assert.equal(B.cloudState.status, 'connecting');
  const r = await on(B, () => B.cloud.joinRoom(roomA));
  await B.started;
  await sleep(3500);
  assert.equal(r.ok, true);
  assert.equal(srv.docs.get('fw/room/' + roomA).data.wsId, wsA, 'le code de A mène toujours à l’espace de A');
  assert.equal(A.cloudState.wsId, wsA);
  assert.equal(B.cloudState.wsId, wsA);
  assert.equal(B.room(), roomA);
});

// Page tuée par le téléphone (pendant une photo, par exemple) : elle ne prévient pas, mais le navigateur libère son verrou.
function kill(d, id) {
  const own = d.raw.get('fw:wsown:' + id);
  d.cloud.stop();
  if (own) { d.raw.set('fw:wsown:' + id, own); heldLocks.delete('fw-tab:' + JSON.parse(own).tab); }
  return own;
}

test('Page tuée sans prévenir puis rouverte sans réseau : elle n’est pas bloquée et tout part au retour', async () => {
  const { A, B, id } = await pair();
  srv.offline.add(B.net);
  done(await order(B, 't1'));
  assert.ok(kill(B, id), 'la page tuée gardait l’action');
  const B2 = await device('B2', { raw: B.raw, owner: B.owner, storedRoom: B.room(), net: B.net });
  done(await order(B2, 't2'));
  srv.offline.delete(B.net); online();
  assert.ok(await until(() => tags(A.ws()).join() === 't1,t2', 20000), 'le PC reçoit les deux actions');
  assert.deepEqual(B2.notes, []);
});

test('Page tuée sans prévenir, un autre appareil écrit, page rouverte : elle reçoit le changement et peut agir', async () => {
  const { A, B, id } = await pair();
  srv.offline.add(B.net);
  done(await order(B, 't1'));
  kill(B, id);
  srv.offline.delete(B.net);
  done(await order(A, 't2'));
  const B2 = await device('B2', { raw: B.raw, owner: B.owner, storedRoom: B.room(), net: B.net });
  assert.ok(await until(() => tags(B2.api._load(id)).includes('t2')), 'la page rouverte reçoit l’action du PC');
  assert.match(B2.notes.join(' '), /n’a pas pu être rejouée/, 'l’action perdue avec la page est signalée');
  done(await order(B2, 't3'));
  assert.ok(await until(() => tags(A.ws()).includes('t3')));
});

test('Sauvegarde envoyée par la version précédente (sans génération) : un autre appareil peut toujours la restaurer', async () => {
  const { A, B, id } = await pair();
  done(await flag(A, 'degraded'));
  done(await exec(A, 'backup.create', {}, admin(A)));
  assert.ok(await until(() => srv.docs.has('fwws/' + id + '/bk/1')));
  delete srv.docs.get('fwws/' + id + '/bk/1').data.gen;
  done(await flag(A, 'degraded', false));
  assert.ok(await until(() => B.ws().backups.length === 1 && B.ws().sim.degraded === false));
  done(await exec(B, 'demo.restore', { n: 1 }));
  assert.equal(B.ws().sim.degraded, true);
});

test('Liaison montante lente (150 kbit/s) : la photo part quand même, et la prise de photo n’attend pas le réseau', async () => {
  const { A, B, id } = await pair();
  srv.upBps = { [A.net]: 150000 };
  const img = 'img_slowuplinkabcdefg', data = 'data:image/jpeg;base64,' + 'A'.repeat(229000);
  const t0 = Date.now();
  await photo(A, id, img, data);
  assert.ok(Date.now() - t0 < 1000, 'photo gardée en ' + (Date.now() - t0) + ' ms');
  done(await flag(A, 'saturation'));
  assert.ok(await until(() => B.ws().sim.saturation === true), 'une action courte passe pendant l’envoi');
  assert.ok(await until(() => srv.docs.has('fwws/' + id + '/img/' + img), 45000), 'la photo arrive sur le serveur');
  assert.equal(srv.log.filter(x => x[0] === 'aborted' && String(x[2]).includes('/img/')).length, 0, 'aucun envoi interrompu');
  assert.ok(await until(() => B.cloud.getImage(id, img).then(v => v === data)), 'l’autre appareil voit la photo');
});

test('Réponse bloquée en route pendant le suivi : l’appareil reprend le suivi', async () => {
  const { A, B, id } = await pair();
  srv.stallIf = (fn, a, who) => fn === 'fw_get' && who === B.net && a.p_path === 'fwws/' + id;
  done(await flag(A, 'saturation'));
  assert.ok(await until(() => srv.log.some(x => x[0] === 'stalled')));
  done(await flag(A, 'degraded'));
  assert.ok(await until(() => B.ws().sim.saturation === true && B.ws().sim.degraded === true, 30000), 'B reçoit les actions de A');
});
