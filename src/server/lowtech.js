// Suivi sans smartphone : SMS (mots-clés) et code USSD simulés. Même dossier, mêmes règles que l'application :
// la personne ne voit que ses propres dossiers, aucune date n'est inventée, et tout message tient dans un SMS.
import { STATE_INFO, APPT_STATES } from './model.js';
import { estimate, fmtDate, fmtRange } from './ai.js';

export const SHORT_CODE = '1234';
export const USSD_CODE = '*123#';
const SLOT = { m: '8 h à 12 h', a: '13 h à 17 h' };
const plain = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
const cut = (s, n = 160) => (s.length <= n ? s : s.slice(0, n - 1).trimEnd() + '…');

// Dossiers actifs de la personne, le plus récemment mis à jour d'abord.
export const activeOrders = (ws, user, canSee) => ws.orders.filter(o => !o.cancelled && canSee(ws, user, o)).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

function facts(ws, order, kind) {
  const st = STATE_INFO[order.state];
  const appt = order.apptId && ws.appointments.find(a => a.id === order.apptId);
  if (kind === 'status') return order.ref + ' : ' + st.label + '. ' + st.client;
  if (kind === 'appt') {
    if (!appt) return order.ref + ' : aucun rendez-vous réservé pour l’instant.';
    return order.ref + ' : rendez-vous ' + APPT_STATES[appt.status].toLowerCase() + ' le ' + fmtDate(appt.date) + ', ' + (SLOT[appt.slot] || '') + '.';
  }
  const e = estimate(ws, order);
  if (e.abstain) return order.ref + ' : ' + e.reason;
  if (e.done) return order.ref + ' : l’installation est terminée, plus de délai à estimer.';
  return order.ref + ' : délai probable ' + fmtRange(e.loH, e.hiH) + ' (estimation, pas un engagement).';
}

// SMS entrant : un mot-clé, parfois suivi de la référence. Renvoie le texte de la réponse (160 caractères au plus).
export function smsReply(ws, user, canSee, text, { callback, setSms }) {
  const t = plain(text);
  const word = t.split(' ')[0] || '';
  const ref = (t.match(/FW-\d{4}-\d+/) || [])[0] || null;
  const KEYS = { SUIVI: 'status', STATUT: 'status', DOSSIER: 'status', RDV: 'appt', VISITE: 'appt', DELAI: 'delay', QUAND: 'delay', RAPPEL: 'callback', RAPPELEZ: 'callback' };
  if (word === 'AIDE' || word === 'HELP' || word === '') return { text: 'Moov Fibre : SUIVI, RDV, DELAI ou RAPPEL (ajoutez votre référence si vous avez plusieurs dossiers). STOP pour ne plus recevoir de SMS.', kind: 'aide' };
  if (word === 'STOP') { setSms(false); return { text: 'Moov Fibre : vous ne recevrez plus de SMS de suivi. Envoyez REPRENDRE pour les recevoir à nouveau.', kind: 'stop' }; }
  if (word === 'REPRENDRE') { setSms(true); return { text: 'Moov Fibre : les SMS de suivi sont réactivés.', kind: 'reprise' }; }
  const kind = KEYS[word];
  if (!kind) return { text: 'Moov Fibre : message non compris. Envoyez AIDE pour voir les mots possibles.', kind: 'inconnu' };
  const list = activeOrders(ws, user, canSee);
  if (!list.length) return { text: 'Moov Fibre : aucun dossier en cours pour ce numéro. Un conseiller peut vous aider au service client.', kind: 'aucun' };
  let order = list[0];
  if (ref) { order = list.find(o => o.ref.toUpperCase() === ref); if (!order) return { text: 'Moov Fibre : référence non reconnue pour ce numéro. Vérifiez-la ou envoyez SUIVI seul.', kind: 'ref' }; }
  // Plusieurs dossiers sans référence : on répond pour le plus récent et on rappelle comment viser l'autre.
  const other = !ref && list.length > 1 ? ' Autre dossier : ' + list[1].ref + ' (ajoutez la référence).' : '';
  if (kind === 'callback') { callback(order, 'Demande faite par SMS'); return { text: cut('Moov Fibre : demande enregistrée pour ' + order.ref + '. Un conseiller vous rappelle dès que possible.' + other), kind, order }; }
  return { text: cut('Moov Fibre ' + facts(ws, order, kind) + other), kind, order };
}

// USSD : l'écran suivant selon les touches déjà tapées (path). Aucun état gardé sur le serveur.
export function ussdScreen(ws, user, canSee, { code, path }, { callback }) {
  if (code != null && plain(code).replace(/\s/g, '') !== USSD_CODE) return { text: 'Code non reconnu. Composez ' + USSD_CODE + '.', end: true };
  const list = activeOrders(ws, user, canSee).slice(0, 3);
  if (!list.length) return { text: 'Moov Fibre\nAucun dossier en cours pour ce numéro.', end: true };
  const steps = (Array.isArray(path) ? path : []).map(x => String(x).trim()).slice(0, 4);
  const pickScreen = () => ({ text: 'Moov Fibre\nVotre dossier :\n' + list.map((o, i) => (i + 1) + ' ' + o.ref).join('\n') + '\n0 Quitter', end: false });
  const menu = o => ({ text: 'Moov Fibre ' + o.ref + '\n1 Où en est mon dossier\n2 Mon rendez-vous\n3 Délai estimé\n4 Être rappelé\n0 Quitter', end: false, order: o });
  let order = list[0], rest = steps;
  if (list.length > 1) {
    if (!steps.length) return pickScreen();
    if (steps[0] === '0') return { text: 'Merci. Au revoir.', end: true };
    order = list[Number(steps[0]) - 1];
    if (!order) return { ...pickScreen(), text: 'Choix invalide.\n' + pickScreen().text };
    rest = steps.slice(1);
  }
  if (!rest.length) return menu(order);
  const c = rest[0];
  if (c === '0') return { text: 'Merci. Au revoir.', end: true };
  if (c === '1') return { text: cut(facts(ws, order, 'status'), 182), end: true, order, action: 'suivi' };
  if (c === '2') return { text: cut(facts(ws, order, 'appt'), 182), end: true, order, action: 'rdv' };
  if (c === '3') return { text: cut(facts(ws, order, 'delay'), 182), end: true, order, action: 'delai' };
  if (c === '4') { callback(order, 'Demande faite par USSD'); return { text: 'Demande de rappel enregistrée pour ' + order.ref + '. Un conseiller vous rappelle. Merci.', end: true, order, action: 'rappel' }; }
  return { text: 'Choix invalide.\n' + menu(order).text, end: false, order };
}
