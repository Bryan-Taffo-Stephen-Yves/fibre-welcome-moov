// IA générative (Claude) sous garde-fou : ce que l'IA a le droit de savoir, et le contrôle de ce qu'elle répond.
// Le serveur simulé ne parle jamais à Internet. Le navigateur lit le contexte du dossier (assistant.context), l'envoie
// à la fonction « fw-ia » (Supabase) qui appelle Claude avec la clé gardée côté serveur, puis rapporte la réponse
// (assistant.ask, champ ai). Avant de la montrer, on la vérifie ici avec l'état réel du dossier :
// - chaque source citée existe, et au moins une est citée quand l'IA répond ;
// - aucun nombre, jour, mois ou référence n'apparaît s'il n'est pas dans une source citée ;
// - pas de promesse de délai, pas de paiement ni d'activation présentés comme confirmés si le dossier ne le dit pas ;
// - jamais de montant de remboursement, de lien, ni de demande de code.
// Sinon, le client voit la réponse par règles et le journal garde le motif. Le contexte ne contient ni nom,
// ni téléphone, ni adresse : l'IA n'en a pas besoin.
import { STATE_INFO, BLOCKER_TYPES, APPT_STATES, PAYMENT_STATES, SLOTS, hourLabel, PHOTO_ISSUES } from './model.js';
import { estimate, fmtDate, fmtDateTime, fmtRange, fmtAgo } from './ai.js';
import { dossierState } from './domain.js';

export const AI_MODEL = 'claude-opus-5-5';
export const genAiOn = ws => !(ws.config && ws.config.genAi === false);

// Textes approuvés des procédures publiques : les seuls que l'IA peut citer (mêmes phrases que l'assistant par règles).
export const PROCEDURE_TEXT = {
  'PR-01': 'Seul le rapprochement fait par Moov confirme un paiement : la référence Moov Money est comparée au montant attendu. Une capture d’écran de reçu ne suffit pas.',
  'PR-02': 'Un raccordement passe par ces étapes : dossier reçu, paiement confirmé, vérification technique (adresse, accès, port fibre proche), prêt à planifier, rendez-vous confirmé, installation, activation de la ligne par le système de Moov, service actif. Chaque étape a ses propres contrôles.',
  'PR-03': 'Le jour de la visite : une personne majeure présente, l’accès au logement, une prise électrique libre près de l’emplacement de la box. Si le câble traverse des parties communes, l’accord du propriétaire ou du syndic.',
  'PR-04': 'Vous pouvez modifier ou annuler votre rendez-vous depuis l’onglet Rendez-vous. L’ancien créneau est libéré et reste visible dans l’historique.',
  'PR-05': 'Installation terminée ne veut pas dire Internet actif : l’activation est confirmée par le système de Moov. Si rien ne marche après l’activation, signalez-le : un incident est ouvert.',
  'PR-06': 'Une annulation passe par une validation de Moov. Le montant éventuel d’un remboursement est fixé par cette procédure : l’assistant ne peut pas l’annoncer.',
};

const MISSION_TEXT = {
  affectee: 'Un technicien est affecté à votre visite.',
  en_route: 'Le technicien est en route vers chez vous.',
  sur_place: 'Le technicien est arrivé chez vous.',
  en_cours: 'Le technicien installe la fibre chez vous.',
  terminee: 'La visite du technicien est terminée.',
  echec: 'La dernière visite n’a pas pu aboutir.',
};
const ACTIVATION_TEXT = {
  demandee: 'L’activation est demandée au système de Moov : on attend sa confirmation.',
  confirmee: 'Le système de Moov a confirmé l’activation de la ligne.',
  echouee: 'L’activation a échoué : une équipe s’en occupe.',
  anomalie: 'La confirmation d’activation est incohérente : une équipe vérifie.',
  annulee: 'L’activation a été annulée.',
};

const slotText = a => ((SLOTS.find(s => s.id === a.slot) || {}).label || '') + (a.time ? ', heure prévue ' + hourLabel(a.time) : '');
const money = p => Number(p.amount).toLocaleString('fr-FR') + ' ' + (p.currency === 'XOF' || !p.currency ? 'F CFA' : p.currency);
const blockerText = b => {
  const t = BLOCKER_TYPES[b.type];
  const detail = b.type === 'PIECE_MANQUANTE' && b.detail ? ' Pièce(s) attendue(s) : ' + b.detail + '.' : b.type === 'ADRESSE_AMBIGUE' && b.detail ? ' Précision demandée : ' + b.detail + '.' : '';
  return t.clientText + detail + (t.owner === 'client' ? ' À faire de votre côté : ' + t.action.charAt(0).toLowerCase() + t.action.slice(1) + '.' : ' Moov s’en occupe.');
};
function dossierText(ds) {
  if (ds.status === 'annule') return 'Dossier en ligne fermé : la commande est annulée.';
  if (ds.status === 'valide') return 'Dossier en ligne validé.';
  if (ds.status === 'verifie') return 'Toutes les pièces sont validées : Moov confirme maintenant l’heure de la visite.';
  if (ds.status === 'a_verifier') return 'Toutes les pièces sont envoyées : une conseillère les vérifie.';
  const parts = [];
  if (ds.missing.length) parts.push('Il manque encore : ' + ds.missing.map(m => m.label.charAt(0).toLowerCase() + m.label.slice(1) + ' (' + m.why + ')').join(', ') + '.');
  if (!ds.submittedAt && ds.dueAt) parts.push((ds.status === 'en_retard' ? 'Le délai d’envoi est dépassé depuis le ' : 'À envoyer avant le ') + fmtDateTime(ds.dueAt) + '.');
  return parts.join(' ') || 'Dossier en ligne en cours.';
}

// Contexte donné à l'IA : uniquement le dossier du client (déjà filtré par ses droits), sans donnée personnelle.
// Chaque élément a un identifiant stable que l'IA doit citer.
export function aiContext(ws, order, { delegate = false } = {}) {
  const now = ws.clock;
  const stale = !ws.integrations.prospect.up;
  const fresh = { label: stale ? 'Données non actualisées depuis ' + fmtAgo(now - ws.integrations.prospect.lastSync) : 'Statut à jour (' + fmtAgo(now - order.updatedAt) + ')', stale };
  const src = 'Dossier ' + order.ref + ', version ' + order.version;
  const items = [];
  const add = (id, kind, title, text, extra = {}) => items.push({ id, kind, title, text, ...extra });
  const st = STATE_INFO[order.state];
  add('F1', 'fact', 'Étape du dossier', order.cancelled ? 'La commande ' + order.ref + ' est annulée. Aucune nouvelle étape n’est prévue : plus de rendez-vous à choisir ni de visite à préparer.' : 'Dossier ' + order.ref + ' : étape « ' + st.label + ' ». ' + st.client, { source: src, fresh });
  const openB = ws.blockers.filter(b => b.orderId === order.id && b.status === 'ouvert');
  add('F2', 'fact', 'Points bloquants', openB.length ? openB.map(blockerText).join(' ') : 'Aucun point bloquant n’est ouvert sur le dossier.', { source: src, fresh });
  const appt = order.apptId && ws.appointments.find(a => a.id === order.apptId);
  add('F3', 'fact', 'Rendez-vous', appt ? 'Rendez-vous ' + String(APPT_STATES[appt.status] || appt.status).toLowerCase() + ' le ' + fmtDate(appt.date) + ', ' + slotText(appt) + '.' : 'Aucun rendez-vous n’est réservé pour l’instant.', { source: 'Service de réservation (simulé)', fresh });
  const pay = order.payment || {};
  add('F4', 'fact', 'Paiement', 'Paiement : ' + String(PAYMENT_STATES[pay.status] || pay.status || 'inconnu').toLowerCase() + '.' + (pay.amount ? ' Montant payé : ' + money(pay) + '.' : '') + (pay.ref && !delegate ? ' Référence ' + pay.ref + '.' : ''), { source: 'Connecteur Moov Money (simulé)', fresh });
  const ds = dossierState(ws, order);
  if (ds) add('F5', 'fact', 'Dossier en ligne', dossierText(ds), { source: src, fresh });
  const wo = order.woId && ws.workOrders.find(w => w.id === order.woId);
  if (wo && MISSION_TEXT[wo.status]) add('F6', 'fact', 'Visite du technicien', MISSION_TEXT[wo.status], { source: 'Application du technicien', fresh });
  const act = ws.activations.filter(a => a.orderId === order.id).at(-1);
  const active = ['SERVICE_ACTIF', 'CLOTURE'].includes(order.state);
  add('F7', 'fact', 'Activation de la ligne', active ? 'Le système de Moov a confirmé l’activation : la fibre est active.' : act && ACTIVATION_TEXT[act.status] ? ACTIVATION_TEXT[act.status] : 'L’activation n’est pas encore demandée : elle vient après l’installation.', { source: 'Système d’activation de Moov (simulé)', fresh });
  if (!order.cancelled) {
    const e = estimate(ws, order);
    if (e.abstain) add('E1', 'abstain', 'Estimation', e.reason);
    else if (!e.done) add('E1', 'estimate', 'Estimation (ce n’est pas un engagement)', 'Délai restant probable : ' + fmtRange(e.loH, e.hiH) + ', fiabilité ' + e.reliability + '. Calculé par le modèle ' + e.modelVersion + ', entraîné sur des données synthétiques.' + (e.risk ? ' ' + e.risk : ''), { source: 'Modèle ' + e.modelVersion });
  }
  for (const d of ws.docs) if (d.scope === 'public' && PROCEDURE_TEXT[d.id] && !(d.expires < now)) add(d.id, 'doc', 'Procédure « ' + d.title + ' »', PROCEDURE_TEXT[d.id], { doc: { id: d.id, title: d.title, version: d.version } });
  if (stale) add('W1', 'warn', 'Attention', 'Le lien avec Moov Prospect est interrompu : le statut affiché peut être ancien.');
  return { ref: order.ref, items, cancelled: !!order.cancelled, payConfirmed: pay.status === 'confirme', active };
}
// Ce qui part vers la fonction (et donc vers Claude) : identifiant, nature, titre et texte. Rien d'autre.
export const aiPayloadItems = ctx => ctx.items.map(({ id, kind, title, text }) => ({ id, kind, title, text }));

// ---------- Garde-fou ----------
const TOPIC_INTENT = { statut: 'status', attente: 'why', preparation: 'prepare', rendez_vous: 'appt', delai: 'when', paiement: 'payment', activation: 'activation', annulation: 'refund', conseiller: 'human', hors_sujet: null, autre: null };
const ACTIONS = { aucune: null, preparer: { go: 'prep' }, rendez_vous: { go: 'rdv' }, conseiller: { handoff: true } };
const norm = s => String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’‘`´]/g, "'").replace(/[  ]/g, ' ');
const NUM = /\d{1,3}(?:[   .]\d{3})+(?:,\d+)?|\d+(?:,\d+)?/g;
// « 1.5 » et « 1,5 » sont le même nombre ; « 25 000 », « 25.000 » et « 25000 » aussi.
const numbers = s => (String(s).replace(/(\d)\.(\d{1,2})(?!\d)/g, '$1,$2').match(NUM) || []).map(x => x.replace(/[   .]/g, ''));
const DAYS = { lundi: 'lun', mardi: 'mar', mercredi: 'mer', jeudi: 'jeu', vendredi: 'ven', samedi: 'sam', dimanche: 'dim' };
const MONTHS = { janvier: 'janv', fevrier: 'fevr', mars: 'mars', avril: 'avr', mai: 'mai', juin: 'juin', juillet: 'juil', aout: 'aout', septembre: 'sept', octobre: 'oct', novembre: 'nov', decembre: 'dec' };
const DATE_WORD = new RegExp('\\b(' + [...Object.keys(DAYS), ...Object.keys(MONTHS)].join('|') + ')\\b|\\b(lun|mar|mer|jeu|ven|sam|dim)\\.|\\b(janv|fevr|avr|juil|sept|oct|nov|dec)\\b', 'g');
const SOON = /\b(aujourd'hui|demain|apres-demain|hier|ce soir|ce matin|cet apres-midi|cette nuit|cette semaine|semaine prochaine|mois prochain|ce week-?end|d'ici|sous peu|bientot|rapidement|tres vite|au plus vite|brefs delais|incessamment)\b/;
const QTY = /\b(un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|quinze|vingt|trente|quarante|cinquante|soixante|cent|mille|quelques|plusieurs)\s+(?:[a-z'-]+\s+)?(minutes?|heures?|jours?|semaines?|mois|ans?|francs?|fcfa|xof)\b/;
const PROMISE = /\b(je (vous )?(le |la )?(garantis|promets)|c'est (garanti|promis)|(est|sont) garantie?s?|sans faute|a coup sur|100 ?%)/;
const PAY_CLAIM = /\bpaiement\b[^.!?]{0,40}\b(est|a ete|a bien ete)\s+(bien\s+|deja\s+)?(confirme|valide|recu|rapproche|enregistre)|\bvous avez (bien )?(paye|regle)\b/;
const ACTIVE_CLAIM = /\b(fibre|ligne|internet|connexion|service|abonnement)\b[^.!?]{0,40}\b(est|a ete)\s+(bien\s+|deja\s+|maintenant\s+)?(active|activee|actif|operationnel\w*|en service)\b/;
const CURRENCY = /(f ?cfa|fcfa|xof|\bfrancs?\b)/;
const LINK = /(https?:\/\/|www\.|\b[\w.-]+@[\w-]+\.[a-z]{2,})/;
const SECRET = /\b(mot de passe|code (secret|pin|recu|sms|de validation|de confirmation)|numero de (carte|compte)|cvv)\b/;
const REF = /\bfw-\d{4}-\d+\b/g;
const clean = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

export function checkAiAnswer(ctx, ai) {
  if (!ai || typeof ai !== 'object') return { ok: false, why: 'réponse illisible' };
  const answer = clean(ai.answer);
  if (answer.length < 2 || answer.length > 700) return { ok: false, why: 'réponse vide ou trop longue' };
  if (typeof ai.can_answer !== 'boolean' || !Object.hasOwn(ACTIONS, ai.action) || !Object.hasOwn(TOPIC_INTENT, ai.topic) || !Array.isArray(ai.cites)) return { ok: false, why: 'réponse illisible' };
  const ids = new Map(ctx.items.map(i => [i.id, i]));
  const cites = [...new Set(ai.cites.map(String))].slice(0, 12);
  const unknown = cites.find(c => !ids.has(c));
  if (unknown) return { ok: false, why: 'source inconnue (' + unknown.slice(0, 12) + ')' };
  if (ai.can_answer && !cites.length) return { ok: false, why: 'aucune source citée' };
  const cited = cites.map(c => ids.get(c));
  const allowed = norm(cited.map(i => i.title + ' ' + i.text).join(' '));
  // La référence du dossier du client est toujours permise (c'est la sienne).
  const allowedNums = new Set([...numbers(cited.map(i => i.text + ' ' + i.title).join(' ')), ...numbers(ctx.ref)]);
  const a = norm(answer);
  const badNum = numbers(answer).find(n => !allowedNums.has(n));
  if (badNum) return { ok: false, why: 'nombre absent des sources (' + badNum + ')' };
  for (const m of a.matchAll(DATE_WORD)) {
    const w = m[1] || m[2] || m[3];
    const key = DAYS[w] || MONTHS[w] || w;
    if (!new RegExp('\\b' + key).test(allowed)) return { ok: false, why: 'date absente des sources (' + w + ')' };
  }
  const soon = SOON.exec(a); if (soon && !allowed.includes(soon[0])) return { ok: false, why: 'promesse de délai (« ' + soon[0] + ' »)' };
  const qty = QTY.exec(a); if (qty && !allowed.includes(qty[0])) return { ok: false, why: 'durée absente des sources (« ' + qty[0] + ' »)' };
  if (PROMISE.test(a)) return { ok: false, why: 'promesse' };
  if (PAY_CLAIM.test(a) && !(ctx.payConfirmed && cites.includes('F4'))) return { ok: false, why: 'paiement présenté comme confirmé' };
  if (ACTIVE_CLAIM.test(a) && !(ctx.active && cites.includes('F7'))) return { ok: false, why: 'activation présentée comme faite' };
  if (/rembours/.test(a) && CURRENCY.test(a)) return { ok: false, why: 'montant de remboursement' };
  if (LINK.test(a)) return { ok: false, why: 'lien ou adresse' };
  if (SECRET.test(a)) return { ok: false, why: 'demande de code' };
  const otherRef = [...a.matchAll(REF)].map(m => m[0]).find(r => r !== norm(ctx.ref));
  if (otherRef) return { ok: false, why: 'autre dossier' };
  return { ok: true, value: { answer, cites, action: ai.action, canAnswer: ai.can_answer, topic: ai.topic } };
}

export const aiModelName = m => (typeof m === 'string' && /^claude-[a-z0-9-]{1,40}$/.test(m) ? m : AI_MODEL);
export const aiMs = ms => (Number.isFinite(Number(ms)) ? Math.max(0, Math.min(120000, Math.round(Number(ms)))) : null);

// Réponse montrée au client : le texte de l'IA, puis les éléments cités (avec leurs vraies sources et leur fraîcheur).
export function aiAnswerOf(ws, ctx, v, { question, model, ms }) {
  const ids = new Map(ctx.items.map(i => [i.id, i]));
  const blocks = v.cites.map(id => { const { id: cite, ...b } = ids.get(id); return { ...b, cite }; });
  let action = v.canAnswer ? ACTIONS[v.action] : { handoff: true };
  if (action && action.go && ctx.cancelled) action = null;
  const intent = v.canAnswer ? TOPIC_INTENT[v.topic] : null;
  return {
    trace: { question, at: ws.clock, intent, tools: ['lire_dossier(' + ctx.ref + ')', 'claude(' + model + ')'], refused: false, ai: model },
    ai: { model, ms, text: v.answer, abstain: !v.canAnswer, action },
    blocks,
    handoff: !v.canAnswer || v.action === 'conseiller',
  };
}

// ---------- Avis de l'IA sur une photo (pour la conseillère, qui décide) ----------
export function checkPhotoReview(x) {
  if (!x || typeof x !== 'object') return null;
  if (!['lisible', 'a_refaire', 'incertain'].includes(x.verdict) || !['oui', 'non', 'incertain'].includes(x.right_document)) return null;
  const issues = Array.isArray(x.issues) ? [...new Set(x.issues.filter(i => PHOTO_ISSUES.includes(i)))] : [];
  // Pas de donnée personnelle recopiée : les suites de chiffres de la note sont masquées.
  const note = clean(x.note).replace(/\d{3,}/g, '•••').slice(0, 200);
  let verdict = x.verdict;
  // « Lisible » mais avec un défaut ou une autre pièce : on ne tranche pas, la conseillère regarde.
  if (verdict === 'lisible' && (x.right_document === 'non' || issues.some(i => i !== 'specimen'))) verdict = 'incertain';
  if (verdict === 'a_refaire' && x.right_document === 'non' && !issues.includes('mauvaise_piece') && !issues.includes('pas_un_document')) issues.push('mauvaise_piece');
  return { verdict, rightDocument: x.right_document, issues, note };
}
