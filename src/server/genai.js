// IA générative (Claude) sous garde-fou : ce que l'IA a le droit de savoir, et le contrôle de ce qu'elle répond.
// Le serveur simulé ne parle jamais à Internet. Le navigateur lit le contexte du dossier (assistant.context), l'envoie
// à la fonction « fw-ia » (Supabase) qui appelle Claude avec la clé gardée côté serveur, puis rapporte la réponse
// (assistant.ask, champ ai). Avant de la montrer, on la vérifie ici avec l'état réel du dossier :
// - Claude n'écrit aucune phrase : il choisit des repères, que l'application remplace par le texte exact d'un élément
//   du dossier (« {F3} ») ou par une phrase d'un recueil approuvé (« {P12} ») ;
// - chaque phrase est à sa place (juste avant l'élément qu'elle introduit) et vraie pour ce dossier ;
// - chaque source citée existe, et au moins un élément est inséré quand l'IA répond.
// Sinon, le client voit la réponse par règles et le journal garde le motif. Le contexte ne contient ni nom,
// ni téléphone, ni adresse : l'IA n'en a pas besoin.
import { STATE_INFO, BLOCKER_TYPES, APPT_STATES, PAYMENT_STATES, SLOTS, hourLabel, PHOTO_ISSUES, ORDER_STATES } from './model.js';
import { estimate, fmtDate, fmtDateTime, fmtRange, fmtAgo } from './ai.js';
import { dossierState, canPlan, missionUnderway } from './domain.js';
import { PHRASES } from '../../supabase/functions/fw-ia/logic.js';

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
// Chaque élément a un identifiant stable que l'IA doit citer. rdv : la personne peut gérer le rendez-vous (un
// représentant seulement si sa délégation le permet).
export function aiContext(ws, order, { delegate = false, rdv = true } = {}) {
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
  // Tant que Moov n'a pas rapproché le paiement, le montant est « attendu », pas « payé » : le client ne doit pas payer
  // une seconde fois. Sur une commande annulée, plus rien n'est attendu.
  const paid = ['confirme', 'rembourse_demande', 'rembourse_valide', 'rembourse'].includes(pay.status);
  add('F4', 'fact', 'Paiement', order.cancelled && !paid ? 'Paiement : aucun paiement n’est attendu, la commande est annulée.'
    : 'Paiement : ' + String(PAYMENT_STATES[pay.status] || pay.status || 'inconnu').toLowerCase() + '.' + (pay.amount ? (paid ? ' Montant payé : ' : ' Montant attendu : ') + money(pay) + '.' : '') + (pay.ref && !delegate ? ' Référence ' + pay.ref + '.' : '')
      + (pay.status === 'en_attente' ? ' Moov vérifie ce paiement : ne payez pas une seconde fois.' : ''), { source: 'Connecteur Moov Money (simulé)', fresh });
  const ds = dossierState(ws, order);
  if (ds) add('F5', 'fact', 'Dossier en ligne', dossierText(ds), { source: src, fresh });
  const wo = order.woId && ws.workOrders.find(w => w.id === order.woId);
  if (wo && MISSION_TEXT[wo.status]) add('F6', 'fact', 'Visite du technicien', MISSION_TEXT[wo.status], { source: 'Application du technicien', fresh });
  const act = ws.activations.filter(a => a.orderId === order.id).at(-1);
  const active = ['SERVICE_ACTIF', 'CLOTURE'].includes(order.state);
  add('F7', 'fact', 'Activation de la ligne', active ? 'Le système de Moov a confirmé l’activation : la fibre est active.' : act && ACTIVATION_TEXT[act.status] ? ACTIVATION_TEXT[act.status] : 'L’activation n’est pas encore demandée : elle vient après l’installation.', { source: 'Système d’activation de Moov (simulé)', fresh });
  const underway = missionUnderway(ws, order);
  const refund = ws.refunds.filter(r => r.orderId === order.id).at(-1);
  const cancelling = !order.cancelled && !!refund && refund.status !== 'rejete';
  // Technicien en route ou annulation en cours : un délai en jours n'a plus de sens, l'IA ne doit pas en donner.
  if (underway) add('E1', 'abstain', 'Estimation', 'Le technicien est en route ou chez vous : pas d’estimation de délai.');
  else if (cancelling) add('E1', 'abstain', 'Estimation', 'Une annulation de la commande est en cours : pas d’estimation de délai.');
  else if (!order.cancelled) {
    const e = estimate(ws, order);
    if (e.abstain) add('E1', 'abstain', 'Estimation', e.reason);
    else if (!e.done) add('E1', 'estimate', 'Estimation (ce n’est pas un engagement)', 'Il reste probablement ' + fmtRange(e.loH, e.hiH) + ' (fiabilité ' + e.reliability + '). Calcul du modèle ' + e.modelVersion + ', entraîné sur des données synthétiques.' + (e.risk ? ' ' + e.risk : ''), { source: 'Modèle ' + e.modelVersion });
  }
  // Ce que l'application permet vraiment (mêmes règles que les onglets Rendez-vous et Préparer) : les phrases de l'IA
  // qui en parlent ne sont acceptées que dans ces cas, et les procédures qui ne s'appliquent plus ne partent pas.
  const equipBlocked = !!ws.sim.equipmentShortage && ws.config.policyEquipment === 'bloquer';
  const plan = canPlan(order) && !underway && !cancelling && !equipBlocked && rdv;
  const prep = !order.cancelled && ORDER_STATES.indexOf(order.state) < ORDER_STATES.indexOf('INSTALLATION_TERMINEE');
  const skip = { 'PR-03': !prep, 'PR-04': order.cancelled || underway };
  for (const d of ws.docs) if (d.scope === 'public' && PROCEDURE_TEXT[d.id] && !(d.expires < now) && !skip[d.id]) add(d.id, 'doc', 'Procédure « ' + d.title + ' »', PROCEDURE_TEXT[d.id], { doc: { id: d.id, title: d.title, version: d.version } });
  if (stale) add('W1', 'warn', 'Attention', 'Le lien avec Moov Prospect est interrompu : le statut affiché peut être ancien.');
  // Mise en garde que Claude peut insérer (il n'écrit jamais lui-même le mot « code »). Le code de réception, lui, se
  // donne bien au technicien à la fin de la visite : la mise en garde le dit, pour ne pas bloquer l'installation.
  add('S1', 'warn', 'Sécurité', 'Moov ne vous demande jamais votre code secret Moov Money, ni de payer sur un autre numéro ou par un lien. Ne donnez à personne un code reçu par SMS, sauf votre code de réception : au technicien, chez vous, à la fin de la visite.');
  // Ce que le client doit savoir dès que l'IA répond : un point bloquant, des pièces à envoyer, des données anciennes.
  // Si Claude ne l'a pas inséré, l'application l'ajoute à la fin de la réponse.
  const mustShow = [openB.length && 'F2', ds && ds.missing.length && !ds.submittedAt && 'F5', stale && 'W1'].filter(Boolean);
  return { ref: order.ref, items, cancelled: !!order.cancelled, payConfirmed: pay.status === 'confirme', active, canPlan: plan, canPrep: prep, delegate, mustShow };
}
// Ce qui part vers la fonction (et donc vers Claude) : identifiant, nature, titre et texte. Rien d'autre.
export const aiPayloadItems = ctx => ctx.items.map(({ id, kind, title, text }) => ({ id, kind, title, text }));

// ---------- Garde-fou ----------
// Claude n'écrit aucune phrase lui-même : sa réponse est une suite de repères. « {F3} » devient le texte exact de
// l'élément F3 du dossier, « {P12} » une phrase du recueil approuvé (PHRASES, dans la fonction fw-ia). Un élément ou une
// phrase recopiés en entier, mot pour mot, comptent aussi. Tout autre mot fait écarter la réponse : les dates, heures,
// montants, états, procédures et mises en garde montrés au client viennent donc toujours tels quels du dossier, et le
// reste du texte a été écrit et relu à l'avance.
const TOPIC_INTENT = { statut: 'status', attente: 'why', preparation: 'prepare', rendez_vous: 'appt', delai: 'when', paiement: 'payment', activation: 'activation', annulation: 'refund', conseiller: 'human', hors_sujet: null, autre: null };
const ACTIONS = { aucune: null, preparer: { go: 'prep' }, rendez_vous: { go: 'rdv' }, conseiller: { handoff: true } };
// Écriture commune : minuscules, sans accents ni caractères invisibles, mêmes apostrophes, tirets et espaces partout
// (NFKD ramène aussi les chiffres et lettres « décoratifs » à leur forme simple).
const norm = s => String(s == null ? '' : s).normalize('NFKD').toLowerCase().replace(/[\u0300-\u036f]/g, '').replace(/[\u00ad\u200b-\u200d\u2060\ufeff]/g, '')
  .replace(/[\u2019\u2018`\u00b4\u02bc\u2032]/g, "'").replace(/[\u2010-\u2015\u2212]/g, '-').replace(/\s+/g, ' ').trim();
const clean = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const MARK = /\{\s*([a-z][a-z0-9-]{0,11})\s*\}/y;
const SEP = /[\s.,;:!?\u2026\u00ab\u00bb"'()/-]+/y;
// Renvoi entre parenthèses (« (F3) », « [source : PR-04] ») : une simple citation, retirée du texte.
// (« et » seulement entre deux espaces : sinon un long mot plein de « et » sans parenthèse fermante bloquait la page.)
const NOTE = /\s*[([]\s*(?:sources?|voir|cf\.?)?\s*:?\s*([A-Z][A-Z0-9-]{0,11}(?:(?:\s*[,;]\s*|\s+et\s+)[A-Z][A-Z0-9-]{0,11})*)\s*[)\]]/gi;
// Ce que l'élément inséré affiche : son texte, précédé d'un mot quand il n'est pas un fait.
const sayOf = i => (i.kind === 'estimate' ? 'Estimation (ce n’est pas un engagement) : ' + i.text.charAt(0).toLowerCase() + i.text.slice(1) : i.text);
const bare = s => norm(s).replace(/[.!?:\s]+$/, '');
const PHRASE = new Map(PHRASES.map(p => [p.id, p]));
const PHRASE_BARE = PHRASES.map(p => ({ id: p.id, key: bare(p.text) }));
// Conditions des phrases (« when ») : la phrase n'est vraie que dans ce cas.
const WHEN = {
  planifier: ctx => !!ctx.canPlan,
  rendez_vous: (ctx, ai) => ai.can_answer && ai.action === 'rendez_vous' && !ctx.cancelled,
  preparer: (ctx, ai) => ai.can_answer && ai.action === 'preparer' && !!ctx.canPrep,
  conseiller: (ctx, ai) => !ai.can_answer || ai.action === 'conseiller',
  client: ctx => !ctx.delegate,
};
const fits = (id, list) => list.some(x => (x.endsWith('*') ? id.startsWith(x.slice(0, -1)) : id === x));

// Pour le journal : ce qu'une phrase hors du recueil contient de dangereux. [motif, règle] : le premier trouvé est gardé.
const OWN = [
  ['nombre, date ou heure écrits par l’IA', /\p{N}[\p{N} .,:h/-]*/u],
  ['écriture inattendue', /[^\p{Script=Latin}\P{L}]/u],
  ['symbole inattendu', /[*#@<>{}|\\^~$€£%]/],
  ['lien ou contact', /:\/\/|\bwww\b|\barobase\b|\(at\)|\b[a-z0-9-]+ ?(?:\.|\bpoint\b) ?(?:ci|com|net|org|fr|me|ly|io|app|info|biz|africa|gl|co|tv)\b|\b(?:site|sites|lien|liens|url|web|e-?mail|mail|courriel|whatsapp|facebook|telegram|instagram|tiktok|sms|ussd|appel\w*|rappel\w*|telephon\w*|numeros?|compos\w*|joign\w*)\b/],
  ['code ou donnée secrète', /\b(?:codes?|pin|otp|mots? de passe|mdp|identifiants?|cartes?|cvv|cryptogramme|confidentiel\w*|secret\w*|chiffres?|expiration)\b/],
  ['nombre écrit par l’IA', /\b(?:deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|treize|quatorze|quinze|seize|vingts?|trente|quarante|cinquante|soixante|septante|octante|nonante|cents?|mille|millions?|milliards?|premiere?s?|seconde?s?|\w+iemes?|demie?s?|quarts?|moitie|dizaines?|douzaines?|quinzaines?|huitaines?|vingtaines?|trentaines?|centaines?|milliers?)\b/],
  ['date, heure ou délai écrits par l’IA', /\b(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre|aujourd'hui|demain|hier|apres-demain|avant-hier|lendemain|surlendemain|veille|matin|matins|matinee|matinees|midi|apres-midi|soir|soirs|soiree|soirees|nuit|nuits|minuit|aube|heures?|minutes?|jours?|journees?|semaines?|week-?ends?|week end|mois|ans|annees?|trimestres?|bientot|prochaine?s?|prochainement|recemment|rapidement|vite|tot|tard|immediat\w*|aussitot|sous peu|d'ici|tout de suite|dans un instant|incessamment|sans tarder|sans delai|d'un moment a l'autre|noel|toussaint|paques|tabaski|ramadan|fetes|nouvel an)\b|\b(?:lun|mar|mer|jeu|ven|sam|dim|janv|fev|fevr|avr|juil|sept|oct|nov|dec)\./],
  ['montant ou paiement écrits par l’IA', /\b(?:francs?|f ?cfa|cfa|xof|euros?|dollars?|montants?|somme|(?:les|des|vos|ces) sommes|prix|tarifs?|frais|couts?|coute\w*|gratuit\w*|rembours\w*|payant\w*|pay(?:e|ee|es|ees|er|ez|ons|ent|era|eras|erez|eront|erai|ait|aient)|regl(?:e|ee|es|ees|er|ez|ement|ements)|vers(?:e|ee|es|ees|er|ez|ement|ements)|credit\w*|debit\w*|encaiss\w*|argent|acomptes?|cautions?|solde\w*|recharg\w*|transfer\w*|virements?|supplements?)\b/],
  ['état du dossier écrit par l’IA', /\b(?:confirm\w*|recue?s?|reception\w*|valid\w*|approuv\w*|accept\w*|rapproch\w*|verifiee?s?|verification technique|actif|actifs|actives?|activ\w*|operationnel\w*|fonctionn\w*|march(?:e|era|ent|eront|ait|aient)|raccordee?s?|branchee?s?|installee?s?|connecte\w*|en service|en route|en chemin|sur place|en cours|en attente|arriv\w*|parti|termin(?:e|ee|es|ees|er|era|ent)|finie?s?|achev\w*|clotur\w*|resolu\w*|levee?s?|debloqu\w*|bloqu\w*|manqu\w*|complete?s?|incomplet\w*|affect\w*|assign\w*|planifi\w*|reservee?s?|annulee?s?|prete?s?|disponibles?|etapes?|stade|echou\w*|echec|incidents?|suspendu\w*|pannes?|ok|en ordre|tout est bon|c'est bon|(?:aucun|pas de) (?:souci|probleme)s?|plus rien|rien a (?:faire|payer|craindre)|surf\w*|navigu\w*|profit\w*|allum\w*|tourn(?:e|ent)|demarr\w*|deja|desormais|internet|wi-?fi|box|modem|routeur|abonnement\w*|attribu\w*|en priorite|meilleurs delais|(?:est|sont|se trouvent?) (?:deja )?chez vous)\b/],
  ['exigence écrite par l’IA', /\b(?:doi(?:t|vent)|devez|devons|faut|besoin|necessaire\w*|obligatoire\w*|requis\w*|exige\w*|il (?:vous )?reste|reste a)\b/],
  ['annonce de ce qui va se passer', /\b(?:\w+(?:era|eront|erai|erons|iront|dra|dront|drez|vra|vront|vrez|ura|uront|urez)|serez|ferez|irez|(?:va|vont|allez|allons) (?:vous |le |la |les |lui |leur |y |en |bien |tres )*\w+(?:er|ir|re|oir))\b/],
  ['promesse', /\b(?:garanti\w*|promet\w*|promis\w*|promesses?|certainement|certitude|surement|assur(?:e|ee|es|ees|ement|ance|ances|ons)|je vous l'assure|engag\w*|sans faute|sans (?:aucun )?doute|aucun doute|absolument|definitivement|forcement|a coup sur|(?:c'est|soyez|suis|sommes|etes|soit|en suis) (?:sure?s?|certaine?s?)|compter sur|je (?:vais|m'occupe|m'en occupe|transmets|relance|contacte|previens|programme|reserve|annule|modifie|valide|confirme)|nous (?:allons|nous occupons|transmettons)|j'ai (?:fait|envoye|transmis|demande|signale|note|enregistre|programme|planifie|reserve|annule|modifie|relance|contacte|prevenu|valide|confirme|verifie)|(?:va|vont) (?:vous )?(?:appeler|rappeler|contacter|venir|passer|arriver|installer|activer|rembourser|envoyer|livrer|valider|confirmer|traiter|regler)|(?:viendr|passer|arriver|installer|activer|rembourser|enverr|livrer|recevr|rappeller|appeller|contacter|traiter|valider|confirmer|regler)(?:a|ont|ez|ai|ons))\b/],
];

// Découpe la réponse en repères (ou textes recopiés en entier) ; renvoie le premier passage qui n'en est pas un.
function partsOf(text, ctx) {
  const items = ctx.items.map(i => ({ id: i.id, key: bare(i.text) })).filter(i => i.key.length >= 8);
  const all = [...PHRASE_BARE.map(p => ({ ...p, phrase: true })), ...items].sort((a, b) => b.key.length - a.key.length);
  const n = norm(text), parts = [];
  let at = 0;
  for (;;) {
    SEP.lastIndex = at; if (SEP.exec(n)) at = SEP.lastIndex;
    if (at >= n.length) return { parts };
    MARK.lastIndex = at;
    const m = MARK.exec(n);
    if (m) { parts.push({ id: m[1].toUpperCase() }); at = MARK.lastIndex; continue; }
    const v = all.find(x => n.startsWith(x.key, at) && !/[\p{L}\p{N}]/u.test(n.charAt(at + x.key.length)));
    if (v) { parts.push({ id: v.id }); at += v.key.length; continue; }
    const rest = n.slice(at), stop = rest.search(/\{/);
    return { parts, stray: stop > 0 ? rest.slice(0, stop) : rest };
  }
}
const motifOf = stray => {
  for (const [why, re] of OWN) { const m = re.exec(stray); if (m) return why + ' (' + m[0].replace(/[\s.,:/-]+$/, '').trim().slice(0, 30) + ')'; }
  return 'phrase hors du recueil (« ' + stray.replace(/[\s.,;:!?-]+$/, '').slice(0, 40) + ' »)';
};

export function checkAiAnswer(ctx, ai) {
  if (!ai || typeof ai !== 'object') return { ok: false, why: 'réponse illisible' };
  const answer = clean(ai.answer);
  if (answer.length < 2 || answer.length > 1200) return { ok: false, why: 'réponse vide ou trop longue' };
  if (typeof ai.can_answer !== 'boolean' || !Object.hasOwn(ACTIONS, ai.action) || !Object.hasOwn(TOPIC_INTENT, ai.topic) || !Array.isArray(ai.cites)) return { ok: false, why: 'réponse illisible' };
  const ids = new Map(ctx.items.map(i => [i.id, i]));
  const bad = why => ({ ok: false, why });
  const cites = [...new Set(ai.cites.map(c => String(c).toUpperCase()))].slice(0, 12);
  const unknown = cites.find(c => !ids.has(c));
  if (unknown) return bad('source inconnue (' + unknown.slice(0, 12) + ')');
  const use = id => { if (!cites.includes(id)) cites.push(id); };
  const text = answer.replace(NOTE, (m, list) => { const l = list.toUpperCase().split(/\s*[,;]\s*|\s+ET\s+/); if (!l.every(x => ids.has(x))) return m; l.forEach(use); return ''; });
  // 1. Rien d'autre que des repères (ou des textes approuvés recopiés en entier).
  const { parts: raw, stray } = partsOf(text, ctx);
  if (stray) return bad(motifOf(stray));
  // 2. Chaque repère existe ; un repère répété ne compte qu'une fois.
  const seen = new Set(), parts = [];
  for (const p of raw) {
    if (!ids.has(p.id) && !PHRASE.has(p.id)) return bad((/^P\d+$/.test(p.id) ? 'phrase inconnue (' : 'source inconnue (') + p.id + ')');
    if (!seen.has(p.id)) { seen.add(p.id); parts.push(p); }
  }
  const inserted = parts.filter(p => ids.has(p.id));
  if (inserted.length > 4) return bad('trop d’éléments insérés');
  if (parts.length - inserted.length > 4) return bad('trop de phrases');
  if (ai.can_answer && !inserted.length) return bad('aucun élément du dossier inséré');
  // 3. Chaque phrase est à sa place : juste avant l'élément qu'elle introduit (« firstOf » : le premier de la liste qui
  // existe dans ce dossier), et seulement quand elle est vraie.
  for (const [k, p] of parts.entries()) {
    const ph = PHRASE.get(p.id);
    if (!ph) continue;
    const next = ph.next && ph.firstOf ? ph.next.filter(id => ids.has(id)).slice(0, 1) : ph.next;
    if (next && !(parts[k + 1] && ids.has(parts[k + 1].id) && fits(parts[k + 1].id, next))) return bad('phrase mal placée (' + p.id + ')');
    if (ph.when && !WHEN[ph.when](ctx, ai)) return bad('phrase hors de propos (' + p.id + ')');
  }
  // 4. Ce que le client doit savoir (point bloquant, pièces à envoyer, données anciennes) est ajouté s'il manque.
  const missing = inserted.length ? (ctx.mustShow || []).filter(id => ids.has(id) && !seen.has(id)) : [];
  if (missing.length) parts.push(...(seen.has('P20') ? [] : [{ id: 'P20' }]), ...missing.map(id => ({ id })));
  parts.filter(p => ids.has(p.id)).forEach(p => use(p.id));
  const shown = parts.map(p => (ids.has(p.id) ? sayOf(ids.get(p.id)) : PHRASE.get(p.id).text)).join(' ');
  return { ok: true, value: { answer: shown, cites, action: ai.action, canAnswer: ai.can_answer, topic: ai.topic } };
}

export const aiModelName = m => (typeof m === 'string' && /^claude-[a-z0-9-]{1,40}$/.test(m) ? m : AI_MODEL);
export const aiMs = ms => (Number.isFinite(Number(ms)) ? Math.max(0, Math.min(120000, Math.round(Number(ms)))) : null);

// Réponse montrée au client : le texte de l'IA, puis les éléments cités (avec leurs vraies sources et leur fraîcheur).
export function aiAnswerOf(ws, ctx, v, { question, model, ms }) {
  const ids = new Map(ctx.items.map(i => [i.id, i]));
  const blocks = v.cites.map(id => { const { id: cite, ...b } = ids.get(id); return { ...b, cite }; });
  let action = v.canAnswer ? ACTIONS[v.action] : { handoff: true };
  if (action && action.go && ctx.cancelled) action = null;
  if (action && action.go === 'prep' && !ctx.canPrep) action = null;
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
