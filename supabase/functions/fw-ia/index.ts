// Fonction « fw-ia » (Supabase Edge Function) : la seule porte de l'application vers Claude.
// La clé de l'API reste ici, dans les secrets de Supabase (ANTHROPIC_API_KEY) : elle n'est jamais envoyée au
// navigateur. Sans clé, la fonction répond « sans_cle » et l'application garde ses réponses par règles.
// Chaque visiteur a un plafond de demandes par minute et par jour, et un budget en dollars par jour ; toute
// l'application aussi (compteur fw_ia_reserve dans la base) : un inconnu ne peut pas vider le crédit.
// deno-lint-ignore-file no-explicit-any
import Anthropic from 'npm:@anthropic-ai/sdk@0.128.0';
import { LIMITS, MODEL, PROBE, checkAssistantInput, checkPhotoInput, corsHeaders, costMax, costOf, originOk, requestFor, visitorKey } from './logic.js';

const env = (k: string) => Deno.env.get(k) || '';
const parse = (s: string): any => { try { return JSON.parse(s); } catch { return null; } };
const json = (body: unknown, status: number, headers: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

// Clés publiques du projet (la page les connaît déjà) : elles écartent les appels qui ne viennent pas de l'application.
function publicKeys(): string[] {
  const keys = Object.values(parse(env('SUPABASE_PUBLISHABLE_KEYS')) || {}).map(String);
  if (env('SUPABASE_ANON_KEY')) keys.push(env('SUPABASE_ANON_KEY'));
  return keys.filter(Boolean);
}
// Clé secrète du projet, pour le compteur de demandes (jamais renvoyée).
function secretKey(): string {
  const k = (parse(env('SUPABASE_SECRET_KEYS')) || {}).default;
  return k ? String(k) : env('SUPABASE_SERVICE_ROLE_KEY');
}

async function rpc(fn: string, args: Record<string, unknown>): Promise<any> {
  const key = secretKey(), url = env('SUPABASE_URL');
  if (!key || !url) return null;
  const headers: Record<string, string> = { apikey: key, 'Content-Type': 'application/json' };
  if (key.startsWith('eyJ')) headers.Authorization = 'Bearer ' + key;
  try {
    const r = await fetch(url + '/rest/v1/rpc/' + fn, { method: 'POST', headers, body: JSON.stringify(args), signal: AbortSignal.timeout(5000) });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

// Empreinte du visiteur, salée avec la clé secrète du projet et le jour (UTC) : elle ne permet ni de retrouver
// l'adresse IP ni de suivre un visiteur d'un jour à l'autre.
async function fingerprint(s: string) {
  const day = new Date().toISOString().slice(0, 10);
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('fw-ia:' + secretKey() + ':' + day + ':' + s));
  return [...new Uint8Array(b)].slice(0, 16).map(x => x.toString(16).padStart(2, '0')).join('');
}

// Corps de la requête, lu morceau par morceau : on s'arrête dès qu'il dépasse LIMITS.body, même sans Content-Length
// (envoi par morceaux), et au bout de LIMITS.bodyMs (un envoi qui traîne n'occupe pas la fonction).
async function readBody(req: Request): Promise<string | [number, string]> {
  if (!req.body) return '';
  const reader = req.body.getReader(), parts: Uint8Array[] = [];
  let size = 0, late = false;
  const timer = setTimeout(() => { late = true; reader.cancel().catch(() => {}); }, LIMITS.bodyMs);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (late) return [408, 'trop_lent'];
      if (done) break;
      size += value.byteLength;
      if (size > LIMITS.body) { reader.cancel().catch(() => {}); return [413, 'trop_gros']; }
      parts.push(value);
    }
  } catch {
    return late ? [408, 'trop_lent'] : [400, 'demande'];
  } finally {
    clearTimeout(timer);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const p of parts) { all.set(p, at); at += p.byteLength; }
  return new TextDecoder().decode(all);
}

let anth: Anthropic | null = null;
let anthKey = '';
function client(): Anthropic {
  const k = env('ANTHROPIC_API_KEY');
  if (!anth || anthKey !== k) { anth = new Anthropic({ apiKey: k, maxRetries: 1, timeout: 50000 }); anthKey = k; }
  return anth;
}

function failure(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return 'cle_refusee';
  if (e instanceof Anthropic.RateLimitError) return 'occupe';
  if (e instanceof Anthropic.APIConnectionError) return 'injoignable';
  if (e instanceof Anthropic.InternalServerError) return 'occupe';
  if (e instanceof Anthropic.NotFoundError) return 'modele_absent';
  // Crédit épuisé : erreur « billing_error » (402), ou ancienne forme (400, « credit balance is too low »).
  if (e instanceof Anthropic.APIError) return (e as any).status === 402 || (e as any).type === 'billing_error' || /credit balance/i.test(String((e as any).message || '')) ? 'credit' : 'api_' + (e as any).status;
  return 'erreur';
}

// État affiché dans l'administration : clé absente, refusée, crédit épuisé, ou prête. Appris de chaque vrai appel
// (une réponse : prête ; une erreur de clé, de crédit ou de modèle : cet état) ; sinon vérifié par un tout petit
// appel au modèle, compté dans la dépense du jour : au plus toutes les 10 minutes quand tout va bien, toutes les
// 2 minutes après un problème. Un état n'est remplacé que par celui d'un appel parti plus tard.
let checked = { at: 0, key: '', state: '' };
const BAD = ['cle_refusee', 'credit', 'modele_absent'];
const fresh = (key: string) => checked.key === key && Date.now() - checked.at < (checked.state === 'pret' ? 600000 : 120000);
const learn = (at: number, key: string, state: string) => { if (checked.key !== key || at >= checked.at) checked = { at, key, state }; };

let probing: Promise<void> | null = null;
async function probe(key: string) {
  const t0 = Date.now();
  try {
    const msg: any = await client().messages.create(PROBE as any, { timeout: 10000, maxRetries: 0 });
    await rpc('fw_ia_spend', { p_day: null, p_who: '*', p_cost: costOf(msg.usage, msg.model) ?? costMax(PROBE) });
    learn(t0, key, 'pret');
  } catch (e) {
    const why = failure(e);
    console.error(JSON.stringify({ kind: 'etat', why }));
    learn(t0, key, BAD.includes(why) ? why : 'injoignable');
  }
}

async function status() {
  const key = env('ANTHROPIC_API_KEY');
  const today = await rpc('fw_ia_today', {});
  const cost = today && typeof today.cost === 'number' ? today.cost : null;
  let state = 'sans_cle';
  if (key) {
    // Sans compteur, ou le budget du jour dépensé, pas de vérification : rien n'est dépensé sans contrôle.
    if (fresh(key) && BAD.includes(checked.state)) state = checked.state;
    else if (cost === null) state = 'compteur';
    else if (cost + costMax(PROBE) > LIMITS.allCost) state = 'limite';
    else {
      if (!fresh(key)) await (probing ||= probe(key).finally(() => { probing = null; }));
      state = checked.key === key ? checked.state : 'injoignable';
    }
  }
  // Dépense du jour et budget en micro-dollars (réservations des appels en cours comprises).
  return { ok: true, state, model: MODEL, used: today && typeof today.used === 'number' ? today.used : null, max: LIMITS.allDay, cost, maxCost: LIMITS.allCost };
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin');
  const cors = corsHeaders(origin);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (!originOk(origin)) return json({ ok: false, why: 'origine' }, 403, cors);
  const keys = publicKeys();
  if (keys.length && !keys.includes(req.headers.get('apikey') || '')) return json({ ok: false, why: 'cle_publique' }, 401, cors);
  if (req.method === 'GET') return json(await status(), 200, cors);
  if (req.method !== 'POST') return json({ ok: false, why: 'methode' }, 405, cors);

  if (Number(req.headers.get('content-length') || 0) > LIMITS.body) return json({ ok: false, why: 'trop_gros' }, 413, cors);
  const raw = await readBody(req);
  if (typeof raw !== 'string') return json({ ok: false, why: raw[1] }, raw[0], cors);
  const body = parse(raw);
  const kind = body && (body.kind === 'photo' || body.kind === 'assistant') ? body.kind : null;
  if (!kind) return json({ ok: false, why: 'demande' }, 400, cors);
  const input = kind === 'photo' ? checkPhotoInput(body) : checkAssistantInput(body);
  if (!input.ok) return json({ ok: false, why: input.why }, input.why === 'trop_gros' ? 413 : 400, cors);
  const key = env('ANTHROPIC_API_KEY');
  if (!key) return json({ ok: false, why: 'sans_cle' }, 503, cors);
  // Clé refusée ou crédit épuisé il y a peu : on ne rappelle pas Claude et on ne compte pas la demande.
  if (fresh(key) && BAD.includes(checked.state)) return json({ ok: false, why: checked.state }, 503, cors);

  // Le compteur est pris avant l'appel, avec la réservation du coût le plus haut possible : des demandes simultanées
  // ne peuvent pas dépasser le budget. S'il ne répond pas, pas d'appel (on ne dépense rien sans contrôle).
  const params = requestFor(kind, input.value);
  const reserved = costMax(params);
  const who = await fingerprint(visitorKey(req.headers));
  const quota = await rpc('fw_ia_reserve', {
    p_who: who, p_ip_day: LIMITS.perIpDay, p_ip_minute: LIMITS.perIpMinute, p_all_day: LIMITS.allDay,
    p_ip_cost: LIMITS.perIpCost, p_all_cost: LIMITS.allCost, p_cost: reserved,
  });
  if (!quota) return json({ ok: false, why: 'compteur' }, 503, cors);
  if (!quota.ok) return json({ ok: false, why: 'limite', detail: String(quota.why || '') }, 429, cors);
  // Le coût réel remplace la réservation (une seule fois).
  const settle = (cost: number) => rpc('fw_ia_spend', { p_day: quota.day, p_who: who, p_cost: cost - reserved });

  const t0 = Date.now();
  let msg: any;
  try {
    msg = await client().beta.messages.create(params as any);
  } catch (e) {
    const why = failure(e);
    // Erreur renvoyée par l'API ou connexion impossible : rien n'est facturé. Délai dépassé : l'appel a pu l'être,
    // la réservation reste comptée.
    if (!(e instanceof Anthropic.APIConnectionTimeoutError)) await settle(0);
    if (BAD.includes(why)) learn(t0, key, why);
    console.error(JSON.stringify({ kind, why }));
    return json({ ok: false, why }, 502, cors);
  }
  const ms = Date.now() - t0, cost = costOf(msg.usage, msg.model) ?? reserved;
  await settle(cost);
  learn(t0, key, 'pret');
  console.log(JSON.stringify({ kind, ms, stop: msg.stop_reason, model: msg.model, in: msg.usage?.input_tokens, out: msg.usage?.output_tokens, cost }));
  // Un refus (après le modèle de secours) ou une réponse coupée : rien d'utilisable, l'application répond par règles.
  if (msg.stop_reason === 'refusal') return json({ ok: false, why: 'refus', ms }, 200, cors);
  if (msg.stop_reason === 'max_tokens') return json({ ok: false, why: 'trop_long', ms }, 200, cors);
  const out = parse((Array.isArray(msg.content) ? msg.content : []).filter((b: any) => b && b.type === 'text').map((b: any) => b.text).join(''));
  if (!out || typeof out !== 'object' || Array.isArray(out)) return json({ ok: false, why: 'illisible', ms }, 200, cors);
  return json({ ok: true, kind, out, model: String(msg.model || MODEL), ms }, 200, cors);
});
