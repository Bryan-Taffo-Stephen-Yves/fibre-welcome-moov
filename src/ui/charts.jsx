// Petits graphiques en SVG (courbes, barres, anneau, carte d'Abidjan), sans bibliothèque externe.
const React = window.React;
let gid = 0;

// Courbe d'évolution. data = liste de nombres.
export function Sparkline({ data = [], width = 120, height = 36, color = 'var(--accent)', fill = true, label }) {
  const id = React.useMemo(() => 'sp' + (++gid), []);
  if (data.length < 2) return <svg width={width} height={height} aria-hidden="true" />;
  const min = Math.min(...data), max = Math.max(...data), span = max - min || 1;
  const pts = data.map((v, i) => [i / (data.length - 1) * (width - 4) + 2, height - 4 - (v - min) / span * (height - 8)]);
  const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('');
  const last = pts[pts.length - 1];
  return <svg className="spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : 'true'}>
    <defs><linearGradient id={id} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={color} stopOpacity=".28" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient></defs>
    {fill && <path d={d + `L${last[0]} ${height}L${pts[0][0]} ${height}Z`} fill={`url(#${id})`} />}
    <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    <circle cx={last[0]} cy={last[1]} r="3" fill={color} />
  </svg>;
}

// Barres arrondies. data = [{ label, value, hi }].
export function Bars({ data = [], height = 150, color = 'var(--bar)', hiColor = 'var(--accent)', unit = '', showValues = true }) {
  const max = Math.max(1, ...data.map(d => d.value));
  return <div className="bars" style={{ height }} role="img" aria-label={data.map(d => d.label + ' : ' + d.value + unit).join(', ')}>
    {data.map((d, i) => <div key={i} className="bars-col">
      {showValues && <span className="bars-v num">{d.value}{unit}</span>}
      <div className="bars-track"><div className="bars-fill" style={{ height: Math.max(3, d.value / max * 100) + '%', background: d.hi ? hiColor : color }} /></div>
      <span className="bars-l">{d.label}</span>
    </div>)}
  </div>;
}

// Anneau de progression (ex. étape 4 sur 10).
export function Ring({ value, max = 1, size = 64, stroke = 7, color = 'var(--accent)', track = 'var(--ring-track)', children }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r, p = Math.max(0, Math.min(1, value / max));
  return <span className="ring" style={{ width: size, height: size }}>
    <svg width={size} height={size} aria-hidden="true"><circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />{p > 0 && <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${c * p} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />}</svg>
    <span className="ring-in">{children}</span>
  </span>;
}

// Barre segmentée (parts d'un tout). parts = [{ value, color, label }].
export function Stacked({ parts = [], height = 10 }) {
  const t = parts.reduce((a, p) => a + p.value, 0) || 1;
  return <div className="stacked" style={{ height }} role="img" aria-label={parts.map(p => p.label + ' ' + p.value).join(', ')}>{parts.filter(p => p.value > 0).map((p, i) => <i key={i} style={{ width: p.value / t * 100 + '%', background: p.color }} title={p.label + ' : ' + p.value} />)}</div>;
}

// Carte stylisée d'Abidjan. zones = { cocody: { count, tone }, ... }. Les communes hors périmètre restent grises.
export const COMMUNES = [
  { id: 'abobo', name: 'Abobo', d: 'M140 14L262 8L282 40L270 78L204 84L150 80L132 50Z', c: [208, 46] },
  { id: 'yopougon', name: 'Yopougon', d: 'M20 70L132 50L150 80L146 112L128 150L60 160L18 132Z', c: [82, 108] },
  { id: 'adjame', name: 'Adjamé', d: 'M150 80L204 84L206 118L160 122L146 112Z', c: [176, 102], ctx: 1 },
  { id: 'attecoube', name: '', d: 'M128 150L146 112L160 122L166 150Z', c: [150, 136], ctx: 1 },
  { id: 'cocody', name: 'Cocody', d: 'M204 84L270 78L330 74L340 110L328 146L262 150L214 142L206 118Z', c: [270, 112] },
  { id: 'bingerville', name: 'Bingerville', d: 'M330 74L388 70L394 120L378 150L328 146L340 110Z', c: [362, 110] },
  { id: 'plateau', name: 'Plateau', d: 'M160 122L206 118L214 142L196 152L166 150Z', c: [186, 138], ctx: 1 },
  { id: 'treichville', name: '', d: 'M150 188L204 186L206 214L154 218Z', c: [178, 202], ctx: 1 },
  { id: 'marcory', name: 'Marcory', d: 'M204 186L262 184L266 212L206 214Z', c: [234, 200] },
  { id: 'koumassi', name: 'Koumassi', d: 'M262 184L326 182L332 210L266 212Z', c: [297, 198], ctx: 1 },
  { id: 'portbouet', name: 'Port-Bouët', d: 'M120 222L154 218L206 214L266 212L332 210L372 216L364 238L130 244Z', c: [246, 231], ctx: 1 },
];
export function AbidjanMap({ zones = {}, onPick, selected, height = 240 }) {
  const max = Math.max(1, ...Object.values(zones).map(z => z.count || 0));
  return <svg className="map" viewBox="0 0 400 260" style={{ height, width: '100%' }} role="img" aria-label={'Carte d’Abidjan : ' + COMMUNES.filter(c => zones[c.id]).map(c => c.name + ' ' + (zones[c.id].count || 0)).join(', ')}>
    <path d="M0 150c40 4 80 10 130 6s70-6 100-2 70 6 110 0 50-4 60-2v36c-30-2-70 6-110 4s-60-6-100-4-70 8-110 6S30 184 0 188z" fill="var(--map-water)" />
    {COMMUNES.map(c => {
      const z = zones[c.id]; const n = z ? z.count || 0 : 0;
      const fill = c.ctx ? 'var(--map-ctx)' : !z ? 'var(--map-land)' : `color-mix(in srgb, var(--accent) ${Math.round(12 + n / max * 58)}%, var(--map-land))`;
      return <path key={c.id} d={c.d} fill={fill} stroke="var(--map-stroke)" strokeWidth="3" strokeLinejoin="round" className={onPick && !c.ctx ? 'map-zone' : undefined} onClick={onPick && !c.ctx ? () => onPick(c.id) : undefined} />;
    })}
    {selected && COMMUNES.filter(c => c.id === selected).map(c => <path key="sel" d={c.d} fill="none" stroke="var(--ink)" strokeWidth="2.5" strokeLinejoin="round" pointerEvents="none" />)}
    {COMMUNES.map(c => { const z = zones[c.id]; const n = z ? z.count || 0 : 0; return c.name ? <text key={c.id} x={c.c[0]} y={c.c[1] + (n ? 20 : 4)} textAnchor="middle" className="map-label" pointerEvents="none">{c.name}</text> : null; })}
    {COMMUNES.map(c => { const z = zones[c.id]; const n = z ? z.count || 0 : 0; return z && n > 0 ? <g key={c.id} transform={`translate(${c.c[0]} ${c.c[1] - 2})`} pointerEvents="none">
      <path d="M0 10c-7-8-11-12-11-18a11 11 0 0122 0c0 6-4 10-11 18z" fill={z.tone === 'bad' ? 'var(--bad)' : 'var(--ink)'} />
      <text y="-5" textAnchor="middle" className="map-pin" style={{ fill: z.tone === 'bad' ? '#fff' : 'var(--bg)' }}>{n}</text>
    </g> : null; })}
  </svg>;
}

// Centre d'une commune sur la carte (pour placer l'agence, le client, le technicien).
export const communeCenter = id => { const c = COMMUNES.find(x => x.id === id); return c ? c.c : [200, 130]; };
const WATER = 'M0 150c40 4 80 10 130 6s70-6 100-2 70 6 110 0 50-4 60-2v36c-30-2-70 6-110 4s-60-6-100-4-70 8-110 6S30 184 0 188z';
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

// Suivi du trajet du technicien, façon application de taxi : agence → domicile du client.
// p : avancement de 0 à 1 (calculé par l'appelant à partir de l'heure de départ et de la durée prévue).
export function TrackMap({ from = 'plateau', to = 'cocody', p = 0, arrived = false, height = 200, fromLabel = 'Agence', toLabel = 'Chez vous', label }) {
  const A = communeCenter(from), B = communeCenter(to);
  const dx = B[0] - A[0], dy = B[1] - A[1], len = Math.hypot(dx, dy) || 1;
  // Une route légèrement courbe plutôt qu'une ligne droite.
  const C = [(A[0] + B[0]) / 2 - dy / len * len * 0.28, (A[1] + B[1]) / 2 + dx / len * len * 0.28];
  const t = arrived ? 1 : Math.max(0, Math.min(1, p));
  const Q1 = lerp(A, C, t), P = lerp(Q1, lerp(C, B, t), t);
  const route = `M${A[0]} ${A[1]}Q${C[0]} ${C[1]} ${B[0]} ${B[1]}`;
  const done = `M${A[0]} ${A[1]}Q${Q1[0]} ${Q1[1]} ${P[0]} ${P[1]}`;
  // Cadrage : on zoome sur le trajet (avec une marge), sans sortir de la carte.
  const xs = [A[0], B[0], C[0]], ys = [A[1], B[1], C[1]];
  const pad = 46;
  let x0 = Math.max(0, Math.min(...xs) - pad), x1 = Math.min(400, Math.max(...xs) + pad), y0 = Math.max(0, Math.min(...ys) - pad), y1 = Math.min(260, Math.max(...ys) + pad);
  const ratio = 400 / 260; if ((x1 - x0) / (y1 - y0) < ratio) { const w = (y1 - y0) * ratio; const cx = (x0 + x1) / 2; x0 = Math.max(0, cx - w / 2); x1 = Math.min(400, x0 + w); } else { const h = (x1 - x0) / ratio; const cy = (y0 + y1) / 2; y0 = Math.max(0, cy - h / 2); y1 = Math.min(260, y0 + h); }
  return <svg className="map track-map" viewBox={`${x0} ${y0} ${x1 - x0} ${y1 - y0}`} style={{ height, width: '100%' }} role="img" aria-label={label || ('Trajet du technicien : ' + Math.round(t * 100) + ' % du chemin parcouru')}>
    <rect x="0" y="0" width="400" height="260" fill="var(--map-ctx)" />
    <path d={WATER} fill="var(--map-water)" />
    {COMMUNES.map(c => <path key={c.id} d={c.d} fill={c.id === to ? 'color-mix(in srgb, var(--accent) 22%, var(--map-land))' : c.ctx ? 'var(--map-ctx)' : 'var(--map-land)'} stroke="var(--map-stroke)" strokeWidth="2.5" strokeLinejoin="round" />)}
    {/* Les communes de départ et d'arrivée portent déjà leur étiquette (agence, client) : leur nom ne s'y superpose pas. */}
    {/* Seulement les noms entièrement dans le cadre (pas de « B » coupé au bord). */}
    {COMMUNES.filter(c => c.name && c.id !== from && c.id !== to && c.c[0] - c.name.length * 2.7 >= x0 + 2 && c.c[0] + c.name.length * 2.7 <= x1 - 2 && c.c[1] + 18 <= y1 - 2 && c.c[1] + 10 >= y0).map(c => <text key={c.id} x={c.c[0]} y={c.c[1] + 18} textAnchor="middle" className="map-label" style={{ fontSize: 9, opacity: 0.7 }} pointerEvents="none">{c.name}</text>)}
    <path d={route} fill="none" stroke="var(--ink)" strokeOpacity=".25" strokeWidth="4" strokeLinecap="round" strokeDasharray="1 7" />
    <path d={done} fill="none" stroke="var(--accent)" strokeWidth="4" strokeLinecap="round" />
    <g transform={`translate(${A[0]} ${A[1]})`}><circle r="5" fill="var(--surface, #fff)" stroke="var(--ink)" strokeWidth="2" /><text y="17" textAnchor="middle" className="map-label" style={{ fontSize: 9, fontWeight: 700 }}>{fromLabel}</text></g>
    <g transform={`translate(${B[0]} ${B[1]})`}>
      <path d="M0 2c-7-8-11-12-11-18a11 11 0 0122 0c0 6-4 10-11 18z" fill="var(--ink)" />
      <path d="M-5 -15l5-4.5 5 4.5v5h-10z" fill="var(--bg, #fff)" />
    </g>
    {/* Étiquette de la destination au-dessus de l'épingle, sur une pastille : ni la route ni la camionnette ne la cachent. */}
    <g transform={`translate(${B[0]} ${B[1] - 34})`} pointerEvents="none">
      <rect className="track-pin-label" x={-(String(toLabel).length * 2.9 + 7)} y="-8" width={String(toLabel).length * 5.8 + 14} height="15" rx="7.5" />
      <text y="3" textAnchor="middle" className="map-label" style={{ fontSize: 9, fontWeight: 700 }}>{toLabel}</text>
    </g>
    <g transform={`translate(${P[0]} ${P[1]})`} className="track-van">
      {!arrived && <circle r="13" fill="var(--accent)" opacity=".18"><animate attributeName="r" values="9;16;9" dur="1.8s" repeatCount="indefinite" /></circle>}
      <circle r="9" fill="var(--accent)" stroke="#fff" strokeWidth="2" />
      <path d="M-5 1.5v-4.5h6l2.5 2.5v2h-8.5zM-3 3a1.2 1.2 0 100-.01M2 3a1.2 1.2 0 100-.01" fill="#fff" stroke="#fff" strokeWidth=".8" strokeLinejoin="round" />
    </g>
  </svg>;
}

// Carte d'ensemble des trajets : plusieurs camionnettes sur la carte d'Abidjan, une épingle par client.
// items : [{ id, from, to, p (0 à 1), arrived, tone ('route' | 'ici' | 'attente' | 'fin'), label }]. L'avancement est calculé par l'appelant.
// selected : id mis en valeur ; onPick(id) : clic ou touche Entrée sur une camionnette ou une épingle.
const TONE_COLOR = { route: 'var(--accent)', ici: 'var(--ok)', attente: 'var(--warn)', fin: 'var(--ink-3)' };
export function TripsMap({ items = [], selected, onPick, height = 260, label }) {
  // Les épingles d'une même commune sont décalées pour rester toutes visibles.
  const perTo = {}; for (const it of items) perTo[it.to] = (perTo[it.to] || 0) + 1;
  const seen = {};
  const geo = items.map((it, k) => {
    const A = communeCenter(it.from), B0 = communeCenter(it.to);
    const i = seen[it.to] = (seen[it.to] || 0) + 1, n = perTo[it.to];
    const B = [B0[0] + (i - 1 - (n - 1) / 2) * 11, B0[1]];
    const dx = B[0] - A[0], dy = B[1] - A[1], len = Math.hypot(dx, dy) || 1;
    // Chaque trajet a sa propre courbure : deux routes entre les mêmes communes ne se superposent pas.
    const bend = 0.2 + (k % 3) * 0.09;
    const C = [(A[0] + B[0]) / 2 - dy / len * len * bend, (A[1] + B[1]) / 2 + dx / len * len * bend];
    const t = it.arrived ? 1 : Math.max(0, Math.min(1, it.p || 0));
    const Q1 = lerp(A, C, t), P = lerp(Q1, lerp(C, B, t), t);
    return { it, A, B, C, P, Q1, t };
  });
  const sel = geo.find(g => g.it.id === selected);
  const ordered = sel ? [...geo.filter(g => g !== sel), sel] : geo; // la visite choisie est dessinée en dernier, donc au-dessus
  const pick = id => onPick && (() => onPick(id));
  const keyPick = id => onPick && (e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(id); } });
  const dim = sel ? 0.45 : 1;
  const lab = sel && sel.it.label ? String(sel.it.label) : '';
  return <div className="trips-map">
    <svg className="map trips-map-svg" viewBox="0 0 400 260" style={{ height, width: '100%' }} role="group" aria-label={label || ('Carte des trajets : ' + items.length + ' camionnette' + (items.length > 1 ? 's' : ''))}>
      <rect x="0" y="0" width="400" height="260" fill="var(--map-ctx)" />
      <path d={WATER} fill="var(--map-water)" />
      {COMMUNES.map(c => <path key={c.id} d={c.d} fill={c.ctx ? 'var(--map-ctx)' : 'var(--map-land)'} stroke="var(--map-stroke)" strokeWidth="2.5" strokeLinejoin="round" />)}
      {COMMUNES.filter(c => c.name).map(c => <text key={c.id} x={c.c[0]} y={c.c[1] + 4} textAnchor="middle" className="map-label" style={{ fontSize: 9, opacity: 0.55 }} pointerEvents="none">{c.name}</text>)}
      {ordered.map(({ it, A, B, C, P, Q1, t }) => {
        const on = sel && sel.it.id === it.id, col = TONE_COLOR[it.tone] || 'var(--accent)';
        const op = on ? 1 : dim;
        return <g key={it.id} opacity={op}>
          <path d={`M${A[0]} ${A[1]}Q${C[0]} ${C[1]} ${B[0]} ${B[1]}`} fill="none" stroke="var(--ink)" strokeOpacity={on ? 0.35 : 0.2} strokeWidth={on ? 3.5 : 2} strokeLinecap="round" strokeDasharray="1 6" />
          <path d={`M${A[0]} ${A[1]}Q${Q1[0]} ${Q1[1]} ${P[0]} ${P[1]}`} fill="none" stroke={col} strokeWidth={on ? 4 : 2.5} strokeLinecap="round" />
          <g transform={`translate(${B[0]} ${B[1]})`} className={onPick ? 'trips-hit' : undefined} role={onPick ? 'button' : undefined} tabIndex={onPick ? 0 : undefined} aria-label={onPick ? 'Client : ' + (it.label || it.id) : undefined} onClick={pick(it.id)} onKeyDown={keyPick(it.id)}>
            <path d="M0 2c-5.5-6.5-8.5-9.5-8.5-14a8.5 8.5 0 0117 0c0 4.5-3 7.5-8.5 14z" fill={on ? col : 'var(--ink)'} stroke={on ? 'var(--surface, #fff)' : 'none'} strokeWidth="1.5" />
            <circle cy="-12" r="3" fill="var(--bg, #fff)" />
          </g>
          <g transform={`translate(${P[0]} ${P[1]})`} className={onPick ? 'trips-hit' : undefined} role={onPick ? 'button' : undefined} tabIndex={onPick ? 0 : undefined} aria-label={onPick ? 'Camionnette : ' + (it.label || it.id) : undefined} onClick={pick(it.id)} onKeyDown={keyPick(it.id)}>
            {on && <circle r="15" fill={col} opacity=".2"><animate attributeName="r" values="11;18;11" dur="1.8s" repeatCount="indefinite" /></circle>}
            {on && <circle r="12" fill="none" stroke="var(--ink)" strokeWidth="1.6" />}
            <circle r={on ? 9 : 7} fill={col} stroke="#fff" strokeWidth="2" />
            <path d={on ? 'M-5 1.5v-4.5h6l2.5 2.5v2h-8.5zM-3 3a1.2 1.2 0 100-.01M2 3a1.2 1.2 0 100-.01' : 'M-3.6 1v-3.2h4.3l1.8 1.8v1.4h-6.1z'} fill="#fff" stroke="#fff" strokeWidth=".8" strokeLinejoin="round" />
            {t >= 1 && it.tone === 'fin' && <path d="M-3 0l2 2 4-4" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />}
          </g>
        </g>;
      })}
      {sel && lab && <g transform={`translate(${Math.max(34, Math.min(366, sel.P[0]))} ${sel.P[1] > 40 ? sel.P[1] - 24 : sel.P[1] + 28})`} pointerEvents="none">
        <rect className="track-pin-label" x={-(lab.length * 2.9 + 7)} y="-8" width={lab.length * 5.8 + 14} height="15" rx="7.5" />
        <text y="3" textAnchor="middle" className="map-label" style={{ fontSize: 9, fontWeight: 700 }}>{lab}</text>
      </g>}
    </svg>
    <ul className="trips-legend" aria-label="Légende de la carte">
      <li><i className="trips-lg trips-lg-van" style={{ background: TONE_COLOR.route }} />En route</li>
      <li><i className="trips-lg trips-lg-van" style={{ background: TONE_COLOR.ici }} />Chez le client</li>
      <li><i className="trips-lg trips-lg-van" style={{ background: TONE_COLOR.attente }} />Attend la validation</li>
      <li><i className="trips-lg trips-lg-van" style={{ background: TONE_COLOR.fin }} />Terminé</li>
      <li><i className="trips-lg trips-lg-pin" />Client</li>
      <li><i className="trips-lg trips-lg-sel" />Visite choisie</li>
    </ul>
  </div>;
}
