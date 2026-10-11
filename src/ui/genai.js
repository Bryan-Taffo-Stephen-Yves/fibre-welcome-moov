// Vraie IA (Claude) vue du navigateur. La page ne connaît aucune clé secrète.
// - Lien public (GitHub Pages) ou fichier ouvert sur l'ordinateur : la page demande à la fonction « fw-ia » du serveur
//   Supabase, qui appelle Claude avec la clé gardée dans les secrets de Supabase.
// - Aperçu privé (claude.ai) : la page ne peut pas joindre Supabase. Elle passe par le compte Claude de la personne qui
//   regarde (capacité « sample »), après son accord.
// Sans réponse utilisable (pas encore de clé, crédit épuisé, plafond du jour, réseau coupé, refus), l'application garde
// ses réponses par règles : personne n'est bloqué. Ce que dit l'IA est ensuite vérifié par le serveur simulé
// (src/server/genai.js) avant d'être montré.
import { SERVER } from './server-config.js';
import { api, call, isOnline, getImage } from './platform.js';
import { ASSISTANT_SYSTEM, ASSISTANT_SCHEMA, PHOTO_SYSTEM, PHOTO_SCHEMA, PHOTO_TYPES, LIMITS, assistantUserText, checkAssistantInput } from '../../supabase/functions/fw-ia/logic.js';

const React = window.React;
const W = typeof window !== 'undefined' ? window : {};
// Nom donné aux réponses de l'aperçu privé : le modèle exact dépend du compte Claude de la personne qui regarde.
export const VIEWER_MODEL = 'claude-compte-visiteur';

function serverCfg() {
  if (W.FW_IA) return W.FW_IA; // essais : fausse fonction locale { url, key }
  if (W.FW_NO_SERVER) return null;
  const c = W.FW_SERVER || SERVER;
  return c && c.url ? { url: c.url.replace(/\/+$/, '') + '/functions/v1/fw-ia', key: c.key } : null;
}
const inViewer = () => !W.FW_IA && !!(W.claude && typeof W.claude.use === 'function');
let sampleP = null;
const viewerSample = () => (sampleP ||= Promise.resolve().then(() => W.claude.use('sample')).then(s => (typeof s === 'function' ? s : null), () => null));
// La page sait-elle joindre une IA ici ? (sinon, pas de bouton « Avis de l'IA »)
export const iaReachable = () => inViewer() || !!serverCfg();

// Les écrans qui montrent l'IA se redessinent quand son état change (panne connue, photo en cours d'analyse).
const subs = new Set();
const notify = () => subs.forEach(f => f());

function timeout(ms) {
  if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) return AbortSignal.timeout(ms);
  const c = new AbortController(); setTimeout(() => c.abort(), ms); return c.signal;
}

// Panne connue : on ne redemande pas à chaque question (le client attendrait pour rien).
let down = null;
const knownDown = () => (down && Date.now() < down.until ? down.why : null);
const PAUSE = { sans_cle: 120000, credit: 300000, cle_refusee: 300000, modele_absent: 300000, compteur: 60000, limite: 60000, absente: 300000, injoignable: 45000, origine: 600000, pas_de_serveur: 600000, rate_limited: 30000, occupe: 30000 };
const markDown = why => { if (PAUSE[why]) { down = { why, until: Date.now() + PAUSE[why] }; notify(); } };
// Pannes de réglage (clé, crédit, fonction absente…) : tant qu'elles durent, les boutons de l'IA sont cachés.
const SETUP = ['sans_cle', 'cle_refusee', 'credit', 'modele_absent', 'absente', 'origine', 'pas_de_serveur'];
// Aperçu privé : l'usage du compte Claude est refusé ou impossible ici, pour toute la visite de la page.
const VIEWER_OFF = ['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed'];
let viewerOff = null;
let viewerImages = null; // true / false une fois connu (l'aperçu peut-il envoyer une photo ?)

async function viaServer(kind, body, ms) {
  const c = serverCfg();
  if (!c) return { ok: false, why: 'pas_de_serveur' };
  const t0 = Date.now();
  let r, j = null;
  try { r = await fetch(c.url, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: c.key || '' }, body: JSON.stringify({ kind, ...body }), signal: timeout(ms) }); }
  catch (e) { const why = e && (e.name === 'TimeoutError' || e.name === 'AbortError') ? 'trop_lent' : 'injoignable'; markDown(why); return { ok: false, why }; }
  try { j = await r.json(); } catch {}
  if (r.status === 404 && !(j && j.why)) { markDown('absente'); return { ok: false, why: 'absente' }; }
  if (!j || typeof j !== 'object') return { ok: false, why: 'illisible' };
  if (!j.ok) { const why = String(j.why || 'erreur').slice(0, 30); markDown(why); return { ok: false, why }; }
  return { ok: true, out: j.out, model: String(j.model || ''), ms: Number.isFinite(j.ms) ? j.ms : Date.now() - t0 };
}

// Aperçu privé : mêmes consignes que la fonction, avec le format demandé en toutes lettres (pas de format imposé ici).
const enumOf = (s, k) => s.properties[k].enum.join(', ');
const ASSISTANT_FORMAT = 'Réponds uniquement avec un objet JSON, sans aucun autre texte, de la forme {"answer": "…", "cites": ["F1"], "action": "aucune", "can_answer": true, "topic": "statut"}. « action » vaut : ' + enumOf(ASSISTANT_SCHEMA, 'action') + '. « topic » vaut : ' + enumOf(ASSISTANT_SCHEMA, 'topic') + '.';
const PHOTO_FORMAT = 'Réponds uniquement avec un objet JSON, sans aucun autre texte, de la forme {"verdict": "lisible", "right_document": "oui", "issues": [], "note": "…"}. « verdict » vaut : ' + enumOf(PHOTO_SCHEMA, 'verdict') + '. « right_document » vaut : ' + enumOf(PHOTO_SCHEMA, 'right_document') + '. « issues » ne contient que : ' + PHOTO_SCHEMA.properties.issues.items.enum.join(', ') + '.';
const b64Blob = (data, type) => { const s = atob(data); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return new Blob([u], { type }); };

// Codes d'erreur de l'aperçu (capacité « sample ») traduits en raisons de l'application.
const VIEWER_WHY = { refused: 'refus', rate_limited: 'rate_limited', session_expired: 'session_expiree', image_rejected: 'image_refusee', images_unavailable: 'apercu_photo', empty_completion: 'illisible', invalid_json: 'illisible', cancelled: 'annule', upstream_error: 'occupe', queue_overflow: 'occupe' };
async function viaViewer(kind, body) {
  if (viewerOff) return { ok: false, why: 'not_granted' };
  const sample = await viewerSample();
  if (!sample) return { ok: false, why: 'apercu' };
  const t0 = Date.now();
  try {
    let out;
    if (kind === 'assistant') {
      const v = checkAssistantInput(body);
      if (!v.ok) return { ok: false, why: v.why };
      out = await sample.json(ASSISTANT_SYSTEM + '\n\n' + ASSISTANT_FORMAT + '\n\n' + assistantUserText(v.value), { modelTier: 'quick', cache: false });
    } else {
      const lim = await sample.limits().catch(() => null);
      if (!lim || !lim.images) { viewerImages = false; notify(); return { ok: false, why: 'apercu_photo' }; }
      out = await sample.json(PHOTO_SYSTEM + '\n\n' + PHOTO_FORMAT + '\n\nPièce attendue : ' + PHOTO_TYPES[body.docType] + '.', { images: b64Blob(body.data, body.mediaType), cache: false });
    }
    if (!out || typeof out !== 'object' || Array.isArray(out)) return { ok: false, why: 'illisible' };
    return { ok: true, out, model: VIEWER_MODEL, ms: Date.now() - t0 };
  } catch (e) {
    const code = String((e && e.code) || '');
    if (VIEWER_OFF.includes(code)) { viewerOff = code; statusMemo = null; notify(); return { ok: false, why: 'not_granted' }; }
    if (code === 'images_unavailable') { viewerImages = false; notify(); }
    // Erreur de la page elle-même (requête mal formée, trop longue) : rien n'est parti, réponse par règles.
    const why = VIEWER_WHY[code] || 'illisible';
    markDown(why);
    return { ok: false, why };
  }
}

// Question du client : le serveur simulé donne le contexte du dossier (avec les droits de la personne), puis Claude
// rédige. Renvoie { ok: true, ai } à joindre à « assistant.ask », ou { ok: false, why } : réponse par règles.
export async function askClaude(token, orderId, question, history = []) {
  if (!isOnline(token)) return { ok: false, why: 'hors_ligne' };
  let ctx;
  try { ctx = api.q(token, 'assistant.context', { orderId, question }); } catch { return { ok: false, why: 'droits' }; }
  if (!ctx || ctx.skip) return { ok: false, why: ctx ? ctx.skip : 'contexte' };
  const k = knownDown(); if (k) return { ok: false, why: k };
  const body = { question, ref: ctx.ref, items: ctx.items, history: history.slice(-LIMITS.history) };
  const r = inViewer() ? await viaViewer('assistant', body) : await viaServer('assistant', body, 30000);
  return r.ok ? { ok: true, ai: { ...r.out, model: r.model, ms: r.ms } } : r;
}

// Avis de Claude sur une photo, demandé par la conseillère : la photo part seule (sans nom ni dossier), l'avis revient au
// serveur simulé (« doc.aiReview »), qui le contrôle et le range avec la pièce. La conseillère décide toujours.
// Une même photo ne part qu'une fois à la fois, même si on clique sur deux boutons (fiche et liste des pièces).
const inflight = new Map();
export function reviewPhoto(token, docId) {
  if (inflight.has(docId)) return inflight.get(docId);
  const p = reviewNow(token, docId).catch(() => ({ ok: false, why: 'illisible' })).finally(() => { inflight.delete(docId); notify(); });
  inflight.set(docId, p); notify();
  return p;
}
async function reviewNow(token, docId) {
  if (!isOnline(token)) return { ok: false, why: 'hors_ligne' };
  // État actuel de la pièce (jamais celui d'un écran périmé) : rien ne part si elle est déjà traitée ou déjà vue par l'IA.
  let doc, wsId;
  try { doc = api.q(token, 'ops.doc', { docId }); wsId = api.session(token).wsId; } catch { return { ok: false, why: 'droits' }; }
  if (!doc.genAi) return { ok: false, why: 'coupee' };
  if (doc.ai) return { ok: true, already: true };
  if (doc.status !== 'a_valider') return { ok: false, why: doc.status === 'analyse' ? 'analyse' : 'traitee' };
  if (!doc.img || !String(doc.mime || '').startsWith('image/')) return { ok: false, why: 'image' };
  try { if (!api.q(token, 'image.allowed', { img: doc.img })) return { ok: false, why: 'droits' }; } catch { return { ok: false, why: 'droits' }; }
  const k = knownDown(); if (k) return { ok: false, why: k };
  const src = await getImage(wsId, doc.img);
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+=*)$/.exec(src || '');
  if (!m) return { ok: false, why: 'image' };
  const body = { docType: doc.type, mediaType: m[1], data: m[2] };
  const r = inViewer() ? await viaViewer('photo', body) : await viaServer('photo', body, 60000);
  if (!r.ok) return r;
  const res = await call(token, 'doc.aiReview', { docId, ai: { ...r.out, model: r.model, ms: r.ms } }, { silent: true });
  return res.ok ? { ok: true, review: res.data } : { ok: false, why: 'serveur', message: res.error.message };
}

// L'IA est-elle utilisable maintenant sur cette page ? (en plus du réglage de l'administrateur, vu par le serveur simulé)
export function iaNow() {
  if (!iaReachable() || viewerOff) return { text: false, photo: false };
  const k = knownDown();
  if (k && SETUP.includes(k)) return { text: false, photo: false };
  return { text: true, photo: !(inViewer() && viewerImages === false) };
}
export function useIa() {
  const [, setV] = React.useState(0);
  React.useEffect(() => {
    let live = true;
    const f = () => { if (live) setV(x => x + 1); };
    subs.add(f); iaStatus(false).then(f, f);
    return () => { live = false; subs.delete(f); };
  }, []);
  return { ...iaNow(), busy: id => inflight.has(id) };
}

// État de l'IA pour l'administration (lu au plus une fois par minute, sauf « Vérifier »).
let statusMemo = null;
export async function iaStatus(force = false) {
  if (!force && statusMemo && Date.now() - statusMemo.at < 60000) return statusMemo.v;
  let v;
  if (inViewer()) {
    const sample = viewerOff ? null : await viewerSample();
    if (sample && viewerImages === null) { const lim = await sample.limits().catch(() => null); viewerImages = !!(lim && lim.images); }
    v = sample ? { state: 'apercu_compte' } : { state: 'apercu' };
  } else {
    const c = serverCfg();
    if (!c) v = { state: 'pas_de_serveur' };
    else {
      try {
        const r = await fetch(c.url, { headers: { apikey: c.key || '' }, signal: timeout(15000) });
        const j = await r.json().catch(() => null);
        v = j && j.ok ? { state: String(j.state), used: j.used, max: j.max, model: j.model } : r.status === 404 ? { state: 'absente' } : { state: j && j.why === 'origine' ? 'origine' : 'injoignable' };
      } catch { v = { state: 'injoignable' }; }
    }
  }
  if (v.state === 'pret' || v.state === 'apercu_compte') { if (down) { down = null; notify(); } } else markDown(v.state);
  statusMemo = { at: Date.now(), v };
  return v;
}
export function useIaStatus() {
  const [s, setS] = React.useState(() => (statusMemo ? statusMemo.v : { state: 'verification' }));
  const live = React.useRef(true);
  React.useEffect(() => { live.current = true; iaStatus(false).then(v => { if (live.current) setS(v); }); return () => { live.current = false; }; }, []);
  const check = React.useCallback(async () => { setS(x => ({ ...x, state: 'verification' })); const v = await iaStatus(true); if (live.current) setS(v); return v; }, []);
  return [s, check];
}

// ---------- Mots pour les écrans ----------
// [ton, titre, explication]
export const IA_STATE = {
  verification: ['neutral', 'Vérification…', 'On demande au serveur si Claude est prêt.'],
  pret: ['ok', 'Prête : Claude répond', 'La clé est installée dans Supabase et acceptée par Anthropic.'],
  sans_cle: ['warn', 'En attente de la clé', 'La fonction est installée, mais la clé de Claude n’est pas encore dans Supabase. En attendant, l’assistant répond par règles.'],
  cle_refusee: ['bad', 'Clé refusée', 'Anthropic refuse la clé installée : vérifiez qu’elle est complète et toujours active.'],
  credit: ['bad', 'Crédit épuisé', 'Le compte Anthropic n’a plus de crédit : l’assistant répond par règles.'],
  modele_absent: ['bad', 'Modèle indisponible', 'Cette clé n’a pas accès au modèle demandé.'],
  injoignable: ['warn', 'Injoignable', 'Le serveur de l’IA ne répond pas pour le moment : l’assistant répond par règles.'],
  absente: ['warn', 'Pas encore installée', 'La fonction « fw-ia » n’est pas encore installée sur Supabase : l’assistant répond par règles.'],
  origine: ['bad', 'Adresse non autorisée', 'Cette adresse de page n’a pas le droit d’appeler l’IA.'],
  pas_de_serveur: ['neutral', 'Sans serveur', 'Aucun serveur n’est configuré : l’assistant répond par règles.'],
  apercu_compte: ['ok', 'Aperçu privé : votre compte Claude', 'Ici, l’IA passe par le compte Claude de la personne qui regarde, après son accord. Sur le lien public, elle passe par la clé installée dans Supabase.'],
  apercu: ['neutral', 'Aperçu privé', 'L’IA n’est pas disponible dans cet aperçu. Elle marche sur le lien public, une fois la clé installée.'],
};
export const iaState = s => IA_STATE[s] || ['warn', 'État inconnu', 'Réponse inattendue du serveur de l’IA.'];

const WHY_TEXT = {
  sans_cle: 'la clé de Claude n’est pas encore installée',
  credit: 'le crédit du compte Anthropic est épuisé',
  cle_refusee: 'la clé de Claude est refusée',
  modele_absent: 'le modèle n’est pas disponible pour cette clé',
  limite: 'le plafond de demandes est atteint, réessayez plus tard',
  compteur: 'le compteur de demandes ne répond pas',
  injoignable: 'le serveur de l’IA ne répond pas',
  absente: 'la fonction de l’IA n’est pas encore installée',
  trop_lent: 'Claude a mis trop de temps',
  occupe: 'Claude est très demandé en ce moment',
  refus: 'Claude a préféré ne pas répondre',
  hors_ligne: 'vous êtes hors ligne',
  not_granted: 'l’usage du compte Claude n’est pas autorisé dans cet aperçu',
  rate_limited: 'trop de demandes à la fois, réessayez dans un moment',
  session_expiree: 'votre session Claude a expiré : reconnectez-vous puis rechargez la page',
  image_refusee: 'Claude n’a pas pu lire ce fichier photo',
  annule: 'la demande a été annulée',
  analyse: 'le contrôle automatique de la photo n’est pas fini, réessayez dans quelques secondes',
  traitee: 'cette pièce est déjà validée ou refusée',
  apercu: 'l’IA n’est pas disponible dans cet aperçu',
  apercu_photo: 'cet aperçu ne peut pas envoyer de photo à Claude',
  pas_de_serveur: 'aucun serveur d’IA n’est configuré',
  image: 'la photo n’est pas disponible sur cet appareil',
  droits: 'accès non autorisé',
  coupee: 'l’administrateur a coupé l’IA générative',
};
export const whyText = w => WHY_TEXT[w] || 'la réponse de l’IA était inutilisable';
// Raisons qui veulent dire « pas d'IA ici, ou pas pour cette question » : inutile de le signaler sous chaque réponse.
const QUIET = ['sans_cle', 'absente', 'pas_de_serveur', 'apercu', 'coupee', 'degrade', 'vide', 'garde', 'hors_ligne', 'droits', 'origine', 'not_granted', 'annule', 'contexte'];
export const quietWhy = w => !w || QUIET.includes(w);
// Texte d'une réponse précédente, pour que Claude comprenne une question de suite (« et pourquoi ? »).
export const answerText = a => (a.ai ? a.ai.text : a.blocks.map(b => b.title + ' : ' + b.text).join(' ')).slice(0, LIMITS.historyText);
// Nom du modèle pour l'administration.
export const modelLabel = m => (m === VIEWER_MODEL ? 'Claude (compte de la personne qui regarde l’aperçu)' : m || 'Claude');
