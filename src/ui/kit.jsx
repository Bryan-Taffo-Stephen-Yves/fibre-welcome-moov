// Petits composants partagés par tous les espaces.
import { STATE_INFO, ORDER_STATES, BLOCKER_TYPES, APPT_STATES, ROLES } from '../server/model.js';
import { fmtDate, fmtDateTime, fmtAgo, fmtDur, fmtRange } from '../server/ai.js';
import { Avatar, AvatarStack, Say, lookFor, HouseScene, VanScene, CAST } from './people.jsx';
import { Sparkline, Bars, Ring, Stacked, AbidjanMap } from './charts.jsx';
import { useImage, useQ, call } from './platform.js';
const React = window.React;
const { useState } = React;

export { fmtDate, fmtDateTime, fmtAgo, fmtDur, fmtRange, STATE_INFO, ORDER_STATES, BLOCKER_TYPES, APPT_STATES, ROLES };
export { Avatar, AvatarStack, Say, lookFor, HouseScene, VanScene, CAST, Sparkline, Bars, Ring, Stacked, AbidjanMap };
export const slotLabel = s => (s === 'm' ? '08h – 12h' : '13h – 17h');
// Durée de garde d'un créneau (réglage de l'administrateur, 5 minutes par défaut).
export const minutes = h => { const n = Number(h) > 0 ? Number(h) : 5; return n + (n > 1 ? ' minutes' : ' minute'); };
export const money = n => n.toLocaleString('fr-FR') + ' F CFA';
export const firstName = n => String(n || '').split(' ')[0];

export function Btn({ kind, size, block, children, className = '', ...p }) {
  const c = ['btn', kind && 'btn-' + kind, size === 's' && 'btn-s', block && 'btn-block', className].filter(Boolean).join(' ');
  return <button type="button" className={c} {...p}>{children}</button>;
}
// Bouton qui attend la fin d'une action asynchrone (évite les doubles clics).
export function AsyncBtn({ onClick, children, ...p }) {
  const [busy, setBusy] = useState(false);
  return <Btn {...p} disabled={busy || p.disabled} onClick={async e => { setBusy(true); try { await onClick(e); } finally { setBusy(false); } }}>{busy ? '…' : children}</Btn>;
}
export const Tag = ({ tone, children, title }) => <span className={'tag' + (tone ? ' tag-' + tone : '')} title={title}>{children}</span>;
export const Sim = ({ what = 'simulé' }) => <Tag tone="sim" title="Ce système n’est pas encore branché : un simulateur répond à sa place.">◇ {what}</Tag>;

// « En clair » : Aya, la guide, explique avec des mots simples.
export function Explain({ children, title = 'En clair', open: o = false }) {
  const [open, setOpen] = useState(o);
  return <div className="stack-s">
    <button type="button" className="explain-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
      <span className="explain-btn" aria-hidden="true">?</span>{title}
    </button>
    {open && <Say name="Aya" size={30}><div className="explain">{children}</div></Say>}
  </div>;
}

// Carte avec un titre (et un contenu à droite du titre).
export function Panel({ title, right, children, tour, dark, className = '' }) {
  return <section className={(dark ? 'card-dark' : 'card') + ' stack ' + className} data-tour={tour}>
    {(title || right) && <div className="card-title"><h2>{title}</h2>{right}</div>}
    {children}
  </section>;
}

export function Field({ label, children, hint, id }) {
  return <div className="field"><label htmlFor={id}>{label}</label>{children}{hint && <span className="tiny muted">{hint}</span>}</div>;
}

// portal : la fenêtre est posée directement dans la page (utile depuis la barre du haut, dont le flou la piégerait).
export function Modal({ title, onClose, children, actions, portal }) {
  React.useEffect(() => { const f = e => e.key === 'Escape' && onClose(); window.addEventListener('keydown', f); return () => window.removeEventListener('keydown', f); }, []);
  const el = <div className="backdrop" onClick={onClose}>
    <div className="dialog" role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()}>
      <div className="spread"><h2>{title}</h2><button type="button" className="icon-btn" onClick={onClose} aria-label="Fermer">{Icon.x}</button></div>
      {children}
      {actions && <div className="row">{actions}</div>}
    </div>
  </div>;
  return portal && window.ReactDOM && window.ReactDOM.createPortal ? window.ReactDOM.createPortal(el, document.body) : el;
}

export function StateTag({ state, cancelled }) {
  if (cancelled) return <Tag tone="bad">Annulé</Tag>;
  const i = ORDER_STATES.indexOf(state);
  const tone = state === 'SERVICE_ACTIF' || state === 'CLOTURE' ? 'ok' : i >= 4 ? 'info' : '';
  return <Tag tone={tone}>{STATE_INFO[state].label}</Tag>;
}
export function Progress({ state }) {
  const i = ORDER_STATES.indexOf(state);
  return <div className="progress" aria-label={'Étape ' + (i + 1) + ' sur ' + ORDER_STATES.length}>{ORDER_STATES.map((s, k) => <span key={s} className={k < i ? 'on' : k === i ? (state === 'CLOTURE' || state === 'SERVICE_ACTIF' ? 'on' : 'now') : ''} title={STATE_INFO[s].label} />)}</div>;
}
export function RiskTag({ risk }) {
  if (!risk) return null;
  const tone = risk.level === 'élevé' ? 'bad' : risk.level === 'moyen' ? 'warn' : 'ok';
  return <Tag tone={tone} title={risk.causes.join(' · ')}>Risque {risk.level} · {Math.round(risk.score * 100)} %</Tag>;
}

// État vide avec un petit personnage.
// Image d'une pièce ou d'une photo : vignette cliquable, agrandie dans une fenêtre. Les droits sont vérifiés
// par le serveur simulé avant tout affichage.
export function Picture({ token, img, thumb, alt = '', label, kind, size }) {
  const st = useImage(token, img);
  const [open, setOpen] = React.useState(false);
  const src = st.src || thumb || null;
  const style = size ? { width: size, height: size } : undefined;
  if (!src) return <span className="pic pic-none" style={style} title={st.denied ? 'Image réservée aux personnes qui suivent ce dossier' : st.loading ? 'Chargement…' : 'Pas d’aperçu'}>{st.loading ? <span className="pic-wait" /> : kind ? <b className="tiny">{kind}</b> : st.denied ? Icon.lock : Icon.doc}</span>;
  return <>
    <button type="button" className="pic" style={style} onClick={() => setOpen(true)} aria-label={'Agrandir : ' + (label || alt || 'image')}><img src={src} alt={alt} /><span className="pic-zoom" aria-hidden="true">{Icon.search}</span></button>
    {open && <Modal title={label || 'Image'} onClose={() => setOpen(false)}>
      <div className="pic-big">{st.src ? <img src={st.src} alt={alt} /> : <><img src={thumb} alt={alt} /><p className="small muted">{st.loading ? 'Image complète en cours de chargement…' : 'Seul l’aperçu est disponible sur cet appareil.'}</p></>}</div>
    </Modal>}
  </>;
}

// Cloche de notifications pour l'équipe Moov et les techniciens : ce que le serveur leur envoie
// (nouvelle pièce, message client, mission retirée…) devient visible, avec un lien vers le dossier.
export function NotifBell({ token, onOpen, dark }) {
  const r = useQ(token, 'notifications');
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  React.useEffect(() => { if (!open) return; const f = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }; document.addEventListener('pointerdown', f); return () => document.removeEventListener('pointerdown', f); }, [open]);
  const list = r.data || [];
  const unread = list.filter(n => !n.read).length;
  const pick = n => { if (!n.read) call(token, 'notif.read', { id: n.id }, { silent: true }); if (n.orderId && onOpen) { onOpen(n.orderId); setOpen(false); } };
  return <span className="nbell" ref={ref}>
    <button type="button" className={'icon-btn nbell-btn' + (dark ? ' on-dark' : '')} onClick={() => setOpen(!open)} aria-expanded={open} aria-label={'Notifications' + (unread ? ' (' + unread + ' non lues)' : '')} data-tour="staff-bell">{Icon.bell}{unread > 0 && <span className="badge">{unread > 9 ? '9+' : unread}</span>}</button>
    {open && <div className="nbell-pop" role="dialog" aria-label="Notifications">
      <div className="spread"><b>Notifications</b>{unread > 0 && <button type="button" className="link-btn small" onClick={() => call(token, 'notif.read', { all: true }, { silent: true })}>Tout marquer lu</button>}</div>
      {list.length === 0 ? <p className="small muted">Rien pour l’instant.</p> : <div className="nbell-list">{list.slice(0, 25).map(n => <button type="button" key={n.id} className={'nbell-item' + (n.read ? '' : ' unread')} onClick={() => pick(n)}>
        <b className="small">{n.title}</b><span className="tiny muted">{n.body}</span><span className="tiny muted">{fmtDateTime(n.at)}{n.orderId && onOpen ? ' · ouvrir' : ''}</span>
      </button>)}</div>}
    </div>}
  </span>;
}

export function Empty({ children, who = 'Aya' }) { return <div className="row" style={{ padding: '10px 0', flexWrap: 'nowrap' }}><Avatar name={who} size={30} /><p className="muted small">{children}</p></div>; }

// Indicateur chiffré, avec une petite courbe si on en donne une.
export function Kpi({ label, value, sub, tone, trend, dark }) {
  return <div className={dark ? 'card-dark stack-s' : 'kpi'}>
    <span className="eyebrow">{label}</span>
    <div className="spread" style={{ alignItems: 'flex-end', flexWrap: 'nowrap' }}><span className="v" style={Object.assign({ fontSize: 34, fontWeight: 500, letterSpacing: '-.03em', lineHeight: 1.1 }, tone ? { color: 'var(--' + tone + ')' } : null)}>{value}</span>{trend && <Sparkline data={trend} width={96} height={34} color={tone ? 'var(--' + tone + ')' : 'var(--accent)'} />}</div>
    {sub && <span className="tiny muted">{sub}</span>}
  </div>;
}

export function Stale({ at }) {
  if (!at) return null;
  return <div className="alert alert-warn small" role="status"><b>Données non actualisées.</b> Le lien avec Moov Prospect est interrompu (simulé). Dernière synchronisation : {fmtDateTime(at)}. Ce que vous voyez peut être ancien.</div>;
}

// Puce « personnage » : avatar + prénom (+ rôle).
export function PersonChip({ name, role, pressed, onClick, size = 28 }) {
  return <button type="button" className="persona-chip" aria-pressed={pressed} onClick={onClick}><Avatar name={name} size={size} />{firstName(name)}{role && <small>{role}</small>}</button>;
}

const I = (d, extra) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" {...extra}>{d}</svg>;
export const Icon = {
  home: I(<><path d="M4 10.5L12 4l8 6.5V19a1 1 0 01-1 1h-4.5v-5.5h-5V20H5a1 1 0 01-1-1z" /></>),
  cal: I(<><rect x="3.5" y="5" width="17" height="15.5" rx="3" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>),
  chat: I(<><path d="M5 5h14a2 2 0 012 2v8a2 2 0 01-2 2H10l-5 4v-4a2 2 0 01-2-2V7a2 2 0 012-2z" /></>),
  doc: I(<><path d="M7 3h7l5 5v11.5a1.5 1.5 0 01-1.5 1.5h-10A1.5 1.5 0 016 19.5v-15A1.5 1.5 0 017 3z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></>),
  user: I(<><circle cx="12" cy="8" r="4" /><path d="M4.5 20.5c1.2-3.8 4-5.5 7.5-5.5s6.3 1.7 7.5 5.5" /></>),
  users: I(<><circle cx="9" cy="8.5" r="3.5" /><path d="M2.5 19.5c.9-3.2 3.4-4.8 6.5-4.8s5.6 1.6 6.5 4.8" /><path d="M15.5 5.3a3.5 3.5 0 010 6.4M18 14.9c2 .6 3.1 2 3.5 4.6" /></>),
  list: I(<><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.5" cy="6" r="1" /><circle cx="4.5" cy="12" r="1" /><circle cx="4.5" cy="18" r="1" /></>),
  bell: I(<><path d="M6 16.5V11a6 6 0 0112 0v5.5l1.5 2h-15z" /><path d="M10 20.5a2 2 0 004 0" /></>),
  wifi: I(<><path d="M2.5 9a14 14 0 0119 0M5.5 12.5a9.5 9.5 0 0113 0M9 16a4.5 4.5 0 016 0" /><circle cx="12" cy="19.2" r=".8" fill="currentColor" /></>),
  tool: I(<><path d="M14.5 6.5a4 4 0 005 5l-9 9a2.1 2.1 0 01-3-3l9-9a4 4 0 00-2-2z" /></>),
  grid: I(<><rect x="4" y="4" width="7" height="7" rx="2" /><rect x="13" y="4" width="7" height="7" rx="2" /><rect x="4" y="13" width="7" height="7" rx="2" /><rect x="13" y="13" width="7" height="7" rx="2" /></>),
  columns: I(<><rect x="3.5" y="4.5" width="17" height="15" rx="3" /><path d="M9.2 4.5v15M14.8 4.5v15" /></>),
  book: I(<><path d="M4.5 19V6a2.5 2.5 0 012.5-2.5h12.5v13H7a2.5 2.5 0 00-2.5 2.5zm0 0A2.5 2.5 0 007 21.5h12.5v-5" /><path d="M9 8h6" /></>),
  compass: I(<><circle cx="12" cy="12" r="8.5" /><path d="M15.5 8.5l-2 5-5 2 2-5z" /></>),
  flask: I(<><path d="M9.5 3.5h5M10.5 3.5v6L5 18.5A1.5 1.5 0 006.3 21h11.4a1.5 1.5 0 001.3-2.5l-5.5-9v-6" /><path d="M7.5 15h9" /></>),
  shield: I(<><path d="M12 3l7.5 3v5.5c0 4.5-3.2 8-7.5 9.5-4.3-1.5-7.5-5-7.5-9.5V6z" /><path d="M9 12l2 2 4-4" /></>),
  headset: I(<><path d="M4.5 14v-2a7.5 7.5 0 0115 0v2" /><rect x="3.5" y="13" width="4" height="6" rx="2" /><rect x="16.5" y="13" width="4" height="6" rx="2" /><path d="M18.5 19c0 1.5-2 2.5-5 2.5" /></>),
  sun: I(<><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M4.6 4.6L6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4" /></>),
  moon: I(<><path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z" /></>),
  auto: I(<><circle cx="12" cy="12" r="8.5" /><path d="M12 3.5v17" /><path d="M12 3.5a8.5 8.5 0 010 17z" fill="currentColor" stroke="none" /></>),
  arrow: I(<><path d="M7 17L17 7M9 7h8v8" /></>),
  right: I(<><path d="M5 12h14M13 6l6 6-6 6" /></>),
  left: I(<><path d="M19 12H5M11 6l-6 6 6 6" /></>),
  check: I(<><path d="M5 12.5l4.5 4.5L19 7.5" /></>),
  x: I(<><path d="M6 6l12 12M18 6L6 18" /></>),
  clock: I(<><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>),
  pin: I(<><path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0113 0c0 5-6.5 11-6.5 11z" /><circle cx="12" cy="10" r="2.3" /></>),
  phone: I(<><rect x="7" y="2.5" width="10" height="19" rx="2.5" /><path d="M11 18.5h2" /></>),
  search: I(<><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></>),
  settings: I(<><circle cx="12" cy="12" r="3" /><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" /></>),
  box: I(<><path d="M3.5 7.5L12 3l8.5 4.5v9L12 21l-8.5-4.5z" /><path d="M3.5 7.5L12 12l8.5-4.5M12 12v9" /></>),
  camera: I(<><path d="M4 8h3l1.5-2.5h7L17 8h3a1 1 0 011 1v9.5a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1z" /><circle cx="12" cy="13.5" r="3.5" /></>),
  alert: I(<><path d="M12 4l9 15.5H3z" /><path d="M12 10v4M12 17v.5" /></>),
  lock: I(<><rect x="5" y="10.5" width="14" height="10" rx="2.5" /><path d="M8 10.5V8a4 4 0 018 0v2.5" /></>),
  plug: I(<><path d="M9 3v5M15 3v5M6.5 8h11v3a5.5 5.5 0 01-11 0zM12 16.5V21" /></>),
  logo: I(<><path d="M4 16c3-6 5-9 8-9s5 3 8 9" /><circle cx="12" cy="16.5" r="2" fill="currentColor" stroke="none" /></>, { strokeWidth: 2.4 }),
};
