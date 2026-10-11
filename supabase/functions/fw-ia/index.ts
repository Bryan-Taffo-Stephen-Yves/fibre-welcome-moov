// Fonction « fw-ia » (Supabase Edge Function) : la seule porte de l'application vers Claude.
// La clé de l'API reste ici, dans les secrets de Supabase (ANTHROPIC_API_KEY) : elle n'est jamais envoyée au
// navigateur. Sans clé, la fonction répond « sans_cle » et l'application garde ses réponses par règles.
// Chaque visiteur a un plafond par minute et par jour, et toute l'application un plafond par jour
// (compteur fw_ia_take dans la base) : un inconnu ne peut pas vider le crédit.
// deno-lint-ignore-file no-explicit-any
import Anthropic from 'npm:@anthropic-ai/sdk@0.128.0';
import { LIMITS, MODEL, checkAssistantInput, checkPhotoInput, corsHeaders, originOk, requestFor, visitorKey } from './logic.js';

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

let anth: Anthropic | null = null;
let anthKey = '';
function client(): Anthropic {
  const k = env('ANTHROPIC_API_KEY');
  if (!anth || anthKey !== k) { anth = new Anthropic({ apiKey: k, maxRetries: 1, timeout: 50000 }); anthKey = k; }
  return anth;
}

// État affiché dans l'administration : clé absente, refusée, crédit épuisé, ou prête. Vérifié avec la fiche du modèle
// (gratuite) : au plus toutes les 10 minutes quand tout va bien, toutes les 2 minutes après un problème.
let checked = { at: 0, key: '', state: '' };
const BAD = ['cle_refusee', 'credit', 'modele_absent'];
const fresh = (key: string) => checked.key === key && Date.now() - checked.at < (checked.state === 'pret' ? 600000 : 120000);
async function status() {
  const key = env('ANTHROPIC_API_KEY');
  let state = 'sans_cle';
  if (key) {
    if (fresh(key)) state = checked.state;
    else {
      try { await client().models.retrieve(MODEL); state = 'pret'; }
      catch (e) { state = e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError ? 'cle_refusee' : e instanceof Anthropic.NotFoundError ? 'modele_absent' : 'injoignable'; }
      checked = { at: Date.now(), key, state };
    }
  }
  const today = await rpc('fw_ia_today', {});
  return { ok: true, state, model: MODEL, used: today && typeof today.used === 'number' ? today.used : null, max: LIMITS.allDay };
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
  const raw = await req.text();
  if (raw.length > LIMITS.body) return json({ ok: false, why: 'trop_gros' }, 413, cors);
  const body = parse(raw);
  const kind = body && (body.kind === 'photo' || body.kind === 'assistant') ? body.kind : null;
  if (!kind) return json({ ok: false, why: 'demande' }, 400, cors);
  const input = kind === 'photo' ? checkPhotoInput(body) : checkAssistantInput(body);
  if (!input.ok) return json({ ok: false, why: input.why }, 400, cors);
  if (!env('ANTHROPIC_API_KEY')) return json({ ok: false, why: 'sans_cle' }, 503, cors);
  // Clé refusée ou crédit épuisé il y a peu : on ne rappelle pas Claude et on ne compte pas la demande.
  if (fresh(env('ANTHROPIC_API_KEY')) && BAD.includes(checked.state)) return json({ ok: false, why: checked.state }, 503, cors);

  // Le compteur est pris avant l'appel : s'il ne répond pas, pas d'appel (on ne dépense rien sans contrôle).
  const quota = await rpc('fw_ia_take', { p_who: await fingerprint(visitorKey(req.headers)), p_ip_day: LIMITS.perIpDay, p_ip_minute: LIMITS.perIpMinute, p_all_day: LIMITS.allDay });
  if (!quota) return json({ ok: false, why: 'compteur' }, 503, cors);
  if (!quota.ok) return json({ ok: false, why: 'limite', detail: String(quota.why || '') }, 429, cors);

  const t0 = Date.now();
  try {
    const msg: any = await client().beta.messages.create(requestFor(kind, input.value) as any);
    const ms = Date.now() - t0;
    console.log(JSON.stringify({ kind, ms, stop: msg.stop_reason, model: msg.model, in: msg.usage?.input_tokens, out: msg.usage?.output_tokens }));
    // Un refus (après le modèle de secours) ou une réponse coupée : rien d'utilisable, l'application répond par règles.
    if (msg.stop_reason === 'refusal') return json({ ok: false, why: 'refus', ms }, 200, cors);
    if (msg.stop_reason === 'max_tokens') return json({ ok: false, why: 'trop_long', ms }, 200, cors);
    const out = parse((msg.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join(''));
    if (!out || typeof out !== 'object' || Array.isArray(out)) return json({ ok: false, why: 'illisible', ms }, 200, cors);
    return json({ ok: true, kind, out, model: String(msg.model || MODEL), ms }, 200, cors);
  } catch (e) {
    const why = failure(e);
    if (BAD.includes(why)) checked = { at: Date.now(), key: env('ANTHROPIC_API_KEY'), state: why };
    console.error(JSON.stringify({ kind, why }));
    return json({ ok: false, why }, 502, cors);
  }
});
