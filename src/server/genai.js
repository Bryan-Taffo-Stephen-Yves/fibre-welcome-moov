// IA générative (Claude) sous garde-fou : ce que l'IA a le droit de savoir, et le contrôle de ce qu'elle répond.
// Le serveur simulé ne parle jamais à Internet. Le navigateur lit le contexte du dossier (assistant.context), l'envoie
// à la fonction « fw-ia » (Supabase) qui appelle Claude avec la clé gardée côté serveur, puis rapporte la réponse
// (assistant.ask, champ ai). Avant de la montrer, on la vérifie ici avec l'état réel du dossier :
// - chaque source citée existe, et au moins une est citée quand l'IA répond ;
// - chaque nombre, date, jour, heure, durée, montant ou référence existe, avec le même rôle, dans une source citée
//   (le « 12 » de « 8 h – 12 h » n'autorise pas un « 12 septembre ») ; un délai tiré de l'estimation est dit estimé ;
// - aucune date pour l'activation, le paiement ou le remboursement : aucune source ne les date ;
// - pas de promesse de délai, pas de paiement ni d'activation présentés comme confirmés si le dossier ne le dit pas ;
// - jamais de montant ni de délai de remboursement, de lien, ni de demande de code.
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
  // Seule la liste des pièces (des libellés fixes) est reprise. La précision d'adresse est un texte libre, écrit par le
  // client ou par l'équipe, qui peut contenir une adresse ou un numéro : elle ne part pas chez Claude.
  const detail = b.type === 'PIECE_MANQUANTE' && b.detail ? ' Pièce(s) attendue(s) : ' + b.detail + '.' : '';
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
  // Tant que Moov n'a pas rapproché le paiement, le montant est « attendu », pas « payé ».
  const paid = ['confirme', 'rembourse_demande', 'rembourse_valide', 'rembourse'].includes(pay.status);
  add('F4', 'fact', 'Paiement', 'Paiement : ' + String(PAYMENT_STATES[pay.status] || pay.status || 'inconnu').toLowerCase() + '.' + (pay.amount ? (paid ? ' Montant payé : ' : ' Montant attendu : ') + money(pay) + '.' : '') + (pay.ref && !delegate ? ' Référence ' + pay.ref + '.' : ''), { source: 'Connecteur Moov Money (simulé)', fresh });
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
const norm = s => String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’‘`´]/g, "'").replace(/[   ]/g, ' ');
// Même écriture pour toutes les heures et tous les nombres : « 1.5 » devient « 1,5 », « 10:00 » et « 8h30 » deviennent
// « 10 h 00 » et « 8 h 30 », « midi » devient « 12 h ».
const prep = t => norm(t).replace(/(\d)\.(\d{1,2})(?!\d)/g, '$1,$2').replace(/\b(\d{1,2}):(\d{2})\b/g, '$1 h $2').replace(/(\d)\s*h\s*(\d{2})\b/g, '$1 h $2')
  .replace(/(?<!apres[- ])\bmidi\b/g, '12 h').replace(/\bminuit\b/g, '0 h');
const MONTHS = { janvier: 1, janv: 1, fevrier: 2, fevr: 2, fev: 2, mars: 3, avril: 4, avr: 4, mai: 5, juin: 6, juillet: 7, juil: 7, aout: 8, septembre: 9, sept: 9, octobre: 10, oct: 10, novembre: 11, nov: 11, decembre: 12, dec: 12 };
const DAYS = { lundi: 1, lun: 1, mardi: 2, mar: 2, mercredi: 3, mer: 3, jeudi: 4, jeu: 4, vendredi: 5, ven: 5, samedi: 6, sam: 6, dimanche: 7, dim: 7 };
const MW = Object.keys(MONTHS).join('|');
const DW = '\\b(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\\b|\\b(lun|mar|mer|jeu|ven|sam|dim)\\.';
const UNITS = { h: 'h', heure: 'h', heures: 'h', j: 'j', jour: 'j', jours: 'j', sem: 'sem', semaine: 'sem', semaines: 'sem', mois: 'mois', min: 'min', minute: 'min', minutes: 'min', an: 'an', ans: 'an' };
// Une quantité : nombre, unité, et minutes seulement après une heure (« 9 h 30 »).
const QU = '(?:(heures?|h)\\b(?: (\\d{2})\\b)?|(jours?|j|semaines?|sem|mois|minutes?|min|ans?)\\b)';
const RANGE_RE = new RegExp("(?:\\b(?:entre|de|du)\\s+)?(\\d+(?:,\\d+)?)(?:\\s*" + QU + ")?\\s*(?:-|–|—|\\ba\\b|\\bau\\b|\\bet\\b|jusqu'a)\\s*(\\d+(?:,\\d+)?)\\s*" + QU, 'g');
const SINGLE_RE = new RegExp('(\\d+(?:,\\d+)?)\\s*' + QU, 'g');
const val = x => String(Number(String(x).replace(/[ .]/g, '').replace(',', '.')));
const qty = (v, hu, mm, ou) => (hu ? val(v) + (mm && mm !== '00' ? ':' + mm : '') + 'h' : val(v) + (ou ? UNITS[ou] : ''));
const START = /\b(entre|de|des|a partir de|apres|pas avant)\s*$/, END = /\b(et|jusqu'a|avant|au plus tard a)\s*$/;
const DURATION = /\b(dans|sous|encore|reste\w*|restant|delai|duree|pendant|environ|d'ici|en)\s+(?:(?:de|d'|les|la|un|une|au moins|moins de|plus de)\s+)?$/;

// Les faits chiffrés ou datés d'un texte, chacun avec son rôle : référence, montant, date, heure ou durée, fourchette,
// jour de la semaine, mois, nombre seul. Un nombre lu dans un rôle ne peut pas resservir dans un autre : le « 12 » de
// « 12 h » n'autorise pas un « 12 septembre ».
function facts(text) {
  let s = prep(text);
  const src = s, toks = [];
  const take = (re, fn) => {
    s = s.replace(re, (...m) => {
      const i = m[m.length - 2], t = fn(m, i);
      if (!t) return m[0];
      toks.push({ ...t, i, txt: m[0].trim() });
      return '#'.repeat(m[0].length);
    });
  };
  take(/\bfw-\d{4}-\d+\b/g, m => ({ t: 'fw', k: m[0] }));
  take(/\b[a-z]{1,5}-\d{3,}\b/g, m => ({ t: 'ref', k: m[0] }));
  take(/(\d{1,3}(?:[ .]\d{3})+|\d+)\s*(f ?cfa|fcfa|cfa|xof|francs?|f)\b/g, m => ({ t: 'money', k: val(m[1]) }));
  take(new RegExp('\\b(\\d{1,2})(?:er)?\\s+(' + MW + ')\\b\\.?(?:\\s+(\\d{4})\\b)?', 'g'), m => ({ t: 'date', k: val(m[1]) + '/' + MONTHS[m[2]], year: m[3] }));
  take(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g, m => ({ t: 'date', k: val(m[1]) + '/' + val(m[2]), year: m[3] }));
  take(RANGE_RE, (m, i) => {
    const b = qty(m[5], m[6], m[7], m[8]), a = qty(m[1], m[2], m[3], m[4] || (!m[2] ? m[8] : '')) + (!m[2] && !m[4] && m[6] ? 'h' : '');
    return { t: 'range', k: a + '-' + b, ends: [a, b], h: !!(m[2] || m[6]), dur: DURATION.test(src.slice(Math.max(0, i - 30), i)) || !!m[8] };
  });
  take(SINGLE_RE, (m, i) => {
    const before = src.slice(Math.max(0, i - 30), i);
    return { t: 'q', k: qty(m[1], m[2], m[3], m[4]), h: !!m[2], dur: !!m[4] || DURATION.test(before), lim: START.test(before) ? 0 : END.test(before) ? 1 : null };
  });
  take(new RegExp("\\b(?:le|du|au|jusqu'au|ce|des le|avant le|apres le|" + Object.keys(DAYS).filter(d => d.length > 3).join('|') + '|(?:lun|mar|mer|jeu|ven|sam|dim)\\.)\\s+(\\d{1,2})(?:er)?\\b', 'g'), m => ({ t: 'day', k: val(m[1]) }));
  for (const m of s.matchAll(new RegExp(DW, 'g'))) toks.push({ t: 'wd', k: String(DAYS[m[1] || m[2]]), i: m.index, txt: m[0] });
  take(new RegExp('\\b(' + MW + ')\\b', 'g'), m => ({ t: 'month', k: String(MONTHS[m[1]]) }));
  take(/\d{1,3}(?:[ .]\d{3})+(?!\d)|\d+(?:,\d+)?/g, m => ({ t: 'n', k: val(m[0]) }));
  for (const t of toks) if (t.t === 'date' && t.year) toks.push({ t: 'year', k: val(t.year), i: t.i, txt: t.year });
  return { s: src, toks };
}

// Coupe un texte en phrases (les points des abréviations « mar. » ou « sept. » ne comptent pas), ou en morceaux de
// phrase (virgule, deux-points, parenthèse, « puis »).
const ABBR = /(?:^|[^a-z])(lun|mar|mer|jeu|ven|sam|dim|janv|fevr|fev|avr|juil|sept|oct|nov|dec|env|etc|m|mme|ref|n)$/;
function cuts(s, parts) {
  const out = [];
  let a = 0;
  for (let i = 0; i <= s.length; i++) {
    const c = s[i];
    let cut = i === s.length || c === '!' || c === '?' || c === ';' || (c === '.' && !/\d/.test(s[i + 1] || '') && !ABBR.test(s.slice(a, i)));
    if (parts && !cut) cut = (c === ',' && !(/\d/.test(s[i - 1] || '') && /\d/.test(s[i + 1] || ''))) || c === ':' || c === '(' || c === ')' || s.startsWith(' puis ', i);
    if (cut) { out.push([a, i]); a = i + 1; }
  }
  return out;
}
const spanAt = (spans, i) => spans.find(([a, b]) => i >= a && i <= b) || [i, i];

const SOON = /\b(aujourd'hui|demain|apres-demain|hier|ce soir|ce matin|cet apres-midi|cette nuit|cette semaine|semaine prochaine|mois prochain|ce week-?end|d'ici|sous peu|bientot|rapidement|tres vite|au plus vite|brefs delais|incessamment|prochainement|(dans |au cours )?(les|des) prochain(e)?s|dans la (journee|matinee|soiree|semaine)|dans l'heure|en fin de (journee|semaine|mois)|fin de (semaine|mois)|tout de suite|immediatement|sans tarder|sans delai|d'un jour a l'autre|le (meme|jour) (jour|meme)|dans la foulee|aussitot|a court terme)\b/;
const QTY = /\b(un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|quinze|vingt|trente|quarante|cinquante|soixante|cent|mille|quelques|plusieurs)\s+(?:[a-z'-]+\s+)?(minutes?|heures?|jours?|semaines?|mois|ans?|francs?|fcfa|xof)\b/;
const PROMISE = /\b(je (vous )?(le |la )?(garantis|promets)|c'est (garanti|promis|certain|sur et certain)|c'est sur(?= *[.!,;]|$)|(est|sont) garantie?s?|sans faute|a coup sur|100 ?%|je vous (l'|le )?assure|soyez (assuree?s?|certaine?s?|sure?s?)|sans aucun doute|(s'engage|nous engageons|m'engage)\b|assurement)/;
// Une date ou une heure ne peut pas être attachée à l'activation, à la confirmation du paiement ou au remboursement :
// aucune source ne les date. Elle peut l'être à la visite (« le technicien viendra le mar. 29 sept. »).
const EVENT = /\b(activ\w*|actif|operationnel\w*|en service|connecte\w*|fonctionnera|marchera|rembours\w*|rapproch\w*)\b|\bpaiement\b[^.!?;,]{0,25}\b(sera|seront|va etre)\b/;
const VISIT = /\b(technicien\w*|visite|rendez-vous|rdv|creneau|passage|passera|viendra|vient|venir|intervention|installateur)\b/;
const REFUND = /\b(rembours\w*|restitu\w*|recuper\w*|integralement|integralite|totalite)\b|\bvous (rendr(a|ont|ait|aient)|sera rendue?s?|seront rendue?s?)\b/;
const AMOUNTISH = /\b(integral\w*|totalite|tout votre argent|toute la somme|votre argent|la somme (payee|versee|reglee)|le montant (paye|verse|regle|total))\b/;
const HEDGE = /\b(estim\w*|probabl\w*|environ|en principe|pas (un |d'|une )?(engagement|promesse|garantie)|sans garantie|indicati\w*|prevision\w*|devrai(t|ent)|pourrai(t|ent)|a titre)\b/;
// Paiement confirmé ou ligne active, dans les tournures courantes (« Moov a bien reçu votre paiement » aussi).
const PAY_CLAIM = [
  /\b(paiement|reglement|versement|argent)\b[^.!?;]{0,40}?\b(est|a ete|a bien ete|etait)\s+(bien\s+|deja\s+|maintenant\s+|desormais\s+)?(confirme|valide|recu|rapproche|enregistre|accepte|verifie|passe|arrive|en ordre|pris en compte)\b/g,
  /\b(tout est|c'est) (bon|en ordre|regle|ok)\b[^.!?;]{0,30}?\bpaiement\b|\bpaiement\b[^.!?;]{0,30}?\b(tout est|c'est) (bon|en ordre|regle|ok)\b/g,
  /\b(a|ont|avons)\s+(bien\s+|deja\s+)?(recu|confirme|valide|rapproche|enregistre|accepte|verifie)\b[^.!?;]{0,30}?\b(paiement|reglement|versement|argent|somme)\b/g,
  /\bvous avez (bien |deja )?(paye|regle|verse)\b/g,
  /\b(paiement|reglement)\s+(bien\s+)?(confirme|valide|recu|accepte|rapproche)\b/g,
];
const ACTIVE_CLAIM = [
  /\b(fibre|ligne|internet|connexion|service|abonnement|acces)\b[^.!?;]{0,40}?\b(est|a ete|a bien ete|sont|ont ete)\s+(bien\s+|deja\s+|maintenant\s+|desormais\s+)?(active|activee|actif|actives|activees|operationnel\w*|en service|ouverte?|fonctionnel\w*|disponible|prete?|en marche|en ligne)\b/g,
  /\b(a|ont|avons)\s+(bien\s+|deja\s+)?(active|ouvert|mis en service)\b[^.!?;]{0,30}?\b(fibre|ligne|internet|connexion|service|abonnement|acces)\b/g,
  /\bvous etes (bien |deja |maintenant |desormais )?connecte/g,
  /\b(internet|fibre|connexion|ligne)\b[^.!?;]{0,20}?\b(fonctionne|marche)\b/g,
];
// Ce n'est pas une affirmation quand c'est nié (« n'est pas encore active ») ou soumis à une condition (« une fois que
// votre paiement est confirmé », « il est confirmé seulement quand… », « Après l'installation, la ligne est activée… »).
const NEG = /\bne\b|\bn'|\bpas\b|\bjamais\b|\baucune?\b/;
const COND = /\b(une fois|des que|quand|lorsque|si|s'il|apres que|avant que|tant que|jusqu'a ce que|pour que|afin que)\b/;
const STEP = /\b(activ\w*|install\w*|visite|paiement|rapproch\w*|confirm\w*|valid\w*|passage)\b/;
const AFTER_STEP = /\bapres (l'|la |le |votre )?(installation|visite|passage|intervention|activation)\b/;
const COND_AFTER = /^[^.!?;,]{0,15}?\b(seulement|uniquement|qu'apres|que lorsque|que quand|que si|qu'une fois|quand|lorsque|une fois|des que|apres)\b/;
function claimed(s, res) {
  const sents = cuts(s, false), parts = cuts(s, true);
  for (const re of res) for (const m of s.matchAll(re)) {
    const [p] = spanAt(parts, m.index), [st] = spanAt(sents, m.index);
    const before = s.slice(p, m.index);
    if (NEG.test(before.slice(-25) + ' ' + m[0]) || COND.test(before) || AFTER_STEP.test(s.slice(Math.max(st, p - 45), m.index))) continue;
    const lead = s.slice(st, p);
    if (lead && COND.test(lead.slice(0, 12)) && STEP.test(lead)) continue;
    if (/\best\b/.test(m[0]) && !/\ba (bien )?ete\b/.test(m[0]) && COND_AFTER.test(s.slice(m.index + m[0].length))) continue;
    return true;
  }
  return false;
}
const LINK = /(https?:\/\/|www\.|\b[\w.-]+@[\w-]+\.[a-z]{2,})/;
const SECRET_WORD = /\b(mot de passe|cvv|cryptogramme|numero de (carte|compte)|code (secret|pin|confidentiel|otp|moov money|recu|sms|de validation|de confirmation|d'acces)|code que vous avez recu)\b/;
const SECRET_ASK = /\b(donnez|envoyez|communiquez|indiquez|transmettez|saisissez|entrez|tapez|dictez|fournissez|partagez|precisez|confirmez|ecrivez|redonnez)(-moi|-nous| moi| nous)?\b[^.!?;]{0,40}?\b(code|mot de passe|pin|numero de carte|cvv)\b/g;
const clean = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const dateLike = t => ['date', 'day', 'wd', 'month', 'year'].includes(t.t) || ((t.t === 'q' || t.t === 'range') && t.h && !t.dur);
const shown = t => t.txt.replace(/#/g, '').trim();

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
  const bad = why => ({ ok: false, why });
  const cited = cites.map(c => ids.get(c));
  const allowed = norm(cited.map(i => i.title + ' ' + i.text).join(' '));
  const known = cited.flatMap(i => facts(i.title + ' : ' + i.text).toks.map(t => ({ ...t, kind: i.kind })));
  const refNums = facts(ctx.ref).toks;
  const { s: a, toks } = facts(answer);

  // 1. Chaque fait chiffré ou daté de la réponse existe, avec le même rôle, dans une source citée.
  let onlyEstimate = false;
  for (const t of toks) {
    if (t.t === 'fw') { if (t.k !== norm(ctx.ref)) return bad('autre dossier'); continue; }
    const kinds = new Set(), from = pred => known.forEach(c => pred(c) && kinds.add(c.kind));
    if (t.t === 'day') from(c => (c.t === 'day' && c.k === t.k) || (c.t === 'date' && c.k.split('/')[0] === t.k));
    else if (t.t === 'month') from(c => (c.t === 'month' && c.k === t.k) || (c.t === 'date' && c.k.split('/')[1] === t.k));
    else if (t.t === 'q') {
      from(c => c.t === 'q' && c.k === t.k);
      // « entre 8 h et midi », « à partir de 8 h » : une borne de la fourchette citée, du bon côté.
      if (!kinds.size && t.lim != null) from(c => c.t === 'range' && c.ends[t.lim] === t.k);
    } else if (t.t === 'n') from(c => (c.t === 'n' || c.t === 'money') && c.k === t.k);
    else from(c => c.t === t.t && c.k === t.k);
    if (!kinds.size && t.t === 'n' && refNums.some(r => r.k.split('-').includes(t.k))) kinds.add('fact');
    if (!kinds.size) {
      const what = { money: 'montant', date: 'date', day: 'date', wd: 'jour', month: 'mois', year: 'année', q: t.h ? 'heure ou durée' : 'durée', range: 'fourchette', ref: 'référence', n: 'nombre' }[t.t];
      return bad(what + ' absent' + (['date', 'day', 'heure ou durée', 'durée', 'fourchette', 'référence', 'année'].includes(what) ? 'e' : '') + ' des sources (' + shown(t) + ')');
    }
    if ([...kinds].every(k => k === 'estimate') && t.t !== 'n') onlyEstimate = true;
  }
  // 2. Un délai tiré de l'estimation reste une estimation : la réponse doit le dire.
  if (onlyEstimate && !HEDGE.test(a)) return bad('estimation présentée comme un engagement');
  const sents = cuts(a, false), parts = cuts(a, true);
  const inSent = ([x, y]) => toks.filter(t => t.i >= x && t.i <= y);
  for (const [x, y] of sents) {
    const sent = a.slice(x, y);
    // 3. Pas de date pour l'activation, le paiement ou le remboursement.
    if (EVENT.test(sent)) for (const t of inSent([x, y]).filter(dateLike)) {
      const [p, q] = spanAt(parts, t.i), part = a.slice(p, q);
      if (EVENT.test(part) || !VISIT.test(part)) return bad('date ou heure non prévue par le dossier (' + shown(t) + ')');
    }
    // 4. Jamais de montant ni de délai de remboursement.
    if (REFUND.test(sent) && (AMOUNTISH.test(sent) || inSent([x, y]).some(t => ['money', 'n', 'q', 'range'].includes(t.t)))) return bad('montant ou délai de remboursement');
  }
  const soon = SOON.exec(a); if (soon && !allowed.includes(soon[0])) return bad('promesse de délai');
  const qtyW = QTY.exec(a); if (qtyW && !allowed.includes(qtyW[0])) return bad('durée absente des sources');
  if (PROMISE.test(a)) return bad('promesse');
  if (claimed(a, PAY_CLAIM) && !(ctx.payConfirmed && cites.includes('F4'))) return bad('paiement présenté comme confirmé');
  // Une ligne active se lit dans l'activation (F7) ou dans l'étape du dossier (F1 dit alors « Votre fibre est active »).
  if (claimed(a, ACTIVE_CLAIM) && !(ctx.active && (cites.includes('F7') || cites.includes('F1')))) return bad('activation présentée comme faite');
  if (LINK.test(a)) return bad('lien ou adresse');
  for (const m of a.matchAll(SECRET_ASK)) if (!/\b(ne|n')\s*$|\bn'$/.test(a.slice(Math.max(0, m.index - 4), m.index)) && !/\bjamais\b/.test(m[0])) return bad('demande de code');
  for (const [x, y] of sents) { const sent = a.slice(x, y); if (SECRET_WORD.test(sent) && !/\bjamais\b|\bne\b[^.!?;]*\bpas\b|\bn'[^.!?;]*\bpas\b/.test(sent)) return bad('demande de code'); }
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
  // Une question hors des sujets connus mais à laquelle Claude répond n'est pas une abstention.
  const intent = v.canAnswer ? TOPIC_INTENT[v.topic] || 'other' : null;
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
  // Pas de donnée personnelle recopiée : tous les chiffres de la note sont masqués (numéro, date de naissance).
  const note = clean(x.note).replace(/\d/g, '•').slice(0, 200);
  let verdict = x.verdict;
  // « Lisible » mais avec un défaut, ou sans être sûr que c'est la bonne pièce : on ne tranche pas, la conseillère regarde.
  if (verdict === 'lisible' && (x.right_document !== 'oui' || issues.some(i => i !== 'specimen'))) verdict = 'incertain';
  if (verdict === 'a_refaire' && x.right_document === 'non' && !issues.includes('mauvaise_piece') && !issues.includes('pas_un_document')) issues.push('mauvaise_piece');
  return { verdict, rightDocument: x.right_document, issues, note };
}
