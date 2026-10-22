// Recette de la fonction « fw-ia » (logic.js et ia.sql) : taille de ce qui part chez Claude, pages autorisées, coût
// réel d'une réponse et réservation avant l'appel. Aucun appel réseau.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LIMITS, MODEL, PRICES, PROBE, checkAssistantInput, assistantUserText, requestFor, checkPhotoInput, costOf, costMax, originOk, corsHeaders } from '../supabase/functions/fw-ia/logic.js';

const item = (i, text = 'Dossier FW-2026-101 : étape « Prêt à planifier ». ' + 'x'.repeat(230)) => ({ id: 'F' + i, kind: 'fact', title: 'Élément ' + i, text });
const real = () => ({ question: 'Quand vient le technicien ?', ref: 'FW-2026-101', items: Array.from({ length: 13 }, (_, i) => item(i + 1)), history: [] });

test('Fonction fw-ia : caractères de contrôle et invisibles retirés partout', () => {
  const bad = '\u0001\u0002\u001b[31m\u200b\u202e\u2066\ufeff\u00ad\ud800';
  const v = checkAssistantInput({
    question: 'Où en est' + bad + ' mon\tdossier ?\u0007', ref: 'FW-2026\u0000-101',
    items: [{ id: 'F1', kind: 'fact', title: 'Ét' + bad + 'ape', text: 'Prêt\r\nà planifier' + bad }],
    history: [{ q: 'avant' + bad, a: 'réponse\u2028suite' + bad }, { q: '\u0001'.repeat(400), a: '\u0001'.repeat(600) }],
  });
  assert.equal(v.ok, true);
  assert.equal(v.value.question, 'Où en est[31m mon dossier ?');
  assert.equal(v.value.ref, 'FW-2026-101');
  assert.equal(v.value.items[0].title, 'Ét[31mape');
  assert.equal(v.value.items[0].text, 'Prêt \nà planifier[31m');
  assert.deepEqual(v.value.history, [{ q: 'avant[31m', a: 'réponse suite[31m' }], 'un échange fait seulement de caractères de contrôle disparaît');
  // Plus rien que JSON.stringify écrirait en \uXXXX (six fois plus long).
  assert.doesNotMatch(assistantUserText(v.value), /\\u[0-9a-f]{4}/i);
  // Le retour à la ligne d'une question reste, entre guillemets : c'est une donnée, pas une consigne.
  assert.match(assistantUserText(checkAssistantInput({ ...real(), question: 'a"\nb' }).value), /QUESTION DU CLIENT : "a\\"\\nb"/);
  // Une question faite seulement d'invisibles est vide.
  assert.equal(checkAssistantInput({ ...real(), question: '\u200b\u0001 \u2060' }).why, 'question_vide');
});

test('Fonction fw-ia : texte envoyé borné (vrai dossier accepté, texte gonflé refusé)', () => {
  // Un dossier plus chargé qu'un vrai (13 éléments de 280 caractères, quand un vrai fait 2 700 caractères en tout), avec
  // quatre échanges de longueur maximale, passe entier.
  const h = Array.from({ length: 4 }, (_, i) => ({ q: 'Question ' + i + ' ' + 'q'.repeat(80), a: 'r'.repeat(LIMITS.historyText) }));
  const ok = checkAssistantInput({ ...real(), history: h });
  assert.equal(ok.ok, true);
  assert.equal(ok.value.history.length, 4);
  assert.ok(assistantUserText(ok.value).length <= LIMITS.prompt);
  // Trop long avec les échanges : les plus anciens partent d'abord.
  const big = { ...real(), items: Array.from({ length: 10 }, (_, i) => item(i + 1, 'é'.repeat(LIMITS.itemText))), history: h.map((x, i) => ({ ...x, q: 'Q' + i })) };
  const cut = checkAssistantInput(big);
  assert.equal(cut.ok, true);
  assert.ok(cut.value.history.length < 4 && cut.value.history.length > 0, String(cut.value.history.length));
  assert.equal(cut.value.history.at(-1).q, 'Q3', 'le dernier échange reste');
  assert.ok(assistantUserText(cut.value).length <= LIMITS.prompt);
  // Trop long sans les échanges : refusé (24 éléments de 600 caractères, et la fonction répond 413).
  const huge = checkAssistantInput({ ...real(), items: Array.from({ length: LIMITS.items }, (_, i) => item(i + 1, '漢'.repeat(LIMITS.itemText))) });
  assert.deepEqual(huge, { ok: false, why: 'trop_gros' });
  // Chaque champ garde sa propre limite.
  const long = checkAssistantInput({ ...real(), question: 'q'.repeat(2000), items: [item(1, 't'.repeat(5000))] });
  assert.equal(long.value.question.length, LIMITS.question);
  assert.equal(long.value.items[0].text.length, LIMITS.itemText);
});

test('Fonction fw-ia : pages autorisées (plus l’origine « null »)', () => {
  // L'origine « null » est celle d'un fichier ouvert sur l'ordinateur, mais aussi de n'importe quel site dans un cadre
  // isolé : refusée. Sans en-tête Origin (appel hors navigateur), la demande passe ; les plafonds protègent.
  assert.equal(originOk('null'), false);
  assert.equal(corsHeaders('null')['Access-Control-Allow-Origin'], undefined);
  for (const o of [null, undefined, '']) assert.equal(originOk(o), true);
  assert.equal(originOk('https://bryan-taffo-stephen-yves.github.io'), true);
  assert.equal(originOk('http://localhost:8000'), true);
  assert.equal(originOk('http://127.0.0.1'), true);
  assert.equal(originOk('https://evil.example'), false);
  assert.equal(originOk('file://'), false);
});

test('Fonction fw-ia : coût réel d’une réponse (avec et sans modèle de secours)', () => {
  // Sans usage.iterations : un seul essai, au tarif du modèle qui a répondu (micro-dollars, arrondi au-dessus).
  assert.equal(costOf({ input_tokens: 1000, output_tokens: 500 }, MODEL), 1000 * 4 + 500 * 20);
  assert.equal(costOf({ input_tokens: 1000, cache_creation_input_tokens: 800, cache_read_input_tokens: 2000, output_tokens: 1 }, MODEL), Math.ceil(1000 * 4 + 800 * 4 * 1.25 + 2000 * 4 * 0.1 + 20));
  assert.equal(costOf({ input_tokens: 1000, output_tokens: 500 }, 'claude-opus-5'), 1000 * 5 + 500 * 25, 'modèle de secours : son tarif');
  assert.equal(costOf({ input_tokens: 1000, output_tokens: 500 }, undefined), 1000 * 5 + 500 * 25, 'modèle inconnu : le tarif le plus haut');
  assert.equal(costOf({ input_tokens: 3, output_tokens: 1, cache_read_input_tokens: null, iterations: null }, MODEL), 32);
  assert.equal(costOf(null, MODEL), null);
  assert.equal(costOf(undefined, MODEL), null);
  // Avec usage.iterations : chaque essai compte (le premier refusé, puis celui de secours), le haut niveau ne compte pas
  // en plus (il ne décrit que le dernier essai).
  const last = { type: 'fallback_message', model: 'claude-opus-5', input_tokens: 1800, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 400 };
  const usage = { input_tokens: 1800, output_tokens: 400, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, iterations: [{ type: 'message', model: MODEL, input_tokens: 1800, cache_creation_input_tokens: 600, cache_read_input_tokens: 0, output_tokens: 0 }, last] };
  assert.equal(costOf(usage, 'claude-opus-5'), 1800 * 4 + 600 * 4 * 1.25 + 1800 * 5 + 400 * 25);
  // Essai sans modèle indiqué : tarif le plus haut ; valeurs absurdes ignorées.
  assert.equal(costOf({ iterations: [{ type: 'message', model: null, input_tokens: 100, output_tokens: 10 }, { type: 'compaction', input_tokens: -5, output_tokens: 'x' }, null] }, MODEL), 100 * 5 + 10 * 25);
  assert.deepEqual(PRICES[MODEL], { in: 4, out: 20 });
});

test('Fonction fw-ia : réservation avant l’appel, sorties bornées, budgets', () => {
  const a = requestFor('assistant', checkAssistantInput(real()).value);
  const p = requestFor('photo', checkPhotoInput({ docType: 'cni_recto', mediaType: 'image/jpeg', data: 'A'.repeat(LIMITS.image) }).value);
  // Réponses courtes (au plus 700 caractères), réflexion comprise : assez de place, pas plus.
  assert.equal(a.max_tokens, 2000);
  assert.equal(p.max_tokens, 1500);
  // La réservation couvre le pire : deux essais au tarif le plus haut, toute la sortie, chaque octet comme un jeton.
  const bytes = s => new TextEncoder().encode(s).length;
  for (const r of [a, p]) {
    const text = r.messages[0].content.filter ? r.messages[0].content.filter(c => c.type === 'text').map(c => c.text).join('') : r.messages[0].content;
    const worst = costOf({ iterations: [0, 1].map(() => ({ type: 'message', model: null, input_tokens: 0, cache_creation_input_tokens: bytes(r.system[0].text + text), output_tokens: r.max_tokens })) });
    assert.ok(costMax(r) >= worst, [costMax(r), worst].join(' < '));
  }
  // Une image compte au plus 5 000 jetons, pas la taille de son texte base64.
  assert.ok(costMax(p) < 300000, String(costMax(p)));
  assert.ok(costMax(a) > 100000 && costMax(a) < 300000, String(costMax(a)));
  // Un texte gonflé (caractères de 3 octets) réserve plus, mais reste borné par LIMITS.prompt.
  const fat = requestFor('assistant', checkAssistantInput({ ...real(), items: Array.from({ length: 13 }, (_, i) => item(i + 1, '漢'.repeat(450))) }).value);
  assert.ok(costMax(fat) > costMax(a) && costMax(fat) < 600000, String(costMax(fat)));
  // Vérification de la clé : le plus petit vrai appel, sans format imposé.
  assert.ok(PROBE.max_tokens <= 32 && PROBE.model === MODEL && !PROBE.output_config.format && !('system' in PROBE));
  assert.ok(costMax(PROBE) < 20000);
  // Budgets : 1 dollar par visiteur et 3 pour toute l'application, par jour (micro-dollars).
  assert.equal(LIMITS.perIpCost, 1000000);
  assert.equal(LIMITS.allCost, 3000000);
});

test('ia.sql : rejouable tel quel sur la base en service', () => {
  const sql = readFileSync(new URL('../supabase/ia.sql', import.meta.url), 'utf8');
  // L'outil qui applique les migrations bloque sur ces deux mots, même en commentaire.
  assert.doesNotMatch(sql, /drop|delete/i);
  assert.match(sql, /alter table public\.fw_ia_use add column if not exists cost bigint not null default 0;/);
  assert.match(sql, /create table if not exists public\.fw_ia_use/);
  // Chaque fonction : créée ou remplacée, fermée au public, ouverte à la seule fonction (service_role).
  const fns = [...sql.matchAll(/create or replace function (public\.\w+)\(([^)]*)\)/g)];
  assert.deepEqual(fns.map(f => f[1]).sort(), ['public.fw_ia_reserve', 'public.fw_ia_spend', 'public.fw_ia_today']);
  for (const [, name, args] of fns) {
    const types = args.split(',').map(s => s.trim().split(/\s+/)[1]).filter(Boolean).join(', ');
    assert.ok(sql.includes('revoke all on function ' + name + '(' + types + ') from public, anon, authenticated;'), name);
    assert.ok(sql.includes('grant execute on function ' + name + '(' + types + ') to service_role;'), name);
  }
  assert.match(sql, /fw_ia_today\(\)\s+returns jsonb/);
});
