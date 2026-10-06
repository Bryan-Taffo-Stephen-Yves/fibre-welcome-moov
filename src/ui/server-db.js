// Accès au serveur de démonstration (Supabase), avec les mêmes gestes que la petite base de l'aperçu en ligne :
// doc(chemin).get(), .set(), .acquire() et .onSnapshot(). Le serveur n'expose que quelques fonctions (voir
// supabase/schema.sql) ; les autres appareils sont suivis en demandant régulièrement les numéros de version.
// Chaque document a un numéro de version (rev) donné par le serveur. Une écriture peut exiger que le document
// soit encore à la version lue (expected) : sinon le serveur refuse et l'appareil relit avant de réessayer.

const TIMEOUT = 10000;
const EVERY = 1500, EVERY_HIDDEN = 6000, MUTE = 15000;

// Réception d'une réponse : le délai repart à chaque morceau reçu. Une réponse qui se bloque en route (connexion
// perdue) est abandonnée au lieu de figer le suivi et les actions ; une réponse lente mais qui avance va au bout.
async function readBody(r, arm) {
  if (!r.body || typeof r.body.getReader !== 'function' || typeof TextDecoder !== 'function') return r.text();
  const rd = r.body.getReader(), dec = new TextDecoder();
  let s = '';
  arm(TIMEOUT);
  for (;;) {
    const { done, value } = await rd.read();
    if (done) return s + dec.decode();
    s += dec.decode(value, { stream: true });
    arm(TIMEOUT);
  }
}

export function serverDb({ url, key }) {
  const headers = { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };
  async function rpc(fn, body) {
    const payload = JSON.stringify(body);
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    let t = null;
    const arm = ms => { if (!ctl) return; if (t) clearTimeout(t); t = setTimeout(() => ctl.abort(), ms); };
    // Envoi : le délai grandit avec la taille, pour qu'une photo (jusqu'à 230 Ko) parte aussi sur une liaison lente.
    arm(TIMEOUT + Math.ceil(payload.length / 12000) * 1000);
    try {
      let r, txt;
      try {
        r = await fetch(url + '/rest/v1/rpc/' + fn, { method: 'POST', headers, body: payload, cache: 'no-store', signal: ctl ? ctl.signal : undefined });
        txt = await readBody(r, arm);
      } catch (e) { throw Object.assign(new Error('Serveur injoignable'), { code: 'network' }); }
      if (!r.ok) {
        let m = ''; try { m = JSON.parse(txt).message || ''; } catch {}
        throw Object.assign(new Error(m || 'Erreur du serveur (' + r.status + ')'), { code: r.status === 401 || r.status === 403 ? 'not_granted' : r.status === 400 ? 'invalid_argument' : 'server', status: r.status });
      }
      return txt ? JSON.parse(txt) : null;
    } finally { if (t) clearTimeout(t); }
  }

  // Dernière version connue de chaque document (lue, écrite ou reçue) : on ne renvoie pas à l'appareil ce qu'il a déjà.
  const seen = {}, muted = {};
  const watchers = new Map();
  let timer = null, running = false;
  const snap = d => ({ exists: !!d, rev: d ? Number(d.rev) : null, data: () => (d ? d.data : undefined), metadata: { hasPendingWrites: false } });
  const note = (path, rev) => { if (rev != null) seen[path] = Math.max(seen[path] || 0, Number(rev)); };

  async function tick() {
    timer = null;
    if (running) return;
    running = true;
    try {
      const now = Date.now();
      const paths = [...watchers.keys()].filter(p => !(muted[p] > now));
      if (paths.length) {
        const revs = (await rpc('fw_revs', { p_paths: paths })) || {};
        for (const p of paths) {
          const r = revs[p];
          // Document absent (effacé par le nettoyage) : on le surveille moins souvent, et une nouvelle version 1 sera bien reçue.
          if (r == null) { seen[p] = 0; muted[p] = now + MUTE; continue; }
          if (Number(r) <= (seen[p] || 0)) continue;
          const d = await rpc('fw_get', { p_path: p });
          if (!d || Number(d.rev) <= (seen[p] || 0)) continue;
          note(p, d.rev);
          for (const cb of [...(watchers.get(p) || [])]) { try { cb(snap(d)); } catch {} }
        }
      }
    } catch {} // réseau coupé : on réessaie au tour suivant
    finally { running = false; schedule(); }
  }
  function schedule(ms) {
    if (timer || !watchers.size) return;
    const hidden = typeof document !== 'undefined' && document.hidden;
    timer = setTimeout(tick, ms != null ? ms : hidden ? EVERY_HIDDEN : EVERY);
  }
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { if (!document.hidden) { if (timer) { clearTimeout(timer); timer = null; } schedule(0); } });

  return {
    kind: 'server',
    // Efface les images et les sauvegardes d'un espace : toutes (suppression), ou celles d'une autre génération que
    // keepGen (réinitialisation).
    purge: (wsId, keepGen = null) => rpc('fw_purge', { p_ws: wsId, p_gen: keepGen }),
    doc(path) {
      return {
        async get() { const d = await rpc('fw_get', { p_path: path }); if (d) note(path, d.rev); return snap(d); },
        // opts.expected : version attendue (0 = le document ne doit pas exister). Réponse { rev } ou { conflict: true }.
        async set(data, opts) {
          const rev = await rpc('fw_set', { p_path: path, p_data: data, p_expected_rev: opts && opts.expected != null ? opts.expected : null });
          if (rev == null || Number(rev) < 0) return { conflict: true };
          note(path, rev); delete muted[path];
          return { rev: Number(rev) };
        },
        acquire({ holder, ttlMs }) { return rpc('fw_acquire', { p_path: path, p_holder: holder, p_ttl_ms: ttlMs }); },
        onSnapshot(cb) {
          if (!watchers.has(path)) watchers.set(path, new Set());
          watchers.get(path).add(cb);
          delete muted[path];
          schedule(200);
          return () => { const s = watchers.get(path); if (s) { s.delete(cb); if (!s.size) watchers.delete(path); } };
        },
      };
    },
  };
}
