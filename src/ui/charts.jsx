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
const COMMUNES = [
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
