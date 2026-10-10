// Serveur simulé : il tourne dans le navigateur (ou dans Node pour les tests) mais se comporte comme un
// vrai serveur. Chaque appel passe par : session validée → rôle autorisé → périmètre du dossier → règle métier
// → journal d'audit → persistance. Masquer un bouton n'est jamais le contrôle d'accès (CDC 2.2).
import { buildWorkspace, startOfDay, H, DAY } from './seed.js';
import * as D from './domain.js';
import { AppError, SYS, byId, getOrder, audit, emit, notify, addMessage, openBlocker, resolveBlocker, openBlockers, transition } from './domain.js';
import { STATE_INFO, BLOCKER_TYPES, ROLES, DOC_TYPES, REPORT_TYPES, APPT_STATES, PAYMENT_STATES, ZONES, CHECKLIST_TECH, stateRank, ORDER_STATES, OFFERS, SHOP_ZONES, DOSSIER_DOCS, TECH_DOCS, SLOT_HOURS, PREP_CHECKLIST, hourLabel } from './model.js';
import { estimate, risk, assistantAnswer, summarize, evaluate, fmtDate, fmtDateTime } from './ai.js';
import { SCENARIOS, runScenarioSetup } from './scenarios.js';
import { techAnswer } from './techhelp.js';

const READONLY = ['auditeur'];
const STAFF_ALL = ['conseiller', 'planificateur', 'technicien', 'superviseur', 'admin', 'auditeur'];

export function createBackend({ storage, realNow = () => Date.now(), lock = null, onChange = () => {} }) {
  const cache = {};
  const K = { reg: 'fw:reg', ws: id => 'fw:ws:' + id, v: id => 'fw:wsv:' + id, n: id => 'fw:wsn:' + id, bk: (id, n) => 'fw:bk:' + id + ':' + n };
  const readReg = () => { try { return JSON.parse(storage.get(K.reg) || 'null') || { workspaces: [], sessions: {} }; } catch { return { workspaces: [], sessions: {} }; } };
  const writeReg = r => storage.set(K.reg, JSON.stringify(r));
  const freshRand = (n = 24) => { let s = ''; const a = 'abcdefghijkmnpqrstuvwxyz23456789'; const c = globalThis.crypto; const b = new Uint8Array(n); if (c && c.getRandomValues) c.getRandomValues(b); else for (let i = 0; i < n; i++) b[i] = Math.floor(Math.random() * 256); for (const x of b) s += a[x % a.length]; return s; };
  // Les valeurs tirées au hasard pendant une écriture (jetons de session, codes d'invitation) sont notées : si l'écriture est
  // rejouée sur une version plus récente (partage entre appareils), elle redonne les mêmes, et les liens déjà donnés marchent.
  let draw = null;
  const rand = (n = 24) => (draw ? draw('s' + n, () => freshRand(n)) : freshRand(n));
  const rnum = () => (draw ? draw('f', Math.random) : Math.random());

  // Le cache d'un onglet vaut tant que la version et le numéro aléatoire de la dernière écriture n'ont pas changé :
  // un autre onglet (ou un autre appareil) peut écrire un état différent sous le même numéro de version.
  function load(id) {
    const v = storage.get(K.v(id));
    if (v == null) return null;
    const n = storage.get(K.n(id));
    if (cache[id] && String(cache[id].version) === v && cache[id]._n === n) return cache[id];
    const raw = storage.get(K.ws(id));
    if (!raw) return null;
    const ws = JSON.parse(raw);
    if (cache[id] && cache[id]._models && cache[id].seed === ws.seed) ws._models = cache[id]._models;
    ws._n = n;
    cache[id] = ws;
    return ws;
  }
  function save(ws) {
    ws.version++;
    storage.set(K.ws(ws.id), JSON.stringify(ws, (k, v) => (k[0] === '_' ? undefined : v)));
    storage.set(K.v(ws.id), String(ws.version));
    ws._n = freshRand(8);
    storage.set(K.n(ws.id), ws._n);
    cache[ws.id] = ws;
    const reg = readReg(); const e = reg.workspaces.find(w => w.id === ws.id);
    if (e) { e.name = ws.name; e.generation = ws.generation; e.expiresAt = ws.expiresAt; writeReg(reg); }
    onChange(ws.id, ws.version);
  }
  const withLock = (id, fn) => {
    const drawn = [];
    const run = () => {
      let i = 0; const prev = draw;
      draw = (kind, make) => { if (i < drawn.length && drawn[i].kind === kind) return drawn[i++].v; const v = make(); drawn[i++] = { kind, v }; drawn.length = i; return v; };
      try { return fn(); } finally { draw = prev; }
    };
    return lock ? lock('fw-' + id, run) : Promise.resolve().then(run);
  };

  // ---------- Sessions et identité de démonstration (CDC 7.3, 11.1) ----------
  function session(token) {
    const reg = readReg();
    const s = reg.sessions[token];
    if (!s) throw new AppError('session', 'Session inconnue ou expirée. Rouvrez votre espace depuis le laboratoire.');
    if (s.expiresReal < realNow()) throw new AppError('session', 'Session expirée.');
    const ws = load(s.wsId);
    if (!ws) throw new AppError('session', 'Cet espace de test n’existe plus (supprimé ou expiré).');
    if (ws.expiresAt < realNow()) { purge(ws.id); throw new AppError('session', 'Cet espace de test a expiré et ses données ont été effacées.'); }
    if (s.gen !== ws.generation) throw new AppError('session', 'L’espace a été réinitialisé : les anciens liens ne fonctionnent plus. Rouvrez-le depuis le laboratoire.');
    const user = byId(ws.users, s.userId);
    if (!user || !user.active) throw new AppError('session', 'Ce compte a été désactivé.');
    if (s.inviteToken) { const inv = ws.invites.find(i => i.token === s.inviteToken); if (!inv || inv.revoked) throw new AppError('session', 'L’invitation utilisée a été révoquée.'); }
    return { s, ws, user };
  }
  function newSession(reg, wsId, userId, gen, extra = {}) {
    const token = 'st_' + rand();
    reg.sessions[token] = { wsId, userId, gen, createdReal: realNow(), expiresReal: realNow() + 12 * H, ...extra };
    return token;
  }

  function purge(id) {
    const reg = readReg();
    reg.workspaces = reg.workspaces.filter(w => w.id !== id);
    for (const t in reg.sessions) if (reg.sessions[t].wsId === id) delete reg.sessions[t];
    writeReg(reg);
    for (const k of storage.keys()) if (k === K.ws(id) || k === K.v(id) || k === K.n(id) || k === 'fw:wsbase:' + id || k === 'fw:wsroom:' + id || k === 'fw:wsown:' + id || k === 'fw:upq:' + id || k.startsWith('fw:bk:' + id + ':')) storage.remove(k);
    delete cache[id];
    onChange(id, -1);
  }

  function warmUp(ws) {
    // Met les dossiers de départ dans des états variés, en rejouant de vrais événements datés dans le passé.
    const real = ws.clock;
    const at = (hAgo, fn) => { ws.clock = real - hAgo * H; fn(); };
    const O = n => byId(ws.orders, 'O' + n);
    const pay = (o, hAgo) => at(hAgo, () => { emit(ws, o, 'DOSSIER_RECU', { source: 'Moov Prospect (simulé)', publicText: STATE_INFO.DOSSIER_RECU.client }); D.confirmPayment(ws, o, { source: 'Moov Money (simulé)' }); });
    const ready = (o, hAgo) => at(hAgo, () => D.markReady(ws, o, byId(ws.users, 'U5')));
    for (const o of ws.orders) o.createdAt = real - 200 * H;
    pay(O(1), 50); ready(O(1), 20);
    pay(O(2), 45); ready(O(2), 18);
    pay(O(3), 30);
    // O4 : rendez-vous confirmé demain avec l'équipe Sud, visible dans l'application terrain.
    pay(O(4), 120); ready(O(4), 90);
    at(80, () => {
      // O4 : visite confirmée demain matin avec l'Équipe Cocody 1 (Brice), visible dans l'application terrain.
      const tomorrow = startOfDay(real) + DAY; const cap = ws.capacity.find(c => c.teamId === 'T1' && c.date >= tomorrow && c.slot === 'm');
      const h = D.holdSlot(ws, O(4), { date: cap.date, slot: 'm' }, SYS, ws.lastReal); h.capId = cap.id; h.teamId = 'T1'; D.bookHold(ws, O(4), h.id, SYS, ws.lastReal);
      const appt = byId(ws.appointments, O(4).apptId); D.confirmAppointment(ws, O(4), appt, byId(ws.users, 'U5'), { teamId: 'T1' });
    });
    pay(O(5), 100); at(96, () => { O(5).requiredDocs = ['justif_domicile']; openBlocker(ws, O(5), 'PIECE_MANQUANTE', { actor: byId(ws.users, 'U4'), detail: 'Justificatif de domicile' }); });
    at(70, () => emit(ws, O(7), 'DOSSIER_RECU', { source: 'Import manuel', publicText: STATE_INFO.DOSSIER_RECU.client }));
    at(69, () => openBlocker(ws, O(7), 'PAIEMENT_NON_RAPPROCHE', { detail: 'Dossier importé sans justificatif vérifiable' }));
    pay(O(8), 260); ready(O(8), 240);
    at(230, () => { const o = O(8); o.state = 'SERVICE_ACTIF'; o.stateSince = ws.clock; o.version++; emit(ws, o, 'SERVICE_ACTIF', { source: 'Historique importé', publicText: STATE_INFO.SERVICE_ACTIF.client }); });
    pay(O(9), 150); at(140, () => openBlocker(ws, O(9), 'ADRESSE_AMBIGUE', { actor: byId(ws.users, 'U5'), detail: 'Plusieurs lots au même numéro' }));
    at(150, () => { const b = openBlockers(ws, 'O9')[0]; if (b) { b.ownerUserId = null; } });
    pay(O(10), 60);
    pay(O(11), 30); ready(O(11), 10);
    at(40, () => emit(ws, O(6), 'DOSSIER_RECU', { source: 'Moov Prospect (simulé)', publicText: STATE_INFO.DOSSIER_RECU.client }));
    ws.clock = real;
    // Démo en direct : Brice (Équipe Cocody 1), le technicien présenté partout, garde une place sur les premiers créneaux.
    const firstDays = [...new Set(ws.capacity.map(c => c.date))].sort((x, y) => x - y).slice(0, 3);
    for (const c of ws.capacity) if (c.teamId === 'T1' && firstDays.includes(c.date) && c.cap <= c.used) c.cap = Math.min(6, c.used + 1);
    for (const n of ws.notifications) n.read = true;
    ws.outbox = []; ws.jobs = [];
  }

  function createWorkspace({ name, seed } = {}) {
    const id = 'ws_' + rand(12);
    const sd = Number.isFinite(seed) ? seed : Math.floor(Math.random() * 1e6);
    const ws = buildWorkspace({ id, name: name || 'Mon espace de test', seed: sd, realNow: realNow() });
    warmUp(ws);
    audit(ws, { id: 'OWNER', name: 'Testeur', role: 'testeur' }, 'espace.creer', id, 'Graine ' + sd);
    const reg = readReg();
    reg.workspaces.push({ id, name: ws.name, createdAt: ws.createdAt, expiresAt: ws.expiresAt, generation: ws.generation });
    const token = newSession(reg, id, 'U1', ws.generation, { owner: true });
    writeReg(reg);
    ws.version = 0; save(ws);
    return { wsId: id, token };
  }

  // ---------- Contrôle d'accès au dossier (côté serveur) ----------
  function canSee(ws, user, order, scope) {
    switch (user.role) {
      case 'client': return order.customerId === user.id;
      case 'representant': return ws.delegations.some(d => d.orderId === order.id && d.delegateId === user.id && !d.revoked && d.until > ws.clock && (!scope || d.scopes.includes(scope)));
      case 'conseiller': case 'planificateur': return (user.zones || []).includes(order.zone);
      case 'technicien': return ws.workOrders.some(w => w.orderId === order.id && w.techUserId === user.id && w.status !== 'annulee');
      default: return ['superviseur', 'admin', 'auditeur'].includes(user.role);
    }
  }
  function scopedOrder(ws, user, orderId, scope) {
    const o = byId(ws.orders, orderId);
    // Même message qu'un dossier inexistant : on ne révèle pas son existence (R-05).
    if (!o || !canSee(ws, user, o, scope)) throw new AppError('introuvable', 'Dossier introuvable ou non autorisé.');
    return o;
  }

  // Pièces demandées encore sans version envoyée valable (validée ou en cours de vérification).
  const missingDocs = (ws, o) => (o.requiredDocs || []).filter(t => !ws.documents.some(d => d.orderId === o.id && d.type === t && ['analyse', 'a_valider', 'valide'].includes(d.status)));
  // Chaque pièce est jugée sur sa dernière version : une ancienne photo validée ne couvre pas une nouvelle à relire ou refusée.
  const lastDoc = (ws, o, t) => ws.documents.filter(d => d.orderId === o.id && d.type === t && d.status !== 'remplace').at(-1);
  const unvalidatedDocs = (ws, o) => (o.requiredDocs || []).filter(t => (lastDoc(ws, o, t) || {}).status !== 'valide');
  const draftDossier = o => !!(o.dossier && !o.dossier.submittedAt);
  const advisorFor = (ws, o) => ws.users.find(u => u.role === 'conseiller' && u.active && (u.zones || []).includes(o.zone)) || null;
  const activeWo = (ws, orderId, techId) => ws.workOrders.find(w => w.orderId === orderId && w.techUserId === techId && !['terminee', 'annulee', 'echec'].includes(w.status));

  // ---------- Commandes ----------
  const C = {};
  const cmd = (name, roles, fn, opts = {}) => { C[name] = { roles, fn, ...opts }; };
  const CLIENTISH = ['client', 'representant'];

  cmd('claim.start', ['client'], ({ ws, user, args }) => {
    const ref = String(args.ref || '').trim().toUpperCase();
    user.claimTries = (user.claimTries || 0) + 1;
    if (user.claimTries > 8) throw new AppError('limite', 'Trop d’essais. Réessayez plus tard ou contactez le service client.');
    const o = ws.orders.find(x => x.ref === ref && !x.claimed && x.contactPhone === user.phone);
    if (o) {
      const code = String(100000 + Math.floor(rnum() * 899999));
      o.claimCode = { code, userId: user.id, exp: ws.lastReal + 10 * 60e3 };
      ws.outbox.push({ id: 'SMS' + (++ws.seq), userId: user.id, to: user.phone, channel: 'sms', text: 'Moov Fibre (démo) : votre code de rattachement est ' + code + '. Il expire dans 10 minutes.', at: ws.clock, attempts: 1, status: 'livré (accusé simulé)', provider: 'identité démo' });
    }
    audit(ws, user, 'rattachement.demande', ref, o ? 'code envoyé' : 'aucune correspondance');
    // Réponse identique dans tous les cas : pas de divulgation d'existence (CL-01).
    return { message: 'Si cette référence correspond à votre numéro vérifié, un code vient d’être envoyé par SMS (voir la boîte d’envoi simulée du laboratoire).' };
  });
  cmd('claim.verify', ['client'], ({ ws, user, args }) => {
    const ref = String(args.ref || '').trim().toUpperCase();
    const o = ws.orders.find(x => x.ref === ref && !x.claimed);
    if (!o || !o.claimCode || o.claimCode.userId !== user.id || o.claimCode.exp < ws.lastReal || o.claimCode.code !== String(args.code || '').trim()) throw new AppError('code', 'Code invalide ou expiré.');
    o.claimed = true; o.customerId = user.id; delete o.claimCode; o.version++; user.claimTries = 0;
    emit(ws, o, 'DOSSIER_RATTACHE', { actor: user, publicText: 'Dossier rattaché à votre compte.' });
    audit(ws, user, 'rattachement.valide', o.ref);
    return { orderId: o.id };
  });

  cmd('order.updateAddress', ['client'], ({ ws, user, order, args }) => {
    const a = order.address;
    const before = JSON.stringify(a);
    for (const k of ['landmark', 'accessNotes', 'floor', 'building']) if (args[k] != null) a[k] = String(args[k]).slice(0, 300);
    if (args.lat != null && args.lng != null) { a.lat = Number(args.lat); a.lng = Number(args.lng); }
    // La personne présente le jour J est rangée avec l'adresse : le nom du client ne change pas.
    if (args.onsiteContact != null) a.onsiteContact = String(args.onsiteContact).trim().slice(0, 80);
    if (args.gps === false) { a.lat = null; a.lng = null; }
    const after = JSON.stringify(a);
    if (after === before) return { unchanged: true };
    order.version++; order.updatedAt = ws.clock;
    emit(ws, order, 'ADRESSE_PRECISEE', { actor: user, payload: { landmark: a.landmark, gps: a.lat != null }, publicText: 'Vous avez précisé votre adresse.' });
    const b = openBlockers(ws, order.id).find(b => b.type === 'ADRESSE_AMBIGUE');
    if (b && a.landmark && a.landmark.length >= 8) resolveBlocker(ws, b, { actor: user, resolution: 'Repère fourni par le client : « ' + a.landmark + ' »' + (a.lat != null ? ' + point GPS' : '') });
    const adv = advisorFor(ws, order);
    if (b && adv) notify(ws, adv.id, { title: 'Adresse précisée', body: order.ref + ' : ' + (a.landmark || 'repère'), orderId: order.id, kind: 'tache' });
    return { unchanged: false, blockerOpen: !!b && b.status !== 'resolu' };
  }, { order: true });

  cmd('doc.upload', ['client'], ({ ws, user, order, args }) => {
    if (!DOC_TYPES[args.type]) throw new AppError('fichier', 'Type de pièce inconnu.');
    D.docCheck(args);
    for (const d of ws.documents.filter(d => d.orderId === order.id && d.type === args.type && ['analyse', 'a_valider', 'refuse'].includes(d.status))) d.status = 'remplace';
    const suspicious = /(ignore|instruction|admin|valide automatiquement)/i.test(args.name);
    const doc = { id: 'DOC' + (++ws.seq), orderId: order.id, type: args.type, name: String(args.name).slice(0, 120), size: args.size, mime: args.mime, thumb: D.smallThumb(args.thumb), img: D.imgRef(args.img), status: 'analyse', reason: null, suspicious, at: ws.clock, by: user.name, check: String(args.mime || '').startsWith('image/') ? D.photoCheck(args.quality) : null };
    ws.documents.push(doc);
    order.updatedAt = ws.clock; order.version++;
    { const b = openBlockers(ws, order.id).find(b => b.type === 'PIECE_MANQUANTE'); if (b) { const m = missingDocs(ws, order); b.detail = m.length ? m.map(t => DOC_TYPES[t].label).join(', ') : 'Pièce(s) reçue(s), vérification par le conseiller'; } }
    ws.jobs.push({ id: 'J' + (++ws.seq), kind: 'scan', ref: doc.id, due: ws.clock + 6e3, generation: ws.generation, attempts: 0 });
    emit(ws, order, 'PIECE_DEPOSEE', { actor: user, payload: { type: args.type }, publicText: 'Pièce envoyée : ' + DOC_TYPES[args.type].label + '. Vérification en cours.' });
    // Dossier en ligne pas encore envoyé : la conseillère sera prévenue une seule fois, à l'envoi du dossier complet.
    const adv = draftDossier(order) ? null : advisorFor(ws, order);
    if (adv) notify(ws, adv.id, { title: 'Nouvelle pièce reçue', body: order.ref + ' : ' + DOC_TYPES[args.type].label + (doc.check && !doc.check.ok ? ' (photo ' + doc.check.issues.join(', ') + ' selon le contrôle automatique)' : ' (contrôle automatique en cours, quelques secondes)'), orderId: order.id, kind: 'tache' });
    return doc;
  }, { order: true });

  cmd('appt.hold', ['client', 'representant', 'conseiller', 'planificateur'], ({ ws, user, order, args, realNow }) => D.holdSlot(ws, order, args, user, realNow), { order: true, scope: 'rdv' });
  cmd('appt.book', ['client', 'representant', 'conseiller', 'planificateur'], ({ ws, user, order, args, realNow }) => {
    const a = D.bookHold(ws, order, args.holdId, user, realNow);
    audit(ws, user, 'rdv.reserver', order.ref, fmtDate(a.date) + ' ' + D.slotLabel(a.slot));
    return a;
  }, { order: true, scope: 'rdv' });
  cmd('appt.cancel', ['client', 'representant', 'conseiller', 'planificateur'], ({ ws, user, order, args }) => {
    const a = byId(ws.appointments, order.apptId);
    if (!a) throw new AppError('introuvable', 'Aucun rendez-vous.');
    D.cancelAppointment(ws, order, a, user, args.reason || 'Annulé par ' + ROLES[user.role].label.toLowerCase(), { force: ['conseiller', 'planificateur'].includes(user.role) });
  }, { order: true, scope: 'rdv' });
  const prepReady = o => PREP_CHECKLIST.filter(i => i.need).every(i => o.prep[i.id]);
  cmd('prep.toggle', ['client', 'representant'], ({ ws, user, order, args }) => {
    if (!PREP_CHECKLIST.some(i => i.id === args.id)) throw new AppError('prep', 'Point de préparation inconnu.');
    const before = prepReady(order);
    order.prep[args.id] = !!args.value; order.updatedAt = ws.clock;
    // Toute la liste indispensable vient d'être cochée : le technicien de la visite est prévenu.
    const wo = ws.workOrders.find(w => w.orderId === order.id && ['affectee', 'en_route'].includes(w.status));
    if (!before && prepReady(order) && wo) notify(ws, wo.techUserId, { title: 'Le client est prêt pour la visite', body: order.ref + ' : ' + user.name.split(' ')[0] + ' a coché la préparation (présence, accès, prise libre' + (order.prep.animaux ? ', animaux enfermés' : '') + ').', orderId: order.id, kind: 'tache' });
  }, { order: true, scope: 'rdv' });

  cmd('msg.send', ['client', 'representant'], ({ ws, user, order, args }) => {
    const text = String(args.text || '').trim().slice(0, 1000);
    if (!text) throw new AppError('vide', 'Message vide.');
    const m = addMessage(ws, order, { from: 'client', author: user, text });
    order.updatedAt = ws.clock;
    const adv = advisorFor(ws, order);
    if (adv) notify(ws, adv.id, { title: 'Nouveau message client', body: order.ref + ' : ' + text.slice(0, 80), orderId: order.id, kind: 'tache' });
    // Accusé de réception automatique : une fois, pas après chaque message.
    const lastAuto = ws.messages.filter(x => x.orderId === order.id && x.auto).at(-1);
    const staffSince = lastAuto && ws.messages.some(x => x.orderId === order.id && x.from === 'staff' && x.visibility === 'public' && x.eventSeq > lastAuto.eventSeq);
    if (!lastAuto || staffSince || ws.clock - lastAuto.at > 4 * H) addMessage(ws, order, { from: 'auto', author: SYS, text: 'Message bien reçu. Un conseiller vous répond en général sous 4 h ouvrées.', auto: true });
    return m;
  }, { order: true, scope: 'messages' });

  cmd('assistant.ask', ['client', 'representant'], ({ ws, user, order, args }) => {
    if (ws.sim.degraded) throw new AppError('degrade', 'Mode dégradé : l’assistant est suspendu. Vos informations de dossier restent visibles, et un conseiller peut vous répondre.');
    const q = String(args.question || '').slice(0, 500);
    const ans = assistantAnswer(ws, order, q, ws.docs.filter(d => d.scope === 'public'));
    (ws.assistantLog ||= []).push({ id: 'AI' + (++ws.seq), orderId: order && order.id, userId: user.id, q, at: ws.clock, intent: ans.trace.intent, refused: ans.trace.refused, blocks: ans.blocks.map(b => b.kind) });
    audit(ws, user, 'ia.assistant', order ? order.ref : '—', (ans.trace.refused ? 'REFUS : ' : (ans.trace.intent || 'abstention') + ' : ') + q.slice(0, 80), { ai: true });
    return ans;
  }, { order: true, scope: 'messages' });
  cmd('assistant.handoff', ['client', 'representant'], ({ ws, user, order, args }) => {
    const t = { id: 'TK' + (++ws.seq), orderId: order.id, type: 'question_assistant', text: String(args.question || '').slice(0, 500), status: 'ouvert', ownerRole: 'conseiller', at: ws.clock, by: user.name };
    ws.tickets.push(t);
    addMessage(ws, order, { from: 'auto', author: SYS, text: 'Votre question a été transmise à un conseiller : « ' + t.text + ' ».', auto: true });
    const adv = ws.users.find(u => u.role === 'conseiller' && u.zones.includes(order.zone));
    if (adv) notify(ws, adv.id, { title: 'Question transférée par l’assistant', body: order.ref + ' : ' + t.text.slice(0, 80), orderId: order.id, kind: 'tache' });
    return t;
  }, { order: true, scope: 'messages' });

  cmd('callback.request', ['client', 'representant'], ({ ws, user, order, args }) => {
    const adv = ws.users.find(u => u.role === 'conseiller' && u.zones.includes(order.zone));
    const cb = { id: 'CB' + (++ws.seq), orderId: order.id, reason: String(args.reason || '').slice(0, 300), availability: args.availability || 'Dès que possible', status: 'demande', ownerUserId: adv ? adv.id : null, ownerName: adv ? adv.name : '—', at: ws.clock };
    ws.callbacks.push(cb);
    emit(ws, order, 'RAPPEL_DEMANDE', { actor: user, publicText: 'Demande de rappel enregistrée (' + cb.availability + ').' });
    if (adv) notify(ws, adv.id, { title: 'Demande de rappel', body: order.ref + ' — ' + cb.availability, orderId: order.id, kind: 'tache' });
    return cb;
  }, { order: true, scope: 'messages' });

  cmd('report.create', ['client', 'representant'], ({ ws, user, order, args }) => {
    if (!REPORT_TYPES[args.type]) throw new AppError('type', 'Type de signalement inconnu.');
    if (args.type === 'tech_absent' && !ws.workOrders.some(w => w.orderId === order.id && ['affectee', 'en_route', 'sur_place'].includes(w.status))) throw new AppError('etat', 'Aucune visite de technicien n’est prévue en ce moment sur ce dossier.');
    if (args.type === 'pas_internet' && stateRank(order.state) < stateRank('INSTALLATION_TERMINEE')) throw new AppError('etat', 'L’installation n’est pas encore faite : Internet arrivera après le passage du technicien et l’activation.');
    const map = { tech_absent: 'TECHNICIEN_ABSENT', adresse: 'ADRESSE_AMBIGUE', pas_internet: 'SERVICE_KO' };
    const t = { id: 'TK' + (++ws.seq), orderId: order.id, type: 'signalement:' + args.type, text: String(args.text || '').slice(0, 500), status: 'ouvert', ownerRole: args.type === 'tech_absent' ? 'planificateur' : 'conseiller', at: ws.clock, by: user.name };
    ws.tickets.push(t);
    emit(ws, order, 'SIGNALEMENT', { actor: user, payload: { type: args.type }, publicText: 'Signalement : ' + REPORT_TYPES[args.type] + '.' });
    if (map[args.type]) openBlocker(ws, order, map[args.type], { actor: user, detail: 'Signalé par le client' + (t.text ? ' : ' + t.text : '') });
    else { const sup = ws.users.find(u => u.role === 'superviseur'); notify(ws, sup.id, { title: 'Dossier signalé bloqué par le client', body: order.ref + (t.text ? ' : ' + t.text : ''), orderId: order.id, kind: 'alerte' }); }
    return t;
  }, { order: true });

  cmd('prefs.set', ['client', 'representant'], ({ user, args }) => { for (const k of ['sms', 'whatsapp', 'push']) if (k in args) user.prefs[k] = !!args[k]; });
  cmd('notif.read', null, ({ ws, user, args }) => { for (const n of ws.notifications) if (n.userId === user.id && (args.all || n.id === args.id)) n.read = true; }, { noAudit: true, readOnlyOk: true });

  cmd('activation.feedback', ['client'], ({ ws, user, order, args }) => {
    if (order.state !== 'SERVICE_ACTIF') throw new AppError('etat', 'Le service n’est pas encore activé.');
    order.clientCheck = { works: !!args.works, at: ws.clock, speed: args.speed || null };
    emit(ws, order, 'CONTROLE_CLIENT', { actor: user, payload: order.clientCheck, publicText: args.works ? 'Vous avez confirmé que la connexion fonctionne.' : 'Vous avez signalé que la connexion ne fonctionne pas.' });
    if (!args.works) openBlocker(ws, order, 'SERVICE_KO', { actor: user, detail: 'Contrôle client négatif après activation' });
  }, { order: true });

  cmd('feedback.submit', ['client'], ({ ws, user, order, args }) => {
    if (!['SERVICE_ACTIF', 'CLOTURE'].includes(order.state)) throw new AppError('etat', 'L’avis est demandé après l’activation.');
    if (ws.feedback.some(f => f.orderId === order.id)) throw new AppError('doublon', 'Vous avez déjà donné votre avis. Merci !');
    const score = Math.max(1, Math.min(5, Number(args.score) || 0));
    const f = { id: 'FB' + (++ws.seq), orderId: order.id, score, comment: String(args.comment || '').slice(0, 500), at: ws.clock, followUp: score <= 2 ? 'ouvert' : null };
    ws.feedback.push(f);
    emit(ws, order, 'AVIS_CLIENT', { actor: user, payload: { score }, publicText: 'Merci pour votre avis (' + score + '/5).' });
    if (score <= 2) { const sup = ws.users.find(u => u.role === 'superviseur'); ws.tickets.push({ id: 'TK' + (++ws.seq), orderId: order.id, type: 'insatisfaction', text: f.comment, status: 'ouvert', ownerRole: 'superviseur', at: ws.clock, by: user.name }); notify(ws, sup.id, { title: 'Client insatisfait', body: order.ref + ' : ' + score + '/5', orderId: order.id, kind: 'alerte' }); }
    return f;
  }, { order: true });

  cmd('cancel.request', ['client'], ({ ws, user, order, args }) => {
    if (order.cancelled || ws.refunds.some(r => r.orderId === order.id && r.status !== 'rejete')) throw new AppError('doublon', 'Une demande d’annulation existe déjà.');
    if (stateRank(order.state) >= stateRank('INSTALLATION_TERMINEE')) throw new AppError('etat', 'L’installation est faite : l’annulation passe par le service client (résiliation).');
    if (D.missionUnderway(ws, order)) throw new AppError('etat', 'Le technicien est déjà en route ou chez vous : parlez-lui ou écrivez à votre conseiller.');
    const r = { id: 'RB' + (++ws.seq), orderId: order.id, reason: String(args.reason || '').slice(0, 300), status: 'demande', steps: [{ at: ws.clock, by: user.name, what: 'Demande client' }], amount: null };
    ws.refunds.push(r);
    order.payment.status = order.payment.status === 'confirme' ? 'rembourse_demande' : order.payment.status;
    openBlocker(ws, order, 'ANNULATION', { actor: user, detail: r.reason });
    return r;
  }, { order: true });

  cmd('privacy.request', ['client'], ({ ws, user, args }) => {
    if (ws.privacy.some(x => x.userId === user.id && x.kind === args.kind && x.status === 'reçue')) throw new AppError('doublon', 'Vous avez déjà une demande de ce type en cours : l’équipe Moov y répond sous 30 jours.');
    const p = { id: 'RGPD' + (++ws.seq), userId: user.id, kind: args.kind, text: String(args.text || '').slice(0, 500), status: 'reçue', at: ws.clock, due: ws.clock + 30 * DAY };
    ws.privacy.push(p);
    const adm = ws.users.find(u => u.role === 'admin'); notify(ws, adm.id, { title: 'Demande sur les données personnelles', body: user.name + ' : ' + args.kind, kind: 'tache' });
    return p;
  });
  cmd('delegation.add', ['client'], ({ ws, user, order, args }) => {
    const del = byId(ws.users, args.delegateId);
    if (!del || del.role !== 'representant') throw new AppError('introuvable', 'Représentant inconnu.');
    const d = { id: 'DL' + (++ws.seq), orderId: order.id, clientId: user.id, delegateId: del.id, scopes: (args.scopes || ['rdv']).filter(s => ['rdv', 'messages'].includes(s)), from: ws.clock, until: ws.clock + (Number(args.days) || 30) * DAY, revoked: false };
    ws.delegations.push(d);
    emit(ws, order, 'DELEGATION', { actor: user, publicText: 'Délégation accordée à ' + del.name + '.' });
    return d;
  }, { order: true });
  cmd('delegation.revoke', ['client'], ({ ws, user, args }) => {
    const d = ws.delegations.find(x => x.id === args.id && x.clientId === user.id);
    if (!d) throw new AppError('introuvable', 'Délégation introuvable.');
    d.revoked = true; d.revokedAt = ws.clock;
    emit(ws, getOrder(ws, d.orderId), 'DELEGATION_REVOQUEE', { actor: user, publicText: 'Délégation révoquée.' });
  });

  // ----- Parcours en ligne : site des offres, dossier sous 24 h, appel, note du technicien -----
  // Achat sur le site de démonstration : le paiement Moov Money est simulé (code affiché à l'écran, aucun vrai
  // paiement), puis passe par le connecteur de paiement comme un vrai webhook signé. Le dossier est créé tout de suite.
  cmd('shop.purchase', ['client'], ({ ws, user, s, args }) => {
    if (!s.owner) throw new AppError('interdit', 'Le site des offres de démonstration est réservé au propriétaire de l’espace.');
    const offer = OFFERS.find(x => x.id === args.offerId);
    if (!offer) throw new AppError('offre', 'Choisissez une offre.');
    const zone = String(args.zone || '');
    if (!SHOP_ZONES.includes(zone)) throw new AppError('zone', ZONES.some(z => z.id === zone) ? 'La fibre n’est pas encore ouverte à la vente en ligne dans cette commune.' : 'Choisissez votre commune.');
    const name = String(args.name || '').trim().replace(/\s+/g, ' ').slice(0, 60);
    if (name.length < 3 || !/[a-zà-ÿ]/i.test(name)) throw new AppError('nom', 'Indiquez votre prénom et votre nom.');
    const digits = String(args.phone || '').replace(/\D/g, '');
    if (digits.length < 8 || digits.length > 15) throw new AppError('tel', 'Numéro de téléphone incomplet.');
    const street = String(args.street || '').trim().slice(0, 120);
    if (street.length < 3) throw new AppError('adresse', 'Indiquez votre quartier et votre rue.');
    // Même nom qu'un client de l'espace : c'est lui qui achète. Sinon, un nouveau client est créé (personnage jouable).
    let cust = ws.users.find(u => u.role === 'client' && u.name.toLowerCase() === name.toLowerCase());
    if (!cust) {
      if (ws.users.filter(u => u.role === 'client').length >= 20) throw new AppError('limite', 'Cet espace compte déjà 20 clients : réutilisez un nom existant ou réinitialisez l’espace.');
      const n = Math.max(0, ...ws.users.map(u => Number(String(u.id).slice(1)) || 0)) + 1;
      const fmt = digits.length === 10 ? '+225 ' + digits.replace(/(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/, '$1 $2 $3 $4 $5') : '+' + digits;
      cust = { id: 'U' + n, role: 'client', name, phone: fmt, active: true, zones: ZONES.map(z => z.id), prefs: { sms: true, whatsapp: false, push: true }, fromShop: true };
      ws.users.push(cust);
    }
    const id = 'O' + (ws.seq + 1000); ws.seq++;
    const o = {
      id, ref: nextRef(ws), customerId: cust.id, claimed: true, contactPhone: cust.phone, contactName: cust.name,
      offer: offer.name + ' ' + offer.speed, offerId: offer.id, equipmentModel: 'ONT ZTE F670L', zone,
      address: { commune: ZONES.find(z => z.id === zone).name, street, landmark: String(args.landmark || '').trim().slice(0, 200), building: args.building === 'immeuble' ? 'immeuble' : 'maison', floor: '', lat: null, lng: null, accessNotes: '', verified: false },
      state: 'DOSSIER_RECU', stateSince: ws.clock, version: 1, createdAt: ws.clock, updatedAt: ws.clock, source: 'Site des offres (démo)',
      payment: { ref: 'MM-' + (600000000 + ws.seq), amount: offer.pay, currency: 'XOF', status: 'en_attente', payer: '•••• ' + digits.slice(-2) },
      apptId: null, woId: null, cancelled: false, prep: {}, scenario: null, linkedTo: null, portReserved: false, clientCheck: null, paidAt: null,
      requiredDocs: [...DOSSIER_DOCS], docNotes: {}, dossier: { openedAt: null, dueAt: null, submittedAt: null },
    };
    ws.orders.push(o);
    emit(ws, o, 'DOSSIER_RECU', { source: 'Site des offres (démo)', actor: cust, publicText: 'Commande reçue : ' + offer.name + ' ' + offer.speed + '.' });
    const r = D.ingest(ws, D.makeEnvelope(ws, 'payment.confirmed', o, { reference: o.payment.ref, amount: o.payment.amount, currency: 'XOF' }, { source: 'Moov Money (simulé)' }));
    if (r.status !== 'traite') throw new AppError('paiement', 'Paiement non confirmé : ' + r.note);
    o.dossier.openedAt = ws.clock; o.dossier.dueAt = ws.clock + (Number(ws.config.dossierDeadlineH) || 24) * H;
    notify(ws, cust.id, { title: 'Complétez votre dossier', body: 'Vous avez ' + (Number(ws.config.dossierDeadlineH) || 24) + ' h pour envoyer vos photos et choisir le créneau de la visite.', orderId: o.id, kind: 'action' });
    D.notifyRole(ws, 'conseiller', o, { title: 'Nouveau client : ' + cust.name, body: o.ref + ' · ' + offer.name + ' payée (' + offer.pay.toLocaleString('fr-FR') + ' F CFA). Dossier attendu sous ' + (Number(ws.config.dossierDeadlineH) || 24) + ' h.', kind: 'info' });
    audit(ws, cust, 'boutique.achat', o.ref, offer.name + ' · ' + o.address.commune + ' (paiement simulé)');
    return { id: o.id, ref: o.ref, userId: cust.id, userName: cust.name, amount: offer.pay, offer: offer.name + ' ' + offer.speed, dueAt: o.dossier.dueAt };
  }, { idem: true, idemFull: true });

  // Envoi du dossier : informations, créneau choisi (réservé dans la même transaction) et photos déjà déposées.
  // Un dossier incomplet part quand même : ce qui manque est affiché au client et à toute l'équipe Moov.
  cmd('dossier.submit', ['client'], ({ ws, user, order, args }) => {
    if (!order.dossier) throw new AppError('etat', 'Ce dossier ne se remplit pas en ligne.');
    if (order.dossier.submittedAt) throw new AppError('doublon', 'Dossier déjà envoyé. Pour compléter, utilisez l’onglet Dossier.');
    if (order.cancelled || order.state !== 'PREPARATION') throw new AppError('etat', 'Ce dossier ne peut plus être envoyé.');
    const info = args.info || {};
    const a = order.address;
    for (const k of ['landmark', 'accessNotes', 'floor']) if (info[k] != null) a[k] = String(info[k]).trim().slice(0, 300);
    if (info.onsiteContact != null) a.onsiteContact = String(info.onsiteContact).trim().slice(0, 80);
    if (info.building != null) a.building = info.building === 'immeuble' ? 'immeuble' : 'maison';
    if (!a.landmark || a.landmark.length < 8) throw new AppError('info', 'Indiquez un repère d’au moins 8 caractères (ex. portail bleu après la pharmacie).');
    const cur = order.apptId && byId(ws.appointments, order.apptId);
    if (!(cur && cur.status === 'reserve' && cur.date === Number(args.date) && cur.slot === args.slot)) D.reserveSlot(ws, order, { date: Number(args.date), slot: args.slot }, user);
    order.dossier.submittedAt = ws.clock; order.dossier.late = ws.clock > order.dossier.dueAt;
    order.version++; order.updatedAt = ws.clock;
    const st = D.dossierState(ws, order);
    const docsMissing = st.missing.filter(m => m.kind === 'doc');
    if (docsMissing.length) D.openBlocker(ws, order, 'PIECE_MANQUANTE', { actor: user, detail: docsMissing.map(m => m.label).join(', '), silent: true });
    const appt = byId(ws.appointments, order.apptId);
    const when = fmtDate(appt.date) + ' (' + D.slotLabel(appt.slot) + ')';
    const nDocs = ws.documents.filter(d => d.orderId === order.id && (order.requiredDocs || []).includes(d.type) && !['remplace', 'refuse'].includes(d.status)).length;
    emit(ws, order, 'DOSSIER_SOUMIS', { actor: user, payload: { missing: st.missing.map(m => m.label), late: order.dossier.late }, publicText: 'Dossier envoyé' + (docsMissing.length ? ', incomplet : il manque ' + docsMissing.map(m => m.label.toLowerCase()).join(', ') : '') + '.' });
    const verified = st.status === 'verifie';
    D.notifyRole(ws, 'conseiller', order, { title: docsMissing.length ? 'Dossier incomplet reçu' : verified ? 'Dossier reçu (pièces déjà validées)' : 'Dossier à vérifier', body: user.name + ' (' + order.ref + ') : ' + nDocs + ' photo' + (nDocs > 1 ? 's' : '') + (docsMissing.length ? ', il manque ' + docsMissing.map(m => m.label.toLowerCase()).join(', ') : '') + (st.flagged ? ', ' + st.flagged + ' à regarder de près' : '') + '. Créneau demandé : ' + when + '.', kind: docsMissing.length ? 'alerte' : verified ? 'info' : 'tache' });
    // Pièces toutes validées avant l'envoi : le planificateur peut fixer l'heure tout de suite.
    if (verified) {
      emit(ws, order, 'DOSSIER_VERIFIE', { actor: user, publicText: 'Toutes vos pièces sont validées. Moov confirme maintenant l’heure de la visite.' });
      D.notifyRole(ws, 'planificateur', order, { title: 'Dossier vérifié : à planifier', body: order.ref + ' (' + order.contactName + ') · ' + order.address.commune + ' · ' + when + '. Choisissez le technicien et l’heure.', kind: 'tache' });
    } else D.notifyRole(ws, 'planificateur', order, { title: 'Créneau demandé', body: order.ref + ' · ' + order.address.commune + ' · ' + when + '. À confirmer quand les pièces sont validées.', kind: 'tache' });
    notify(ws, user.id, docsMissing.length
      ? { title: 'Dossier envoyé, mais incomplet', body: 'Il manque encore : ' + docsMissing.map(m => m.label.toLowerCase()).join(', ') + '. Ajoutez-les depuis l’onglet Dossier.', orderId: order.id, kind: 'action' }
      : { title: 'Dossier envoyé', body: (verified ? 'Vos photos sont déjà validées.' : 'Votre conseillère vérifie vos photos.') + ' Vous recevrez une notification dès que l’heure de la visite est confirmée.', orderId: order.id, kind: 'succes' });
    return st;
  }, { order: true });

  // La conseillère dit au client ce qui manque (ou ce qui n'est pas lisible), avec un mot si elle veut.
  cmd('dossier.ask', ['conseiller', 'superviseur'], ({ ws, user, order, args }) => {
    if (!order.dossier) throw new AppError('etat', 'Ce dossier n’a pas été rempli en ligne.');
    const miss = D.dossierMissing(ws, order).filter(m => m.kind !== 'slot');
    const note = String(args.text || '').trim().slice(0, 400);
    if (!miss.length && note.length < 5) throw new AppError('motif', 'Rien ne manque : écrivez au client ce que vous attendez de lui.');
    // « Bonjour Awa, il manque encore : … » : la salutation en tête, puis la liste, puis le mot de la conseillère.
    const hi = /^((?:bonjour|bonsoir)[^,.!?]{0,40}[,!]\s*)/i.exec(note);
    const greet = hi ? hi[1] : 'Bonjour ' + String(order.contactName || '').split(' ')[0] + ', ';
    const rest = hi ? note.slice(hi[1].length) : note;
    const comma = /,\s*$/.test(greet);
    const list = miss.length ? (comma ? 'il' : 'Il') + ' manque encore : ' + miss.map(m => m.label.toLowerCase() + ', ' + m.why.replace(/^refusée : (.)/, (x, c) => 'refusée : ' + c.toLowerCase())).join(' ; ') + '. ' : '';
    const up = x => x.charAt(0).toUpperCase() + x.slice(1);
    const text = greet + list + (list || !comma ? up(rest) : rest.charAt(0).toLowerCase() + rest.slice(1));
    addMessage(ws, order, { from: 'staff', author: user, text: text.trim() });
    notify(ws, order.customerId, { title: 'Votre dossier est incomplet', body: text.trim().slice(0, 220), orderId: order.id, kind: 'action' });
    order.updatedAt = ws.clock;
    return { sent: true };
  }, { order: true });

  // La conseillère (qui vient de valider les photos) ou le planificateur choisit le technicien et l'heure : le dossier passe « prêt »,
  // le rendez-vous est confirmé et la mission arrive d'un coup sur le téléphone du technicien.
  cmd('dossier.validate', ['planificateur', 'conseiller'], ({ ws, user, order, args }) => {
    if (!order.dossier || !order.dossier.submittedAt) throw new AppError('etat', 'Le client n’a pas encore envoyé son dossier.');
    const appt = byId(ws.appointments, order.apptId);
    if (!appt || appt.status !== 'reserve') throw new AppError('etat', 'Aucun créneau en attente de validation sur ce dossier.');
    if (!args.time) throw new AppError('heure', 'Choisissez l’heure de passage du technicien.');
    const notOk = unvalidatedDocs(ws, order);
    if (notOk.length) throw new AppError('pieces', 'Pièces pas encore validées par la conseillère : ' + notOk.map(t => DOC_TYPES[t].label.toLowerCase()).join(', ') + '.');
    if (order.state === 'PREPARATION') D.markReady(ws, order, user, { quiet: true });
    return D.confirmAppointment(ws, order, appt, user, { teamId: args.teamId, time: String(args.time) });
  }, { order: true });

  // Appel simulé au service client : il sonne chez la conseillère du dossier (aucun son, aucun vrai appel).
  const LIVE_CALL = ['sonne', 'en_cours'];
  cmd('call.start', CLIENTISH, ({ ws, user, order, args }) => {
    const calls = (ws.calls ||= []);
    if (calls.some(c => c.orderId === order.id && LIVE_CALL.includes(c.status))) throw new AppError('doublon', 'Un appel est déjà en cours.');
    const adv = advisorFor(ws, order);
    if (!adv) throw new AppError('indispo', 'Aucun conseiller disponible : demandez plutôt à être rappelé.');
    const c = { id: 'APL' + (++ws.seq), orderId: order.id, fromId: user.id, fromName: user.name, toId: adv.id, toName: adv.name, reason: String(args.reason || '').trim().slice(0, 200), status: 'sonne', startedAt: ws.clock, answeredAt: null, endedAt: null, note: '' };
    calls.push(c);
    if (calls.length > 60) calls.splice(0, calls.length - 60);
    ws.jobs.push({ id: 'J' + (++ws.seq), kind: 'call', ref: c.id, due: ws.clock + 45e3, generation: ws.generation, attempts: 0 });
    notify(ws, adv.id, { title: 'Appel entrant : ' + user.name, body: order.ref + (c.reason ? ' · ' + c.reason : '') + '. Décrochez depuis l’Équipe Moov.', orderId: order.id, kind: 'appel' });
    emit(ws, order, 'APPEL_CLIENT', { actor: user, payload: { to: adv.name } });
    return c;
  }, { order: true, scope: 'messages' });
  const findCall = (ws, id) => { const c = (ws.calls || []).find(x => x.id === id); if (!c) throw new AppError('introuvable', 'Appel introuvable.'); return c; };
  cmd('call.answer', ['conseiller'], ({ ws, user, args }) => {
    const c = findCall(ws, args.id);
    if (c.toId !== user.id) throw new AppError('introuvable', 'Appel introuvable.');
    if (c.status !== 'sonne') throw new AppError('etat', c.status === 'en_cours' ? 'Vous êtes déjà en ligne.' : 'Cet appel est terminé : le client a raccroché ou un rappel a été créé.');
    c.status = 'en_cours'; c.answeredAt = ws.clock;
    audit(ws, user, 'appel.decrocher', (byId(ws.orders, c.orderId) || {}).ref || '', c.fromName);
    return c;
  }, { noAudit: true });
  cmd('call.end', ['conseiller', 'client', 'representant'], ({ ws, user, args }) => {
    const c = findCall(ws, args.id);
    const mine = user.role === 'conseiller' ? c.toId === user.id : c.fromId === user.id;
    if (!mine) throw new AppError('introuvable', 'Appel introuvable.');
    if (!LIVE_CALL.includes(c.status)) return c;
    const o = byId(ws.orders, c.orderId);
    if (c.status === 'sonne') {
      if (user.role === 'conseiller') missedCall(ws, c, 'Conseillère occupée', ws.clock);
      else { c.status = 'annule'; c.endedAt = ws.clock; }
      return c;
    }
    c.status = 'termine'; c.endedAt = ws.clock; c.endedBy = user.role === 'conseiller' ? 'conseiller' : 'client';
    if (user.role === 'conseiller' && args.note) c.note = String(args.note).trim().slice(0, 500);
    const sec = Math.max(1, Math.round((c.endedAt - c.answeredAt) / 1000));
    if (o) emit(ws, o, 'APPEL_TERMINE', { actor: user, payload: { sec }, publicText: 'Appel avec ' + c.toName.split(' ')[0] + ' (' + (sec >= 60 ? Math.floor(sec / 60) + ' min ' : '') + (sec % 60) + ' s).' });
    if (o && c.note) addMessage(ws, o, { from: 'staff', author: byId(ws.users, c.toId) || user, text: 'Note d’appel : ' + c.note, visibility: 'interne' });
    return c;
  }, { noAudit: true });

  // Note du technicien juste après la visite (différente de l'avis sur le service, demandé après l'activation).
  cmd('tech.rate', ['client'], ({ ws, user, order, args }) => {
    const wo = ws.workOrders.filter(w => w.orderId === order.id && w.status === 'terminee').at(-1);
    if (!wo) throw new AppError('etat', 'Vous pourrez noter le technicien après sa visite.');
    const list = (ws.techRatings ||= []);
    if (list.some(r => r.woId === wo.id)) throw new AppError('doublon', 'Vous avez déjà noté cette visite. Merci !');
    const score = Math.round(Number(args.score));
    if (!(score >= 1 && score <= 5)) throw new AppError('note', 'Choisissez une note de 1 à 5 étoiles.');
    const r = { id: 'NT' + (++ws.seq), orderId: order.id, woId: wo.id, techUserId: wo.techUserId, teamId: wo.teamId, score, clear: args.clear == null ? null : !!args.clear, problem: !!args.problem, comment: String(args.comment || '').trim().slice(0, 500), at: ws.clock };
    list.push(r);
    const team = byId(ws.teams, wo.teamId);
    if (team) team.quality = Math.round(((Number(team.quality) || 4) * 9 + score) / 10 * 10) / 10;
    const tech = byId(ws.users, wo.techUserId);
    emit(ws, order, 'NOTE_TECHNICIEN', { actor: user, payload: { score, clear: r.clear, problem: r.problem }, publicText: 'Vous avez noté la visite de ' + (tech ? tech.name.split(' ')[0] : 'votre technicien') + ' : ' + score + '/5.' });
    notify(ws, wo.techUserId, { title: 'Note du client : ' + score + '/5', body: order.ref + (r.comment ? ' : « ' + r.comment.slice(0, 120) + ' »' : r.clear === false ? ' : explications pas assez claires' : ''), orderId: order.id, kind: score >= 4 ? 'succes' : 'info' });
    if (score <= 2 || r.problem || r.clear === false) {
      ws.tickets.push({ id: 'TK' + (++ws.seq), orderId: order.id, type: 'visite', text: score + '/5' + (r.problem ? ', souci pendant le rendez-vous' : '') + (r.clear === false ? ', explications pas claires' : '') + (r.comment ? ' : ' + r.comment : ''), status: 'ouvert', ownerRole: 'superviseur', at: ws.clock, by: user.name });
      D.notifyRole(ws, 'superviseur', order, { title: 'Visite à revoir', body: order.ref + ' : ' + (tech ? tech.name : 'technicien') + ' noté ' + score + '/5' + (r.problem ? ', souci signalé' : '') + '.', kind: 'alerte' });
    }
    return r;
  }, { order: true });

  // ----- Équipes Moov -----
  cmd('msg.reply', ['conseiller', 'superviseur'], ({ ws, user, order, args }) => {
    const text = String(args.text || '').trim(); if (!text) throw new AppError('vide', 'Message vide.');
    const m = addMessage(ws, order, { from: 'staff', author: user, text, visibility: 'public' });
    if (args.fromAi) audit(ws, user, 'ia.resume.utilise', order.ref, 'Brouillon IA relu et envoyé', { ai: true });
    for (const t of ws.tickets.filter(t => t.orderId === order.id && t.status === 'ouvert' && t.type === 'question_assistant')) t.status = 'repondu';
    notify(ws, order.customerId, { title: 'Réponse de ' + user.name, body: text.slice(0, 140), orderId: order.id, kind: 'message' });
    return m;
  }, { order: true });
  cmd('note.add', ['conseiller', 'planificateur', 'technicien', 'superviseur'], ({ ws, user, order, args }) => { const text = String(args.text || '').trim().slice(0, 1000); if (!text) throw new AppError('vide', 'Note vide.'); return addMessage(ws, order, { from: 'staff', author: user, text, visibility: 'interne' }); }, { order: true });
  cmd('doc.request', ['conseiller'], ({ ws, user, order, args }) => {
    if (!DOC_TYPES[args.type]) throw new AppError('type', 'Type de pièce inconnu.');
    const label = DOC_TYPES[args.type].label;
    const reason = String(args.reason || '').trim().slice(0, 200);
    if ((order.requiredDocs || []).includes(args.type) && missingDocs(ws, order).includes(args.type)) throw new AppError('doublon', label + ' est déjà demandée à ce client.');
    order.requiredDocs = [...new Set([...(order.requiredDocs || []), args.type])];
    order.docNotes = { ...(order.docNotes || {}), [args.type]: reason };
    const b = openBlockers(ws, order.id).find(x => x.type === 'PIECE_MANQUANTE');
    const detail = missingDocs(ws, order).map(t => DOC_TYPES[t].label).join(', ');
    if (b) { b.detail = detail; order.version++; }
    else openBlocker(ws, order, 'PIECE_MANQUANTE', { actor: user, detail, silent: true });
    order.updatedAt = ws.clock;
    emit(ws, order, 'PIECE_DEMANDEE', { actor: user, payload: { type: args.type, reason }, publicText: 'Moov vous demande : ' + label + (reason ? ' (' + reason + ')' : '') + '.' });
    if (order.customerId) notify(ws, order.customerId, { title: 'Pièce demandée : ' + label, body: (reason ? reason + '. ' : '') + 'Envoyez-la depuis votre dossier, onglet Pièces (dossier ' + order.ref + ').', orderId: order.id, kind: 'action' });
    return { claimed: !!order.customerId };
  }, { order: true });
  const reviewDoc = ({ ws, user, args }) => {
    const doc = byId(ws.documents, args.docId); if (!doc) throw new AppError('introuvable', 'Pièce introuvable.');
    const order = scopedOrder(ws, user, doc.orderId);
    if (doc.status !== 'a_valider') throw new AppError('etat', 'Cette pièce n’est pas en attente de validation.');
    if (args.decision === 'valide') {
      doc.status = 'valide';
      emit(ws, order, 'PIECE_VALIDEE', { actor: user, publicText: 'Pièce validée : ' + DOC_TYPES[doc.type].label + '.' });
      const b = openBlockers(ws, order.id).find(b => b.type === 'PIECE_MANQUANTE');
      const still = unvalidatedDocs(ws, order);
      if (b && !still.length) resolveBlocker(ws, b, { actor: user, resolution: 'Pièces validées : ' + (order.requiredDocs || [doc.type]).map(t => DOC_TYPES[t].label).join(', ') });
      else if (b) { b.detail = still.map(t => DOC_TYPES[t].label).join(', '); }
      notify(ws, order.customerId, { title: 'Pièce validée', body: DOC_TYPES[doc.type].label + ' acceptée. Merci !', orderId: order.id, kind: 'succes' });
      if (order.dossier && order.dossier.submittedAt && order.state === 'PREPARATION' && !still.length) {
        emit(ws, order, 'DOSSIER_VERIFIE', { actor: user, publicText: 'Toutes vos pièces sont validées. Moov confirme maintenant l’heure de la visite.' });
        D.notifyRole(ws, 'planificateur', order, { title: 'Dossier vérifié : à planifier', body: order.ref + ' (' + order.contactName + ') : pièces validées par ' + user.name.split(' ')[0] + '. Choisissez le technicien et l’heure.', kind: 'tache' });
      }
      const wo = ws.workOrders.find(w => w.orderId === order.id && !['terminee', 'annulee', 'echec'].includes(w.status));
      if (wo && TECH_DOCS.includes(doc.type)) notify(ws, wo.techUserId, { title: 'Pièce validée pour votre mission', body: order.ref + ' : ' + DOC_TYPES[doc.type].label + ' consultable dans la mission.', orderId: order.id, kind: 'tache' });
    } else {
      if (!args.reason) throw new AppError('motif', 'Indiquez le motif du refus : le client doit comprendre quoi corriger.');
      doc.status = 'refuse'; doc.reason = String(args.reason).slice(0, 200);
      if ((order.requiredDocs || []).includes(doc.type)) { const b = openBlockers(ws, order.id).find(b => b.type === 'PIECE_MANQUANTE'); if (b) b.detail = missingDocs(ws, order).map(t => DOC_TYPES[t].label).join(', '); else openBlocker(ws, order, 'PIECE_MANQUANTE', { actor: user, detail: DOC_TYPES[doc.type].label, silent: true }); }
      emit(ws, order, 'PIECE_REFUSEE', { actor: user, publicText: 'Pièce refusée : ' + args.reason });
      notify(ws, order.customerId, { title: 'Pièce à remplacer', body: DOC_TYPES[doc.type].label + ' refusée : ' + args.reason, orderId: order.id, kind: 'action' });
    }
    audit(ws, user, 'piece.' + args.decision, order.ref, doc.name);
  };
  cmd('doc.review', ['conseiller'], reviewDoc);
  // « Suivre l'avis » : applique l'avis automatique (recalculé ici, jamais celui d'un écran périmé). La conseillère reste l'auteure des décisions.
  cmd('dossier.followAdvice', ['conseiller'], ({ ws, user, order, args }) => {
    const adv = D.dossierAdvice(ws, order);
    if (!adv || adv.verdict === 'rien') throw new AppError('etat', 'Aucune pièce à regarder pour le moment.');
    if (adv.verdict === 'attendre') throw new AppError('etat', 'Le contrôle des photos est encore en cours : patientez quelques secondes.');
    const done = { valide: 0, refuse: 0 };
    for (const it of adv.items) {
      if (it.verdict === 'ok') { reviewDoc({ ws, user, args: { docId: it.docId, decision: 'valide' } }); done.valide++; }
      else { reviewDoc({ ws, user, args: { docId: it.docId, decision: 'refuse', reason: it.reason } }); done.refuse++; }
    }
    audit(ws, user, 'dossier.avis', order.ref, done.valide + ' validée(s), ' + done.refuse + ' refusée(s)');
    return done;
  }, { order: true });
  cmd('address.requestPrecision', ['conseiller', 'planificateur'], ({ ws, user, order, args }) => openBlocker(ws, order, 'ADRESSE_AMBIGUE', { actor: user, detail: args.detail || '' }), { order: true });
  cmd('order.markReady', ['planificateur'], ({ ws, user, order }) => {
    // Dossier rempli en ligne : il passe par « Valider le dossier » (pièces vérifiées par la conseillère).
    if (order.dossier) throw new AppError('etat', 'Dossier en ligne : utilisez « Choisir le technicien et l’heure » une fois les pièces validées par la conseillère.');
    return D.markReady(ws, order, user);
  }, { order: true });
  cmd('blocker.assign', ['conseiller', 'planificateur', 'superviseur'], ({ ws, user, args }) => {
    const b = byId(ws.blockers, args.blockerId); if (!b) throw new AppError('introuvable', 'Blocage introuvable.');
    const order = scopedOrder(ws, user, b.orderId);
    const to = byId(ws.users, args.userId);
    if (!to || !to.active || !['conseiller', 'planificateur', 'superviseur'].includes(to.role)) throw new AppError('introuvable', 'On ne peut confier un blocage qu’à un conseiller, un planificateur ou un superviseur actif.');
    if (!canSee(ws, to, order)) throw new AppError('interdit', to.name + ' ne suit pas cette zone.');
    b.ownerUserId = to.id; b.ownerRole = to.role;
    emit(ws, order, 'BLOCAGE_AFFECTE', { actor: user, payload: { to: to.name } });
    audit(ws, user, 'blocage.affecter', order.ref, BLOCKER_TYPES[b.type].label + ' → ' + to.name);
    notify(ws, to.id, { title: 'Blocage affecté', body: order.ref + ' : ' + b.action, orderId: order.id, kind: 'tache' });
  });
  cmd('blocker.resolve', ['conseiller', 'planificateur', 'superviseur'], ({ ws, user, args }) => {
    const b = byId(ws.blockers, args.blockerId); if (!b) throw new AppError('introuvable', 'Blocage introuvable.');
    scopedOrder(ws, user, b.orderId);
    if (!args.resolution || args.resolution.length < 5) throw new AppError('motif', 'Décrivez la résolution (elle reste dans l’historique).');
    if (['ACTIVATION_ECHOUEE', 'ANOMALIE_ACTIVATION', 'ANNULATION', 'PAIEMENT_NON_RAPPROCHE'].includes(b.type)) throw new AppError('interdit', 'Ce blocage se lève par sa procédure dédiée (activation, paiement ou annulation), pas manuellement.');
    if (b.type === 'CAPACITE_RESEAU') { const o = getOrder(ws, b.orderId); const port = ws.ports[o.zone]; if (port.free <= 0 && !o.portReserved) throw new AppError('capacite', 'Toujours aucun port libre : réservez une ressource d’abord.'); }
    resolveBlocker(ws, b, { actor: user, resolution: args.resolution });
  });
  cmd('network.addPorts', ['planificateur', 'superviseur'], ({ ws, user, args }) => {
    const p = ws.ports[args.zone]; if (!p) throw new AppError('introuvable', 'Zone inconnue.');
    if (user.role === 'planificateur' && !(user.zones || []).includes(args.zone)) throw new AppError('interdit', 'Zone hors de votre périmètre.');
    const n = Math.round(Number(args.n) || 1); if (n < 1 || n > 10) throw new AppError('nombre', 'Entre 1 et 10 ports à la fois.');
    p.free += n; audit(ws, user, 'reseau.ports', args.zone, '+' + n + ' port(s) réservé(s) (simulé)');
  });
  cmd('escalate', ['conseiller', 'planificateur'], ({ ws, user, order, args }) => {
    if (!args.reason || String(args.reason).trim().length < 5) throw new AppError('motif', 'Expliquez en une phrase pourquoi vous escaladez (le superviseur le lira).');
    const sup = ws.users.find(u => u.role === 'superviseur');
    ws.tickets.push({ id: 'TK' + (++ws.seq), orderId: order.id, type: 'escalade', text: String(args.reason || ''), status: 'ouvert', ownerRole: 'superviseur', at: ws.clock, by: user.name });
    emit(ws, order, 'ESCALADE', { actor: user, payload: { reason: args.reason } });
    notify(ws, sup.id, { title: 'Escalade', body: order.ref + ' : ' + (args.reason || ''), orderId: order.id, kind: 'alerte' });
    audit(ws, user, 'escalade', order.ref, args.reason || '');
  }, { order: true });
  cmd('callback.update', ['conseiller'], ({ ws, user, args }) => {
    const cb = byId(ws.callbacks, args.id); if (!cb) throw new AppError('introuvable', 'Rappel introuvable.');
    const order = scopedOrder(ws, user, cb.orderId);
    cb.status = args.status; cb.note = args.note || ''; cb.doneAt = ws.clock; cb.ownerName = user.name;
    emit(ws, order, 'RAPPEL_' + args.status.toUpperCase(), { actor: user, publicText: args.status === 'fait' ? 'Un conseiller vous a rappelé.' : null });
  });
  cmd('ticket.close', ['conseiller', 'planificateur', 'superviseur'], ({ ws, user, args }) => { const t = byId(ws.tickets, args.id); if (!t) throw new AppError('introuvable', 'Ticket introuvable.'); scopedOrder(ws, user, t.orderId); if (t.ownerRole && t.ownerRole !== user.role && user.role !== 'superviseur') throw new AppError('interdit', 'Ce ticket est suivi par le ' + (ROLES[t.ownerRole] || {}).label.toLowerCase() + '.'); if (t.status !== 'ouvert') throw new AppError('doublon', 'Ce ticket est déjà traité.');
    if (t.type === 'escalade_terrain' && !String(args.note || '').trim()) throw new AppError('motif', 'Écrivez une réponse pour le technicien.');
    t.status = 'traite'; t.closedBy = user.name; t.note = args.note || '';
    if (t.type === 'escalade_terrain') {
      const wo = byId(ws.workOrders, t.woId); const h = wo && (wo.help || []).find(x => x.ticketId === t.id);
      if (h) { h.status = 'repondu'; h.reply = { by: user.name, text: String(args.note).trim().slice(0, 500), at: ws.clock }; }
      if (wo) notify(ws, wo.techUserId, { title: 'Réponse de ' + user.name.split(' ')[0], body: String(args.note).trim().slice(0, 160), orderId: t.orderId, kind: 'info' });
    }
    // Un souci signalé après la visite est réglé : la visite est validée et le technicien est libéré.
    if (t.type === 'visite' && t.woId) {
      const wo = byId(ws.workOrders, t.woId);
      if (wo && wo.signoff && wo.signoff.state === 'probleme') D.finishSignoff(ws, byId(ws.orders, wo.orderId), wo, 'regle', user);
    }
  });

  cmd('appt.confirm', ['planificateur'], ({ ws, user, order, args }) => {
    if (order.dossier) { const notOk = unvalidatedDocs(ws, order); if (notOk.length) throw new AppError('pieces', 'Pièces pas encore validées par la conseillère : ' + notOk.map(t => DOC_TYPES[t].label.toLowerCase()).join(', ') + '.'); }
    return D.confirmAppointment(ws, order, byId(ws.appointments, order.apptId) || {}, user, { teamId: args.teamId });
  }, { order: true });
  cmd('appt.reassign', ['planificateur'], ({ ws, user, order, args }) => {
    if (!args.reason || args.reason.length < 5) throw new AppError('motif', 'Une réaffectation doit être justifiée.');
    const appt = byId(ws.appointments, order.apptId);
    if (!appt || appt.status !== 'confirme') throw new AppError('etat', 'Aucun rendez-vous confirmé à réaffecter.');
    const team = byId(ws.teams, args.teamId);
    if (!team || !team.available || !team.zones.includes(order.zone)) throw new AppError('equipe', 'Équipe indisponible ou hors zone.');
    if (team.id === appt.teamId) throw new AppError('equipe', 'C’est déjà l’équipe prévue : choisissez une autre équipe.');
    if (!(user.zones || []).includes(order.zone)) throw new AppError('interdit', 'Hors de votre périmètre.');
    const cap = ws.capacity.find(c => c.teamId === team.id && c.date === appt.date && c.slot === appt.slot);
    if (!cap || D.remaining(ws, cap) <= 0) throw new AppError('complet', team.name + ' n’a plus de place sur ce créneau.');
    // Heure déjà fixée : le nouveau technicien ne doit pas être attendu ailleurs au même moment.
    if (appt.time) { const clash = D.teamBusyAt(ws, team.id, appt.date, appt.time, appt.id); if (clash) throw new AppError('heure', ((byId(ws.users, team.techUserId) || {}).name || team.name) + ' a déjà une visite à ' + hourLabel(appt.time) + ' (' + clash + '). Choisissez une autre équipe.'); }
    const oldTeam = byId(ws.teams, appt.teamId);
    D.releaseCap(ws, appt); cap.used++; appt.capId = cap.id; appt.teamId = team.id;
    const wo = byId(ws.workOrders, appt.woId);
    const prevTech = wo.techUserId;
    if (!['affectee'].includes(wo.status)) throw new AppError('etat', 'Le technicien a déjà commencé cette mission : prévenez-le avant de la confier à une autre équipe.');
    wo.formerTechs = [...new Set([...(wo.formerTechs || []), prevTech])];
    wo.teamId = team.id; wo.techUserId = team.techUserId; wo.version++; wo.status = 'affectee';
    emit(ws, order, 'MISSION_REAFFECTEE', { actor: user, payload: { from: oldTeam.name, to: team.name, reason: args.reason }, publicText: 'Une autre équipe a été désignée pour votre installation. Le créneau ne change pas.' });
    audit(ws, user, 'mission.reaffecter', order.ref, oldTeam.name + ' → ' + team.name + ' : ' + args.reason);
    for (const b of openBlockers(ws, order.id).filter(b => ['TECHNICIEN_ABSENT', 'SOUS_TRAITANT'].includes(b.type))) resolveBlocker(ws, b, { actor: user, resolution: 'Réaffecté à ' + team.name });
    notify(ws, prevTech, { title: 'Mission retirée', body: order.ref + ' réaffectée : ' + args.reason, orderId: order.id, kind: 'tache' });
    notify(ws, team.techUserId, { title: 'Nouvelle mission', body: order.ref + ' — ' + fmtDate(appt.date) + ' ' + (appt.time ? 'à ' + hourLabel(appt.time) : D.slotLabel(appt.slot)), orderId: order.id, kind: 'tache' });
    const newFirst = String((byId(ws.users, team.techUserId) || {}).name || team.name).split(' ')[0];
    notify(ws, order.customerId, appt.time
      ? { title: 'Changement de technicien : ' + newFirst + ' viendra le ' + fmtDate(appt.date) + ' à ' + hourLabel(appt.time), body: (ws.config.templates.rdv_heure || 'Moov Fibre : {tech} viendra le {date} à {heure}.').replace('{tech}', newFirst).replace('{date}', fmtDate(appt.date)).replace('{heure}', hourLabel(appt.time)).replace('{slot}', D.slotLabel(appt.slot)), orderId: order.id, kind: 'rdv' }
      : { title: 'Changement d’équipe', body: 'Une autre équipe viendra au même créneau (' + fmtDate(appt.date) + ', ' + D.slotLabel(appt.slot) + ').', orderId: order.id, kind: 'rdv' });
  }, { order: true });
  cmd('team.setAvailable', ['planificateur'], ({ ws, user, args }) => {
    const t = byId(ws.teams, args.teamId); if (!t) throw new AppError('introuvable', 'Équipe inconnue.');
    if (!t.zones.some(z => (user.zones || []).includes(z))) throw new AppError('interdit', 'Équipe hors de votre périmètre.');
    t.available = !!args.available;
    audit(ws, user, 'equipe.' + (t.available ? 'disponible' : 'indisponible'), t.name, args.reason || '');
    for (const a of ws.appointments.filter(a => a.teamId === t.id && a.status === 'confirme' && a.date >= startOfDay(ws.clock))) {
      const o = getOrder(ws, a.orderId);
      if (!t.available) openBlocker(ws, o, t.contractor ? 'SOUS_TRAITANT' : 'TECHNICIEN_ABSENT', { actor: user, detail: t.name + ' : ' + (args.reason || 'indisponible') });
      else for (const b of openBlockers(ws, o.id).filter(b => ['TECHNICIEN_ABSENT', 'SOUS_TRAITANT'].includes(b.type))) resolveBlocker(ws, b, { actor: user, resolution: t.name + ' de nouveau disponible' });
    }
  });
  cmd('capacity.set', ['planificateur'], ({ ws, user, args }) => {
    const c = byId(ws.capacity, args.capId); if (!c) throw new AppError('introuvable', 'Créneau inconnu.');
    const team = byId(ws.teams, c.teamId);
    if (!team || !team.zones.some(z => (user.zones || []).includes(z))) throw new AppError('interdit', 'Équipe hors de votre périmètre.');
    if (!Number.isFinite(Number(args.cap)) || String(args.cap).trim() === '') throw new AppError('nombre', 'Indiquez un nombre de visites (0 à 6).');
    const n = Math.max(0, Math.min(6, Math.round(Number(args.cap))));
    if (n < c.used) throw new AppError('capacite', 'Impossible de descendre sous le nombre de rendez-vous déjà pris (' + c.used + ').');
    c.cap = n; audit(ws, user, 'capacite.modifier', c.id, String(n));
  });

  cmd('wo.action', ['technicien'], ({ ws, user, args }) => {
    const wo = byId(ws.workOrders, args.woId);
    if (wo && wo.techUserId !== user.id && (wo.formerTechs || []).includes(user.id)) throw new AppError('retiree', 'Cette mission a été confiée à une autre équipe entre-temps. Votre action n’a pas été appliquée ; votre brouillon est conservé.');
    if (!wo || wo.techUserId !== user.id) throw new AppError('introuvable', 'Mission introuvable ou non affectée.');
    if (wo.status === 'annulee') throw new AppError('conflit', 'Cette mission a été annulée ou réaffectée entre-temps. Votre action n’a pas été appliquée ; votre brouillon est conservé.', { resolution: 'Contactez le planificateur.' });
    if (args.expectedVersion != null && args.expectedVersion !== wo.version && !['photo', 'comment'].includes(args.action)) {
      throw new AppError('conflit', 'La mission a été modifiée pendant que vous étiez hors ligne (version ' + args.expectedVersion + ' → ' + wo.version + '). Action refusée, brouillon conservé.', { current: wo.version });
    }
    return D.woAction(ws, wo, args.action, args.args || {}, user);
  }, { idem: true });

  // ----- Boîte à outils du technicien sur place : poser une question, montrer un problème en photo, transmettre au responsable -----
  const myOpenWo = (ws, user, woId) => {
    const wo = byId(ws.workOrders, woId);
    if (!wo || wo.techUserId !== user.id) throw new AppError('introuvable', 'Mission introuvable ou non affectée.');
    if (!['sur_place', 'en_cours'].includes(wo.status)) throw new AppError('etat', 'L’aide est disponible une fois arrivé chez le client.');
    return wo;
  };
  // Une photo d'aide ne peut pas reprendre l'image d'une pièce ou d'une photo de mission déjà rangée (elle changerait de règle de visibilité).
  const freeImg = (ws, img) => (img && (ws.documents.some(d => d.img === img) || ws.workOrders.some(w => (w.photos || []).some(x => x.img === img))) ? null : img);
  const helpPhoto = (ws, p) => {
    if (!p || typeof p !== 'object') return null;
    return { id: 'PH' + (++ws.seq), name: String(p.name || 'photo.jpg').slice(0, 120), thumb: D.smallThumb(p.thumb), img: freeImg(ws, D.imgRef(p.img)), check: D.photoCheck(p.quality) };
  };
  cmd('tech.ask', ['technicien'], ({ ws, user, args }) => {
    const wo = myOpenWo(ws, user, args.woId);
    const q = String(args.question || '').trim().slice(0, 500);
    const photo = helpPhoto(ws, args.photo);
    if (!q && !photo) throw new AppError('vide', 'Écrivez votre question ou ajoutez une photo.');
    if ((wo.help || []).length >= 40) throw new AppError('limite', 'Trop de demandes sur cette mission : transmettez au responsable.');
    const ans = !q && photo ? { topic: null, title: 'Photo reçue', steps: ['Décrivez le problème en une phrase si vous le pouvez.', 'Transmettez la photo au responsable : il vous répond ici.'], source: null, escalate: true } : techAnswer(q);
    const a = { title: ans.title, steps: ans.steps, source: ans.source, escalate: ans.escalate || !!photo, topic: ans.topic };
    if (photo) a.note = 'Le guide ne lit pas les images (aide simulée). ' + (photo.check && !photo.check.ok ? 'La photo est ' + photo.check.issues.join(' et ') + ' : reprenez-la si le responsable doit la voir.' : 'Transmettez la photo au responsable pour qu’il la regarde.');
    const h = { id: 'HP' + (++ws.seq), kind: 'ask', at: ws.clock, q, a, photo, escalated: false };
    (wo.help ||= []).push(h);
    audit(ws, user, 'terrain.aide', byId(ws.orders, wo.orderId).ref, (q || 'photo').slice(0, 120));
    return h;
  }, { idem: true, idemFull: true });
  cmd('tech.escalate', ['technicien'], ({ ws, user, args }) => {
    const wo = myOpenWo(ws, user, args.woId);
    const order = byId(ws.orders, wo.orderId);
    let h = args.helpId ? (wo.help || []).find(x => x.id === args.helpId) : null;
    if (args.helpId && !h) throw new AppError('introuvable', 'Demande introuvable.');
    if (h && h.escalated) throw new AppError('doublon', 'Cette demande a déjà été transmise à votre responsable.');
    const text = String(args.text || (h && h.q) || '').trim().slice(0, 500);
    const photo = h ? h.photo : helpPhoto(ws, args.photo);
    if (!text && !photo) throw new AppError('vide', 'Décrivez le problème ou ajoutez une photo pour votre responsable.');
    if (!h && (wo.help || []).length >= 40) throw new AppError('limite', 'Trop de demandes sur cette mission.');
    if ((wo.help || []).filter(x => x.kind === 'escalade' && x.status === 'ouvert').length >= 3) throw new AppError('limite', 'Trois demandes attendent déjà une réponse de votre responsable.');
    if (!h) { h = { id: 'HP' + (++ws.seq), kind: 'ask', at: ws.clock, q: text, a: null, photo, escalated: false }; (wo.help ||= []).push(h); }
    const t = { id: 'TK' + (++ws.seq), orderId: order.id, woId: wo.id, type: 'escalade_terrain', text: text || 'Photo envoyée sans texte', status: 'ouvert', ownerRole: 'superviseur', at: ws.clock, by: user.name };
    ws.tickets.push(t);
    h.escalated = true; h.kind = 'escalade'; h.status = 'ouvert'; h.ticketId = t.id; h.escalatedAt = ws.clock;
    emit(ws, order, 'AIDE_TERRAIN', { actor: user, payload: { help: h.id } });
    D.notifyRole(ws, 'superviseur', order, { title: 'Un technicien demande de l’aide', body: user.name.split(' ')[0] + ' chez le client ' + order.ref + ' (' + order.address.commune + ') : ' + (t.text.length > 110 ? t.text.slice(0, 110) + '…' : t.text) + (photo ? ' (photo jointe)' : ''), kind: 'alerte' });
    audit(ws, user, 'terrain.transmettre', order.ref, t.text.slice(0, 120));
    return h;
  }, { idem: true, idemFull: true });

  // Le client a regardé la box (ou non) et valide la visite. Sans réponse, la validation se fait toute seule (voir les tâches planifiées).
  cmd('install.validate', ['client'], ({ ws, user, order, args }) => {
    const wo = ws.workOrders.filter(w => w.orderId === order.id && w.status === 'terminee').at(-1);
    if (!wo || !wo.signoff) throw new AppError('etat', 'Il n’y a pas de visite à valider pour le moment.');
    if (order.cancelled) throw new AppError('etat', 'Cette commande est annulée : il n’y a plus rien à valider.');
    if (['validee', 'auto'].includes(wo.signoff.state)) throw new AppError('doublon', 'La visite est déjà validée. Merci !');
    const c = args.checks || {};
    const checks = { voyant: !!c.voyant, internet: !!c.internet, propre: !!c.propre };
    if (args.mode === 'probleme') {
      const text = String(args.text || '').trim().slice(0, 500);
      if (text.length < 5) throw new AppError('motif', 'Décrivez le souci en une phrase pour que l’équipe puisse vous aider.');
      if (wo.signoff.state === 'probleme') throw new AppError('doublon', 'Votre signalement est déjà transmis à l’équipe Moov.');
      wo.signoff = { ...wo.signoff, state: 'probleme', problemAt: ws.clock, problem: text, checks };
      ws.tickets.push({ id: 'TK' + (++ws.seq), orderId: order.id, woId: wo.id, type: 'visite', text: 'Souci signalé à la fin de la visite : ' + text, status: 'ouvert', ownerRole: 'superviseur', at: ws.clock, by: user.name });
      emit(ws, order, 'INSTALLATION_CONTESTEE', { actor: user, publicText: 'Vous avez signalé un souci après la visite. L’équipe Moov vous répond.' });
      D.notifyRole(ws, 'superviseur', order, { title: 'Souci signalé après une visite', body: order.ref + ' : ' + text, kind: 'alerte' });
      D.notifyRole(ws, 'conseiller', order, { title: 'Le client signale un souci', body: order.ref + ' : ' + text, kind: 'alerte' });
      notify(ws, wo.techUserId, { title: 'Le client signale un souci', body: order.ref + ' : ' + text, orderId: order.id, kind: 'alerte' });
      return wo.signoff;
    }
    // Internet arrive après l'activation : on ne l'exige qu'une fois le service actif.
    const needNet = order.state === 'SERVICE_ACTIF';
    if (args.mode === 'verifie' && !(checks.voyant && (checks.internet || !needNet))) throw new AppError('verif', needNet ? 'Cochez que le voyant de la box est allumé et qu’Internet fonctionne, ou choisissez « Il y a un souci ».' : 'Cochez que le voyant de la box est allumé, ou choisissez « Il y a un souci ».');
    if (!['verifie', 'auto'].includes(args.mode)) throw new AppError('mode', 'Choix inconnu.');
    D.finishSignoff(ws, order, wo, args.mode, user, args.mode === 'verifie' ? checks : null);
    return wo.signoff;
  }, { order: true });

  cmd('payment.manualRequest', ['conseiller'], ({ ws, user, order, args }) => {
    if (order.payment.status !== 'en_attente') throw new AppError('etat', 'Paiement déjà rapproché.');
    if ((ws.approvals || []).some(a => a.kind === 'paiement' && a.orderId === order.id && a.status === 'en_attente')) throw new AppError('doublon', 'Une demande de rapprochement attend déjà la validation du superviseur.');
    if (!args.justification || args.justification.length < 10) throw new AppError('motif', 'Justification obligatoire (référence du relevé, etc.).');
    (ws.approvals ||= []).push({ id: 'AP' + (++ws.seq), kind: 'paiement', orderId: order.id, by: user.id, byName: user.name, justification: args.justification, status: 'en_attente', at: ws.clock });
    audit(ws, user, 'paiement.rapprochement_manuel.demande', order.ref, args.justification);
  }, { order: true });
  cmd('approval.decide', ['superviseur'], ({ ws, user, args }) => {
    const ap = (ws.approvals || []).find(a => a.id === args.id); if (!ap || ap.status !== 'en_attente') throw new AppError('introuvable', 'Demande introuvable.');
    if (ap.by === user.id) throw new AppError('interdit', 'Double validation : la personne qui demande ne peut pas valider.');
    const order = getOrder(ws, ap.orderId);
    ap.status = args.ok ? 'validee' : 'refusee'; ap.decidedBy = user.name; ap.decidedAt = ws.clock;
    audit(ws, user, 'validation.' + ap.kind + '.' + ap.status, order.ref, ap.justification);
    if (!args.ok) {
      if (ap.kind === 'annulation') {
        const r = ws.refunds.find(x => x.id === ap.refundId);
        if (r) { r.status = 'rejete'; r.steps.push({ at: ws.clock, by: user.name, what: 'Refus du superviseur' + (args.note ? ' : ' + args.note : '') }); }
        if (order.payment.status === 'rembourse_demande') order.payment.status = 'confirme';
        for (const b of openBlockers(ws, order.id).filter(b => b.type === 'ANNULATION')) resolveBlocker(ws, b, { actor: user, resolution: 'Annulation refusée' + (args.note ? ' : ' + args.note : '') });
        emit(ws, order, 'ANNULATION_REFUSEE', { actor: user, publicText: 'Votre demande d’annulation n’a pas été acceptée. Votre installation continue. Un conseiller peut vous expliquer pourquoi.' });
        notify(ws, order.customerId, { title: 'Annulation non acceptée', body: 'Votre commande ' + order.ref + ' continue.' + (args.note ? ' Motif : ' + args.note : '') + ' Vous pouvez écrire au service client.', orderId: order.id, kind: 'info' });
      }
      if (ap.kind === 'paiement') { const adv = byId(ws.users, ap.by); if (adv) notify(ws, adv.id, { title: 'Rapprochement refusé', body: order.ref + ' : le superviseur n’a pas validé le paiement manuel.', orderId: order.id, kind: 'tache' }); }
      return;
    }
    if (ap.kind === 'paiement') D.confirmPayment(ws, order, { source: 'Rapprochement manuel audité (' + ap.byName + ' + ' + user.name + ')', actor: user });
    if (ap.kind === 'annulation') {
      const r = ws.refunds.find(x => x.id === ap.refundId);
      r.status = 'valide'; r.steps.push({ at: ws.clock, by: user.name, what: 'Validation superviseur' });
      order.cancelled = true; order.version++;
      if (order.payment.status === 'rembourse_demande') order.payment.status = 'rembourse_valide';
      const appt = byId(ws.appointments, order.apptId);
      if (appt && ['reserve', 'confirme'].includes(appt.status)) { appt.status = 'annule'; appt.reason = 'Commande annulée'; D.releaseCap(ws, appt); const wo = byId(ws.workOrders, appt.woId); if (wo) wo.status = 'annulee'; }
      if (order.portReserved) { ws.ports[order.zone].free++; ws.ports[order.zone].reserved--; order.portReserved = false; }
      for (const b of openBlockers(ws, order.id)) resolveBlocker(ws, b, { actor: user, resolution: 'Commande annulée' });
      emit(ws, order, 'COMMANDE_ANNULEE', { actor: user, publicText: 'Votre commande est annulée. Le remboursement suit la procédure Moov (simulé dans cette démo).' });
      ws.jobs.push({ id: 'J' + (++ws.seq), kind: 'refund', ref: r.id, due: ws.clock + 60e3, generation: ws.generation, attempts: 0 });
      notify(ws, order.customerId, { title: 'Annulation validée', body: 'Votre commande ' + order.ref + ' est annulée. Le remboursement est en cours de traitement (simulé).', orderId: order.id, kind: 'info' });
    }
  });
  cmd('cancel.instruct', ['conseiller'], ({ ws, user, order, args }) => {
    const r = ws.refunds.find(x => x.orderId === order.id && x.status === 'demande'); if (!r) throw new AppError('introuvable', 'Aucune demande d’annulation.');
    r.status = 'instruite'; r.steps.push({ at: ws.clock, by: user.name, what: 'Instruction conseiller : ' + (args.note || '') });
    (ws.approvals ||= []).push({ id: 'AP' + (++ws.seq), kind: 'annulation', orderId: order.id, refundId: r.id, by: user.id, byName: user.name, justification: args.note || 'Annulation demandée par le client', status: 'en_attente', at: ws.clock });
    audit(ws, user, 'annulation.instruire', order.ref, args.note || '');
    const sup = ws.users.find(u => u.role === 'superviseur' && u.active); if (sup) notify(ws, sup.id, { title: 'Annulation à valider', body: order.ref + ' : ' + (args.note || 'demande du client'), orderId: order.id, kind: 'tache' });
  }, { order: true });
  cmd('order.close', ['superviseur'], ({ ws, user, order }) => {
    if (order.state !== 'SERVICE_ACTIF') throw new AppError('etat', 'Seul un dossier au service actif peut être clôturé.');
    const bl = openBlockers(ws, order.id); if (bl.length) throw new AppError('bloque', 'Incident ouvert : ' + bl.map(b => BLOCKER_TYPES[b.type].label).join(', '));
    const act = ws.activations.find(a => a.orderId === order.id && a.status === 'confirmee');
    if (!act && order.source !== 'Moov Prospect (simulé)') throw new AppError('etat', 'Aucune confirmation d’activation enregistrée.');
    transition(ws, order, 'CLOTURE', { actor: user, reason: 'Contrôles terminés' });
    audit(ws, user, 'dossier.cloturer', order.ref);
  }, { order: true });
  cmd('activation.retry', ['superviseur'], ({ ws, user, order }) => {
    const b = openBlockers(ws, order.id).find(b => ['ACTIVATION_ECHOUEE', 'ANOMALIE_ACTIVATION'].includes(b.type));
    if (!b || order.state !== 'ACTIVATION_EN_ATTENTE') throw new AppError('etat', 'Aucune activation en échec à relancer.');
    const prev = ws.activations.filter(a => a.orderId === order.id).at(-1);
    const act = { id: 'ACT' + (++ws.seq), orderId: order.id, ref: 'PRV-' + (100000 + ws.seq), serial: prev.serial, status: 'demandee', requestedAt: ws.clock, result: null, retryOf: prev.ref };
    ws.activations.push(act);
    ws.deliveries.push({ id: 'DLV' + (++ws.seq), provider: 'activation', eventId: act.ref, orderId: order.id, kind: 'activation.request', status: 'en_attente', attempts: 0, nextAt: ws.clock + 60e3, error: null, generation: ws.generation, createdAt: ws.clock });
    if (b.type === 'ANOMALIE_ACTIVATION') resolveBlocker(ws, b, { actor: user, resolution: 'Correspondance vérifiée, nouvelle demande ' + act.ref });
    emit(ws, order, 'ACTIVATION_RELANCEE', { actor: user, payload: { ref: act.ref }, publicText: 'Nouvelle tentative d’activation lancée.' });
    audit(ws, user, 'activation.relancer', order.ref, act.ref);
  }, { order: true });
  cmd('duplicate.link', ['conseiller'], ({ ws, user, order, args }) => {
    const other = scopedOrder(ws, user, args.otherId);
    order.linkedTo = other.id; other.linkedTo = order.id; order.version++;
    audit(ws, user, 'doublon.rapprocher', order.ref, '↔ ' + other.ref + ' (réversible, sans fusion)');
    emit(ws, order, 'DOUBLON_RAPPROCHE', { actor: user, payload: { other: other.ref } });
  }, { order: true });
  cmd('duplicate.unlink', ['conseiller'], ({ ws, user, order }) => { const o2 = byId(ws.orders, order.linkedTo); if (!o2 && !order.linkedTo) throw new AppError('etat', 'Ce dossier n’est rapproché d’aucun autre.'); if (o2) o2.linkedTo = null; order.linkedTo = null; order.version++; audit(ws, user, 'doublon.separer', order.ref); emit(ws, order, 'DOUBLON_SEPARE', { actor: user, payload: { other: o2 ? o2.ref : null } }); }, { order: true });
  cmd('blocker.escalateCheck', ['superviseur'], () => {});

  // ----- Administration -----
  cmd('user.setActive', ['admin'], ({ ws, user, args }) => {
    const u = byId(ws.users, args.userId); if (!u) throw new AppError('introuvable', 'Utilisateur inconnu.');
    if (u.id === user.id) throw new AppError('interdit', 'Vous ne pouvez pas vous désactiver vous-même.');
    if (u.id === 'U1' && !args.active) throw new AppError('interdit', 'Awa porte votre espace de démonstration : son compte ne peut pas être désactivé ici. Essayez avec un autre compte, par exemple un technicien.');
    u.active = !!args.active; audit(ws, user, 'compte.' + (u.active ? 'activer' : 'desactiver'), u.name, args.reason || '');
  });
  cmd('user.setZones', ['admin'], ({ ws, user, args }) => { const u = byId(ws.users, args.userId); u.zones = args.zones.filter(z => ZONES.some(x => x.id === z)); audit(ws, user, 'compte.perimetre', u.name, u.zones.join(', ')); });
  cmd('invite.create', ['admin'], ({ ws, user, args, s }) => createInvite(ws, user, args), { ownerOk: true });
  cmd('invite.revoke', ['admin'], ({ ws, user, args }) => {
    const inv = ws.invites.find(i => i.token === args.token); if (!inv) throw new AppError('introuvable', 'Invitation inconnue.');
    inv.revoked = true; inv.revokedAt = ws.clock; audit(ws, user, 'invitation.revoquer', ROLES[byId(ws.users, inv.userId).role].label);
  }, { ownerOk: true });
  cmd('config.set', ['admin'], ({ ws, user, args }) => {
    const allowed = ['holdMinutes', 'autoConfirm', 'policyEquipment', 'contractDays'];
    const num = (min, max, what) => { const n = Number(String(args.value).replace(',', '.')); if (!Number.isFinite(n) || n < min || n > max) throw new AppError('valeur', what + ' : saisissez un nombre entre ' + min + ' et ' + max + '.'); return n; };
    if (args.key.startsWith('slaH.')) { const st = args.key.slice(5); if (!ORDER_STATES.includes(st)) throw new AppError('cle', 'État inconnu.'); ws.config.slaH[st] = num(1, 2000, 'Délai en heures'); }
    else if (args.key.startsWith('templates.')) ws.config.templates[args.key.slice(10)] = String(args.value).slice(0, 300);
    else if (args.key === 'holidays') {
      const parts = String(args.value).split(/[ ,;]+/).filter(Boolean);
      const bad = parts.filter(x => !/^\d{4}-\d{2}-\d{2}$/.test(x) || Number.isNaN(Date.parse(x + 'T00:00:00Z')));
      if (bad.length) throw new AppError('valeur', 'Date non reconnue : ' + bad.join(', ') + '. Écrivez-la ainsi : 2026-12-25.');
      ws.config.holidays = parts;
    }
    else if (args.key === 'holdMinutes') ws.config.holdMinutes = num(1, 60, 'Durée de garde du créneau (minutes)');
    else if (args.key === 'contractDays') ws.config.contractDays = num(1, 120, 'Délai de référence (jours)');
    else if (args.key === 'dossierDeadlineH') ws.config.dossierDeadlineH = num(1, 72, 'Délai pour envoyer le dossier (heures)');
    else if (args.key === 'autoValidateMin') ws.config.autoValidateMin = num(1, 240, 'Délai avant validation automatique (minutes)');
    else if (args.key === 'travelMin') ws.config.travelMin = num(1, 30, 'Durée du trajet simulé (minutes)');
    else if (args.key === 'policyEquipment') { if (!['bloquer', 'avertir', 'ignorer'].includes(String(args.value))) throw new AppError('valeur', 'Politique inconnue.'); ws.config.policyEquipment = String(args.value); }
    else if (allowed.includes(args.key)) ws.config[args.key] = args.key === 'autoConfirm' ? !!args.value : Number(args.value);
    else throw new AppError('cle', 'Paramètre non modifiable.');
    audit(ws, user, 'config.modifier', args.key, String(args.value));
  });
  cmd('model.activate', ['admin'], ({ ws, user, args }) => {
    for (const m of ws.models) m.active = args.version != null && m.version === args.version;
    audit(ws, user, 'ia.modele.' + (args.version ? 'activer' : 'desactiver'), args.version || 'tous', args.reason || '', { ai: true });
  });
  cmd('kb.update', ['admin'], ({ ws, user, args }) => {
    const d = byId(ws.docs, args.id); if (!d) throw new AppError('introuvable', 'Procédure inconnue.');
    const [maj, min] = d.version.split('.').map(Number); d.version = maj + '.' + (min + 1); d.expires = ws.clock + 90 * DAY; d.updatedBy = user.name;
    audit(ws, user, 'procedure.reviser', d.id, 'v' + d.version);
  });
  cmd('integration.replay', ['admin'], ({ ws, user, args }) => {
    const d = byId(ws.deliveries, args.id); if (!d || d.status !== 'abandon') throw new AppError('etat', 'Seules les livraisons abandonnées peuvent être rejouées.');
    d.status = 'en_attente'; d.attempts = 0; d.nextAt = ws.clock; d.error = null; d.replayedBy = user.name;
    audit(ws, user, 'integration.rejouer', d.eventId);
  });
  cmd('backup.create', ['admin'], ({ ws, user }) => {
    const n = (ws.backups.at(-1) || { n: 0 }).n + 1;
    // On garde les 5 dernières sauvegardes : les plus anciennes sont effacées pour ne pas remplir le navigateur.
    while (ws.backups.length >= 5) { const old = ws.backups.shift(); storage.remove(K.bk(ws.id, old.n)); }
    const snap = JSON.stringify({ ...ws, backups: [] }, (k, v) => (k[0] === '_' ? undefined : v));
    storage.set(K.bk(ws.id, n), snap);
    ws.backups.push({ n, at: ws.clock, realAt: realNow(), size: snap.length, by: user.name, events: ws.events.length });
    audit(ws, user, 'sauvegarde.creer', '#' + n, Math.round(snap.length / 1024) + ' Ko');
  });
  cmd('order.open', STAFF_ALL, ({ ws, user, order }) => { audit(ws, user, 'dossier.consulter', order.ref, 'Accès à la fiche complète'); }, { order: true, noAudit: true, readOnlyOk: true });
  cmd('export.orders', ['admin', 'superviseur', 'auditeur'], ({ ws, user }) => {
    // Export minimisé (pas de nom ni de téléphone) et protégé contre les formules actives (MO-09).
    const safe = v => { let x = String(v == null ? '' : v); if (/^[=+\-@\t\r]/.test(x)) x = "'" + x; return '"' + x.replace(/"/g, '""') + '"'; };
    const rows = [['reference', 'zone', 'etat', 'age_jours', 'blocages_ouverts', 'rdv', 'commentaire_client'].join(';')];
    for (const o of ws.orders) rows.push([o.ref, o.zone, o.state, Math.round((ws.clock - o.createdAt) / DAY), openBlockers(ws, o.id).map(b => b.type).join('|'), (byId(ws.appointments, o.apptId) || {}).status || '', (ws.feedback.find(f => f.orderId === o.id) || {}).comment || ''].map(safe).join(';'));
    audit(ws, user, 'export.dossiers', ws.orders.length + ' lignes', 'Champs minimisés, formules neutralisées');
    return rows.join('\n');
  }, { noAudit: true, readOnlyOk: true });
  cmd('degraded.set', ['admin'], ({ ws, user, args }) => { ws.sim.degraded = !!args.on; audit(ws, user, 'continuite.mode_degrade', args.on ? 'activé' : 'désactivé'); });

  // ----- Simulateur (espace de démonstration uniquement, CDC 7.5) -----
  // Référence unique dans l'espace (les connecteurs retrouvent le dossier par sa référence).
  const nextRef = ws => 'FW-2026-' + String(Math.max(100, ...ws.orders.map(o => Number(String(o.ref).split('-').pop()) || 0)) + 1).padStart(3, '0');
  cmd('demo.createOrder', null, ({ ws, args }) => {
    const n = ws.orders.length + 1;
    const zone = args.zone || 'cocody';
    const cust = args.customerId ? byId(ws.users, args.customerId) : null;
    const o = { ...JSON.parse(JSON.stringify(ws.orders[0])), id: 'O' + (ws.seq + 1000), ref: nextRef(ws), customerId: cust ? cust.id : null, claimed: !!cust, contactName: cust ? cust.name : 'Client fictif ' + n, contactPhone: cust ? cust.phone : '+225 07 00 00 ' + String(n).padStart(2, '0'), zone, state: 'DOSSIER_RECU', stateSince: ws.clock, version: 1, createdAt: ws.clock, updatedAt: ws.clock, apptId: null, woId: null, portReserved: false, cancelled: false, prep: {}, scenario: args.scenario || null, clientCheck: null, linkedTo: null, requiredDocs: [] };
    o.address = { ...o.address, commune: ZONES.find(z => z.id === zone).name, verified: false };
    o.payment = { ref: 'MM-' + (500000000 + ws.seq), amount: 25000, currency: 'XOF', status: 'en_attente' };
    o.paidAt = null; o.docNotes = {};
    ws.seq++;
    ws.orders.push(o);
    emit(ws, o, 'DOSSIER_RECU', { source: 'Moov Prospect (simulé)', publicText: STATE_INFO.DOSSIER_RECU.client });
    return o;
  }, { demo: true });
  cmd('demo.webhook', null, ({ ws, args }) => {
    const order = getOrder(ws, args.orderId);
    const kind = args.kind || 'payment';
    let env;
    if (kind === 'payment') env = D.makeEnvelope(ws, 'payment.confirmed', order, { reference: order.payment.ref, amount: args.amount != null ? args.amount : order.payment.amount, currency: 'XOF' }, { source: 'Moov Money (simulé)', badSig: args.badSig });
    else if (kind === 'old') env = D.makeEnvelope(ws, 'order.status', order, { state: args.state || 'PAIEMENT_CONFIRME' }, { source: 'Moov Prospect (simulé)', occurredAt: ws.clock - 72 * H });
    else if (kind === 'wrongEquipment') { const act = ws.activations.filter(a => a.orderId === order.id).at(-1); if (!act) throw new AppError('etat', 'Pas de demande d’activation sur ce dossier.'); env = D.makeEnvelope(ws, 'activation.result', order, { request_ref: act.ref, serial: 'ZTE-F670-99999', ok: true }, { source: 'Système d’activation (émulateur)' }); }
    const results = [D.ingest(ws, env)];
    if (args.duplicate) results.push(D.ingest(ws, { ...env }));
    ws.lastWebhooks = results.map(r => ({ status: r.status, note: r.note, eventId: env.event_id }));
    return ws.lastWebhooks;
  }, { demo: true });
  cmd('demo.integration', null, ({ ws, args }) => { const i = ws.integrations[args.provider]; i.up = !!args.up; if (i.up) i.lastSync = ws.clock; ws.alerts.push({ id: 'AL' + (++ws.seq), at: ws.clock, level: i.up ? 'info' : 'critique', text: i.name + (i.up ? ' rétabli' : ' indisponible (simulé)'), ack: false }); }, { demo: true });
  cmd('demo.flag', null, ({ ws, args }) => { if (!(args.key in ws.sim)) throw new AppError('cle', 'Paramètre inconnu.'); ws.sim[args.key] = !!args.value; }, { demo: true });
  cmd('demo.clock', null, ({ ws, args }) => { ws.clock += Number(args.hours) * H; }, { demo: true });
  cmd('demo.scenario', null, ({ ws, args, realNow: rn }) => runScenarioSetup(ws, args.code, { D, realNow: rn, cmds: C }), { demo: true });
  cmd('demo.restore', null, ({ ws, args }) => {
    const raw = storage.get(K.bk(ws.id, args.n)); if (!raw) throw new AppError('introuvable', 'Sauvegarde introuvable.');
    const snap = JSON.parse(raw);
    const keep = { backups: ws.backups, generation: ws.generation, version: ws.version, invites: ws.invites };
    Object.keys(ws).forEach(k => delete ws[k]); Object.assign(ws, snap, keep);
    audit(ws, { id: 'OWNER', name: 'Testeur', role: 'admin' }, 'sauvegarde.restaurer', '#' + args.n);
    return { restored: args.n };
  }, { demo: true });

  function createInvite(ws, actor, { userId, hours = 2 }) {
    const u = byId(ws.users, userId); if (!u) throw new AppError('introuvable', 'Rôle inconnu.');
    const inv = { token: 'inv_' + rand(16), userId: u.id, role: u.role, createdAt: realNow(), expiresReal: realNow() + hours * H, revoked: false, uses: 0, gen: ws.generation, by: actor.name };
    ws.invites.push(inv);
    audit(ws, actor, 'invitation.creer', ROLES[u.role].label + ' — ' + u.name, 'valable ' + hours + ' h');
    return inv;
  }

  async function exec(token, name, args = {}, opts = {}) {
    let wsId, wsRef = null;
    try { wsId = session(token).ws.id; } catch (e) { return { ok: false, error: { code: e.code || 'erreur', message: e.message } }; }
    return withLock(wsId, () => {
      const rn = realNow();
      try {
        const { s, ws, user } = session(token);
        wsRef = ws;
        advance(ws, rn);
        const c = C[name];
        if (!c) throw new AppError('commande', 'Commande inconnue.');
        if (c.demo) { if (ws.env !== 'demo' || !s.owner) throw new AppError('interdit', 'Commande de simulation réservée au propriétaire d’un espace de démonstration.'); }
        else if (c.roles && !c.roles.includes(user.role) && !(c.ownerOk && s.owner)) {
          audit(ws, user, 'acces.refuse', name, 'Rôle ' + user.role);
          save(ws);
          throw new AppError('interdit', 'Action non autorisée pour le rôle ' + (ROLES[user.role] || {}).label + '.');
        }
        if (READONLY.includes(user.role) && !c.readOnlyOk) throw new AppError('interdit', 'Rôle en lecture seule.');
        if (c.idem && opts.idemKey && ws.idem[opts.idemKey]) return { ok: true, data: ws.idem[opts.idemKey].data, replayed: true };
        const order = c.order ? scopedOrder(ws, user, args.orderId, c.scope) : null;
        if (order && opts.expectedVersion != null && opts.expectedVersion !== order.version) throw new AppError('conflit', 'Le dossier a changé entre-temps (version ' + opts.expectedVersion + ' → ' + order.version + '). Rechargez puis réessayez.');
        const data = c.fn({ ws, user, s, order, args, realNow: rn });
        if (c.idem && opts.idemKey) ws.idem[opts.idemKey] = { at: ws.clock, data: c.idemFull ? clone(data) : data && data.id ? { id: data.id, status: data.status } : null };
        if (!c.noAudit && !name.startsWith('demo.') && !['assistant.ask'].includes(name)) audit(ws, user, name, order ? order.ref : (args.id || args.blockerId || args.userId || ''), '');
        if (name.startsWith('demo.')) audit(ws, { id: 'OWNER', name: 'Simulateur', role: 'testeur' }, name, args.orderId ? (byId(ws.orders, args.orderId) || {}).ref : '', JSON.stringify(args).slice(0, 120));
        runJobs(ws);
        markScenarios(ws);
        save(ws);
        return { ok: true, data: clone(data) };
      } catch (e) {
        if (!(e instanceof AppError)) { console.error(e); }
        // Refus qui laisse une trace voulue (ex. blocage « capacité réseau » ouvert) : on garde l'état.
        if (e instanceof AppError && e.extra && e.extra.keep && wsRef) { markScenarios(wsRef); save(wsRef); return { ok: false, error: { code: e.code || 'erreur', message: e.message, extra: e.extra } }; }
        // Transaction annulée : on relit l'état persistant (rien n'est écrit en cas d'erreur).
        delete cache[wsId];
        const message = e instanceof AppError ? e.message : /quota/i.test(String(e && (e.name + e.message))) ? 'Le stockage du navigateur est plein : supprimez un ancien espace de test dans le Labo, ou des sauvegardes.' : 'Erreur inattendue. Réessayez ; si elle revient, réinitialisez l’espace dans le Labo.';
        return { ok: false, error: { code: e.code || 'erreur', message, extra: e.extra } };
      }
    }).catch(e => { delete cache[wsId]; return { ok: false, error: { code: (e && e.code) || 'erreur', message: (e && e.message) || 'Erreur inattendue. Réessayez.' } }; });
  }
  const clone = x => (x === undefined ? null : JSON.parse(JSON.stringify(x, (k, v) => (k[0] === '_' ? undefined : v))));

  // ---------- Écoulement du temps et tâches différées ----------
  function advance(ws, rn) {
    const dt = Math.max(0, rn - ws.lastReal);
    ws.clock += dt; ws.lastReal = rn;
    for (const h of ws.holds) if (h.status === 'actif' && h.expiresReal <= rn) h.status = 'expire';
  }
  function runJobs(ws) {
    const now = ws.clock;
    for (const j of ws.jobs) {
      if (j.done || j.due > now) continue;
      if (j.generation !== ws.generation) { j.done = true; j.dropped = 'ancienne génération'; continue; }
      if (j.kind === 'send') {
        const o = byId(ws.outbox, j.ref); if (!o) { j.done = true; continue; }
        o.attempts++;
        if (!ws.integrations.sms.up) {
          if (o.attempts >= 3) { o.status = 'échec (non livré)'; j.done = true; ws.alerts.push({ id: 'AL' + (++ws.seq), at: now, level: 'alerte', text: 'Notification non livrée à ' + o.to + ' après 3 essais', ack: false }); }
          else { o.status = 'nouvel essai prévu'; j.due = now + o.attempts * 60e3; }
        } else { o.status = 'livré (accusé simulé)'; j.done = true; }
      } else if (j.kind === 'scan') {
        // Photo d'un dossier en ligne déposée avant l'envoi : la conseillère a déjà été prévenue par « Dossier à vérifier ».
        const d = byId(ws.documents, j.ref); if (d && d.status === 'analyse') { d.status = 'a_valider'; d.scanNote = (d.suspicious ? 'Nom de fichier contenant des instructions : ignorées, aucun droit accordé.' : 'Aucun contenu dangereux détecté (analyse simulée).') + (d.check ? (d.check.ok ? ' Photo nette et lisible.' : ' Photo ' + d.check.issues.join(', ') + ' : à regarder de près.') : ''); const o = byId(ws.orders, d.orderId); const adv = draftDossier(o) || (o.dossier && o.dossier.submittedAt && d.at <= o.dossier.submittedAt) ? null : advisorFor(ws, o); if (adv) notify(ws, adv.id, { title: 'Pièce à valider', body: o.ref + ' : ' + DOC_TYPES[d.type].label + (d.check && !d.check.ok ? ' (photo ' + d.check.issues.join(', ') + ')' : ''), orderId: o.id, kind: 'tache' }); }
        j.done = true;
      } else if (j.kind === 'track') {
        // Trajet simulé du technicien : on prévient le client à 2 minutes, puis à l'arrivée prévue.
        const wo = byId(ws.workOrders, j.ref);
        if (wo && wo.track && wo.track.id === j.trackId && wo.status === 'en_route') {
          const o = byId(ws.orders, wo.orderId); const f = String((byId(ws.users, wo.techUserId) || {}).name || 'Le technicien').split(' ')[0];
          if (j.step === 'near' && !wo.track.near) { wo.track.near = true; notify(ws, o.customerId, { title: f + ' arrive dans 2 minutes', body: 'Préparez-vous à lui ouvrir. Votre code de réception (' + wo.receptionCode + ') se donne seulement à la fin.', orderId: o.id, kind: 'rdv' }); }
          if (j.step === 'there' && !wo.track.there) { wo.track.there = true; notify(ws, o.customerId, { title: f + ' est tout près de chez vous', body: 'Gardez votre téléphone à portée de main : il vous cherche peut-être.', orderId: o.id, kind: 'rdv' }); notify(ws, wo.techUserId, { title: 'Arrivé chez le client ?', body: o.ref + ' : touchez « Arrivé » une fois devant le logement.', orderId: o.id, kind: 'tache' }); }
        }
        j.done = true;
      } else if (j.kind === 'autovalid') {
        // Le client n'a pas répondu : la visite est validée toute seule, et l'équipe Moov apprend que le technicien est libre.
        const wo = byId(ws.workOrders, j.ref);
        if (wo && wo.signoff && wo.signoff.state === 'attente') {
          const o = byId(ws.orders, wo.orderId);
          if (o.cancelled) D.finishSignoff(ws, o, wo, 'annule', SYS);
          else if (wo.reception && wo.reception.status === 'reserve') {
            // Le client avait fait une réserve devant le technicien : pas de validation automatique, le superviseur s'en occupe.
            wo.signoff = { ...wo.signoff, state: 'probleme', problemAt: now, problem: 'Réserve faite à la réception' + (wo.reception.comment ? ' : ' + wo.reception.comment : '') };
            ws.tickets.push({ id: 'TK' + (++ws.seq), orderId: o.id, woId: wo.id, type: 'visite', text: 'Visite terminée avec une réserve du client' + (wo.reception.comment ? ' : ' + wo.reception.comment : ''), status: 'ouvert', ownerRole: 'superviseur', at: now, by: 'Système' });
            D.notifyRole(ws, 'superviseur', o, { title: 'Visite à revoir : réserve du client', body: o.ref + (wo.reception.comment ? ' : ' + wo.reception.comment : ''), kind: 'alerte' });
          } else D.finishSignoff(ws, o, wo, 'delai', SYS);
        }
        j.done = true;
      } else if (j.kind === 'call') {
        // Personne n'a décroché : l'appel devient une demande de rappel, suivie comme les autres.
        const c = (ws.calls || []).find(x => x.id === j.ref);
        if (c && c.status === 'sonne') missedCall(ws, c, 'Appel manqué', now);
        j.done = true;
      } else if (j.kind === 'refund') {
        const r = byId(ws.refunds, j.ref); if (r && r.status === 'valide') { r.status = 'rembourse'; r.steps.push({ at: now, by: 'Moov Money (simulé)', what: 'Remboursement exécuté (simulé, aucun transfert réel)' }); const o = byId(ws.orders, r.orderId); o.payment.status = 'rembourse'; emit(ws, o, 'REMBOURSEMENT_SIMULE', { source: 'Moov Money (simulé)', publicText: 'Remboursement effectué (simulation : aucun argent n’a circulé).' }); }
        j.done = true;
      }
    }
    ws.jobs = ws.jobs.filter(j => !j.done || now - j.due < 2 * H).slice(-200);
    // Livraisons sortantes vers les systèmes Moov : reprises bornées avec délai croissant et aléatoire.
    // Les reprises tombées pendant un saut d'horloge sont toutes jouées (au plus 6 passages).
    for (let pass = 0; pass < 6 && ws.deliveries.some(d => d.status === 'en_attente' && d.nextAt <= now); pass++) for (const d of ws.deliveries) {
      if (d.status !== 'en_attente' || d.nextAt > now) continue;
      if (d.generation !== ws.generation) { d.status = 'abandon'; d.error = 'Ancienne génération'; continue; }
      const prov = ws.integrations[d.provider];
      d.attempts++;
      if (!prov.up) {
        d.error = 'Service indisponible (délai dépassé)';
        if (d.attempts >= 5) { d.status = 'abandon'; ws.alerts.push({ id: 'AL' + (++ws.seq), at: now, level: 'critique', text: 'Livraison ' + d.eventId + ' abandonnée après 5 essais : rejeu manuel possible', ack: false }); }
        else d.nextAt = d.nextAt + Math.pow(2, d.attempts) * 60e3 * (0.8 + Math.random() * 0.4);
        continue;
      }
      if (d.kind === 'activation.request') {
        const act = ws.activations.find(a => a.ref === d.eventId);
        d.status = 'ok'; d.error = null;
        if (!act || act.status !== 'demandee') continue;
        const order = byId(ws.orders, act.orderId);
        const ok = !ws.sim.failNextActivation;
        if (!ok) ws.sim.failNextActivation = false;
        D.ingest(ws, D.makeEnvelope(ws, 'activation.result', order, { request_ref: act.ref, serial: act.serial, ok, error: ok ? null : 'OLT : profil de service refusé (simulé)' }, { source: 'Système d’activation (émulateur)' }));
      }
    }
    // Rapprochement périodique avec Moov Prospect.
    const p = ws.integrations.prospect;
    if (p.up) p.lastSync = now;
    for (const k of ['money', 'activation', 'stock', 'sms']) if (ws.integrations[k].up) ws.integrations[k].lastSync = now;
    // Escalade des blocages dont l'échéance est dépassée (MO-01).
    for (const b of ws.blockers) if (b.status === 'ouvert' && !b.escalated && b.dueAt < now) {
      b.escalated = true;
      const sup = ws.users.find(u => u.role === 'superviseur');
      const o = byId(ws.orders, b.orderId);
      if (sup && o) notify(ws, sup.id, { title: 'Échéance dépassée', body: o.ref + ' : ' + BLOCKER_TYPES[b.type].label + ' ouvert depuis ' + Math.round((now - b.openedAt) / H) + ' h', orderId: o.id, kind: 'alerte' });
    }
    // Rappel la veille du rendez-vous.
    for (const a of ws.appointments) if (a.status === 'confirme' && !a.reminded && a.date - now < 24 * H && a.date > now) {
      a.reminded = true; const o = byId(ws.orders, a.orderId);
      notify(ws, o.customerId, { title: 'Rappel : visite demain', body: ws.config.templates.rappel.replace('{slot}', a.time ? hourLabel(a.time) : D.slotLabel(a.slot)), orderId: o.id, kind: 'rdv' });
    }
  }

  function missedCall(ws, c, why, now) {
    c.status = why === 'Appel manqué' ? 'manque' : 'refuse'; c.endedAt = now;
    const o = byId(ws.orders, c.orderId); if (!o) return;
    const cb = { id: 'CB' + (++ws.seq), orderId: o.id, reason: why + (c.reason ? ' : ' + c.reason : ''), availability: 'Dès que possible', status: 'demande', ownerUserId: c.toId, ownerName: c.toName, at: now, fromCall: c.id };
    ws.callbacks.push(cb);
    emit(ws, o, 'RAPPEL_DEMANDE', { publicText: why + ' : ' + c.toName.split(' ')[0] + ' vous rappelle dès que possible.' });
    notify(ws, c.fromId, { title: c.toName.split(' ')[0] + ' vous rappelle', body: (why === 'Appel manqué' ? 'Votre conseillère n’a pas pu décrocher.' : 'Votre conseillère est occupée.') + ' Elle vous rappelle dès que possible.', orderId: o.id, kind: 'appel' });
    notify(ws, c.toId, { title: 'Rappel à faire', body: o.ref + ' : ' + c.fromName + ' a appelé (' + why.toLowerCase() + ').', orderId: o.id, kind: 'tache' });
  }

  // Y a-t-il quelque chose à faire avancer ? Vérifié sans verrou, pour ne pas réveiller tous les appareils toutes les 2 s.
  function needsPump(ws) {
    const rn = realNow(), ahead = ws.clock + Math.max(0, rn - ws.lastReal);
    return ws.expiresAt < rn
      || ws.jobs.some(j => !j.done && j.due <= ahead)
      || ws.deliveries.some(d => d.status === 'en_attente' && d.nextAt <= ahead)
      || ws.holds.some(h => h.status === 'actif' && h.expiresReal <= rn)
      || ws.blockers.some(b => b.status === 'ouvert' && !b.escalated && b.dueAt < ahead)
      || ws.appointments.some(a => a.status === 'confirme' && !a.reminded && a.date - ahead < 24 * H && a.date > ahead);
  }
  async function pump(wsId) {
    const pre = load(wsId); if (!pre || !needsPump(pre)) return;
    return withLock(wsId, () => {
      const ws = load(wsId); if (!ws) return;
      if (ws.expiresAt < realNow()) { purge(wsId); return; }
      if (!needsPump(ws)) return;
      advance(ws, realNow());
      runJobs(ws);
      markScenarios(ws);
      save(ws);
    });
  }
  // Une étape de scénario réussie reste acquise, même si l'état change ensuite (ex. service rétabli).
  function markScenarios(ws) {
    for (const sc of SCENARIOS) {
      const run = (ws.scenarioRuns || []).filter(r => r.code === sc.code).at(-1); if (!run) continue;
      sc.steps.forEach((st, i) => { if (!(run.reached && run.reached[i]) && safeCheck(st, ws) === true) (run.reached ||= {})[i] = true; });
    }
  }

  // ---------- Lectures filtrées selon les droits ----------
  function q(token, name, args = {}) {
    const { s, ws, user } = session(token);
    const Q = queries[name];
    if (!Q) throw new AppError('requete', 'Requête inconnue.');
    if (Q.roles && !Q.roles.includes(user.role) && !(Q.ownerOk && s.owner)) throw new AppError('interdit', 'Lecture non autorisée pour ce rôle.');
    return Q.fn({ ws, user, s, args });
  }

  // Un représentant n'agit que sur ce que le client lui a confié : pas de pièces d'identité, de téléphone ni de référence de paiement.
  const mask = x => (x ? String(x).slice(0, 4) + ' •••• ' + String(x).slice(-2) : x);
  const forDelegate = v => ({
    ...v,
    order: { ...v.order, contactPhone: mask(v.order.contactPhone), payment: { ...v.order.payment, ref: mask(v.order.payment && v.order.payment.ref) } },
    documents: v.documents.map(d => ({ id: d.id, type: d.type, status: d.status, at: d.at, name: 'Pièce confidentielle', hidden: true })),
    mission: v.mission && { ...v.mission, report: v.mission.report && { ...v.mission.report, photos: [] } },
  });
  const publicEvent = e => ({ seq: e.seq, type: e.type, at: e.effectiveAt, receivedAt: e.receivedAt, text: e.publicText, source: e.source, actorRole: e.role });
  function clientView(ws, user, o) {
    const appts = ws.appointments.filter(a => a.orderId === o.id);
    const appt = byId(ws.appointments, o.apptId);
    const wo = byId(ws.workOrders, o.woId);
    const tech = wo && byId(ws.users, wo.techUserId);
    const team = wo && byId(ws.teams, wo.teamId);
    return {
      order: { id: o.id, ref: o.ref, state: o.state, stateSince: o.stateSince, updatedAt: o.updatedAt, version: o.version, offer: o.offer, address: o.address, zone: o.zone, contactName: o.contactName, contactPhone: o.contactPhone, payment: o.payment, paidAt: o.paidAt, cancelled: o.cancelled, prep: o.prep, requiredDocs: o.requiredDocs || [], docNotes: o.docNotes || {}, claimed: !!o.customerId, clientCheck: o.clientCheck },
      timeline: ws.events.filter(e => e.orderId === o.id && e.publicText).map(publicEvent),
      blockers: ws.blockers.filter(b => b.orderId === o.id).map(b => ({ id: b.id, type: b.type, label: BLOCKER_TYPES[b.type].label, text: BLOCKER_TYPES[b.type].clientText + (b.type === 'PIECE_MANQUANTE' && b.detail ? ' Pièce(s) attendue(s) : ' + b.detail + '.' : b.type === 'ADRESSE_AMBIGUE' && b.detail ? ' Précision demandée : ' + b.detail + '.' : ''), owner: b.ownerRole === 'client' ? 'vous' : 'Moov (' + (ROLES[b.ownerRole] || {}).label + ')', action: b.action, status: b.status, openedAt: b.openedAt, dueAt: b.dueAt, resolution: b.resolution })),
      appointments: appts.map(a => ({ id: a.id, date: a.date, slot: a.slot, status: a.status, reason: a.reason, replaces: a.replaces, time: a.time || null })),
      appt: appt && { id: appt.id, date: appt.date, slot: appt.slot, status: appt.status, time: appt.time || null },
      hold: ws.holds.find(h => h.orderId === o.id && h.status === 'actif' && h.expiresReal > ws.lastReal) || null,
      mission: wo && wo.status !== 'annulee' ? { status: wo.status, techName: tech ? tech.name.split(' ')[0] + ' ' + tech.name.split(' ').slice(1).map(x => x[0] + '.').join(' ') : '—', company: team && team.contractor ? team.contractor + ' pour Moov' : 'Moov Africa', badge: 'MOOV-' + (tech ? tech.id.replace('U', '') : '') + '7' , times: wo.times, receptionCode: wo.receptionCode, reception: wo.reception, track: wo.track || null, woId: wo.id, report: wo.status === 'terminee' ? { checklist: CHECKLIST_TECH.map(c => ({ label: c.label, value: wo.checklist[c.id], unit: c.unit })), serial: wo.serial, photos: wo.photos.map(p => ({ id: p.id, name: p.name, thumb: p.thumb, img: p.img, at: p.at })), comment: wo.comment } : null, failure: wo.failure, signoff: wo.signoff || null } : null,
      activation: ws.activations.filter(a => a.orderId === o.id).map(a => ({ ref: a.ref, status: a.status, at: a.requestedAt, confirmedAt: a.confirmedAt })),
      documents: ws.documents.filter(d => d.orderId === o.id).map(d => ({ id: d.id, type: d.type, name: d.name, mime: d.mime, status: d.status, reason: d.reason, at: d.at, thumb: d.thumb, img: d.img, scanNote: d.scanNote, check: d.check })),
      messages: ws.messages.filter(m => m.orderId === o.id && m.visibility === 'public'),
      callbacks: ws.callbacks.filter(c => c.orderId === o.id),
      tickets: ws.tickets.filter(t => t.orderId === o.id && (t.type.startsWith('signalement') || t.type === 'question_assistant')).map(t => ({ id: t.id, type: t.type, status: t.status, at: t.at, text: t.text })),
      estimate: o.cancelled ? { abstain: true, reason: 'Commande annulée.', at: ws.clock } : estimate(ws, o),
      feedback: ws.feedback.find(f => f.orderId === o.id) || null,
      refund: ws.refunds.filter(r => r.orderId === o.id).at(-1) || null,
      delegations: ws.delegations.filter(d => d.orderId === o.id).map(d => ({ ...d, delegate: (byId(ws.users, d.delegateId) || {}).name })),
      stale: !ws.integrations.prospect.up ? ws.integrations.prospect.lastSync : null,
      contractDue: o.paidAt ? o.paidAt + ws.config.contractDays * DAY : null,
      dossier: D.dossierState(ws, o),
      // Projection : jamais la note interne de la conseillère ni les identifiants des personnes.
      calls: (ws.calls || []).filter(c => c.orderId === o.id).slice(-5).map(c => ({ id: c.id, status: c.status, fromName: c.fromName, toName: c.toName, reason: c.reason, startedAt: c.startedAt, answeredAt: c.answeredAt, endedAt: c.endedAt, mine: c.fromId === user.id })),
      techRating: (ws.techRatings || []).filter(r => r.orderId === o.id).at(-1) || null,
      lastVisit: (w => w && { woId: w.id, techName: (byId(ws.users, w.techUserId) || {}).name || '—', end: w.times.end, signoff: w.signoff || null })(ws.workOrders.filter(w => w.orderId === o.id && w.status === 'terminee').at(-1)),
    };
  }

  const DOSSIER_ORDER = { a_verifier: 0, incomplet: 1, verifie: 2, en_retard: 3, a_completer: 4 };
  const queries = {
    me: { fn: ({ ws, user, s }) => ({
      user: { id: user.id, name: user.name, role: user.role, phone: user.phone, prefs: user.prefs, zones: user.zones, contractor: user.contractor },
      ws: { id: ws.id, name: ws.name, env: ws.env, generation: ws.generation, expiresAt: ws.expiresAt, clock: ws.clock, seed: ws.seed, degraded: ws.sim.degraded, integrations: ws.integrations, holdMinutes: ws.config.holdMinutes, lastReal: ws.lastReal, travelMin: ws.config.travelMin || 4, autoValidateMin: ws.config.autoValidateMin || 60, dossierDeadlineH: ws.config.dossierDeadlineH || 24 },
      owner: !!s.owner,
      unread: ws.notifications.filter(n => n.userId === user.id && !n.read).length,
      users: s.owner ? ws.users.map(u => ({ id: u.id, name: u.name, role: u.role, active: u.active })) : null,
    }) },
    'client.orders': { roles: CLIENTISH, fn: ({ ws, user }) => ws.orders.filter(o => canSee(ws, user, o)).map(o => ({ id: o.id, ref: o.ref, state: o.state, address: o.address, cancelled: o.cancelled, updatedAt: o.updatedAt, dossier: o.dossier ? (D.dossierState(ws, o) || {}).status || null : null, scopes: user.role === 'representant' ? ws.delegations.filter(d => d.orderId === o.id && d.delegateId === user.id && !d.revoked).flatMap(d => d.scopes) : null })) },
    'client.order': { roles: CLIENTISH, fn: ({ ws, user, args }) => { const v = clientView(ws, user, scopedOrder(ws, user, args.orderId)); return user.role === 'representant' ? forDelegate(v) : v; } },
    'client.availability': { roles: CLIENTISH, fn: ({ ws, user, args }) => D.availability(ws, scopedOrder(ws, user, args.orderId, 'rdv')) },
    'client.document': { roles: ['client'], fn: ({ ws, user, args }) => { const d = byId(ws.documents, args.docId); if (!d) throw new AppError('introuvable', 'Pièce introuvable ou non autorisée.'); scopedOrder(ws, user, d.orderId); return d; } },
    notifications: { fn: ({ ws, user }) => ws.notifications.filter(n => n.userId === user.id).slice(-60).reverse() },
    // Chaque personne ne voit que ses propres SMS, même dans l'espace de démo de son propriétaire.
    outbox: { fn: ({ ws, user }) => ws.outbox.filter(o => o.userId === user.id).slice(-60).reverse() },
    delegates: { roles: ['client'], fn: ({ ws }) => ws.users.filter(u => u.role === 'representant').map(u => ({ id: u.id, name: u.name })) },
    'kb.public': { fn: ({ ws, user }) => ws.docs.filter(d => d.scope === 'public' || user.role !== 'client') },

    'ops.orders': { roles: ['conseiller', 'planificateur', 'superviseur', 'admin', 'auditeur'], fn: ({ ws, user, args }) => {
      const qx = String(args.q || '').trim().toLowerCase();
      let list = ws.orders.filter(o => canSee(ws, user, o));
      if (qx) { list = list.filter(o => o.ref.toLowerCase().includes(qx) || o.contactPhone.replace(/\s/g, '').includes(qx.replace(/\s/g, '')) || o.contactName.toLowerCase().includes(qx)); }
      if (args.zone) list = list.filter(o => o.zone === args.zone);
      if (args.state) list = list.filter(o => o.state === args.state);
      return list.map(o => opsRow(ws, o));
    } },
    'ops.queues': { roles: ['conseiller', 'planificateur', 'superviseur'], fn: ({ ws, user }) => {
      const rows = ws.orders.filter(o => canSee(ws, user, o) && !o.cancelled && !['CLOTURE'].includes(o.state)).map(o => opsRow(ws, o));
      const noNext = rows.filter(r => r.idleH > 36 && !['SERVICE_ACTIF'].includes(r.state));
      return {
        sansAction: noNext.sort((a, b) => b.risk.score - a.risk.score),
        enRetard: rows.filter(r => r.overSla).sort((a, b) => b.risk.score - a.risk.score),
        incomplets: rows.filter(r => r.blockers.some(b => ['PIECE_MANQUANTE', 'ADRESSE_AMBIGUE', 'PAIEMENT_NON_RAPPROCHE'].includes(b.type)) || (r.dossier && ['incomplet', 'en_retard'].includes(r.dossier.status))),
        dossiers: rows.filter(r => r.dossier && ['incomplet', 'a_verifier', 'verifie', 'en_retard', 'a_completer'].includes(r.dossier.status)).sort((a, b) => (DOSSIER_ORDER[a.dossier.status] - DOSSIER_ORDER[b.dossier.status]) || ((b.dossier.submittedAt || 0) - (a.dossier.submittedAt || 0))),
        bloques: rows.filter(r => r.blockers.length).sort((a, b) => b.risk.score - a.risk.score),
        aConfirmer: rows.filter(r => r.apptStatus === 'reserve'),
        aPreparer: rows.filter(r => r.state === 'PREPARATION' && !r.blockers.length),
        tickets: ws.tickets.filter(t => t.status === 'ouvert' && (t.ownerRole === user.role || user.role === 'superviseur') && canSee(ws, user, byId(ws.orders, t.orderId))).map(t => ({ ...t, ref: byId(ws.orders, t.orderId).ref })),
        callbacks: ws.callbacks.filter(c => c.status === 'demande' && canSee(ws, user, byId(ws.orders, c.orderId))).map(c => ({ ...c, ref: byId(ws.orders, c.orderId).ref })),
        docs: ws.documents.filter(d => ['analyse', 'a_valider'].includes(d.status) && canSee(ws, user, byId(ws.orders, d.orderId))).map(d => ({ ...d, ref: byId(ws.orders, d.orderId).ref })),
        approvals: (ws.approvals || []).filter(a => a.status === 'en_attente').map(a => ({ ...a, ref: byId(ws.orders, a.orderId).ref })),
      };
    } },
    'ops.order': { roles: ['conseiller', 'planificateur', 'superviseur', 'admin', 'auditeur'], fn: ({ ws, user, args }) => {
      const o = scopedOrder(ws, user, args.orderId);
      const cv = clientView(ws, user, o);
      const dups = ws.orders.filter(x => x.id !== o.id && (x.contactPhone === o.contactPhone || (x.address.street === o.address.street && x.zone === o.zone)) && canSee(ws, user, x)).map(x => ({ id: x.id, ref: x.ref, why: x.contactPhone === o.contactPhone ? 'même téléphone' : 'même adresse', state: x.state }));
      return { ...cv, internal: {
        events: ws.events.filter(e => e.orderId === o.id),
        notes: ws.messages.filter(m => m.orderId === o.id && m.visibility === 'interne'),
        blockers: ws.blockers.filter(b => b.orderId === o.id).map(b => ({ ...b, ownerName: (byId(ws.users, b.ownerUserId) || {}).name || null, label: BLOCKER_TYPES[b.type].label })),
        risk: risk(ws, o), deliveries: ws.deliveries.filter(d => d.orderId === o.id || d.orderRef === o.ref),
        workOrder: (w => w && { ...w, teamName: (byId(ws.teams, w.teamId) || {}).name || null })(byId(ws.workOrders, o.woId)), customer: byId(ws.users, o.customerId), linkedTo: o.linkedTo && byId(ws.orders, o.linkedTo) && byId(ws.orders, o.linkedTo).ref, duplicates: dups,
        tickets: ws.tickets.filter(t => t.orderId === o.id), approvals: (ws.approvals || []).filter(a => a.orderId === o.id), portReserved: o.portReserved, feedback: ws.feedback.find(f => f.orderId === o.id),
        assistantLog: (ws.assistantLog || []).filter(a => a.orderId === o.id),
        techRatings: (ws.techRatings || []).filter(r => r.orderId === o.id),
        advice: D.dossierAdvice(ws, o),
      } };
    } },
    // Droit de voir une image (pièce ou photo) : même règle que le dossier, technicien seulement sur sa mission ouverte.
    // Un identifiant d'image connu ne suffit pas (R-11).
    'image.allowed': { fn: ({ ws, user, args }) => {
      const img = D.imgRef(args.img); if (!img) return false;
      if (['admin', 'auditeur'].includes(user.role)) return false;
      const d = ws.documents.find(x => x.img === img);
      if (d) { const o = byId(ws.orders, d.orderId); if (!o || user.role === 'representant') return false; return user.role === 'technicien' ? !!activeWo(ws, o.id, user.id) && TECH_DOCS.includes(d.type) : canSee(ws, user, o); }
      const hw = ws.workOrders.find(x => (x.help || []).some(h => h.photo && h.photo.img === img));
      if (hw) { const o = byId(ws.orders, hw.orderId); if (!o) return false; return user.role === 'technicien' ? hw.techUserId === user.id : ['superviseur', 'planificateur', 'conseiller'].includes(user.role) && canSee(ws, user, o); }
      const w = ws.workOrders.find(x => (x.photos || []).some(p => p.img === img));
      if (w) { const o = byId(ws.orders, w.orderId); if (!o) return false; return user.role === 'technicien' ? w.techUserId === user.id : user.role === 'representant' ? false : user.role === 'client' ? w.status === 'terminee' && canSee(ws, user, o) : canSee(ws, user, o); }
      return false;
    } },
    // Qui peut venir à l'heure choisie ? Pour chaque équipe de la zone : place restante sur la demi-journée et heures déjà prises.
    'ops.techFree': { roles: ['planificateur', 'superviseur', 'conseiller'], fn: ({ ws, user, args }) => {
      const o = scopedOrder(ws, user, args.orderId);
      const appt = byId(ws.appointments, o.apptId);
      const notOk = unvalidatedDocs(ws, o);
      if (!appt) return { appt: null, hours: [], teams: [], docsOk: !notOk.length, docsMissing: notOk.map(t => DOC_TYPES[t].label) };
      const hours = SLOT_HOURS[appt.slot] || [];
      // Toutes les équipes sont montrées : celles qui ne travaillent pas dans la commune du client sont grisées (et expliquées).
      const teams = ws.teams.map(t => {
        const covers = t.zones.includes(o.zone);
        const cap = ws.capacity.find(c => c.teamId === t.id && c.date === appt.date && c.slot === appt.slot);
        const own = appt.teamId === t.id && ['reserve', 'confirme'].includes(appt.status);
        const left = cap ? D.remaining(ws, cap) : 0;
        const busy = ws.appointments.filter(a => a.id !== appt.id && a.teamId === t.id && a.date === appt.date && a.slot === appt.slot && ['confirme', 'en_cours', 'realise'].includes(a.status)).map(a => ({ time: a.time || null, ref: (byId(ws.orders, a.orderId) || {}).ref }));
        const tech = byId(ws.users, t.techUserId);
        const canTake = covers && t.available && (own || left > 0);
        const now = D.techNow(ws, t.techUserId);
        const nowOrder = now.orderId ? byId(ws.orders, now.orderId) : null;
        const live = { status: now.status, problem: !!now.problem, freeSince: now.freeSince || null, ref: nowOrder && canSee(ws, user, nowOrder) ? nowOrder.ref : null };
        return { live, id: t.id, covers, name: t.name, techId: t.techUserId, techName: tech ? tech.name : '—', contractor: t.contractor, quality: t.quality, available: t.available, own, left, busy, canTake,
          hours: hours.map(h => ({ h, free: canTake && !busy.some(b => b.time === h) })) };
      });
      teams.sort((a, b) => (b.canTake - a.canTake) || (b.covers - a.covers));
      return { commune: o.address.commune, appt: { id: appt.id, date: appt.date, slot: appt.slot, status: appt.status, teamId: appt.teamId, time: appt.time || null }, hours, teams, docsOk: !notOk.length, docsMissing: notOk.map(t => DOC_TYPES[t].label), state: o.state };
    } },
    'ops.calls': { roles: ['conseiller', 'superviseur'], fn: ({ ws, user }) => (ws.calls || []).filter(c => (c.toId === user.id || user.role === 'superviseur') && (LIVE_CALL.includes(c.status) || ws.clock - c.startedAt < 15 * 60e3)).map(c => ({ ...c, ref: (byId(ws.orders, c.orderId) || {}).ref })).reverse() },
    'ops.summary': { roles: ['conseiller', 'superviseur'], fn: ({ ws, user, args }) => { const o = scopedOrder(ws, user, args.orderId); return summarize(ws, o); } },
    'ops.staff': { roles: STAFF_ALL, fn: ({ ws }) => ws.users.filter(u => !['client', 'representant'].includes(u.role)).map(u => ({ id: u.id, name: u.name, role: u.role })) },
    planning: { roles: ['planificateur', 'superviseur'], fn: ({ ws, user }) => {
      const teams = ws.teams.filter(t => user.role === 'superviseur' || t.zones.some(z => user.zones.includes(z)));
      const days = [...new Set(ws.capacity.map(c => c.date))].sort((a, b) => a - b).slice(0, 10);
      const cells = ws.capacity.filter(c => teams.some(t => t.id === c.teamId) && days.includes(c.date)).map(c => ({ ...c, left: D.remaining(ws, c), appts: ws.appointments.filter(a => a.capId === c.id && ['reserve', 'confirme', 'en_cours', 'realise'].includes(a.status)).map(a => ({ id: a.id, status: a.status, ref: byId(ws.orders, a.orderId).ref, orderId: a.orderId, zone: byId(ws.orders, a.orderId).zone })) }));
      const unassigned = ws.appointments.filter(a => a.status === 'reserve' && canSee(ws, user, byId(ws.orders, a.orderId))).map(a => ({ ...a, ref: byId(ws.orders, a.orderId).ref, zone: byId(ws.orders, a.orderId).zone, orderId: a.orderId }));
      const stock = Object.create(null); for (const e of ws.equipment) { stock[e.model] ||= { stock: 0, attribue: 0 }; stock[e.model][e.status]++; }
      const demand = ws.orders.filter(o => ['PRET_A_PLANIFIER', 'RDV_CONFIRME'].includes(o.state)).length;
      return { teams, days, cells, unassigned, ports: ws.ports, stock, demand, shortage: ws.sim.equipmentShortage, saturation: ws.sim.saturation, zones: user.zones };
    } },
    'tech.missions': { roles: ['technicien'], fn: ({ ws, user }) => ws.workOrders.filter(w => w.techUserId === user.id).map(w => {
      const o = byId(ws.orders, w.orderId); const a = byId(ws.appointments, w.apptId);
      return { ...w, ref: o.ref, orderId: o.id, orderVersion: o.version, address: o.address, contactName: o.contactName, offer: o.offer, equipmentModel: o.equipmentModel, appt: a && { date: a.date, slot: a.slot, status: a.status, time: a.time || null }, prep: o.prep, rating: (ws.techRatings || []).find(r => r.woId === w.id) || null, teamName: (byId(ws.teams, w.teamId) || {}).name || null, notes: ws.messages.filter(m => m.orderId === o.id && m.visibility === 'interne').slice(-3),
        // Pièces utiles à la visite, visibles seulement tant que la mission est ouverte (besoin d'en connaître).
        documents: ['terminee', 'annulee', 'echec'].includes(w.status) ? [] : ws.documents.filter(d => d.orderId === o.id && TECH_DOCS.includes(d.type) && d.status !== 'remplace').map(d => ({ id: d.id, type: d.type, name: d.name, status: d.status, at: d.at, thumb: d.thumb, img: d.img })) };
    }).sort((x, y) => ((x.appt && x.appt.date) || 0) - ((y.appt && y.appt.date) || 0)) },
    // Suivi des trajets et des visites pour l'administrateur général et le superviseur : qui est où, depuis quand, pendant combien de temps.
    'admin.trips': { roles: ['admin', 'superviseur', 'planificateur', 'auditeur'], fn: ({ ws, user }) => {
      const mins = ms => (ms == null ? null : Math.round(ms / 6e4 * 10) / 10);
      const mine = o => user.role === 'planificateur' ? (user.zones || []).includes(o.zone) : true;
      // Toutes les visites qui ont commencé ou sont prévues ; le périmètre ne limite que ce qui s'affiche (pas l'état des techniciens).
      const all = ws.workOrders.filter(w => w.status !== 'annulee' && (w.times.depart || w.times.arrive || w.times.start || ['affectee', 'echec'].includes(w.status))).map(w => {
        const o = byId(ws.orders, w.orderId); if (!o) return null;
        const t = w.times, tech = byId(ws.users, w.techUserId), team = byId(ws.teams, w.teamId);
        const open = (w.help || []).filter(h => h.kind === 'escalade' && h.status === 'ouvert').length;
        const sign = w.signoff && ['validee', 'auto'].includes(w.signoff.state);
        // Étape atteinte : mission transmise (1), en route (2), arrivé (3), en cours (4), terminé (5), validé (6). Une visite en échec n'a pas d'étape de plus que celle où elle s'est arrêtée.
        const stage = w.status === 'echec' ? (t.start ? 4 : t.arrive ? 3 : t.depart ? 2 : 1) : sign ? 6 : w.status === 'terminee' ? 5 : w.status === 'en_cours' ? 4 : w.status === 'sur_place' ? 3 : w.status === 'en_route' ? 2 : 1;
        return { inScope: mine(o), woId: w.id, orderId: o.id, ref: o.ref, client: o.contactName, commune: o.address.commune, zone: o.zone, techId: w.techUserId, techName: tech ? tech.name : 'Technicien inconnu', teamName: team ? team.name : null, contractor: team ? team.contractor : null,
          status: w.status, stage, track: w.track || null, times: { depart: t.depart || null, arrive: t.arrive || null, start: t.start || null, end: t.end || null },
          travelMin: w.status === 'terminee' ? mins(t.depart && (t.arrive || t.start) ? (t.arrive || t.start) - t.depart : null) : null, onSiteMin: w.status === 'terminee' ? mins((t.arrive || t.start) && t.end ? t.end - (t.arrive || t.start) : null) : null,
          signoff: w.signoff ? { state: w.signoff.state, mode: w.signoff.mode || null, autoAt: w.signoff.autoAt, at: w.signoff.at || null } : null, freeAt: w.freeAt || null,
          helpCount: (w.help || []).length, helpOpen: ['en_cours', 'sur_place'].includes(w.status) ? open : 0, failure: w.failure || null };
      }).filter(Boolean);
      const rows = all.filter(r => r.inScope).map(({ inScope, ...r }) => r).sort((a, b) => ((b.times.depart || b.times.start || 0) - (a.times.depart || a.times.start || 0)));
      const done = rows.filter(r => r.travelMin != null), onsite = rows.filter(r => r.onSiteMin != null);
      const avg = l => (l.length ? Math.round(l.reduce((s, x) => s + x, 0) / l.length * 10) / 10 : null);
      const techs = ws.teams.filter(tm => user.role !== 'planificateur' || tm.zones.some(z => (user.zones || []).includes(z))).map(tm => {
        const u = byId(ws.users, tm.techUserId); const n = D.techNow(ws, tm.techUserId);
        const o = n.orderId ? byId(ws.orders, n.orderId) : null;
        return { id: tm.techUserId, name: u ? u.name : 'Technicien inconnu', teamName: tm.name, contractor: tm.contractor, available: tm.available, status: n.status, problem: !!n.problem, ref: o && mine(o) ? o.ref : null, freeSince: n.freeSince || null, visits: all.filter(r => r.techId === tm.techUserId && r.stage >= 5).length };
      });
      return { now: ws.clock, total: rows.length, kpis: { enRoute: rows.filter(r => r.status === 'en_route').length, surPlace: rows.filter(r => ['sur_place', 'en_cours'].includes(r.status)).length, attenteClient: rows.filter(r => r.status === 'terminee' && r.signoff && ['attente', 'probleme'].includes(r.signoff.state)).length, validees: rows.filter(r => r.stage === 6).length, aideEnAttente: rows.reduce((n, r) => n + r.helpOpen, 0), travelAvgMin: avg(done.map(r => r.travelMin)), onSiteAvgMin: avg(onsite.map(r => r.onSiteMin)), autoValidateMin: ws.config.autoValidateMin || 60 }, trips: rows.slice(0, 60), techs };
    } },
    dashboard: { roles: ['superviseur', 'admin', 'auditeur'], fn: ({ ws }) => dashboard(ws) },
    'admin.users': { roles: ['admin', 'auditeur'], ownerOk: true, fn: ({ ws }) => ({ users: ws.users, invites: ws.invites.map(i => ({ ...i, user: (byId(ws.users, i.userId) || {}).name })), privacy: ws.privacy }) },
    'admin.config': { roles: ['admin', 'superviseur', 'auditeur'], fn: ({ ws }) => ({ config: { ...ws.config, webhookSecret: '•••• (stocké dans un coffre en production)' }, zones: ZONES, blockerTypes: BLOCKER_TYPES, docs: ws.docs, ports: ws.ports }) },
    'admin.integrations': { roles: ['admin', 'superviseur', 'auditeur'], fn: ({ ws }) => ({ integrations: ws.integrations, deliveries: ws.deliveries.slice(-80).reverse(), alerts: ws.alerts.slice(-30).reverse(), outbox: ws.outbox.slice(-30).reverse() }) },
    'admin.audit': { roles: ['admin', 'auditeur', 'superviseur'], fn: ({ ws, args }) => { let a = ws.audit; if (args.q) { const x = args.q.toLowerCase(); a = a.filter(e => (e.action + e.resource + e.actor + e.detail).toLowerCase().includes(x)); } if (args.ai) a = a.filter(e => e.ai); return a.slice().sort((x, y) => (y.at - x.at) || (y.seq - x.seq)).slice(0, 300); } },
    'admin.models': { roles: ['admin', 'auditeur', 'superviseur'], fn: ({ ws }) => { ws._eval ||= evaluate(ws.seed); const done = ws.predictions.filter(p => p.actualH != null); return { models: ws.models, evaluation: ws._eval, live: { predictions: ws.predictions.length, withOutcome: done.length, mae: done.length ? done.reduce((s, p) => s + Math.abs(p.medianH - p.actualH), 0) / done.length : null, coverage: done.length ? done.filter(p => p.actualH >= p.loH && p.actualH <= p.hiH).length / done.length : null }, assistant: (ws.assistantLog || []).slice(-50).reverse(), seed: ws.seed }; } },
    'admin.health': { roles: ['admin', 'superviseur', 'auditeur'], fn: ({ ws }) => ({ integrations: ws.integrations, degraded: ws.sim.degraded, backups: ws.backups, jobs: { pending: ws.jobs.filter(j => !j.done).length, dropped: ws.jobs.filter(j => j.dropped).length }, deliveries: { pending: ws.deliveries.filter(d => d.status === 'en_attente').length, dead: ws.deliveries.filter(d => d.status === 'abandon').length }, storageKb: Math.round((storage.get(K.ws(ws.id)) || '').length / 1024) }) },
    'admin.refunds': { roles: ['admin', 'superviseur', 'conseiller', 'auditeur'], fn: ({ ws, user }) => ({ refunds: ws.refunds.filter(r => canSee(ws, user, byId(ws.orders, r.orderId))).map(r => ({ ...r, ref: byId(ws.orders, r.orderId).ref })), payments: ws.orders.filter(o => canSee(ws, user, o)).map(o => ({ id: o.id, ...o.payment, orderRef: o.ref, state: o.state })), approvals: (ws.approvals || []).map(a => ({ ...a, ref: byId(ws.orders, a.orderId).ref })) }) },
    'labo.state': { ownerOk: true, fn: ({ ws, s }) => {
      if (!s.owner) throw new AppError('interdit', 'Réservé au propriétaire de l’espace.');
      return { ws: { id: ws.id, name: ws.name, seed: ws.seed, generation: ws.generation, clock: ws.clock, expiresAt: ws.expiresAt, createdAt: ws.createdAt, sim: ws.sim, integrations: ws.integrations, backups: ws.backups },
        orders: ws.orders.map(o => ({ id: o.id, ref: o.ref, state: o.state, zone: o.zone, customerId: o.customerId, scenario: o.scenario, cancelled: o.cancelled, blockers: openBlockers(ws, o.id).map(b => b.type) })),
        users: ws.users, invites: ws.invites, scenarios: SCENARIOS.map(sc => ({ code: sc.code, title: sc.title, goal: sc.goal, steps: withLaterDone(sc.steps.map((st, i) => { const run = (ws.scenarioRuns || []).filter(r => r.code === sc.code).at(-1); return { ...st, check: undefined, done: run && run.reached && run.reached[i] ? true : safeCheck(st, ws) }; })), active: (ws.scenarioRuns || []).some(r => r.code === sc.code), run: (ws.scenarioRuns || []).filter(r => r.code === sc.code).at(-1) || null })),
        events: ws.events.slice().sort((a, b) => (b.effectiveAt - a.effectiveAt) || (b.seq - a.seq)).slice(0, 80), outbox: ws.outbox.slice(-40).reverse(), lastWebhooks: ws.lastWebhooks || [], deliveries: ws.deliveries.slice(-30).reverse() };
    } },
  };
  // Une étape qu'on ne peut pas vérifier (null) compte comme faite dès qu'une étape suivante l'est.
  function withLaterDone(steps) { let later = false; for (let i = steps.length - 1; i >= 0; i--) { if (steps[i].done === true) later = true; else if (steps[i].done === null && later) steps[i].done = true; } return steps; }
  function safeCheck(st, ws) { try { const run = (ws.scenarioRuns || []).filter(r => r.code === st.code).at(-1); if (!st.check || !run) return false; const v = st.check(ws, run); return v === null ? null : !!v; } catch { return false; } }

  function opsRow(ws, o) {
    const bl = openBlockers(ws, o.id);
    const lastEv = ws.events.filter(e => e.orderId === o.id).at(-1);
    const sla = ws.config.slaH[o.state];
    const inState = (ws.clock - o.stateSince) / H;
    const appt = byId(ws.appointments, o.apptId);
    const r = risk(ws, o);
    return { id: o.id, ref: o.ref, zone: o.zone, commune: o.address.commune, state: o.state, contactName: o.contactName, contactPhone: o.contactPhone, ageD: (ws.clock - (o.paidAt || o.createdAt)) / DAY, inStateH: inState, sla, overSla: sla && inState > sla, idleH: lastEv ? (ws.clock - lastEv.effectiveAt) / H : 0, blockers: bl.map(b => ({ id: b.id, type: b.type, label: BLOCKER_TYPES[b.type].label, owner: (byId(ws.users, b.ownerUserId) || {}).name || null, dueAt: b.dueAt, escalated: b.escalated })), apptStatus: appt && appt.status, apptDate: appt && appt.date, apptSlot: appt && appt.slot, apptTime: appt && appt.time || null, risk: r, cancelled: o.cancelled, version: o.version, dossier: D.dossierState(ws, o), offer: o.offer };
  }

  function dashboard(ws) {
    const paidToActive = [];
    for (const o of ws.orders) {
      const act = ws.events.find(e => e.orderId === o.id && e.type === 'SERVICE_ACTIF');
      if (act && o.paidAt) paidToActive.push((act.effectiveAt - o.paidAt) / DAY);
    }
    const q = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))]; };
    const open = ws.orders.filter(o => !o.cancelled && !['SERVICE_ACTIF', 'CLOTURE'].includes(o.state));
    const ages = open.map(o => (ws.clock - (o.paidAt || o.createdAt)) / DAY);
    const byState = Object.fromEntries(ORDER_STATES.map(s => [s, ws.orders.filter(o => o.state === s && !o.cancelled).length]));
    const openB = ws.blockers.filter(b => b.status === 'ouvert');
    const appts = ws.appointments.filter(a => ['realise', 'non_honore'].includes(a.status));
    const firstContact = [];
    for (const o of ws.orders) { const pay = ws.events.find(e => e.orderId === o.id && e.type === 'PAIEMENT_CONFIRME'); const c = ws.events.find(e => e.orderId === o.id && ['MESSAGE', 'RDV_RESERVE', 'RAPPEL_FAIT'].includes(e.type)); if (pay && c) firstContact.push((c.effectiveAt - pay.effectiveAt) / H); }
    const fb = ws.feedback;
    const byZone = ZONES.map(z => ({ zone: z.name, open: open.filter(o => o.zone === z.id).length, blocked: open.filter(o => o.zone === z.id && openBlockers(ws, o.id).length).length }));
    const aging = [[0, 3], [3, 7], [7, 14], [14, 999]].map(([a, b]) => ({ label: b === 999 ? a + ' j et +' : a + '–' + b + ' j', n: ages.filter(x => x >= a && x < b).length }));
    const resolved = ws.blockers.filter(b => b.status === 'resolu');
    return {
      total: ws.orders.length, open: open.length, active: byState.SERVICE_ACTIF + byState.CLOTURE,
      medianDays: q(paidToActive, 0.5), p90Days: q(paidToActive, 0.9), nActive: paidToActive.length,
      byState, aging, byZone,
      blocked: openB.length, blockedNoOwner: openB.filter(b => !b.ownerUserId).length, overdue: openB.filter(b => b.dueAt < ws.clock).length,
      avgResolveH: resolved.length ? resolved.reduce((s, b) => s + (b.resolvedAt - b.openedAt) / H, 0) / resolved.length : null,
      missed: appts.filter(a => a.status === 'non_honore').length, done: appts.filter(a => a.status === 'realise').length,
      firstContactH: q(firstContact, 0.5),
      activationFails: ws.activations.filter(a => ['echouee', 'anomalie'].includes(a.status)).length, reopened: ws.tickets.filter(t => t.type === 'signalement:pas_internet').length,
      satisfaction: fb.length ? fb.reduce((s, f) => s + f.score, 0) / fb.length : null, feedbackN: fb.length, feedbackRate: byState.SERVICE_ACTIF + byState.CLOTURE ? fb.length / (byState.SERVICE_ACTIF + byState.CLOTURE) : null,
      contactsPer100: ws.orders.length ? Math.round(100 * (ws.messages.filter(m => m.from === 'client').length + ws.callbacks.length) / ws.orders.length) : 0,
      abstainRate: (ws.assistantLog || []).length ? (ws.assistantLog.filter(a => !a.intent).length / ws.assistantLog.length) : null,
      alerts: ws.alerts.filter(a => !a.ack).slice(-10).reverse(),
      synthetic: true,
    };
  }

  // ---------- Cycle de vie des espaces de test ----------
  function listWorkspaces() {
    const reg = readReg();
    const now = realNow();
    for (const w of reg.workspaces.filter(w => w.expiresAt < now)) purge(w.id);
    // Une session de propriétaire expire au bout de 12 h, l'espace au bout de 24 h : on en recrée une
    // au lieu de laisser la page bloquée sur « Je prépare votre espace ».
    return readReg().workspaces.map(w => ({ ...w, ownerToken: ownerToken(w.id) }));
  }
  function ownerToken(wsId) {
    const reg = readReg(), now = realNow();
    let dirty = false;
    for (const t in reg.sessions) if (reg.sessions[t].expiresReal < now) { delete reg.sessions[t]; dirty = true; }
    const e = reg.workspaces.find(w => w.id === wsId);
    if (!e) { if (dirty) writeReg(reg); return null; }
    const found = Object.entries(reg.sessions).find(([, s]) => s.wsId === wsId && s.owner && !s.inviteToken && s.gen === e.generation && s.userId === 'U1');
    if (found) { if (dirty) writeReg(reg); return found[0]; }
    const ws = load(wsId);
    if (!ws) { if (dirty) writeReg(reg); return null; }
    const tok = newSession(reg, wsId, 'U1', ws.generation, { owner: true });
    writeReg(reg);
    return tok;
  }
  // Un espace dont l'état arrive d'un autre appareil (partage) : on l'inscrit dans ce navigateur.
  function adopt(wsId) {
    const ws = load(wsId);
    if (!ws) throw new AppError('introuvable', 'Espace introuvable sur cet appareil.');
    const reg = readReg();
    const e = reg.workspaces.find(w => w.id === wsId);
    if (e) { e.name = ws.name; e.expiresAt = ws.expiresAt; e.generation = ws.generation; }
    else reg.workspaces.push({ id: wsId, name: ws.name, createdAt: ws.createdAt, expiresAt: ws.expiresAt, generation: ws.generation });
    for (const t in reg.sessions) if (reg.sessions[t].wsId === wsId && reg.sessions[t].gen !== ws.generation) delete reg.sessions[t];
    writeReg(reg);
    return ownerToken(wsId);
  }
  // Espace partagé entre appareils : il vit 30 jours au lieu de 24 h.
  async function markShared(token) {
    const { ws, s } = session(token); if (!s.owner) throw new AppError('interdit', 'Réservé au propriétaire.');
    return withLock(ws.id, () => { const w = load(ws.id); if (w.shared && w.expiresAt - realNow() > 7 * 24 * H) return; w.shared = true; w.expiresAt = Math.max(w.expiresAt, realNow() + 30 * 24 * H); save(w); });
  }
  async function resetWorkspace(token) {
    const { ws, s } = session(token);
    if (!s.owner) throw new AppError('interdit', 'Seul le propriétaire peut réinitialiser.');
    return withLock(ws.id, () => {
      // On relit l'espace sous le verrou : un autre appareil a pu écrire juste avant.
      const cur = load(ws.id) || ws;
      const gen = cur.generation + 1;
      const fresh = buildWorkspace({ id: cur.id, name: cur.name, seed: cur.seed, realNow: realNow(), generation: gen });
      warmUp(fresh);
      fresh.version = cur.version;
      audit(fresh, { id: 'OWNER', name: 'Testeur', role: 'testeur' }, 'espace.reinitialiser', ws.id, 'Génération ' + gen + ' : anciens liens, invitations et tâches invalidés');
      for (const k of storage.keys()) if (k.startsWith('fw:bk:' + ws.id + ':')) storage.remove(k);
      const reg = readReg();
      // Les sessions de l'ancienne génération tombent ; celles de la nouvelle (créées depuis une première exécution de cette
      // réinitialisation, avant qu'elle soit rejouée) restent valables.
      for (const t in reg.sessions) if (reg.sessions[t].wsId === ws.id && reg.sessions[t].gen !== gen) delete reg.sessions[t];
      const tok = newSession(reg, ws.id, 'U1', gen, { owner: true });
      writeReg(reg);
      save(fresh);
      return { token: tok };
    });
  }
  function deleteWorkspace(token) { const { ws, s } = session(token); if (!s.owner) throw new AppError('interdit', 'Seul le propriétaire peut supprimer.'); purge(ws.id); }
  async function renew(token) { const { ws, s } = session(token); if (!s.owner) throw new AppError('interdit', 'Réservé au propriétaire.'); return withLock(ws.id, () => { const w = load(ws.id); w.expiresAt = Math.max(w.expiresAt, realNow()) + 24 * H; save(w); }); }
  function switchUser(token, userId) {
    const { ws, s } = session(token);
    if (!s.owner || ws.env !== 'demo') throw new AppError('interdit', 'Changement de rôle possible uniquement dans votre espace de démonstration.');
    const u = byId(ws.users, userId); if (!u) throw new AppError('introuvable', 'Utilisateur inconnu.');
    const reg = readReg();
    const t = newSession(reg, ws.id, u.id, ws.generation, { owner: true });
    writeReg(reg);
    return t;
  }
  async function invite(token, userId, hours) {
    const { ws, s, user } = session(token);
    if (!s.owner && user.role !== 'admin') throw new AppError('interdit', 'Réservé au propriétaire ou à l’administrateur.');
    return withLock(ws.id, () => { const w = load(ws.id); const inv = createInvite(w, s.owner ? { id: 'OWNER', name: 'Testeur', role: 'testeur' } : user, { userId, hours }); save(w); return inv; });
  }
  async function join(wsId, inviteToken) {
    // L'identifiant d'espace de l'URL ne donne aucun droit : seule l'invitation validée ouvre une session.
    const ws = load(wsId);
    const inv = ws && ws.invites.find(i => i.token === inviteToken);
    if (!inv) throw new AppError('invitation', 'Invitation invalide.');
    if (inv.revoked) throw new AppError('invitation', 'Cette invitation a été révoquée.');
    if (inv.gen !== ws.generation) throw new AppError('invitation', 'L’espace a été réinitialisé : cette invitation ne vaut plus.');
    if (inv.expiresReal < realNow()) throw new AppError('invitation', 'Invitation expirée.');
    return withLock(ws.id, () => {
      const w = load(ws.id); const i = w.invites.find(x => x.token === inviteToken); i.uses++;
      const reg = readReg(); const t = newSession(reg, w.id, i.userId, w.generation, { inviteToken }); writeReg(reg);
      audit(w, byId(w.users, i.userId), 'invitation.utiliser', ROLES[i.role].label); save(w);
      return t;
    });
  }
  function backups(token) { return session(token).ws.backups; }

  return { createWorkspace, listWorkspaces, resetWorkspace, deleteWorkspace, renew, switchUser, invite, join, exec, q, pump, adopt, markShared, ownerToken, keys: K, forget: id => { delete cache[id]; }, session: t => { const { ws, user, s } = session(t); return { wsId: ws.id, userId: user.id, role: user.role, owner: !!s.owner }; }, _load: load, backups };
}

export function memoryStorage() {
  const m = new Map();
  return { get: k => (m.has(k) ? m.get(k) : null), set: (k, v) => m.set(k, v), remove: k => m.delete(k), keys: () => [...m.keys()] };
}
