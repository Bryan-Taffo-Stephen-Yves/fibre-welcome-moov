// Intelligence artificielle du démonstrateur (CDC 6).
// - IA-01 estimation : référence (médiane par zone/étape) et modèle v2 (quantiles par strate).
// - IA-02 risque : règles explicites + score.
// - IA-03 assistant : réponses sourcées, abstention, résistance aux instructions hostiles.
// - IA-04 résumé : chaque phrase renvoie à un événement.
// Tout est ENTRAÎNÉ SUR DONNÉES SYNTHÉTIQUES générées avec une graine : cela valide la chaîne,
// pas la précision réelle chez Moov (CDC 6.6).
import { ZONES, STATE_INFO, BLOCKER_TYPES, stateRank, APPT_STATES, PAYMENT_STATES } from './model.js';

export function rng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const lognorm = (r, med, sigma) => { const u = Math.max(1e-9, r()), v = r(); return med * Math.exp(sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)); };
export const quantile = (arr, q) => { if (!arr.length) return NaN; const s = [...arr].sort((a, b) => a - b); const i = (s.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo); };

export const STAGES = ['prep', 'plan', 'visit', 'act'];
export const STAGE_LABEL = { prep: 'vérification technique', plan: 'choix et confirmation du rendez-vous', visit: 'attente puis visite du technicien', act: 'activation de la ligne' };
const ZONE_F = { cocody: 1, yopougon: 1.35, marcory: 1.1, abobo: 1.5, bingerville: 1.25 };
const BASE_H = { prep: 30, plan: 20, visit: 70, act: 6 };

// Historique synthétique reproductible (graine) avec profils de zone et de charge.
export function genHistory(seed, n = 700) {
  const r = rng(seed * 7919 + 13);
  const out = [];
  const day = 24 * 3600e3;
  for (let i = 0; i < n; i++) {
    const zone = ZONES[Math.floor(r() * ZONES.length)].id;
    const t0 = i * (180 * day / n);
    const load = Math.min(1, Math.max(0, 0.35 + 0.35 * Math.sin(i / 60) + (r() - 0.5) * 0.4));
    const docsOk = r() > 0.22;
    const d = {};
    for (const s of STAGES) {
      let m = BASE_H[s] * ZONE_F[zone];
      if (s === 'prep' && !docsOk) m *= 2.1;
      if (s === 'visit') m *= 0.7 + load * 1.1;
      if (s === 'plan') m *= 0.8 + load * 0.5;
      d[s] = lognorm(r, m, s === 'act' ? 0.9 : 0.45);
    }
    // Environ 12 % des dossiers ne sont pas terminés (censure) : on ne les supprime pas en silence.
    const censoredAt = r() < 0.12 ? STAGES[1 + Math.floor(r() * 3)] : null;
    out.push({ id: 'H' + i, zone, t0, load, docsOk, d, censoredAt });
  }
  return out;
}

export const stageOf = st => {
  if (stateRank(st) <= stateRank('PREPARATION')) return 'prep';
  if (st === 'PRET_A_PLANIFIER') return 'plan';
  if (st === 'RDV_CONFIRME') return 'visit';
  if (stateRank(st) < stateRank('SERVICE_ACTIF')) return 'act';
  return null;
};
const remainingFrom = (h, stage) => { let s = 0; for (const k of STAGES.slice(STAGES.indexOf(stage))) s += h.d[k]; return s; };
const complete = h => !h.censoredAt;

export function trainModels(history) {
  const byZS = {}, strata = {};
  for (const h of history) {
    if (!complete(h)) continue;
    for (const s of STAGES) {
      const rem = remainingFrom(h, s);
      (byZS[h.zone + ':' + s] ||= []).push(rem);
      const k = h.zone + ':' + s + ':' + (h.load > 0.5 ? 'H' : 'L') + ':' + (s === 'prep' ? (h.docsOk ? 'D' : 'N') : '-');
      (strata[k] ||= []).push(rem);
    }
  }
  const baseline = {}, v2 = {};
  for (const k in byZS) baseline[k] = { med: quantile(byZS[k], 0.5), p10: quantile(byZS[k], 0.1), p90: quantile(byZS[k], 0.9), n: byZS[k].length };
  for (const k in strata) v2[k] = { med: quantile(strata[k], 0.5), p10: quantile(strata[k], 0.1), p90: quantile(strata[k], 0.9), n: strata[k].length };
  return { baseline, v2 };
}

function predictRaw(models, version, { zone, stage, load, docsOk }) {
  if (version === 'baseline-1') return { ...models.baseline[zone + ':' + stage], used: ['zone', 'étape'] };
  const k = zone + ':' + stage + ':' + (load > 0.5 ? 'H' : 'L') + ':' + (stage === 'prep' ? (docsOk ? 'D' : 'N') : '-');
  const m = models.v2[k];
  if (!m || m.n < 12) return { ...models.baseline[zone + ':' + stage], used: ['zone', 'étape'], fallback: true };
  return { ...m, used: ['zone', 'étape', 'charge des équipes', ...(stage === 'prep' ? ['complétude des pièces'] : [])] };
}

// Évaluation temporelle (CDC 6.6 : séparation dans le temps, comparaison à la référence).
export function evaluate(seed) {
  const hist = genHistory(seed);
  const cut = Math.floor(hist.length * 0.7);
  const train = hist.slice(0, cut), test = hist.slice(cut);
  const models = trainModels(train);
  const res = { train: train.length, test: test.length, censoredTest: test.filter(h => !complete(h)).length, versions: {} };
  for (const v of ['baseline-1', 'quantiles-2']) {
    let ae = 0, n = 0, cov = 0, width = 0; const zones = Object.create(null);
    for (const h of test) {
      if (!complete(h)) continue;
      for (const s of STAGES) {
        const p = predictRaw(models, v, { zone: h.zone, stage: s, load: h.load, docsOk: h.docsOk });
        const y = remainingFrom(h, s);
        const e = Math.abs(p.med - y);
        ae += e; n++; width += p.p90 - p.p10; if (y >= p.p10 && y <= p.p90) cov++;
        const z = (zones[h.zone] ||= { ae: 0, n: 0 }); z.ae += e; z.n++;
      }
    }
    res.versions[v] = { mae: ae / n, coverage: cov / n, width: width / n, n, zones: Object.fromEntries(Object.entries(zones).map(([k, z]) => [k, z.ae / z.n])) };
  }
  const b = res.versions['baseline-1'], m = res.versions['quantiles-2'];
  res.gain = 1 - m.mae / b.mae;
  res.worstZoneRegression = Math.max(...Object.keys(m.zones).map(z => m.zones[z] / b.zones[z] - 1));
  res.passes = res.gain >= 0.10 && res.worstZoneRegression < 0.05 && Math.abs(m.coverage - 0.8) < 0.08;
  return res;
}

const H = 3600e3;
export function estimate(ws, order) {
  const now = ws.clock;
  const model = ws.models.find(m => m.active);
  const base = { at: now, modelVersion: model ? model.version : null, synthetic: true };
  if (!model) return { ...base, abstain: true, reason: 'Aucun modèle actif : l’estimation est désactivée par l’administrateur.' };
  const stage = stageOf(order.state);
  if (!stage) return { ...base, done: true };
  const prospect = ws.integrations.prospect;
  if (!prospect.up && now - prospect.lastSync > 6 * H) return { ...base, abstain: true, reason: 'Les données de Moov Prospect ne sont plus à jour depuis plus de 6 h. Nous préférons ne pas afficher de délai.' };
  if (order.state === 'DOSSIER_RECU') return { ...base, abstain: true, reason: 'Le paiement n’est pas encore rapproché : le délai démarre à la confirmation du paiement.' };
  const models = ws._models || (ws._models = trainModels(genHistory(ws.seed)));
  const load = teamLoad(ws, order.zone);
  const docsOk = !ws.blockers.some(b => b.orderId === order.id && b.status === 'ouvert' && b.type === 'PIECE_MANQUANTE');
  const p = predictRaw(models, model.version, { zone: order.zone, stage, load, docsOk });
  if (!p || !p.n) return { ...base, abstain: true, reason: 'Pas assez de dossiers comparables pour cette zone.' };
  const elapsed = (now - (order.stateSince || now)) / H;
  let med = Math.max(2, p.med - elapsed), lo = Math.max(1, p.p10 - elapsed), hi = Math.max(med + 2, p.p90 - elapsed);
  const causes = [];
  const openB = ws.blockers.filter(b => b.orderId === order.id && b.status === 'ouvert');
  for (const b of openB) { const add = BLOCKER_TYPES[b.type].slaH * 0.6; med += add; hi += add * 1.6; causes.push({ label: 'Blocage : ' + BLOCKER_TYPES[b.type].label, effect: '+' + Math.round(add) + ' h' }); }
  if (load > 0.5) causes.push({ label: 'Équipes très chargées dans votre zone', effect: 'allonge' });
  else causes.push({ label: 'Charge des équipes normale', effect: 'neutre' });
  if (stage === 'prep' && !docsOk) causes.push({ label: 'Une pièce du dossier manque', effect: 'allonge' });
  causes.push({ label: 'Délais habituels à ' + (ZONES.find(z => z.id === order.zone) || {}).name, effect: 'référence' });
  const appt = order.apptId && ws.appointments.find(a => a.id === order.apptId);
  let risk = null;
  if (appt && ['reserve', 'confirme'].includes(appt.status)) {
    const apptEnd = appt.date + (appt.slot === 'm' ? 12 : 17) * H;
    const expected = now + med * H;
    if (expected > apptEnd + 36 * H) risk = 'Le modèle prévoit un délai plus long que votre rendez-vous. Le rendez-vous confirmé reste valable ; une équipe vérifie.';
  }
  const reliability = p.fallback || p.n < 30 ? 'faible' : (hi - lo) / med > 1.6 ? 'moyenne' : 'bonne';
  return { ...base, stage, medianH: med, loH: lo, hiH: hi, from: now, reliability, causes, used: p.used, sample: p.n, risk, fallback: !!p.fallback, confirmedAppt: appt && appt.status === 'confirme' ? appt : null };
}

export function teamLoad(ws, zone) {
  const teams = ws.teams.filter(t => t.zones.includes(zone) && t.available);
  if (!teams.length) return 1;
  let cap = 0, used = 0;
  for (const s of ws.capacity) if (teams.some(t => t.id === s.teamId) && s.date >= ws.clock - 24 * H && s.date < ws.clock + 6 * 24 * H) { cap += s.cap; used += s.used; }
  const sat = ws.sim.saturation ? 0.5 : 0;
  return Math.min(1, (cap ? used / cap : 1) + sat);
}

// IA-02 : risque de blocage ou de dépassement. Règles certaines d'abord, score ensuite.
export function risk(ws, order) {
  const now = ws.clock;
  const causes = [];
  let score = 0.05;
  const openB = ws.blockers.filter(b => b.orderId === order.id && b.status === 'ouvert');
  for (const b of openB) { score += 0.35; causes.push(BLOCKER_TYPES[b.type].label + (b.ownerUserId ? '' : ' (sans responsable)')); if (!b.ownerUserId) score += 0.15; }
  const lastEv = ws.events.filter(e => e.orderId === order.id).at(-1);
  const idleH = lastEv ? (now - lastEv.effectiveAt) / H : 0;
  if (idleH > 48 && !['SERVICE_ACTIF', 'CLOTURE'].includes(order.state)) { score += 0.25; causes.push('Aucune action depuis ' + Math.round(idleH) + ' h'); }
  const sla = ws.config.slaH[order.state];
  const inState = (now - order.stateSince) / H;
  if (sla && inState > sla * 0.8) { score += inState > sla ? 0.3 : 0.15; causes.push((inState > sla ? 'Seuil dépassé' : 'Seuil bientôt atteint') + ' pour « ' + STATE_INFO[order.state].label + ' » (' + Math.round(inState) + ' h / ' + sla + ' h)'); }
  if (teamLoad(ws, order.zone) > 0.8 && stateRank(order.state) < stateRank('RDV_CONFIRME')) { score += 0.1; causes.push('Capacité de la zone presque saturée'); }
  score = Math.min(0.99, score);
  const level = score >= 0.6 ? 'élevé' : score >= 0.3 ? 'moyen' : 'faible';
  let action = 'Aucune action requise', to = null;
  if (openB.length) { const b = openB[0]; action = BLOCKER_TYPES[b.type].action; to = BLOCKER_TYPES[b.type].owner; }
  else if (causes.length) { action = 'Contacter le client et fixer la prochaine étape'; to = 'conseiller'; }
  return { score, level, horizon: '48 h', causes, action, to };
}

// ---------- IA-03 : assistant contextualisé ----------
const INJECTION = /(ignore|oublie|oubliez).{0,30}(instruction|consigne|règle)|tu es (maintenant|désormais)|mode (admin|développeur|developpeur)|system prompt|en tant qu.administrateur|donne(-| )moi (les|le) (dossier|données|numéro)s? d|affiche.{0,20}(tous|autres) (les )?clients|confirme (que )?(mon|le) paiement|marque.{0,20}(actif|activé)/i;
const OTHER_REF = /FW-\d{4}-\d{3,}/gi;

export const INTENTS = [
  { id: 'status', re: /(où en|ou en|avance|statut|état|etat|suivi|mon dossier)/i },
  { id: 'why', re: /(pourquoi|attendre|attente|si long|retard|bloqu)/i },
  { id: 'prepare', re: /(prépar|prepar|quoi faire|avant (la|le) (visite|passage)|présent|document)/i },
  { id: 'appt', re: /(rendez|rdv|créneau|creneau|modifier|déplacer|deplacer|changer|reporter|annuler (le|mon) r)/i },
  { id: 'when', re: /(quand|date|combien de temps|délai|delai|jour)/i },
  { id: 'payment', re: /(paiement|payé|paye|moov money|reçu|recu|montant)/i },
  { id: 'activation', re: /(activ|internet (ne )?marche|connexion|fonctionne)/i },
  { id: 'refund', re: /(rembours|annul)/i },
  { id: 'human', re: /(conseiller|humain|parler à|appeler|quelqu)/i },
];

export function assistantAnswer(ws, order, question, docs) {
  const now = ws.clock;
  const trace = { question, at: now, intent: null, tools: ['lire_dossier(' + (order ? order.ref : '—') + ')'], refused: false };
  if (INJECTION.test(question)) {
    trace.refused = true;
    return { trace, blocks: [{ kind: 'guard', title: 'Demande refusée', text: 'Je ne peux ni changer mes règles, ni consulter d’autres dossiers, ni confirmer un paiement ou une activation. Ces faits viennent uniquement des systèmes autorisés de Moov.' }], handoff: true };
  }
  const refs = (question.match(OTHER_REF) || []).filter(r => !order || r.toUpperCase() !== order.ref);
  if (refs.length) {
    trace.refused = true;
    return { trace, blocks: [{ kind: 'guard', title: 'Accès limité à votre dossier', text: 'Je ne peux parler que de votre propre dossier. Je ne confirme même pas si une autre référence existe.' }] };
  }
  if (!order) return { trace, blocks: [{ kind: 'abstain', title: 'Aucun dossier rattaché', text: 'Rattachez d’abord votre dossier avec la référence et le code reçu par SMS.' }] };
  const intent = (INTENTS.find(i => i.re.test(question)) || {}).id || null;
  trace.intent = intent;
  const stale = !ws.integrations.prospect.up;
  const fresh = { label: stale ? 'Données non actualisées depuis ' + fmtAgo(now - ws.integrations.prospect.lastSync) : 'Statut à jour (' + fmtAgo(now - order.updatedAt) + ')', stale };
  const st = STATE_INFO[order.state];
  const openB = ws.blockers.filter(b => b.orderId === order.id && b.status === 'ouvert');
  const appt = order.apptId && ws.appointments.find(a => a.id === order.apptId);
  const doc = id => { const d = docs.find(x => x.id === id); return d ? { id: d.id, title: d.title, version: d.version } : null; };
  const blocks = [];
  const factStatus = () => blocks.push({ kind: 'fact', title: 'Dans votre dossier', text: 'Étape actuelle : ' + st.label + '. ' + st.client + (openB.length ? ' Point bloquant : ' + openB.map(b => BLOCKER_TYPES[b.type].clientText).join(' ') : ''), source: 'Dossier ' + order.ref + ', version ' + order.version, fresh });
  const est = () => {
    const e = estimate(ws, order);
    if (e.abstain) blocks.push({ kind: 'abstain', title: 'Estimation', text: e.reason });
    else if (!e.done) blocks.push({ kind: 'estimate', title: 'Estimation (ce n’est pas un engagement)', text: 'Délai restant probable : ' + fmtRange(e.loH, e.hiH) + ', fiabilité ' + e.reliability + '. Calculé par le modèle ' + e.modelVersion + ', entraîné sur données synthétiques.', source: 'Modèle ' + e.modelVersion });
  };
  switch (intent) {
    case 'status': factStatus(); est(); break;
    case 'why':
      factStatus();
      if (!openB.length) blocks.push({ kind: 'doc', title: 'Procédure', text: 'Chaque étape a ses propres contrôles : vérification technique, disponibilité des équipes, puis activation à distance. Aucun blocage n’est ouvert sur votre dossier.', doc: doc('PR-02') });
      est(); break;
    case 'prepare':
      factStatus();
      blocks.push({ kind: 'doc', title: 'Procédure', text: 'Le jour J : une personne majeure présente, l’accès au logement, une prise électrique libre près de l’emplacement de la box. Si le câble traverse des parties communes, l’accord du propriétaire ou du syndic.', doc: doc('PR-03') });
      blocks.push({ kind: 'action', title: 'Action possible', text: 'Ouvrir votre liste de préparation.', action: { go: 'prep' } }); break;
    case 'appt':
      if (appt) blocks.push({ kind: 'fact', title: 'Dans votre dossier', text: 'Rendez-vous ' + APPT_STATES[appt.status].toLowerCase() + ' le ' + fmtDate(appt.date) + ', ' + (appt.slot === 'm' ? '8 h – 12 h' : '13 h – 17 h') + '.', source: 'Service de réservation (simulé)', fresh });
      else blocks.push({ kind: 'fact', title: 'Dans votre dossier', text: 'Aucun rendez-vous n’est réservé pour l’instant.', source: 'Service de réservation (simulé)', fresh });
      blocks.push({ kind: 'doc', title: 'Procédure', text: 'Vous pouvez modifier ou annuler depuis l’onglet Rendez-vous. L’ancien créneau est libéré et reste visible dans l’historique.', doc: doc('PR-04') });
      blocks.push({ kind: 'action', title: 'Action possible', text: 'Ouvrir la page Rendez-vous (vous confirmerez vous-même).', action: { go: 'rdv' } }); break;
    case 'when':
      if (appt && appt.status === 'confirme') blocks.push({ kind: 'fact', title: 'Engagement confirmé', text: 'Visite confirmée le ' + fmtDate(appt.date) + ', ' + (appt.slot === 'm' ? '8 h – 12 h' : '13 h – 17 h') + '.', source: 'Service de réservation (simulé)', fresh });
      est(); break;
    case 'payment':
      blocks.push({ kind: 'fact', title: 'Dans votre dossier', text: 'Paiement : ' + PAYMENT_STATES[order.payment.status] + '. Référence ' + order.payment.ref + '.', source: 'Connecteur Moov Money (simulé)', fresh });
      blocks.push({ kind: 'doc', title: 'Procédure', text: 'Seul le rapprochement fait par Moov confirme un paiement. Une capture d’écran de reçu ne suffit pas.', doc: doc('PR-01') }); break;
    case 'activation':
      factStatus();
      blocks.push({ kind: 'doc', title: 'Procédure', text: 'Installation terminée ne veut pas dire Internet actif : l’activation est confirmée par le système Moov. Si rien ne marche après activation, signalez-le : un incident est ouvert.', doc: doc('PR-05') }); break;
    case 'refund':
      blocks.push({ kind: 'doc', title: 'Procédure', text: 'Une annulation passe par une validation de Moov. Le montant éventuel d’un remboursement est fixé par cette procédure : je ne peux pas vous l’annoncer.', doc: doc('PR-06') });
      blocks.push({ kind: 'action', title: 'Action possible', text: 'Parler à un conseiller.', action: { handoff: true } }); break;
    case 'human':
      blocks.push({ kind: 'action', title: 'Transfert', text: 'Je transmets votre question à un conseiller. Vous serez notifié de sa réponse.', action: { handoff: true } }); break;
    default:
      blocks.push({ kind: 'abstain', title: 'Je préfère ne pas deviner', text: 'Je n’ai pas d’information fiable pour répondre. Je peux transférer votre question à un conseiller.', action: { handoff: true } });
  }
  if (stale && intent) blocks.push({ kind: 'warn', title: 'Attention', text: 'Le lien avec Moov Prospect est interrompu : le statut affiché peut être ancien.' });
  return { trace, blocks };
}

// ---------- IA-04 : résumé pour les équipes ----------
export function summarize(ws, order) {
  const evs = ws.events.filter(e => e.orderId === order.id);
  const lines = [];
  const first = evs[0];
  if (first) lines.push({ text: 'Dossier reçu de ' + first.source + ' le ' + fmtDate(first.effectiveAt) + '.', ref: first.seq });
  const pay = evs.find(e => e.type === 'PAIEMENT_CONFIRME');
  if (pay) lines.push({ text: 'Paiement rapproché (' + order.payment.amount.toLocaleString('fr-FR') + ' ' + order.payment.currency + ').', ref: pay.seq });
  const blk = ws.blockers.filter(b => b.orderId === order.id);
  for (const b of blk) lines.push({ text: 'Blocage « ' + BLOCKER_TYPES[b.type].label + ' » ' + (b.status === 'ouvert' ? 'ouvert, responsable : ' + (b.ownerRole || '—') : 'résolu : ' + (b.resolution || '')) + '.', ref: b.eventSeq });
  const appts = ws.appointments.filter(a => a.orderId === order.id);
  for (const a of appts) lines.push({ text: 'Rendez-vous ' + fmtDate(a.date) + ' ' + (a.slot === 'm' ? 'matin' : 'après-midi') + ' : ' + APPT_STATES[a.status].toLowerCase() + '.', ref: a.eventSeq });
  const msgs = ws.messages.filter(m => m.orderId === order.id && m.visibility === 'public' && m.from === 'client');
  if (msgs.length) lines.push({ text: msgs.length + ' message(s) du client, dernier : « ' + msgs.at(-1).text.slice(0, 80) + ' ».', ref: msgs.at(-1).eventSeq });
  const last = evs.at(-1);
  lines.push({ text: 'État actuel : ' + STATE_INFO[order.state].label + '.', ref: last && last.seq });
  const r = risk(ws, order);
  const draft = 'Bonjour ' + (ws.users.find(u => u.id === order.customerId) || {}).name + ', votre dossier ' + order.ref + ' est à l’étape « ' + STATE_INFO[order.state].label + ' ». ' + (r.to === 'client' ? 'Pour avancer, merci de : ' + r.action.toLowerCase() + '. ' : '') + 'Nous revenons vers vous dès qu’il y a du nouveau.';
  return { lines, risk: r, draft, generatedAt: ws.clock, note: 'Brouillon à relire. L’IA ne promet ni date, ni dérogation, ni montant.' };
}

export const fmtDate = t => new Intl.DateTimeFormat('fr-FR', { timeZone: 'Africa/Abidjan', weekday: 'short', day: 'numeric', month: 'short' }).format(t);
export const fmtDateTime = t => new Intl.DateTimeFormat('fr-FR', { timeZone: 'Africa/Abidjan', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(t);
export const fmtAgo = ms => { const m = Math.round(ms / 60e3); if (m < 1) return 'à l’instant'; if (m < 60) return 'il y a ' + m + ' min'; const h = Math.round(m / 60); if (h < 48) return 'il y a ' + h + ' h'; return 'il y a ' + Math.round(h / 24) + ' j'; };
export const fmtDur = h => h < 20 ? Math.round(h) + ' h' : String(Math.round(h / 24 * 2) / 2).replace('.', ',') + ' j';
export const fmtRange = (lo, hi) => fmtDur(lo) + ' à ' + fmtDur(hi);
