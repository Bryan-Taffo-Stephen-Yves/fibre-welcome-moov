// Personnages dessinés (style « bitmoji ») et petites illustrations, en SVG pur :
// l'aperçu en ligne interdit les images externes, tout est donc dessiné ici.
const React = window.React;

const SKINS = [['#5b3a24', '#4a2e1c'], ['#734528', '#5f381f'], ['#8a5533', '#734527'], ['#a0663e', '#865232'], ['#b8794b', '#9c653d']];
const HAIR = '#1c1512';
const PASTELS = ['#ffe3d8', '#e2eaff', '#efe8ff', '#dff5e8', '#fff1c9', '#fde2ee', '#e3f1f7', '#f1f6d6'];
const SHIRTS = ['#ef3a4a', '#3a6df0', '#7c5cff', '#16a37a', '#f59e0b', '#db2777', '#0f766e', '#334155'];
const FEMALE = new Set(['Awa', 'Mariam', 'Aminata', 'Fatou', 'Adjoua', 'Nadia', 'Salimata', 'Aïcha', 'Aya']);

// Les personnages de la démo ont un look fixe, les autres noms reçoivent un look stable calculé.
export const PEOPLE = {
  'Awa Kouassi': { f: 1, skin: 2, hair: 'braids', shirt: '#ef3a4a', bg: '#ffe3d8', earrings: 1 },
  'Koffi Bamba': { skin: 1, hair: 'short', beard: 1, shirt: '#3a6df0', bg: '#e2eaff' },
  'Seydou Traoré': { skin: 0, hair: 'cap', cap: '#22252b', shirt: '#64748b', bg: '#ece6da' },
  'Nadia Konan': { f: 1, skin: 3, hair: 'puff', headset: 1, shirt: '#7c5cff', bg: '#efe8ff', earrings: 1 },
  'Hervé Ouattara': { skin: 1, hair: 'fade', glasses: 1, shirt: '#0f766e', collar: 1, bg: '#dcf3ec' },
  'Brice Yao': { skin: 2, hair: 'helmet', helmet: '#f5b700', vest: 1, shirt: '#f97316', bg: '#fff1c9' },
  'Moussa Koné': { skin: 0, hair: 'helmet', helmet: '#f5b700', vest: 1, beard: 1, shirt: '#f97316', bg: '#fde7d4' },
  'Didier Aka': { skin: 1, hair: 'cap', cap: '#2563eb', vest: 1, shirt: '#16a37a', bg: '#dff5e8' },
  'Salimata Diabaté': { f: 1, skin: 1, hair: 'wrap', wrap: '#f59e0b', shirt: '#1f2937', blazer: 1, bg: '#fdf3d6', earrings: 1 },
  'Jean-Marc N’Guessan': { skin: 2, hair: 'short', glasses: 1, beard: 2, tie: 1, shirt: '#1e293b', bg: '#e2e8f0' },
  'Fatou Touré': { f: 1, skin: 3, hair: 'bun', glasses: 1, shirt: '#db2777', bg: '#fde2ee', earrings: 1 },
  'Aya': { f: 1, skin: 3, hair: 'afro', headset: 1, shirt: '#ef3a4a', bg: '#ffe3d8', earrings: 1 },
};

const hash = s => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
// Le serveur abrège parfois les noms (« Brice Y. ») : on retrouve alors le personnage complet.
export function castName(name) {
  if (!name || PEOPLE[name]) return name;
  const [f, ...r] = String(name).split(' '); const ini = (r[0] || '').replace('.', '')[0];
  if (!ini || !/\.$/.test(String(name))) return name;
  return Object.keys(PEOPLE).find(k => k.split(' ')[0] === f && (k.split(' ')[1] || '')[0] === ini) || name;
}
export function lookFor(name) {
  name = castName(name);
  if (PEOPLE[name]) return PEOPLE[name];
  const h = hash(name || '?');
  const f = FEMALE.has(String(name || '').split(' ')[0]);
  const hairs = f ? ['braids', 'puff', 'wrap', 'bun', 'afro'] : ['short', 'fade', 'afro', 'fade'];
  return { f, skin: h % SKINS.length, hair: hairs[(h >>> 3) % hairs.length], shirt: SHIRTS[(h >>> 7) % SHIRTS.length], bg: PASTELS[(h >>> 11) % PASTELS.length], beard: !f && (h >>> 13) % 3 === 0, glasses: (h >>> 15) % 4 === 0, earrings: f, wrap: SHIRTS[(h >>> 17) % SHIRTS.length] };
}

let uid = 0;
function Face({ L }) {
  const [skin, shade] = SKINS[L.skin] || SKINS[2];
  return <g>
    {/* Cheveux derrière la tête */}
    {L.hair === 'afro' && <circle cx="50" cy="38" r="24" fill={HAIR} />}
    {L.hair === 'braids' && <g fill={HAIR}><path d="M29 40c-2-17 9-24 21-24s23 7 21 24l3 38h-9l-2-30H37l-2 30h-9z" /></g>}
    {L.hair === 'puff' && <circle cx="50" cy="17" r="11" fill={HAIR} />}
    {L.hair === 'bun' && <circle cx="50" cy="19" r="8" fill={HAIR} />}
    {/* Cou et oreilles */}
    <path d="M42 58h16v14c0 5-16 5-16 0z" fill={shade} />
    <ellipse cx="33" cy="47" rx="3.6" ry="5" fill={shade} />
    <ellipse cx="67" cy="47" rx="3.6" ry="5" fill={shade} />
    {L.earrings ? <><circle cx="33" cy="53.5" r="1.8" fill="#f5c542" /><circle cx="67" cy="53.5" r="1.8" fill="#f5c542" /></> : null}
    {/* Visage */}
    <ellipse cx="50" cy="45" rx="17" ry="19" fill={skin} />
    {L.beard === 1 && <path d="M33.5 47c1 14 9 19 16.5 19s15.5-5 16.5-19c-2 8-7 11-16.5 11S35.5 55 33.5 47z" fill={HAIR} />}
    {L.beard === 2 && <path d="M45 58.5c1.5 4 3 5 5 5s3.5-1 5-5c-1.6 1-3.2 1.4-5 1.4s-3.4-.4-5-1.4z" fill={HAIR} />}
    {/* Cheveux devant */}
    {L.hair === 'short' && <path d="M33 43c-2-15 8-21 17-21s19 5 17 21c-2-7-7-10-17-10s-15 3-17 10z" fill={HAIR} />}
    {L.hair === 'fade' && <path d="M34 39c0-11 8-15 16-15s16 4 16 15c-4-6-10-7-16-7s-12 1-16 7z" fill={HAIR} />}
    {(L.hair === 'afro' || L.hair === 'puff' || L.hair === 'bun' || L.hair === 'braids') && <path d="M33 43c-2-15 8-22 17-22s19 7 17 22c-3-8-8-12-17-12s-14 4-17 12z" fill={HAIR} />}
    {L.hair === 'wrap' && <g><path d="M31 42c-3-19 8-28 20-28s23 9 18 28c-4-7-11-10-19-10s-15 3-19 10z" fill={L.wrap || '#f59e0b'} /><ellipse cx="62" cy="17" rx="9" ry="6.5" fill={L.wrap || '#f59e0b'} /><path d="M36 30c8-4 20-4 28 0" stroke="rgba(255,255,255,.45)" strokeWidth="2" fill="none" strokeLinecap="round" /><path d="M38 25c7-3 17-3 24 0" stroke="rgba(0,0,0,.18)" strokeWidth="2" fill="none" strokeLinecap="round" /></g>}
    {L.hair === 'helmet' && <g><path d="M31 40c0-15 9-22 19-22s19 7 19 22z" fill={L.helmet || '#f5b700'} /><rect x="27" y="37" width="46" height="5.5" rx="2.75" fill={L.helmet || '#f5b700'} /><path d="M50 19v19" stroke="rgba(0,0,0,.15)" strokeWidth="3" /><path d="M36 30c3-6 8-9 12-9" stroke="rgba(255,255,255,.55)" strokeWidth="2" fill="none" strokeLinecap="round" /></g>}
    {L.hair === 'cap' && <g><path d="M32 40c0-14 8-20 18-20s18 6 18 20z" fill={L.cap || '#22252b'} /><path d="M50 37h24c2 0 2 4 0 4.5L50 42z" fill={L.cap || '#22252b'} /><circle cx="50" cy="21" r="1.6" fill="rgba(255,255,255,.35)" /></g>}
    {/* Sourcils, yeux, nez, bouche, joues */}
    <path d="M39 40.5q4-2.2 8-.4M53 40.1q4-1.8 8 .4" stroke={HAIR} strokeWidth="1.9" fill="none" strokeLinecap="round" />
    <ellipse cx="43" cy="46.5" rx="2.3" ry="2.7" fill="#1b1410" /><ellipse cx="57" cy="46.5" rx="2.3" ry="2.7" fill="#1b1410" />
    <circle cx="43.8" cy="45.6" r=".8" fill="#fff" /><circle cx="57.8" cy="45.6" r=".8" fill="#fff" />
    <path d="M50 49.5q-1.8 4.2.6 4.8" stroke={shade} strokeWidth="1.5" fill="none" strokeLinecap="round" />
    <path d="M44 56.3q6 6.4 12 0z" fill="#5b1d1a" /><path d="M45.6 56.6h8.8q-.6 1.3-4.4 1.4t-4.4-1.4z" fill="#fff" />
    <circle cx="38.5" cy="53" r="3" fill="#ff6b6b" opacity=".16" /><circle cx="61.5" cy="53" r="3" fill="#ff6b6b" opacity=".16" />
    {L.glasses ? <g stroke="#1b1b1f" strokeWidth="1.6" fill="rgba(255,255,255,.18)"><rect x="36.5" y="42.5" width="12" height="9" rx="3.5" /><rect x="51.5" y="42.5" width="12" height="9" rx="3.5" /><path d="M48.5 46h3" fill="none" /></g> : null}
    {L.headset ? <g fill="none" stroke="#23252b" strokeWidth="2.6" strokeLinecap="round"><path d="M30.5 46c-1-18 9-26 19.5-26S70.5 28 69.5 46" /><path d="M31.5 52q3 9 12 9.5" strokeWidth="1.8" /><rect x="27" y="42" width="6" height="11" rx="3" fill="#23252b" /><rect x="67" y="42" width="6" height="11" rx="3" fill="#23252b" /><circle cx="44.5" cy="61.5" r="1.8" fill="#23252b" stroke="none" /></g> : null}
  </g>;
}

function Body({ L }) {
  const [, shade] = SKINS[L.skin] || SKINS[2];
  return <g>
    <path d="M12 104c1-20 16-31 38-31s37 11 38 31z" fill={L.shirt} />
    {L.blazer ? <path d="M40 74l10 16 10-16 6 2-16 26-16-26z" fill="rgba(255,255,255,.14)" /> : null}
    {L.tie ? <><path d="M42 73l8 8 8-8" fill="#fff" /><path d="M48 80h4l1.5 4-3.5 16-3.5-16z" fill="#ef3a4a" /></> : L.collar ? <path d="M41 73l9 9 9-9-2.5-1.5L50 78l-6.5-6.5z" fill="#fff" opacity=".9" /> : <path d="M43.5 73.5l6.5 7 6.5-7z" fill={shade} />}
    {L.vest ? <g><rect x="12" y="88" width="76" height="5" fill="#e5e7eb" opacity=".9" /><path d="M36 76l-3 28M64 76l3 28" stroke="#e5e7eb" strokeWidth="4" opacity=".9" /></g> : null}
  </g>;
}

// Avatar rond. size en pixels ; ring = liseré blanc ; dot = pastille d'état (ok, warn, bad, accent).
export function Avatar({ name, size = 40, ring, dot, title, className = '', look }) {
  const L = look || lookFor(name);
  const id = React.useMemo(() => 'av' + (++uid), []);
  return <span className={'avatar' + (ring ? ' avatar-ring' : '') + ' ' + className} style={{ width: size, height: size }} title={title || name} role="img" aria-label={title || name}>
    <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true">
      <defs><clipPath id={id}><circle cx="50" cy="50" r="50" /></clipPath></defs>
      <g clipPath={'url(#' + id + ')'}><rect width="100" height="100" fill={L.bg} /><Body L={L} /><Face L={L} /></g>
    </svg>
    {dot && <i className={'avatar-dot dot-' + dot} />}
  </span>;
}

export function AvatarStack({ names, size = 28, max = 4 }) {
  const shown = names.slice(0, max);
  return <span className="avatar-stack">{shown.map((n, i) => <Avatar key={n + i} name={n} size={size} ring />)}{names.length > max && <span className="avatar-more" style={{ width: size, height: size }}>+{names.length - max}</span>}</span>;
}

// Petite bulle où un personnage parle (visite guidée, explications).
export function Say({ name = 'Aya', children, size = 36, tone }) {
  return <div className={'say' + (tone ? ' say-' + tone : '')}><Avatar name={name} size={size} /><div className="say-bubble">{children}</div></div>;
}

// ---------- Illustrations ----------
// Maison raccordée : le câble et le Wi-Fi s'allument au fil des étapes (0 à 1).
export function HouseScene({ progress = 0, height = 120 }) {
  const on = progress >= 1; const cable = progress >= .55;
  return <svg className="scene" viewBox="0 0 240 120" height={height} aria-hidden="true">
    <circle cx="200" cy="26" r="12" fill="#ffd66b" opacity=".9" />
    <path d="M0 104h240v16H0z" fill="var(--scene-ground)" />
    <rect x="22" y="30" width="5" height="76" rx="2.5" fill="var(--scene-pole)" />
    <rect x="14" y="34" width="21" height="4" rx="2" fill="var(--scene-pole)" />
    <path d="M27 36C70 44 104 52 128 66" fill="none" stroke={cable ? 'var(--accent)' : 'var(--scene-line)'} strokeWidth="3" strokeLinecap="round" strokeDasharray={cable ? '0' : '5 6'} />
    <path d="M118 58l42-30 42 30v48h-84z" fill="var(--scene-wall)" />
    <path d="M110 62l50-38 50 38" fill="none" stroke="var(--accent)" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
    <rect x="148" y="78" width="22" height="28" rx="4" fill="var(--scene-door)" />
    <rect x="126" y="70" width="16" height="14" rx="3" fill="var(--scene-window)" />
    <rect x="178" y="70" width="16" height="14" rx="3" fill="var(--scene-window)" />
    <rect x="128" y="92" width="14" height="8" rx="2" fill="#15161a" /><circle cx="131.5" cy="96" r="1.2" fill={on ? '#8ee000' : '#f59e0b'} />
    {on && <g fill="none" stroke="#8ee000" strokeWidth="2.4" strokeLinecap="round"><path d="M126 86a12 12 0 0118 0" /><path d="M121 81a19 19 0 0128 0" opacity=".6" /></g>}
  </svg>;
}

// Camionnette d'intervention (technicien en route).
export function VanScene({ height = 70, name = 'Brice Yao' }) {
  return <svg className="scene" viewBox="0 0 200 80" height={height} aria-hidden="true">
    <path d="M0 70h200" stroke="var(--scene-line)" strokeWidth="2" strokeDasharray="8 8" />
    <path d="M30 28h86l26 18v18H30z" fill="#fff" stroke="var(--scene-line)" strokeWidth="2" />
    <path d="M30 50h112" stroke="var(--accent)" strokeWidth="6" />
    <path d="M118 31h8l12 13h-20z" fill="#bfe3ff" />
    <circle cx="56" cy="66" r="9" fill="#15161a" /><circle cx="56" cy="66" r="3.5" fill="#d1d5db" />
    <circle cx="122" cy="66" r="9" fill="#15161a" /><circle cx="122" cy="66" r="3.5" fill="#d1d5db" />
    <path d="M150 40h14M154 48h18M150 56h12" stroke="var(--scene-line)" strokeWidth="3" strokeLinecap="round" />
  </svg>;
}

// Le « casting » de la démo, affiché sur l'accueil.
export const CAST = [
  { name: 'Awa Kouassi', role: 'client', space: 'client', line: 'A payé sa fibre, suit son dossier' },
  { name: 'Brice Yao', role: 'technicien', space: 'terrain', line: 'Installe la fibre chez les clients' },
  { name: 'Nadia Konan', role: 'conseiller', space: 'ops', line: 'Répond et débloque les dossiers' },
  { name: 'Hervé Ouattara', role: 'planificateur', space: 'ops', line: 'Organise les équipes et les créneaux' },
  { name: 'Salimata Diabaté', role: 'superviseur', space: 'ops', line: 'Suit les délais, valide les exceptions' },
  { name: 'Jean-Marc N’Guessan', role: 'admin', space: 'admin', line: 'Gère les comptes et les réglages' },
];
