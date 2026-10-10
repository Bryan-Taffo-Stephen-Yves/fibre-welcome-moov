// Règles métier du serveur simulé (CDC 3, 4, 5). Aucune fonction ici ne vérifie les droits :
// c'est backend.js qui contrôle la session, le rôle et le périmètre avant d'appeler ces règles.
import { stateRank, STATE_INFO, BLOCKER_TYPES, CHECKLIST_TECH, SLOTS, APPT_STATES, DOC_TYPES, DOSSIER_DOCS, PREP_CHECKLIST, SLOT_HOURS, TEAM_BASE, hourLabel } from './model.js';
import { estimate, fmtDate, stageOf } from './ai.js';
import { H, DAY, startOfDay } from './seed.js';

export class AppError extends Error { constructor(code, message, extra) { super(message); this.code = code; this.extra = extra; } }
export const SYS = { id: 'SYS', role: 'systeme', name: 'Système' };

export const byId = (arr, id) => arr.find(x => x.id === id);
export const getOrder = (ws, id) => { const o = byId(ws.orders, id); if (!o) throw new AppError('introuvable', 'Dossier introuvable.'); return o; };
const nid = (ws, p) => p + (++ws.seq);
const userName = (ws, id) => (byId(ws.users, id) || {}).name || id;

export function audit(ws, actor, action, resource, detail = '', extra = {}) {
  ws.audit.push({ seq: ws.audit.length + 1, at: ws.clock, realAt: ws.lastReal, actorId: actor.id, actor: actor.name, role: actor.role, action, resource, detail, ai: !!extra.ai, correlationId: extra.correlationId || null });
}

// Événement métier (CDC 3.3) : identifiant, date effective, date de réception, source, acteur, version.
export function emit(ws, order, type, { source = 'Fibre Welcome', actor = SYS, payload = {}, effectiveAt, publicText, correlationId } = {}) {
  const e = { seq: ws.events.length + 1, id: nid(ws, 'E'), orderId: order ? order.id : null, type, source, actorId: actor.id, actor: actor.name, role: actor.role,
    effectiveAt: effectiveAt || ws.clock, receivedAt: ws.clock, version: order ? order.version : null, payload, publicText: publicText || null, correlationId: correlationId || null, generation: ws.generation };
  ws.events.push(e);
  return e;
}

const ALLOWED = {
  DOSSIER_RECU: ['PAIEMENT_CONFIRME'],
  PAIEMENT_CONFIRME: ['PREPARATION'],
  PREPARATION: ['PRET_A_PLANIFIER'],
  PRET_A_PLANIFIER: ['RDV_CONFIRME'],
  RDV_CONFIRME: ['INTERVENTION_EN_COURS', 'PRET_A_PLANIFIER'],
  INTERVENTION_EN_COURS: ['INSTALLATION_TERMINEE', 'PRET_A_PLANIFIER'],
  INSTALLATION_TERMINEE: ['ACTIVATION_EN_ATTENTE'],
  ACTIVATION_EN_ATTENTE: ['SERVICE_ACTIF'],
  SERVICE_ACTIF: ['CLOTURE'],
  CLOTURE: [],
};

export function transition(ws, order, to, { actor = SYS, source = 'Fibre Welcome', reason = '', correlationId } = {}) {
  if (order.cancelled) throw new AppError('annule', 'Ce dossier est annulé : aucune nouvelle étape possible.');
  if (!ALLOWED[order.state].includes(to)) throw new AppError('transition', 'Passage de « ' + STATE_INFO[order.state].label + ' » à « ' + STATE_INFO[to].label + ' » interdit.');
  const from = order.state;
  // Journal des prédictions : on garde ce que le modèle disait à chaque étape, pour mesurer l'erreur plus tard.
  const est = estimate(ws, order);
  if (!est.abstain && !est.done) ws.predictions.push({ orderId: order.id, at: ws.clock, state: from, medianH: est.medianH, loH: est.loH, hiH: est.hiH, model: est.modelVersion });
  order.state = to; order.stateSince = ws.clock; order.version++; order.updatedAt = ws.clock;
  const e = emit(ws, order, to, { actor, source, payload: { from, to, reason }, publicText: STATE_INFO[to].client, correlationId });
  if (to === 'SERVICE_ACTIF') {
    for (const p of ws.predictions.filter(p => p.orderId === order.id && p.actualH == null)) p.actualH = (ws.clock - p.at) / H;
  }
  return e;
}

export function openBlocker(ws, order, type, { actor = SYS, detail = '', ownerUserId = null, silent = false } = {}) {
  const exists = ws.blockers.find(b => b.orderId === order.id && b.type === type && b.status === 'ouvert');
  if (exists) return exists;
  const t = BLOCKER_TYPES[type];
  const ownerRole = t.owner;
  const owner = ownerUserId || (ownerRole === 'client' ? order.customerId : (ws.users.find(u => u.role === ownerRole && u.active && (!u.zones || u.zones.includes(order.zone))) || {}).id) || null;
  const e = emit(ws, order, 'BLOCAGE_OUVERT', { actor, payload: { type, detail }, publicText: t.clientText });
  const b = { id: nid(ws, 'B'), orderId: order.id, type, detail, status: 'ouvert', openedAt: ws.clock, openedBy: actor.name, ownerRole, ownerUserId: owner, dueAt: ws.clock + t.slaH * H, action: t.action, escalated: false, resolution: null, eventSeq: e.seq };
  ws.blockers.push(b);
  order.updatedAt = ws.clock; order.version++;
  audit(ws, actor, 'blocage.ouvrir', order.ref, t.label + (detail ? ' — ' + detail : ''));
  if (owner && !silent) notify(ws, owner, { title: 'Action attendue : ' + t.label, body: t.action + ' (dossier ' + order.ref + ').', orderId: order.id, kind: ownerRole === 'client' ? 'action' : 'tache' });
  return b;
}

export function resolveBlocker(ws, b, { actor, resolution }) {
  if (b.status !== 'ouvert') return b;
  b.status = 'resolu'; b.resolution = resolution; b.resolvedAt = ws.clock; b.resolvedBy = actor.name;
  const order = getOrder(ws, b.orderId);
  order.version++; order.updatedAt = ws.clock;
  emit(ws, order, 'BLOCAGE_RESOLU', { actor, payload: { type: b.type, resolution }, publicText: 'Point résolu : ' + BLOCKER_TYPES[b.type].label.toLowerCase() + '.' });
  audit(ws, actor, 'blocage.resoudre', order.ref, BLOCKER_TYPES[b.type].label + ' — ' + resolution);
  return b;
}

export const openBlockers = (ws, orderId) => ws.blockers.filter(b => b.orderId === orderId && b.status === 'ouvert');

// ---------- Notifications (CL-14) : boîte interne toujours, canaux externes simulés selon préférences ----------
export function notify(ws, userId, { title, body, orderId = null, kind = 'info', channels = true }) {
  const u = byId(ws.users, userId);
  if (!u) return;
  const n = { id: nid(ws, 'N'), userId, title, body, orderId, kind, at: ws.clock, read: false };
  ws.notifications.push(n);
  if (channels && ['client', 'representant'].includes(u.role)) {
    for (const ch of ['sms', 'whatsapp', 'push']) if (u.prefs[ch]) {
      const out = { id: nid(ws, 'SMS'), userId, to: u.phone, channel: ch, text: body, at: ws.clock, attempts: 0, status: 'en_attente', provider: 'simulé' };
      ws.outbox.push(out);
      ws.jobs.push({ id: nid(ws, 'J'), kind: 'send', ref: out.id, due: ws.clock, generation: ws.generation, attempts: 0 });
    }
  }
  return n;
}

export function addMessage(ws, order, { from, author, text, visibility = 'public', auto = false }) {
  const e = emit(ws, order, visibility === 'interne' ? 'NOTE_INTERNE' : 'MESSAGE', { actor: author, payload: { from, visibility } });
  const m = { id: nid(ws, 'M'), orderId: order.id, from, authorId: author.id, author: author.name, role: author.role, text, visibility, auto, at: ws.clock, eventSeq: e.seq };
  ws.messages.push(m);
  return m;
}

// ---------- Capacité et rendez-vous (CL-07, PL-01, PL-05) ----------
const activeHolds = (ws, capId) => ws.holds.filter(h => h.capId === capId && h.status === 'actif' && h.expiresReal > ws.lastReal).length;
export const remaining = (ws, c) => c.cap - c.used - activeHolds(ws, c.id);

export function availability(ws, order) {
  const teams = ws.teams.filter(t => t.available && t.zones.includes(order.zone));
  const out = [];
  const tomorrow = startOfDay(ws.clock) + DAY;
  const byKey = {};
  for (const c of ws.capacity) {
    if (c.date < tomorrow || !teams.some(t => t.id === c.teamId)) continue;
    const k = c.date + ':' + c.slot;
    (byKey[k] ||= { date: c.date, slot: c.slot, left: 0, teams: [] });
    const left = ws.sim.saturation ? Math.max(0, remaining(ws, c) - 1) : remaining(ws, c);
    byKey[k].left += Math.max(0, left);
    if (left > 0) byKey[k].teams.push(c.teamId);
  }
  for (const k in byKey) out.push(byKey[k]);
  out.sort((a, b) => a.date - b.date || (a.slot < b.slot ? 1 : -1));
  const port = ws.ports[order.zone];
  const conditional = ws.sim.equipmentShortage ? (ws.config.policyEquipment === 'bloquer' ? 'bloque' : 'conditionnel') : null;
  return { slots: out.slice(0, 20), conditional, portOk: port.free > 0 || order.portReserved, holdMinutes: ws.config.holdMinutes };
}

export function holdSlot(ws, order, { date, slot }, actor, realNow) {
  if (!canPlan(order)) throw new AppError('etat', 'Le dossier n’est pas encore prêt à être planifié.');
  if (missionUnderway(ws, order)) throw new AppError('etat', UNDERWAY_MSG);
  if (ws.sim.equipmentShortage && ws.config.policyEquipment === 'bloquer') throw new AppError('materiel', 'Matériel indisponible : la prise de rendez-vous est suspendue selon la politique en vigueur. Aucune date ne vous est promise.');
  // Réservation atomique : la vérification et la prise de capacité se font dans la même transaction verrouillée.
  const teams = ws.teams.filter(t => t.available && t.zones.includes(order.zone));
  const caps = ws.capacity.filter(c => c.date === date && c.slot === slot && teams.some(t => t.id === c.teamId) && (ws.sim.saturation ? remaining(ws, c) - 1 : remaining(ws, c)) > 0);
  if (!caps.length) {
    const alt = availability(ws, order).slots.filter(s => s.left > 0).slice(0, 3);
    throw new AppError('complet', 'Ce créneau vient d’être pris. Voici d’autres possibilités.', { alternatives: alt });
  }
  for (const h of ws.holds.filter(h => h.orderId === order.id && h.status === 'actif')) h.status = 'libere';
  const cur = order.apptId && byId(ws.appointments, order.apptId);
  // Préférence : l'équipe déjà affectée, puis l'équipe dont c'est la zone principale.
  const rank = c => (cur && c.teamId === cur.teamId ? 2 : 0) + (byId(ws.teams, c.teamId).zones[0] === order.zone ? 1 : 0);
  caps.sort((x, y) => rank(y) - rank(x));
  const c = caps[0];
  const hold = { id: nid(ws, 'HLD'), orderId: order.id, capId: c.id, teamId: c.teamId, date, slot, status: 'actif', createdAt: ws.clock, expiresReal: realNow + ws.config.holdMinutes * 60e3, by: actor.id };
  ws.holds.push(hold);
  emit(ws, order, 'CRENEAU_TENU', { actor, payload: { date, slot, expiresInMin: ws.config.holdMinutes } });
  return hold;
}

// Un dossier rempli en ligne a déjà choisi son créneau à l'envoi : il peut le changer pendant la vérification.
export const canPlan = order => ['PRET_A_PLANIFIER', 'RDV_CONFIRME'].includes(order.state) || (order.state === 'PREPARATION' && !!(order.dossier && order.dossier.submittedAt));

// Une fois le technicien parti, le rendez-vous ne se change plus depuis l'application : on passe par le conseiller.
export function missionUnderway(ws, order) {
  const appt = order.apptId && byId(ws.appointments, order.apptId);
  const wo = appt && appt.woId && byId(ws.workOrders, appt.woId);
  return !!wo && ['en_route', 'sur_place', 'en_cours'].includes(wo.status);
}
const UNDERWAY_MSG = 'Le technicien est déjà en route ou chez vous : le rendez-vous ne peut plus être changé ici. Écrivez à votre conseiller.';

export function bookHold(ws, order, holdId, actor, realNow) {
  if (missionUnderway(ws, order)) throw new AppError('etat', UNDERWAY_MSG);
  const hold = byId(ws.holds, holdId);
  if (!hold || hold.orderId !== order.id) throw new AppError('introuvable', 'Réservation temporaire introuvable.');
  if (hold.status !== 'actif' || hold.expiresReal <= realNow) { hold.status = 'expire'; throw new AppError('expire', 'Le délai de réservation temporaire est dépassé. Choisissez à nouveau un créneau.'); }
  const cap = byId(ws.capacity, hold.capId);
  if (cap.used >= cap.cap) throw new AppError('complet', 'Capacité épuisée.');
  cap.used++; hold.status = 'consomme';
  const old = order.apptId && byId(ws.appointments, order.apptId);
  const appt = { id: nid(ws, 'RDV'), orderId: order.id, date: hold.date, slot: hold.slot, teamId: hold.teamId, capId: cap.id, status: 'reserve', createdAt: ws.clock, replaces: null, reason: null, eventSeq: 0 };
  if (old && ['reserve', 'confirme'].includes(old.status)) {
    // Replanification : l'ancien rendez-vous reste dans l'historique et sa capacité est libérée.
    const wasConfirmed = old.status === 'confirme';
    old.status = 'remplace'; old.reason = 'Replanifié par ' + actor.name; releaseCap(ws, old);
    appt.replaces = old.id;
    const oldWo = old.woId && byId(ws.workOrders, old.woId);
    // Même équipe disponible : le nouveau créneau est confirmé directement et la mission suit (SC-04).
    // Dossier en ligne : l'heure avait été fixée par le planificateur, il doit la refixer pour la nouvelle date.
    if (wasConfirmed && old.teamId === appt.teamId && order.state === 'RDV_CONFIRME' && !order.dossier) {
      appt.status = 'confirme';
      if (oldWo) { appt.woId = oldWo.id; oldWo.apptId = appt.id; oldWo.version++; }
    } else if (oldWo && !['terminee', 'annulee'].includes(oldWo.status)) { oldWo.status = 'annulee'; oldWo.version++; notify(ws, oldWo.techUserId, { title: 'Mission retirée', body: order.ref + ' : rendez-vous replanifié avec une autre équipe.', orderId: order.id, kind: 'tache' }); }
  }
  ws.appointments.push(appt);
  order.apptId = appt.id; order.version++; order.updatedAt = ws.clock;
  const e = emit(ws, order, old ? 'RDV_REPLANIFIE' : 'RDV_RESERVE', { actor, payload: { date: appt.date, slot: appt.slot, replaces: appt.replaces }, publicText: 'Rendez-vous ' + (appt.status === 'confirme' ? 'confirmé' : 'réservé') + ' le ' + fmtDate(appt.date) + ' (' + slotLabel(appt.slot) + ').' });
  appt.eventSeq = e.seq;
  if (order.state === 'RDV_CONFIRME' && appt.status !== 'confirme') transition(ws, order, 'PRET_A_PLANIFIER', { actor, reason: 'Replanification avec changement d’équipe' });
  if (appt.status === 'confirme') {
    const wo = appt.woId && byId(ws.workOrders, appt.woId);
    if (wo) notify(ws, wo.techUserId, { title: 'Mission déplacée', body: order.ref + ' : nouvelle date ' + fmtDate(appt.date) + ' (' + slotLabel(appt.slot) + ').', orderId: order.id, kind: 'tache' });
    notify(ws, order.customerId, { title: 'Nouveau rendez-vous confirmé', body: ws.config.templates.rdv_confirme.replace('{date}', fmtDate(appt.date)).replace('{slot}', slotLabel(appt.slot)), orderId: order.id, kind: 'rdv' });
  } else {
    const planner = ws.users.find(u => u.role === 'planificateur' && u.zones.includes(order.zone));
    const refix = order.dossier && old && old.time;
    if (planner) notify(ws, planner.id, { title: refix ? 'Heure à refixer' : 'Rendez-vous à confirmer', body: order.ref + ' — ' + (refix ? 'le client a déplacé sa visite au ' : '') + fmtDate(appt.date) + ' ' + slotLabel(appt.slot) + (refix ? '. Choisissez à nouveau le technicien et l’heure.' : ''), orderId: order.id, kind: 'tache' });
    notify(ws, order.customerId, { title: 'Créneau réservé', body: 'Votre créneau du ' + fmtDate(appt.date) + ' (' + slotLabel(appt.slot) + ') est réservé. Moov confirme l’équipe sous peu.', orderId: order.id, kind: 'rdv', channels: false });
  }
  if (ws.config.autoConfirm && appt.status === 'reserve' && order.state === 'PRET_A_PLANIFIER' && !order.dossier) confirmAppointment(ws, order, appt, SYS, {});
  return appt;
}

export const slotLabel = s => (SLOTS.find(x => x.id === s) || {}).label || s;

export function releaseCap(ws, appt) {
  const cap = byId(ws.capacity, appt.capId);
  if (cap && cap.used > 0) cap.used--;
}

export function confirmAppointment(ws, order, appt, actor, { teamId, time } = {}) {
  if (appt.status !== 'reserve') throw new AppError('etat', 'Ce rendez-vous n’est pas en attente de confirmation.');
  if (order.state !== 'PRET_A_PLANIFIER') throw new AppError('etat', 'Le dossier doit être prêt à planifier.');
  const team = byId(ws.teams, teamId || appt.teamId);
  if (!team || !team.available) throw new AppError('equipe', 'Équipe indisponible.');
  if (!team.zones.includes(order.zone)) throw new AppError('equipe', 'Cette équipe n’intervient pas dans la zone ' + order.address.commune + '.');
  if (time != null) {
    if (!(SLOT_HOURS[appt.slot] || []).includes(time)) throw new AppError('heure', 'Choisissez une heure comprise dans le créneau ' + slotLabel(appt.slot) + '.');
    const clash = teamBusyAt(ws, team.id, appt.date, time, appt.id);
    if (clash) throw new AppError('heure', userName(ws, team.techUserId) + ' a déjà une visite le ' + fmtDate(appt.date) + ' à ' + hourLabel(time) + ' (' + clash + '). Choisissez une autre heure ou une autre équipe.');
  }
  if (team.id !== appt.teamId) {
    const cap = ws.capacity.find(c => c.teamId === team.id && c.date === appt.date && c.slot === appt.slot);
    if (!cap || remaining(ws, cap) <= 0) throw new AppError('complet', 'Cette équipe n’a plus de place sur ce créneau.');
    releaseCap(ws, appt); cap.used++; appt.capId = cap.id; appt.teamId = team.id;
  }
  if (ws.config.policyEquipment !== 'ignorer') {
    const stock = ws.sim.equipmentShortage ? 0 : ws.equipment.filter(e => e.status === 'stock' && e.model === order.equipmentModel).length;
    if (!stock) throw new AppError('materiel', 'Aucun équipement ' + order.equipmentModel + ' en stock : confirmation impossible sans fausse promesse.');
  }
  appt.status = 'confirme';
  if (time != null) appt.time = time;
  // Visite dans moins de 24 h : la confirmation tient lieu de rappel (pas de « Rappel : visite demain » juste après).
  if (appt.date - ws.clock < 24 * H) appt.reminded = true;
  let wo = appt.woId && byId(ws.workOrders, appt.woId);
  if (!wo) {
    wo = { id: nid(ws, 'MI'), orderId: order.id, apptId: appt.id, teamId: team.id, techUserId: team.techUserId, status: 'affectee', times: {}, checklist: {}, serial: '', photos: [], comment: '', receptionCode: String(1000 + Math.floor((ws.seq * 7919) % 9000)), reception: null, failure: null, version: 1, createdAt: ws.clock };
    ws.workOrders.push(wo); appt.woId = wo.id;
  }
  order.woId = wo.id;
  transition(ws, order, 'RDV_CONFIRME', { actor, reason: 'Créneau confirmé, ' + team.name });
  audit(ws, actor, 'rdv.confirmer', order.ref, fmtDate(appt.date) + ' ' + (appt.time || slotLabel(appt.slot)) + ' — ' + team.name);
  const techFirst = String(userName(ws, team.techUserId)).split(' ')[0];
  const body = appt.time ? (ws.config.templates.rdv_heure || 'Moov Fibre : {tech} viendra le {date} à {heure}.').replace('{tech}', techFirst).replace('{date}', fmtDate(appt.date)).replace('{heure}', hourLabel(appt.time)).replace('{slot}', slotLabel(appt.slot))
    : ws.config.templates.rdv_confirme.replace('{date}', fmtDate(appt.date)).replace('{slot}', slotLabel(appt.slot));
  // Première notification : un technicien est désigné. La deuxième arrive quand il se met en route.
  notify(ws, order.customerId, { title: appt.time ? techFirst + ' viendra le ' + fmtDate(appt.date) + ' à ' + hourLabel(appt.time) : 'Rendez-vous confirmé', body, orderId: order.id, kind: 'rdv' });
  notify(ws, team.techUserId, { title: 'Nouvelle mission', body: order.ref + ' — ' + order.address.commune + ', ' + fmtDate(appt.date) + ' ' + (appt.time ? 'à ' + hourLabel(appt.time) : slotLabel(appt.slot)), orderId: order.id, kind: 'tache' });
  return appt;
}

// Une équipe est-elle déjà attendue chez un autre client à cette heure-là ? Renvoie la référence du dossier, ou null.
export function teamBusyAt(ws, teamId, date, time, exceptApptId) {
  const a = ws.appointments.find(x => x.id !== exceptApptId && x.teamId === teamId && x.date === date && x.time === time && ['confirme', 'en_cours'].includes(x.status));
  return a ? (byId(ws.orders, a.orderId) || {}).ref || a.id : null;
}

export function cancelAppointment(ws, order, appt, actor, reason, { force = false } = {}) {
  if (!['reserve', 'confirme', 'tenu'].includes(appt.status)) throw new AppError('etat', 'Ce rendez-vous ne peut plus être annulé.');
  if (!force && missionUnderway(ws, order)) throw new AppError('etat', UNDERWAY_MSG);
  appt.status = 'annule'; appt.reason = reason; releaseCap(ws, appt);
  const wo = appt.woId && byId(ws.workOrders, appt.woId);
  if (wo && !['terminee'].includes(wo.status)) { wo.status = 'annulee'; wo.cancelReason = reason; wo.version++; notify(ws, wo.techUserId, { title: 'Mission annulée', body: order.ref + ' : ' + reason, orderId: order.id, kind: 'tache' }); }
  if (order.state === 'RDV_CONFIRME') transition(ws, order, 'PRET_A_PLANIFIER', { actor, reason: 'Rendez-vous annulé : ' + reason });
  else { order.version++; order.updatedAt = ws.clock; }
  emit(ws, order, 'RDV_ANNULE', { actor, payload: { reason }, publicText: 'Rendez-vous annulé. Le créneau a été libéré.' });
  audit(ws, actor, 'rdv.annuler', order.ref, reason);
}

// Les images (pièces, photos) sont rangées à part, dans la photothèque de l'espace : le dossier ne garde
// qu'une référence opaque et, au plus, une petite vignette, pour que l'état partagé reste léger.
export const imgRef = x => (typeof x === 'string' && /^img_[a-z0-9]{8,40}$/.test(x) ? x : null);
export const smallThumb = x => (typeof x === 'string' && x.startsWith('data:image/') && x.length < 24000 ? x : null);

// ---------- Terrain (TE-01 à TE-08) ----------
export function woAction(ws, wo, action, args, actor) {
  const order = getOrder(ws, wo.orderId);
  const appt = byId(ws.appointments, wo.apptId);
  const now = ws.clock;
  const need = (ok, msg) => { if (!ok) throw new AppError('etat', msg); };
  switch (action) {
    case 'depart': {
      need(wo.status === 'affectee', 'Mission déjà démarrée.'); wo.status = 'en_route'; wo.times.depart = now;
      // Trajet simulé (démo) : de l'agence de l'équipe jusqu'à la commune du client, en quelques minutes réelles.
      const min = Math.max(1, Math.min(30, Number(ws.config.travelMin) || 4));
      wo.track = { id: nid(ws, 'TRJ'), from: TEAM_BASE[wo.teamId] || 'plateau', to: order.zone, departAt: now, durMs: min * 60e3, near: false, there: false };
      if (min > 2) ws.jobs.push({ id: nid(ws, 'J'), kind: 'track', step: 'near', ref: wo.id, trackId: wo.track.id, due: now + (min - 2) * 60e3, generation: ws.generation, attempts: 0 });
      ws.jobs.push({ id: nid(ws, 'J'), kind: 'track', step: 'there', ref: wo.id, trackId: wo.track.id, due: now + min * 60e3, generation: ws.generation, attempts: 0 });
      emit(ws, order, 'TECH_EN_ROUTE', { actor, publicText: 'Le technicien est en route.' });
      // Dernier rappel : ce qui n'est pas encore coché dans la liste de préparation (chien enfermé, accès, présence, prise).
      const todo = PREP_CHECKLIST.filter(i => (!i.when || i.when === order.address.building) && !(order.prep || {})[i.id] && (i.need || i.id === 'animaux')).map(i => i.ask);
      const remind = todo.length ? ' Vérifiez maintenant : ' + todo.join(', ') + '.' : ' Tout est prêt de votre côté, merci.';
      notify(ws, order.customerId, { title: 'Technicien en route : arrive dans ' + min + ' min', body: userName(ws, wo.techUserId) + ' est en route vers chez vous.' + remind, orderId: order.id, kind: 'rdv' }); break;
    }
    case 'arrive': need(['affectee', 'en_route'].includes(wo.status), 'Étape impossible.'); wo.status = 'sur_place'; wo.times.arrive = now;
      if (wo.track) wo.track.arrivedAt = now;
      emit(ws, order, 'TECH_ARRIVE', { actor, publicText: 'Le technicien est arrivé.' });
      notify(ws, order.customerId, { title: 'Votre technicien est arrivé', body: userName(ws, wo.techUserId) + ' est devant chez vous. Pensez à lui ouvrir.', orderId: order.id, kind: 'rdv' }); break;
    case 'start': need(['sur_place', 'en_route', 'affectee'].includes(wo.status), 'Étape impossible.'); wo.status = 'en_cours'; wo.times.start = now; wo.times.arrive ||= now;
      if (appt) appt.status = 'en_cours';
      transition(ws, order, 'INTERVENTION_EN_COURS', { actor, source: 'Application terrain' }); break;
    case 'checklist': {
      need(wo.status === 'en_cours', 'Démarrez la mission avant de remplir la checklist.');
      const v = { ...(args.values || {}) };
      for (const c of CHECKLIST_TECH.filter(c => c.type !== 'bool')) {
        if (v[c.id] === '' || v[c.id] == null) { delete v[c.id]; continue; }
        const n = Number(String(v[c.id]).replace(',', '.').replace('−', '-'));
        if (!Number.isFinite(n)) throw new AppError('checklist', c.label + ' : saisissez un nombre (ex. −19,5).');
        v[c.id] = n;
      }
      Object.assign(wo.checklist, v); break;
    }
    case 'serial': {
      need(wo.status === 'en_cours', 'Démarrez la mission d’abord.');
      const s = String(args.serial || '').trim().toUpperCase();
      if (!s) throw new AppError('serie', 'Saisissez ou scannez le numéro de série de la box.');
      const eq = ws.equipment.find(e => e.serial === s);
      if (!eq) throw new AppError('serie', 'Numéro de série inconnu de l’inventaire.');
      if (eq.model !== order.equipmentModel) throw new AppError('serie', 'Cet équipement (' + eq.model + ') ne correspond pas à la commande (' + order.equipmentModel + ').');
      if (eq.status === 'attribue' && eq.orderId !== order.id) throw new AppError('serie', 'Cet équipement est déjà attribué à un autre dossier. Il est refusé.');
      const prev = ws.equipment.find(e => e.orderId === order.id && e.serial !== s);
      if (prev) { prev.status = 'stock'; prev.orderId = null; }
      eq.status = 'attribue'; eq.orderId = order.id; wo.serial = s;
      emit(ws, order, 'EQUIPEMENT_ATTRIBUE', { actor, payload: { serial: s } }); break;
    }
    case 'photo': need(wo.status === 'en_cours', 'Démarrez la mission d’abord.');
      wo.photos.push({ id: nid(ws, 'PH'), name: String(args.name || 'photo.jpg').slice(0, 120), thumb: smallThumb(args.thumb), img: imgRef(args.img), at: now, takenOffline: !!args.offline, capturedAt: args.capturedAt || now, gps: args.gps || null });
      emit(ws, order, 'PREUVE_AJOUTEE', { actor, payload: { kind: 'photo', offline: !!args.offline } }); break;
    case 'comment': wo.comment = String(args.text || '').trim().slice(0, 1000); emit(ws, order, 'COMMENTAIRE_TECHNICIEN', { actor, payload: { text: wo.comment } }); break;
    case 'reception': {
      need(wo.status === 'en_cours', 'Démarrez la mission d’abord.');
      if (args.mode === 'code' && String(args.code == null ? '' : args.code).replace(/\s/g, '') !== wo.receptionCode) throw new AppError('code', 'Code de réception incorrect. Demandez au client le code affiché dans son application.');
      wo.reception = { status: args.status === 'reserve' ? 'reserve' : 'accord', comment: String(args.comment || '').slice(0, 300), mode: args.mode || 'code', at: now };
      emit(ws, order, 'RECEPTION_CLIENT', { actor, payload: wo.reception, publicText: wo.reception.status === 'accord' ? 'Vous avez validé la réception des travaux.' : 'Réception des travaux avec réserve : ' + (args.comment || '') }); break;
    }
    case 'finish': {
      need(wo.status === 'en_cours', 'La mission n’est pas en cours.');
      const missing = CHECKLIST_TECH.filter(c => c.required && (c.type === 'bool' ? wo.checklist[c.id] !== true : wo.checklist[c.id] === undefined || wo.checklist[c.id] === ''));
      if (missing.length) throw new AppError('checklist', 'Checklist incomplète : ' + missing.map(m => m.label).join(', ') + '.');
      const p = Number(wo.checklist.puissance);
      if (!(p >= -27 && p <= -8)) throw new AppError('checklist', 'Puissance optique hors plage (' + wo.checklist.puissance + ' dBm). Attendu entre −27 et −8 dBm.');
      if (!wo.serial) throw new AppError('checklist', 'Saisissez ou scannez le numéro de série de la box.');
      if (!wo.photos.length) throw new AppError('checklist', 'Ajoutez au moins une photo de la prise ou de la box.');
      if (!wo.reception) throw new AppError('checklist', 'Recueillez l’accord ou la réserve du client.');
      wo.status = 'terminee'; wo.times.end = now;
      if (appt) appt.status = 'realise';
      transition(ws, order, 'INSTALLATION_TERMINEE', { actor, source: 'Application terrain' });
      requestActivation(ws, order, actor);
      // Le client vérifie la box puis valide, ou laisse partir le technicien : sans réponse, la validation se fait toute seule.
      wo.signoff = { state: 'attente', since: now, autoAt: now + Math.max(1, Number(ws.config.autoValidateMin) || 60) * 60e3 };
      ws.jobs.push({ id: nid(ws, 'J'), kind: 'autovalid', ref: wo.id, due: wo.signoff.autoAt, generation: ws.generation, attempts: 0 });
      notify(ws, order.customerId, { title: 'Installation terminée : vérifiez et validez', body: userName(ws, wo.techUserId) + ' a fini. Regardez les voyants de la box, puis validez, ou laissez-le partir.', orderId: order.id, kind: 'action' });
      break;
    }
    case 'fail': {
      need(['affectee', 'en_route', 'sur_place', 'en_cours'].includes(wo.status), 'Mission déjà clôturée.');
      const type = args.reason;
      if (!['CLIENT_ABSENT', 'ACCES_IMPOSSIBLE', 'MATERIEL_PANNE', 'CAPACITE_RESEAU'].includes(type)) throw new AppError('motif', 'Motif d’échec invalide.');
      wo.status = 'echec'; wo.failure = { type, comment: args.comment || '', at: now }; wo.times.end = now;
      if (appt) { appt.status = type === 'CLIENT_ABSENT' ? 'non_honore' : 'annule'; appt.reason = BLOCKER_TYPES[type].label; releaseCap(ws, appt); }
      if (['RDV_CONFIRME', 'INTERVENTION_EN_COURS'].includes(order.state)) transition(ws, order, 'PRET_A_PLANIFIER', { actor, source: 'Application terrain', reason: BLOCKER_TYPES[type].label });
      openBlocker(ws, order, type, { actor, detail: args.comment || '' });
      notify(ws, order.customerId, { title: 'Visite non réalisée', body: BLOCKER_TYPES[type].clientText + ' Un conseiller vous recontacte pour une nouvelle date.', orderId: order.id, kind: 'alerte' });
      break;
    }
    case 'incident': {
      need(['sur_place', 'en_cours'].includes(wo.status), 'Un incident se signale une fois sur place.');
      const type = args.type || 'AUTRE';
      if (!['MATERIEL_PANNE', 'CAPACITE_RESEAU', 'ACCES_IMPOSSIBLE', 'AUTRE'].includes(type)) throw new AppError('motif', 'Type d’incident invalide.');
      const text = String(args.comment || '').trim().slice(0, 500);
      if (text.length < 5) throw new AppError('motif', 'Décrivez l’incident en quelques mots.');
      // Un souci interne à l'équipe (« Autre ») ne bloque pas le dossier aux yeux du client : seul le planificateur est prévenu.
      if (type !== 'AUTRE') openBlocker(ws, order, type, { actor, detail: text });
      ws.tickets.push({ id: nid(ws, 'TK'), orderId: order.id, type: 'incident_terrain', text: (type === 'AUTRE' ? '' : BLOCKER_TYPES[type].label + ' : ') + text, status: 'ouvert', ownerRole: type === 'AUTRE' ? 'planificateur' : BLOCKER_TYPES[type].owner, at: now, by: actor.name });
      const planner = ws.users.find(u => u.role === 'planificateur' && u.active !== false && (u.zones || []).includes(order.zone));
      if (planner) notify(ws, planner.id, { title: 'Incident terrain', body: order.ref + ' : ' + text, orderId: order.id, kind: 'tache' });
      emit(ws, order, 'INCIDENT_TERRAIN', { actor, payload: { type, text } });
      break;
    }
    default: throw new AppError('action', 'Action inconnue.');
  }
  wo.version++; order.updatedAt = now;
  return wo;
}

export function requestActivation(ws, order, actor) {
  const act = { id: nid(ws, 'ACT'), orderId: order.id, ref: 'PRV-' + (100000 + ws.seq), serial: (byId(ws.workOrders, order.woId) || {}).serial, status: 'demandee', requestedAt: ws.clock, result: null };
  ws.activations.push(act);
  transition(ws, order, 'ACTIVATION_EN_ATTENTE', { actor, reason: 'Demande ' + act.ref + ' envoyée au système d’activation' });
  const d = { id: nid(ws, 'DLV'), provider: 'activation', eventId: act.ref, orderId: order.id, kind: 'activation.request', status: 'en_attente', attempts: 0, nextAt: ws.clock + 2 * 60e3, error: null, generation: ws.generation, createdAt: ws.clock };
  ws.deliveries.push(d);
  notify(ws, order.customerId, { title: 'Installation terminée', body: 'Les travaux sont terminés. Moov active maintenant votre ligne : vous serez prévenu dès que c’est fait.', orderId: order.id, kind: 'info' });
  return act;
}

// ---------- Connecteurs entrants (CDC 8.2, 10.1) ----------
export function sign(ws, payload) {
  const s = ws.config.webhookSecret + JSON.stringify(payload);
  let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return 'sig_' + (h >>> 0).toString(16);
}

export function ingest(ws, env) {
  const log = (status, note) => {
    const d = { id: nid(ws, 'IN'), provider: env.source, eventId: env.event_id, kind: 'entrant:' + env.event_type, orderRef: env.external_order_id, status, error: note, attempts: 1, receivedAt: ws.clock, occurredAt: env.occurred_at, generation: ws.generation, createdAt: ws.clock };
    ws.deliveries.push(d); return { status, note, delivery: d };
  };
  if (!env.signature || env.signature !== sign(ws, env.payload)) { audit(ws, SYS, 'integration.rejet', env.event_id, 'Signature invalide (' + env.source + ')'); return log('rejete', 'Signature invalide : événement ignoré, aucun changement d’état.'); }
  if (ws.seenEvents[env.event_id]) return log('doublon', 'Événement déjà traité : aucun effet supplémentaire.');
  const order = ws.orders.find(o => o.ref === env.external_order_id);
  if (!order) { ws.seenEvents[env.event_id] = ws.clock; return log('rejete', 'Commande inconnue dans cet espace.'); }
  ws.seenEvents[env.event_id] = ws.clock;
  const p = env.payload || {};
  switch (env.event_type) {
    case 'payment.confirmed': {
      if (order.payment.status !== 'en_attente') return log('ignore', 'Paiement déjà rapproché : événement sans effet (' + order.payment.status + ').');
      const used = ws.orders.find(o => o !== order && o.payment.ref === p.reference && o.payment.status === 'confirme');
      if (used) { openBlocker(ws, order, 'PAIEMENT_NON_RAPPROCHE', { detail: 'Transaction déjà consommée par un autre dossier' }); return log('rejete', 'Transaction déjà utilisée pour un autre dossier.'); }
      if (p.reference !== order.payment.ref || p.amount !== order.payment.amount || p.currency !== order.payment.currency) {
        openBlocker(ws, order, 'PAIEMENT_NON_RAPPROCHE', { detail: 'Montant ou référence incohérent' });
        return log('anomalie', 'Référence, montant ou devise incohérents : rapprochement manuel requis.');
      }
      confirmPayment(ws, order, { source: 'Moov Money (simulé)', occurredAt: env.occurred_at, correlationId: env.correlation_id });
      return log('traite', 'Paiement confirmé et rapproché.');
    }
    case 'activation.result': {
      const act = ws.activations.find(a => a.orderId === order.id && a.ref === p.request_ref);
      if (!act) return log('rejete', 'Aucune demande d’activation correspondante.');
      if (act.status !== 'demandee') return log('ignore', 'Résultat déjà reçu pour cette demande.');
      if (p.serial !== act.serial) {
        act.status = 'anomalie'; act.result = 'Équipement ' + p.serial + ' ≠ ' + act.serial;
        openBlocker(ws, order, 'ANOMALIE_ACTIVATION', { detail: 'Confirmation reçue pour ' + p.serial + ', attendu ' + act.serial });
        return log('anomalie', 'Confirmation pour un autre équipement : dossier NON activé.');
      }
      if (stateRank(order.state) > stateRank('ACTIVATION_EN_ATTENTE')) return log('ignore', 'Dossier déjà plus avancé : pas de régression.');
      if (p.ok) {
        act.status = 'confirmee'; act.result = 'OK'; act.confirmedAt = ws.clock;
        for (const b of openBlockers(ws, order.id).filter(b => b.type === 'ACTIVATION_ECHOUEE')) resolveBlocker(ws, b, { actor: SYS, resolution: 'Activation confirmée après relance' });
        transition(ws, order, 'SERVICE_ACTIF', { source: 'Système d’activation (émulateur)', reason: 'Confirmation ' + act.ref + ', équipement ' + act.serial, correlationId: env.correlation_id });
        notify(ws, order.customerId, { title: 'Votre fibre est active', body: ws.config.templates.actif, orderId: order.id, kind: 'succes' });
        return log('traite', 'Activation confirmée.');
      }
      act.status = 'echouee'; act.result = p.error || 'Échec';
      openBlocker(ws, order, 'ACTIVATION_ECHOUEE', { detail: p.error || '' });
      notify(ws, order.customerId, { title: 'Activation en échec', body: BLOCKER_TYPES.ACTIVATION_ECHOUEE.clientText, orderId: order.id, kind: 'alerte' });
      return log('traite', 'Activation échouée : incident ouvert, dossier non marqué actif.');
    }
    case 'order.status': {
      // Événement de statut venant de Moov Prospect : un événement ancien ne fait jamais reculer le dossier.
      if (stateRank(p.state) <= stateRank(order.state) || (env.occurred_at && env.occurred_at < order.stateSince)) return log('ignore', 'Événement ancien (' + (STATE_INFO[p.state] || {}).label + ') reçu après un état plus récent : pas de régression.');
      return log('ignore', 'Transition non autorisée depuis cette source.');
    }
    default: return log('rejete', 'Type d’événement inconnu.');
  }
}

export function confirmPayment(ws, order, { source, actor = SYS, occurredAt, correlationId }) {
  order.payment.status = 'confirme'; order.payment.confirmedAt = ws.clock; order.paidAt = occurredAt || ws.clock;
  for (const b of openBlockers(ws, order.id).filter(b => b.type === 'PAIEMENT_NON_RAPPROCHE')) resolveBlocker(ws, b, { actor, resolution: 'Paiement rapproché' });
  transition(ws, order, 'PAIEMENT_CONFIRME', { actor, source, correlationId });
  transition(ws, order, 'PREPARATION', { actor, source: 'Fibre Welcome', reason: 'Vérification technique lancée automatiquement' });
  if (order.customerId) notify(ws, order.customerId, { title: 'Paiement confirmé', body: 'Moov a confirmé votre paiement de ' + order.payment.amount.toLocaleString('fr-FR') + ' F CFA. Nous vérifions maintenant votre adresse.', orderId: order.id, kind: 'succes' });
}

export function makeEnvelope(ws, type, order, payload, { source, eventId, occurredAt, badSig } = {}) {
  const env = { event_id: eventId || 'evt_' + (++ws.seq) + '_' + Math.floor(Math.random() * 1e6), event_type: type, schema_version: '1.0', source: source || 'simulateur', external_order_id: order.ref, occurred_at: occurredAt || ws.clock, received_at: ws.clock, correlation_id: 'cor_' + ws.seq, payload };
  env.signature = badSig ? 'sig_falsifiee' : sign(ws, payload);
  return env;
}

// ---------- Vérification technique (PL-03) ----------
export function markReady(ws, order, actor, { quiet = false } = {}) {
  if (order.state !== 'PREPARATION') throw new AppError('etat', 'Le dossier n’est pas en vérification technique.');
  // Un port s'est libéré (ou a été ajouté) : le blocage « capacité réseau » se lève à la validation.
  const capB = openBlockers(ws, order.id).find(b => b.type === 'CAPACITE_RESEAU');
  if (capB && !order.portReserved && ws.ports[order.zone] && ws.ports[order.zone].free > 0) resolveBlocker(ws, capB, { actor, resolution: 'Port fibre disponible : réservé à la validation' });
  const bl = openBlockers(ws, order.id).filter(b => ['PIECE_MANQUANTE', 'ADRESSE_AMBIGUE', 'CAPACITE_RESEAU', 'PAIEMENT_NON_RAPPROCHE'].includes(b.type));
  if (bl.length) throw new AppError('bloque', 'Impossible : blocage ouvert (' + bl.map(b => BLOCKER_TYPES[b.type].label).join(', ') + ').');
  const port = ws.ports[order.zone];
  if (!order.portReserved) {
    if (port.free <= 0) { openBlocker(ws, order, 'CAPACITE_RESEAU', { actor, detail: 'Aucun port libre au point de raccordement ' + order.address.commune }); throw new AppError('capacite', 'Aucun port fibre libre dans la zone : blocage « capacité réseau » ouvert.', { keep: true }); }
    port.free--; port.reserved++; order.portReserved = true;
  }
  order.address.verified = true;
  transition(ws, order, 'PRET_A_PLANIFIER', { actor, reason: 'Adresse, accès et port réseau vérifiés' });
  if (!quiet) notify(ws, order.customerId, { title: 'Choisissez votre créneau', body: 'Tout est vérifié : vous pouvez réserver la visite du technicien dans l’application.', orderId: order.id, kind: 'action' });
}

// ---------- Dossier rempli en ligne après l'achat (site des offres) ----------
// Prévient toutes les personnes actives d'un rôle qui suivent la zone du dossier.
export function notifyRole(ws, role, order, msg) {
  for (const u of ws.users.filter(u => u.role === role && u.active !== false && (!order || !u.zones || u.zones.includes(order.zone)))) notify(ws, u.id, { orderId: order ? order.id : null, ...msg });
}

// Fin de visite : le client a validé (après vérification), ou laissé partir le technicien, ou n'a pas répondu à temps.
// L'équipe Moov est prévenue que le technicien est de nouveau disponible pour une autre mission.
export function finishSignoff(ws, order, wo, mode, actor, checks) {
  const SAYS = { verifie: ['Vous avez vérifié l’installation et validé la visite.', 'le client a vérifié et validé l’installation.', 'validée par le client'], auto: ['Vous avez laissé le technicien partir : la visite est validée.', 'le client vous a laissé partir sans vérifier, validation automatique.', 'validée (le client l’a laissé partir)'], delai: ['Sans réponse de votre part, la visite a été validée automatiquement.', 'le client n’a pas répondu à temps, validation automatique.', 'validée automatiquement (client sans réponse)'] };
  const say = SAYS[mode] || SAYS.auto;
  wo.signoff = { ...(wo.signoff || {}), state: mode === 'verifie' ? 'validee' : 'auto', mode, at: ws.clock, checks: checks || null };
  wo.freeAt = ws.clock;
  const first = userName(ws, wo.techUserId).split(' ')[0];
  emit(ws, order, 'INSTALLATION_VALIDEE', { actor, payload: { mode }, publicText: say[0] });
  notify(ws, wo.techUserId, { title: 'Visite validée', body: order.ref + ' : ' + say[1] + ' Vous êtes de nouveau disponible.', orderId: order.id, kind: 'succes' });
  for (const role of ['conseiller', 'planificateur', 'superviseur']) notifyRole(ws, role, order, { title: first + ' est de nouveau disponible', body: order.ref + ' (' + order.contactName + ') : visite ' + say[2] + '. ' + first + ' peut recevoir une nouvelle mission.', kind: 'info' });
}

// Ce qui manque encore au dossier, en mots simples. Les pièces refusées ou jamais envoyées comptent.
export function dossierMissing(ws, order) {
  const out = [];
  const req = order.requiredDocs || [];
  for (const t of req) {
    const live = ws.documents.filter(d => d.orderId === order.id && d.type === t && d.status !== 'remplace');
    const last = live.at(-1);
    if (!last) out.push({ kind: 'doc', type: t, label: DOC_TYPES[t].label, why: 'pas encore envoyée' });
    else if (last.status === 'refuse') out.push({ kind: 'doc', type: t, label: DOC_TYPES[t].label, why: 'refusée : ' + (last.reason || 'à refaire') });
  }
  const a = order.address || {};
  if (!a.landmark || String(a.landmark).trim().length < 8) out.push({ kind: 'info', field: 'landmark', label: 'Repère pour trouver le logement', why: 'au moins 8 caractères' });
  const appt = order.apptId && byId(ws.appointments, order.apptId);
  if (!appt || !['reserve', 'confirme', 'en_cours', 'realise'].includes(appt.status)) out.push({ kind: 'slot', label: 'Créneau de visite', why: 'pas encore choisi' });
  return out;
}

// État du dossier en ligne, calculé (jamais stocké) : il suit toujours les pièces et le rendez-vous réels.
export function dossierState(ws, order) {
  const d = order.dossier;
  if (!d) return null;
  const missing = dossierMissing(ws, order);
  const docs = (order.requiredDocs || []).map(t => ws.documents.filter(x => x.orderId === order.id && x.type === t && x.status !== 'remplace').at(-1)).filter(Boolean);
  const pending = docs.filter(x => ['analyse', 'a_valider'].includes(x.status)).length;
  const flagged = docs.filter(x => x.check && !x.check.ok && ['analyse', 'a_valider'].includes(x.status)).length;
  let status;
  if (order.cancelled) status = 'annule';
  else if (stateRank(order.state) >= stateRank('RDV_CONFIRME')) status = 'valide';
  else if (!d.submittedAt) status = ws.clock > d.dueAt ? 'en_retard' : 'a_completer';
  else if (missing.length) status = 'incomplet';
  else if (pending) status = 'a_verifier';
  else status = 'verifie';
  return { status, openedAt: d.openedAt, dueAt: d.dueAt, submittedAt: d.submittedAt || null, late: !!d.late, missing, pending, flagged, docs: docs.length };
}

// Réserve directement une place sur un créneau (sans garde temporaire) : la vérification et la prise de capacité
// se font dans la même transaction, comme pour une réservation normale.
export function reserveSlot(ws, order, { date, slot }, actor) {
  if (!SLOTS.some(s => s.id === slot) || !Number.isFinite(Number(date))) throw new AppError('creneau', 'Choisissez un créneau dans la liste.');
  // Mêmes règles que la réservation classique : matériel suspendu, pas de visite aujourd'hui ni dans le passé.
  if (ws.sim.equipmentShortage && ws.config.policyEquipment === 'bloquer') throw new AppError('materiel', 'Matériel indisponible : la prise de rendez-vous est suspendue selon la politique en vigueur. Aucune date ne vous est promise.');
  if (Number(date) < startOfDay(ws.clock) + DAY) throw new AppError('creneau', 'Choisissez un créneau à partir de demain.');
  const teams = ws.teams.filter(t => t.available && t.zones.includes(order.zone));
  const caps = ws.capacity.filter(c => c.date === Number(date) && c.slot === slot && teams.some(t => t.id === c.teamId) && (ws.sim.saturation ? remaining(ws, c) - 1 : remaining(ws, c)) > 0);
  if (!caps.length) {
    const alt = availability(ws, order).slots.filter(s => s.left > 0).slice(0, 3);
    throw new AppError('complet', 'Ce créneau vient d’être pris. Choisissez-en un autre.', { alternatives: alt });
  }
  caps.sort((x, y) => (byId(ws.teams, y.teamId).zones[0] === order.zone ? 1 : 0) - (byId(ws.teams, x.teamId).zones[0] === order.zone ? 1 : 0));
  const c = caps[0];
  const old = order.apptId && byId(ws.appointments, order.apptId);
  if (old && ['reserve', 'tenu'].includes(old.status)) { old.status = 'remplace'; old.reason = 'Nouveau créneau choisi par ' + actor.name; releaseCap(ws, old); }
  c.used++;
  const appt = { id: nid(ws, 'RDV'), orderId: order.id, date: c.date, slot, teamId: c.teamId, capId: c.id, status: 'reserve', createdAt: ws.clock, replaces: old ? old.id : null, reason: null, eventSeq: 0 };
  ws.appointments.push(appt);
  order.apptId = appt.id; order.version++; order.updatedAt = ws.clock;
  appt.eventSeq = emit(ws, order, 'RDV_RESERVE', { actor, payload: { date: appt.date, slot }, publicText: 'Créneau demandé : ' + fmtDate(appt.date) + ' (' + slotLabel(slot) + '). Moov confirme l’heure et le technicien.' }).seq;
  return appt;
}

// Contrôle automatique d'une photo, à partir de mesures faites sur le téléphone (taille, lumière, netteté).
// Ce n'est pas une IA : trois règles simples, expliquées au client et à la conseillère.
export function photoCheck(q) {
  if (!q || typeof q !== 'object') return null;
  const n = (v, lo, hi) => { const x = Number(v); return Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : null; };
  const m = { w: n(q.w, 0, 20000), h: n(q.h, 0, 20000), bright: n(q.bright, 0, 255), sharp: n(q.sharp, 0, 100) };
  if (m.w == null || m.h == null || m.bright == null || m.sharp == null) return null;
  const issues = [];
  if (Math.min(m.w, m.h) < 480) issues.push('trop petite');
  if (m.bright < 55) issues.push('trop sombre');
  else if (m.bright > 235) issues.push('trop claire (reflet)');
  if (m.sharp < 12) issues.push('floue');
  return { ok: !issues.length, issues, ...m };
}

// Avis automatique sur les pièces d'un dossier en ligne, pour aider la conseillère. Ce n'est PAS une IA : il lit seulement
// le contrôle de la photo (netteté, lumière, taille) et repère une même photo envoyée pour deux pièces. La conseillère décide.
const ADVICE_WORDS = { 'floue': 'Photo floue, merci de la reprendre', 'trop sombre': 'Photo trop sombre, merci de la reprendre à la lumière', 'trop claire (reflet)': 'Photo avec un reflet, merci de la reprendre sans éclairage direct', 'trop petite': 'Photo trop petite, merci de la reprendre de plus près' };
export function dossierAdvice(ws, order) {
  if (!order.dossier) return null;
  const live = (order.requiredDocs || []).map(t => ws.documents.filter(d => d.orderId === order.id && d.type === t && d.status !== 'remplace').at(-1)).filter(Boolean);
  const review = live.filter(d => ['analyse', 'a_valider'].includes(d.status));
  const items = review.map(d => {
    const reasons = [];
    if (d.check && !d.check.ok) for (const i of d.check.issues) reasons.push(ADVICE_WORDS[i] || ('Photo ' + i));
    const twin = live.find(o => o.id !== d.id && o.thumb && o.thumb === d.thumb && o.mime === d.mime);
    if (twin && !reasons.length) reasons.push('Même photo que « ' + (DOC_TYPES[twin.type].short || DOC_TYPES[twin.type].label).toLowerCase() + ' » : merci d’envoyer la bonne pièce');
    const wait = d.status === 'analyse';
    return { docId: d.id, type: d.type, label: DOC_TYPES[d.type].label, status: d.status, verdict: wait ? 'attendre' : reasons.length ? 'refaire' : 'ok', reason: reasons[0] || null, notes: reasons };
  });
  const verdict = !items.length ? 'rien' : items.some(i => i.verdict === 'attendre') ? 'attendre' : items.some(i => i.verdict === 'refaire') ? 'refaire' : 'valider';
  const nOk = items.filter(i => i.verdict === 'ok').length, nBad = items.filter(i => i.verdict === 'refaire').length;
  const summary = verdict === 'rien' ? 'Aucune pièce à regarder pour le moment.' : verdict === 'attendre' ? 'Le contrôle des photos est en cours.' : verdict === 'valider' ? 'Les photos semblent nettes et lisibles : vous pouvez valider.' : nBad + ' photo' + (nBad > 1 ? 's' : '') + ' à refaire' + (nOk ? ', ' + nOk + ' semble' + (nOk > 1 ? 'nt' : '') + ' correcte' + (nOk > 1 ? 's' : '') : '') + '.';
  return { verdict, summary, items, simulated: true };
}

export function docCheck(file) {
  const okMime = ['image/jpeg', 'image/png', 'application/pdf', 'image/webp'];
  if (!okMime.includes(file.mime)) throw new AppError('fichier', 'Format refusé. Formats acceptés : JPG, PNG, WEBP, PDF.');
  if (file.size > 5 * 1024 * 1024) throw new AppError('fichier', 'Fichier trop lourd (5 Mo maximum).');
  if (/\.(exe|js|html?|bat|sh|svg)$/i.test(file.name)) throw new AppError('fichier', 'Type de fichier dangereux refusé.');
}

export { DOC_TYPES, APPT_STATES, stageOf };
