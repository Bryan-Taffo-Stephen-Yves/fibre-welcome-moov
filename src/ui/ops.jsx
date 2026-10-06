// Console opérations : conseiller, planificateur, superviseur (CDC 5.1, 5.2, 5.3).
// Mise en page « tableau de bord » : sections en pilules, cartes arrondies, tableaux sombres, personnages.
import { useQ, call, api, toast } from './platform.js';
import { Btn, AsyncBtn, Sim, Explain, Field, Modal, StateTag, Progress, Empty, Icon, Picture, NotifBell, Avatar, AvatarStack, Sparkline, Bars, Ring, Stacked, AbidjanMap, firstName, fmtDate, fmtDateTime, slotLabel, money, STATE_INFO, ORDER_STATES, BLOCKER_TYPES, APPT_STATES, ROLES } from './kit.jsx';
import { ZONES, DOC_TYPES, PAYMENT_STATES, REPORT_TYPES, CHECKLIST_TECH } from '../server/model.js';
const React = window.React;
const { useState, useRef } = React;
const DAY = 864e5;

// ---------- Petites aides d'affichage ----------
const zoneName = id => (ZONES.find(z => z.id === id) || {}).name || id;
const nf1 = x => (Math.round(x * 10) / 10).toLocaleString('fr-FR');
const PRIO = { 'élevé': ['bad', 'Urgent'], moyen: ['warn', 'À surveiller'], faible: ['ok', 'Normal'] };
// Les causes de priorité viennent du serveur ; on les raccourcit pour la lecture.
function plainCause(c) {
  if (!c) return '';
  let m = c.match(/^Seuil (dépassé|bientôt atteint) pour « (.+) » \((\d+) h \/ (\d+) h\)$/);
  if (m) return (m[1] === 'dépassé' ? 'Délai dépassé' : 'Délai bientôt atteint') + ' (' + m[2].toLowerCase() + ')';
  m = c.match(/^Aucune action depuis (\d+) h$/);
  if (m) return 'Rien de fait depuis ' + dur(+m[1]);
  return c;
}
const QUEUES = {
  bloques: ['Bloqués', 'Un obstacle empêche d’avancer'],
  sansAction: ['Sans suite', 'Rien de fait depuis 36 h'],
  enRetard: ['En retard', 'Délai de l’étape dépassé'],
  incomplets: ['Incomplets', 'Pièce, adresse ou paiement'],
  aConfirmer: ['RDV à confirmer', 'Créneau choisi par le client'],
  aPreparer: ['À vérifier', 'Vérification technique'],
};
const QUEUE_KEYS = Object.keys(QUEUES);
const TICKETS = { question_assistant: 'Question transmise par l’assistant', escalade: 'Escalade', insatisfaction: 'Client insatisfait', incident_terrain: 'Incident sur le terrain' };
const ticketLabel = t => t.startsWith('signalement:') ? 'Signalement : ' + String(REPORT_TYPES[t.slice(12)] || t.slice(12)).toLowerCase() : TICKETS[t] || t;
const DOC_STATUS = { analyse: ['info', 'En analyse'], a_valider: ['warn', 'À valider'], valide: ['ok', 'Validée'], refuse: ['bad', 'Refusée'], remplace: ['neutral', 'Remplacée'] };
const fmtNum = n => String(n).replace('.', ',').replace(/^-/, '−');
// Résumé lisible de la checklist du technicien : puissance mesurée et points cochés.
const ckSummary = ck => {
  const bools = CHECKLIST_TECH.filter(c => c.type === 'bool');
  const ticks = bools.filter(c => ck[c.id] === true).length;
  const p = ck.puissance;
  if (p == null && !ticks) return 'pas encore remplie';
  return (p != null && p !== '' ? fmtNum(p) + ' dBm · ' : '') + ticks + ' sur ' + bools.length + ' points cochés';
};
const WO_STATUS = { affectee: 'Affectée', en_route: 'En route', sur_place: 'Sur place', en_cours: 'En cours', terminee: 'Terminée', echec: 'Échec', annulee: 'Annulée' };
const REFUND_STATUS = { demande: ['warn', 'Demandée'], instruite: ['info', 'Instruite'], valide: ['ok', 'Validée'], rembourse: ['ok', 'Remboursée (simulé)'], rejete: ['bad', 'Rejetée'] };
const EVENTS = {
  MESSAGE: 'Message', NOTE_INTERNE: 'Note interne', TECH_EN_ROUTE: 'Technicien en route', TECH_ARRIVE: 'Technicien arrivé', SIGNALEMENT: 'Signalement du client',
  RECEPTION_CLIENT: 'Réception par le client', RDV_RESERVE: 'Rendez-vous réservé', RDV_ANNULE: 'Rendez-vous annulé', RAPPEL_DEMANDE: 'Rappel demandé', RAPPEL_FAIT: 'Client rappelé',
  PREUVE_AJOUTEE: 'Photo ajoutée', PIECE_VALIDEE: 'Pièce validée', PIECE_REFUSEE: 'Pièce refusée', PIECE_DEPOSEE: 'Pièce envoyée', PIECE_DEMANDEE: 'Pièce demandée',
  MISSION_REAFFECTEE: 'Mission réaffectée', ESCALADE: 'Escalade au superviseur', EQUIPEMENT_ATTRIBUE: 'Équipement attribué', DOUBLON_RAPPROCHE: 'Doublon rapproché',
  DELEGATION: 'Délégation', CRENEAU_TENU: 'Créneau gardé', CONTROLE_CLIENT: 'Préparation du client', COMMANDE_ANNULEE: 'Commande annulée', BLOCAGE_RESOLU: 'Blocage résolu',
  BLOCAGE_OUVERT: 'Blocage ouvert', BLOCAGE_AFFECTE: 'Blocage affecté', AVIS_CLIENT: 'Avis du client', ADRESSE_PRECISEE: 'Adresse précisée', ACTIVATION_RELANCEE: 'Activation relancée',
  REMBOURSEMENT_SIMULE: 'Remboursement (simulé)', DOSSIER_RATTACHE: 'Dossier rattaché', INCIDENT_TERRAIN: 'Incident signalé par le technicien', COMMENTAIRE_TECHNICIEN: 'Commentaire du technicien',
};
const holdNote = e => (e && e.type === 'CRENEAU_TENU' && e.payload && e.payload.expiresInMin ? ' ' + e.payload.expiresInMin + ' min' : '');
const evLabel = t => EVENTS[t] || (STATE_INFO[t] && STATE_INFO[t].label) || (t.charAt(0) + t.slice(1).toLowerCase().replace(/_/g, ' '));
const fmtWd = d => new Intl.DateTimeFormat('fr-FR', { timeZone: 'Africa/Abidjan', weekday: 'short' }).format(d);
const fmtDn = d => new Intl.DateTimeFormat('fr-FR', { timeZone: 'Africa/Abidjan', day: 'numeric' }).format(d);
const sum = (list, f) => list.reduce((a, x) => a + f(x), 0);
const dur = h => h < 20 ? Math.round(h) + ' h' : nf1(Math.round(h / 24 * 2) / 2) + ' j';

const Pill = ({ tone = 'neutral', children, title }) => <span className={'op-pill op-pill-' + tone} title={title}><i aria-hidden="true" />{children}</span>;

// ---------- Console ----------
export function OpsConsole({ token }) {
  const me = useQ(token, 'me');
  const qs = useQ(token, 'ops.queues');
  const [sec, setSec] = useState(null);
  const [orderId, setOrderId] = useState(null);
  const [preset, setPreset] = useState(null);
  const root = useRef(null);
  if (me.error) return <div className="alert alert-bad">{me.error.message}</div>;
  const role = me.data.user.role;
  const sections = role === 'planificateur' ? [['queues', 'Files de travail', Icon.list], ['planning', 'Planning', Icon.cal], ['teams', 'Équipes et ressources', Icon.users], ['search', 'Dossiers', Icon.search]]
    : role === 'superviseur' ? [['dash', 'Tableau de bord', Icon.grid], ['queues', 'Files et escalades', Icon.list], ['approvals', 'Validations', Icon.shield], ['planning', 'Planning', Icon.cal], ['search', 'Dossiers', Icon.search]]
    : [['queues', 'Files de travail', Icon.list], ['search', 'Dossiers', Icon.search]];
  const s = sections.some(x => x[0] === sec) ? sec : sections[0][0];
  const q = qs.data;
  const count = q ? { queues: new Set(QUEUE_KEYS.flatMap(k => q[k].map(r => r.id))).size, approvals: q.approvals.length } : {};
  const toTop = () => requestAnimationFrame(() => { const el = root.current; if (el && el.getBoundingClientRect().top < 0) window.scrollBy(0, el.getBoundingClientRect().top - 90); });
  const open = id => { setOrderId(id); call(token, 'order.open', { orderId: id }, { silent: true }); toTop(); };
  const go = k => { setSec(k); setOrderId(null); setPreset(null); };
  const goSearch = zone => { setPreset({ zone }); setSec('search'); setOrderId(null); toTop(); };
  const zones = me.data.user.zones || [];
  return <div className="op-root" ref={root}>
    <div className="op-top">
      <nav className="pills op-nav" role="tablist" aria-label="Sections">
        {sections.map(([k, l, ic]) => <button key={k} type="button" role="tab" aria-selected={s === k} onClick={() => go(k)} data-tour={'ops-' + k}><span className="op-nav-ic" aria-hidden="true">{ic}</span>{l}{count[k] ? <span className="count">{count[k]}</span> : null}</button>)}
      </nav>
      <NotifBell token={token} onOpen={open} />
      <div className="op-scope" title="Vous ne voyez que les dossiers de ces communes">
        <span className="small muted">Périmètre</span>
        {zones.length === ZONES.length ? <span className="op-zone">Tout Abidjan</span> : zones.map(z => <span key={z} className="op-zone">{zoneName(z)}</span>)}
      </div>
    </div>
    {orderId ? <OrderSheet key={orderId} token={token} orderId={orderId} role={role} onClose={() => setOrderId(null)} />
      : s === 'queues' ? <Queues token={token} role={role} open={open} />
      : s === 'search' ? <Search key={preset ? preset.zone : 'all'} token={token} open={open} initial={preset} zones={zones} />
      : s === 'planning' ? <Planning token={token} role={role} open={open} />
      : s === 'teams' ? <Teams token={token} />
      : s === 'dash' ? <Dashboard token={token} open={open} goSearch={goSearch} goApprovals={() => go('approvals')} />
      : <Approvals token={token} open={open} />}
  </div>;
}

// ---------- Tableau de dossiers (carte sombre) ----------
function Stage({ r }) {
  if (r.cancelled) return <Pill tone="bad">Annulé</Pill>;
  const i = ORDER_STATES.indexOf(r.state);
  return <div className="op-stage">
    <span className="op-stage-l"><Ring value={i + 1} max={ORDER_STATES.length} size={22} stroke={3} color="var(--lime)" track="var(--dark-3)" />{STATE_INFO[r.state].label}</span>
    <span className={'tiny ' + (r.overSla ? 'op-late' : 'muted')}>depuis {dur(r.inStateH)}{r.sla ? ', délai ' + dur(r.sla) : ''}</span>
  </div>;
}
function Prio({ risk, shown = [] }) {
  const [tone, label] = PRIO[risk.level] || ['neutral', risk.level];
  const title = 'Score de risque ' + Math.round(risk.score * 100) + ' %' + (risk.causes.length ? ' : ' + risk.causes.join(' · ') : '');
  // Les blocages sont déjà dans leur colonne : on explique ici les autres raisons.
  const other = risk.causes.filter(c => !shown.some(l => c.startsWith(l)));
  const why = (other.length ? other : risk.causes).slice(0, 2).map(plainCause).join(' · ');
  return <div className="op-prio" title={title}>
    <Pill tone={tone}>{label}</Pill>
    <span className="tiny muted">{why || 'Rien à signaler'}</span>
  </div>;
}
function BlockerCell({ list }) {
  if (!list.length) return <span className="muted small">Aucun</span>;
  return <div className="op-blks">{list.map(b => <div key={b.id} className="op-blk">
    <span className={'small' + (b.escalated ? ' op-late' : '')}>{b.label}</span>
    {b.owner ? <span className="op-owner"><Avatar name={b.owner} size={22} />{firstName(b.owner)}</span> : <span className="op-nobody-s">personne</span>}
  </div>)}</div>;
}
function OrderTable({ rows, open, empty = 'Aucun dossier ici pour le moment.' }) {
  if (!rows.length) return <div className="op-empty"><Avatar name="Aya" size={44} /><div><b>Rien à traiter</b><p className="small muted">{empty}</p></div></div>;
  return <div className="op-tblbox"><div className="tbl-wrap"><table className="tbl op-tbl">
    <thead><tr><th>Client</th><th>Étape</th><th className="op-c-age">Âge</th><th>Blocage et responsable</th><th>Priorité</th><th className="op-c-go"><span className="sr-only">Ouvrir</span></th></tr></thead>
    <tbody>{rows.map(r => <tr key={r.id} className="click" onClick={() => open(r.id)} tabIndex={0} onKeyDown={e => e.key === 'Enter' && open(r.id)} aria-label={'Ouvrir le dossier ' + r.ref + ' de ' + r.contactName}>
      <td className="op-c-who"><div className="who-cell"><Avatar name={r.contactName} size={38} /><div className="op-who-t"><b>{r.contactName}</b><span className="tiny muted">{r.ref} · {r.commune}</span></div></div></td>
      <td className="op-c-state"><Stage r={r} /></td>
      <td className="op-c-age num" title="Jours depuis le paiement"><span className="op-age">{nf1(r.ageD)}</span> <span className="tiny muted">j</span></td>
      <td className={'op-c-blk' + (r.blockers.length ? '' : ' op-c-none')}><BlockerCell list={r.blockers} /></td>
      <td className="op-c-prio"><Prio risk={r.risk} shown={r.blockers.map(b => b.label)} /></td>
      <td className="op-c-go"><span className="op-go" aria-hidden="true">{Icon.arrow}</span></td>
    </tr>)}</tbody>
  </table></div></div>;
}

// ---------- Files de travail ----------
function Queues({ token, role, open }) {
  const r = useQ(token, 'ops.queues');
  const [tab, setTab] = useState(role === 'planificateur' ? 'aPreparer' : 'bloques');
  const [side, setSide] = useState(null);
  if (r.error) return <div className="alert alert-bad">{r.error.message}</div>;
  const q = r.data;
  const keys = role === 'planificateur' ? ['aPreparer', 'aConfirmer', 'bloques', 'enRetard', 'sansAction', 'incomplets'] : QUEUE_KEYS;
  const cur = keys.includes(tab) ? tab : keys[0];
  const sides = [['docs', 'Pièces', q.docs], ['callbacks', 'Rappels', q.callbacks], ['tickets', 'Tickets', q.tickets]];
  const sd = side || (sides.find(x => x[2].length) || sides[0])[0];
  return <div className="op-queues" data-tour="ops-queues-panel">
    <div className="op-qrow" role="tablist" aria-label="Files de travail">
      {keys.map(k => { const list = q[k]; return <button key={k} type="button" role="tab" aria-selected={cur === k} className="op-q" onClick={() => setTab(k)}>
        <span className="op-q-top"><span className="op-q-label">{QUEUES[k][0]}</span>{list.length > 0 && <AvatarStack names={list.map(x => x.contactName)} size={24} max={3} />}</span>
        <span className="op-q-n num">{list.length}</span>
        <span className="op-q-hint">{QUEUES[k][1]}</span>
      </button>; })}
    </div>
    <div className="op-split">
      <section className="card-dark stack op-main">
        <div className="card-title op-main-h">
          <div className="stack-s" style={{ gap: 2 }}><h2>{QUEUES[cur][0]} <span className="op-h-n">{q[cur].length}</span></h2><span className="small muted">Les plus urgents en haut. Touchez une ligne pour ouvrir le dossier.</span></div>
          <Explain title="Comment lire ?">Chaque file regroupe les dossiers qui demandent une action. La <b>priorité</b> vient de règles simples (blocage ouvert, délai dépassé, rien fait depuis 48 h) plus un score de risque. La colonne de droite dit toujours pourquoi.</Explain>
        </div>
        <OrderTable rows={q[cur]} open={open} empty="Cette file est vide : aucun dossier n’attend ici." />
      </section>
      <aside className="card stack op-side">
        <div className="card-title"><h2>À traiter aussi</h2></div>
        <div className="pills pills-soft op-pills-s" role="tablist" aria-label="Autres demandes">
          {sides.map(([k, l, list]) => <button key={k} type="button" role="tab" aria-selected={sd === k} onClick={() => setSide(k)}>{l}<span className="count">{list.length}</span></button>)}
        </div>
        <div className="op-side-list">
        {sd === 'docs' && (q.docs.length ? q.docs.map(d => <DocReview key={d.id} token={token} d={d} canReview={role === 'conseiller'} />) : <Empty>Aucune pièce à valider.</Empty>)}
        {sd === 'callbacks' && (q.callbacks.length ? q.callbacks.map(c => <div key={c.id} className="op-item">
          <div className="op-item-h"><span className="op-ic">{Icon.phone}</span><div className="grow op-trunc"><b className="small">Rappeler · {c.ref}</b><div className="tiny muted">{fmtDateTime(c.at)} · joignable : {c.availability}</div></div></div>
          {c.reason && <p className="small">« {c.reason} »</p>}
          <div className="spread">
            {c.ownerName && c.ownerName !== '—' ? <span className="op-owner"><Avatar name={c.ownerName} size={24} />{firstName(c.ownerName)}</span> : <span className="tiny muted">Sans responsable</span>}
            {role === 'conseiller' && <div className="row"><Btn size="s" kind="ghost" onClick={() => open(c.orderId)}>Ouvrir</Btn><AsyncBtn size="s" kind="primary" onClick={() => call(token, 'callback.update', { id: c.id, status: 'fait', note: 'Client rappelé' })}>Marquer rappelé</AsyncBtn></div>}
          </div>
        </div>) : <Empty>Aucun rappel en attente.</Empty>)}
        {sd === 'tickets' && (q.tickets.length ? q.tickets.map(t => <div key={t.id} className="op-item">
          <div className="op-item-h"><Avatar name={t.by} size={34} /><div className="grow op-trunc"><b className="small">{ticketLabel(t.type)}</b><div className="tiny muted">{t.ref} · {firstName(t.by)} · {fmtDateTime(t.at)}</div></div></div>
          {t.text && <p className="small">« {t.text} »</p>}
          <div className="row"><Btn size="s" kind="primary" onClick={() => open(t.orderId)}>Ouvrir le dossier</Btn><AsyncBtn size="s" kind="ghost" onClick={() => call(token, 'ticket.close', { id: t.id })}>Clore</AsyncBtn></div>
        </div>) : <Empty>Aucun ticket ouvert.</Empty>)}
        </div>
      </aside>
    </div>
  </div>;
}

// Une pièce envoyée par le client : image agrandissable, contrôle automatique, puis décision du conseiller.
function DocReview({ token, d, canReview, compact }) {
  const [reason, setReason] = useState('');
  const [refusing, setRefusing] = useState(false);
  const [t, l] = DOC_STATUS[d.status] || ['neutral', d.status];
  return <div className="op-item">
    <div className="op-item-h"><Picture token={token} img={d.img} thumb={d.thumb} label={DOC_TYPES[d.type].label + (d.ref ? ' · ' + d.ref : '')} alt={DOC_TYPES[d.type].label} kind={d.mime === 'application/pdf' ? 'PDF' : null} />
      <div className="grow op-trunc"><b className="small">{DOC_TYPES[d.type].label}</b><div className="tiny muted">{compact ? '' : d.ref + ' · '}{d.name}</div><div className="tiny muted">{d.size ? Math.max(1, Math.round(d.size / 1024)) + ' Ko · ' : ''}{fmtDateTime(d.at)}</div></div>
      {compact && <Pill tone={t}>{l}</Pill>}</div>
    {d.status === 'analyse' && <span className="tiny muted">Contrôle automatique en cours (quelques secondes), la décision sera possible juste après.</span>}
    {d.scanNote && d.status === 'a_valider' && <span className="tiny muted">{d.scanNote}</span>}
    {d.reason && d.status === 'refuse' && <span className="tiny op-bad">Motif donné au client : {d.reason}</span>}
    {canReview && d.status === 'a_valider' && (refusing ? <>
      <input className="input" aria-label="Motif de refus" placeholder="Pourquoi refuser ? (le client le lira)" value={reason} onChange={e => setReason(e.target.value)} autoFocus />
      <div className="row"><AsyncBtn size="s" kind="danger" onClick={() => call(token, 'doc.review', { docId: d.id, decision: 'refuse', reason })}>Refuser la pièce</AsyncBtn><Btn size="s" kind="ghost" onClick={() => setRefusing(false)}>Annuler</Btn></div>
    </> : <div className="row"><AsyncBtn size="s" kind="primary" onClick={() => call(token, 'doc.review', { docId: d.id, decision: 'valide' })}>Valider</AsyncBtn><Btn size="s" kind="ghost" onClick={() => setRefusing(true)}>Refuser</Btn></div>)}
  </div>;
}

// ---------- Recherche ----------
function Search({ token, open, initial, zones }) {
  const [q, setQ] = useState(''); const [zone, setZone] = useState((initial && initial.zone) || ''); const [state, setState] = useState('');
  const r = useQ(token, 'ops.orders', { q, zone, state });
  const n = r.data ? r.data.length : 0;
  return <div className="op-search" data-tour="ops-search-panel">
    <div className="card op-filters">
      <div className="op-sbox"><span className="op-sbox-ic" aria-hidden="true">{Icon.search}</span><label htmlFor="s-q" className="sr-only">Référence, nom ou téléphone</label><input id="s-q" className="input" value={q} onChange={e => setQ(e.target.value)} placeholder="Référence, nom ou téléphone" autoComplete="off" /></div>
      <label htmlFor="s-z" className="sr-only">Zone</label>
      <select id="s-z" className="input" value={zone} onChange={e => setZone(e.target.value)}><option value="">Toutes mes zones</option>{ZONES.filter(z => !zones || zones.includes(z.id)).map(z => <option key={z.id} value={z.id}>{z.name}</option>)}</select>
      <label htmlFor="s-s" className="sr-only">Étape</label>
      <select id="s-s" className="input" value={state} onChange={e => setState(e.target.value)}><option value="">Toutes les étapes</option>{ORDER_STATES.map(x => <option key={x} value={x}>{STATE_INFO[x].label}</option>)}</select>
    </div>
    <section className="card-dark stack">
      <div className="card-title"><h2>{n} dossier{n > 1 ? 's' : ''}</h2><span className="tiny muted">Votre périmètre seulement. Chaque ouverture de fiche est notée au journal.</span></div>
      {r.error ? <div className="alert alert-bad">{r.error.message}</div> : <OrderTable rows={r.data} open={open} empty="Aucun dossier ne correspond à cette recherche." />}
    </section>
  </div>;
}

// ---------- Fiche dossier ----------
function OrderSheet({ token, orderId, role, onClose }) {
  const r = useQ(token, 'ops.order', { orderId });
  const staff = useQ(token, 'ops.staff');
  const [modal, setModal] = useState(null);
  const [f, setF] = useState({});
  const [msg, setMsg] = useState('');
  const [note, setNote] = useState('');
  const [sum, setSum] = useState(null);
  const [mode, setMode] = useState(null);
  const [more, setMore] = useState(false);
  const [tab, setTab] = useState('docs');
  const [allEv, setAllEv] = useState(false);
  const msgRef = useRef(null);
  const noteRef = useRef(null);
  const teams = useQ(token, role === 'planificateur' || role === 'superviseur' ? 'planning' : 'me');
  if (r.error) return <div className="stack"><div><Btn size="s" kind="ghost" onClick={onClose}>{Icon.left} Retour</Btn></div><div className="alert alert-bad">{r.error.message}</div></div>;
  const v = r.data; const o = v.order; const I = v.internal;
  const appt = v.appt;
  const isC = role === 'conseiller', isP = role === 'planificateur', isS = role === 'superviseur';
  const canWrite = isC || isS;
  const md = mode || (canWrite ? 'msg' : 'note');
  const genSum = () => { try { const s = api.q(token, 'ops.summary', { orderId }); setSum(s); setMsg(s.draft); setMode('msg'); } catch (e) { setSum({ error: e.message }); } };
  const focus = (m, ref) => { setMode(m); setTimeout(() => { const el = ref.current; if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.focus(); } }, 40); };
  const teamList = (teams.data && teams.data.teams) || [];
  const staffName = id => ((staff.data || []).find(u => u.id === id) || {}).name;
  const idx = ORDER_STATES.indexOf(o.state);
  const [ptone, plabel] = PRIO[I.risk.level] || ['neutral', I.risk.level];

  // Une seule action principale par rôle ; les autres vont dans « Plus d'actions ».
  const acts = [];
  if (isP && o.state === 'PREPARATION') acts.push({ k: 'ready', async: true, label: 'Valider la vérification technique', run: () => call(token, 'order.markReady', { orderId }) });
  if (isP && appt && appt.status === 'reserve') acts.push({ k: 'confirm', label: 'Confirmer le RDV et affecter', run: () => { setModal('confirm'); setF({ teamId: '' }); } });
  if (isS && o.state === 'ACTIVATION_EN_ATTENTE' && I.blockers.some(b => b.status === 'ouvert' && ['ACTIVATION_ECHOUEE', 'ANOMALIE_ACTIVATION'].includes(b.type))) acts.push({ k: 'retry', async: true, label: 'Relancer l’activation', run: () => call(token, 'activation.retry', { orderId }) });
  if (isC && v.refund && v.refund.status === 'demande') acts.push({ k: 'cancel', async: true, label: 'Instruire l’annulation', run: async () => { const x = await call(token, 'cancel.instruct', { orderId, note: 'Client joint, demande confirmée' }); if (x.ok) toast('Annulation transmise au superviseur pour validation.'); } });
  const payPending = (I.approvals || []).some(a => a.kind === 'paiement' && a.status === 'en_attente');
  if (isC && o.payment.status === 'en_attente' && !payPending) acts.push({ k: 'pay', label: 'Rapprochement manuel', run: () => { setModal('pay'); setF({}); } });
  if (isS && o.state === 'SERVICE_ACTIF') acts.push({ k: 'close', async: true, label: 'Clôturer le dossier', run: () => call(token, 'order.close', { orderId }) });
  if (isP && appt && appt.status === 'confirme') acts.push({ k: 'reassign', label: 'Réaffecter la mission', run: () => { setModal('reassign'); setF({}); } });
  if (canWrite) acts.push({ k: 'write', label: 'Écrire au client', run: () => focus('msg', msgRef) });
  const asked = new Set((o.requiredDocs || []).filter(t => !v.documents.some(d => d.type === t && d.status === 'valide')));
  if (isC) acts.push({ k: 'docreq', label: 'Demander une pièce', run: () => { setModal('docreq'); setF({ type: Object.keys(DOC_TYPES).find(t => !asked.has(t)) || 'cni' }); } });
  if ((isC || isP) && o.state === 'PREPARATION') acts.push({ k: 'addr', async: true, label: 'Demander une précision d’adresse', run: () => call(token, 'address.requestPrecision', { orderId, detail: 'Précision demandée par ' + ROLES[role].label }) });
  if (isC || isP) acts.push({ k: 'esc', label: 'Escalader au superviseur', run: () => { setModal('escalate'); setF({}); } });
  if (isP) acts.push({ k: 'note', label: 'Ajouter une note', run: () => focus('note', noteRef) });
  const act = (a, primary) => { const P = { key: a.k, kind: primary ? 'primary' : undefined, size: primary ? undefined : 's', onClick: a.run }; return a.async ? <AsyncBtn {...P}>{a.label}</AsyncBtn> : <Btn {...P}>{a.label}</Btn>; };
  const [main, ...rest] = acts;

  const openB = I.blockers.filter(b => b.status === 'ouvert'), doneB = I.blockers.filter(b => b.status !== 'ouvert');
  const thread = [...v.messages.map(m => ({ ...m, kind: 'msg' })), ...I.notes.map(n => ({ ...n, kind: 'note' }))].sort((a, b) => a.at - b.at);
  const evs = [...I.events].reverse();
  const wo = I.workOrder;

  return <div className="op-sheet" data-tour="ops-sheet">
    <div className="op-sheet-bar">
      <Btn size="s" kind="ghost" onClick={onClose}>{Icon.left} Retour aux listes</Btn>
      <span className="tiny muted">Mis à jour le {fmtDateTime(o.updatedAt)}</span>
    </div>

    <section className="card-strong op-head">
      <div className="op-head-top">
        <Avatar name={o.contactName} size={76} />
        <div className="grow stack-s op-head-id">
          <div className="row"><StateTag state={o.state} cancelled={o.cancelled} /><span className="small muted">{o.ref} · {o.offer}</span></div>
          <h2 className="op-name">{o.contactName}</h2>
          <div className="op-meta small muted"><span>{Icon.pin}{o.address.street}, {o.address.commune}</span><span>{Icon.phone}{o.contactPhone}</span><span title="Un dossier rattaché apparaît dans l’application du client">{Icon.user}{o.claimed ? 'Rattaché au compte du client' : 'Pas encore rattaché à un compte client'}</span></div>
          {(o.address.landmark || o.address.floor || o.address.accessNotes || o.address.onsiteContact) && <div className="op-meta small muted op-addr-x">
            {o.address.landmark && <span>Repère : {o.address.landmark}</span>}
            {o.address.floor && <span>Étage : {o.address.floor}</span>}
            {o.address.accessNotes && <span>Accès : {o.address.accessNotes}</span>}
            {o.address.onsiteContact && <span>Présent le jour J : {o.address.onsiteContact}</span>}
          </div>}
        </div>
        <div className="op-head-ring">
          <Ring value={o.cancelled ? 0 : idx + 1} max={ORDER_STATES.length} size={86} stroke={8} color={o.state === 'SERVICE_ACTIF' || o.state === 'CLOTURE' ? 'var(--ok)' : 'var(--accent)'}><span className="op-ring-n">{idx + 1}</span><span className="op-ring-d">sur {ORDER_STATES.length}</span></Ring>
          <span className="tiny muted">étape</span>
        </div>
      </div>
      <Progress state={o.state} />
      <div className={'op-why op-why-' + ptone}>
        <Pill tone={ptone} title={'Score de risque ' + Math.round(I.risk.score * 100) + ' %'}>Priorité : {plabel}</Pill>
        <span className="small">{I.risk.causes.length ? I.risk.causes.map(plainCause).join(' · ') : 'Rien à signaler pour l’instant.'}</span>
      </div>
      <div className="op-facts">
        <div className="op-fact"><span className="eyebrow">Paiement</span><b className="small">{PAYMENT_STATES[o.payment.status]}</b><span className="tiny muted">{money(o.payment.amount)} <Sim what="Moov Money" /></span></div>
        <div className="op-fact"><span className="eyebrow">Rendez-vous</span><b className="small">{appt ? fmtDate(appt.date) : 'Pas encore'}</b><span className="tiny muted">{appt ? slotLabel(appt.slot) + ' · ' + APPT_STATES[appt.status] : 'Aucun créneau choisi'}</span></div>
        <div className="op-fact"><span className="eyebrow">Réseau</span><b className="small">{I.portReserved ? 'Port réservé' : 'Port non réservé'}</b><span className="tiny muted"><Sim what="référentiel fictif" /></span></div>
        <div className="op-fact" title="Suggestion calculée (IA-02), à vérifier"><span className="eyebrow">À faire ensuite</span><b className="small">{I.risk.action}</b><span className="tiny muted">{I.risk.to ? 'par : ' + ROLES[I.risk.to].label : 'suggestion automatique'}</span></div>
      </div>
      {payPending && isC && <div className="alert alert-info small">Rapprochement manuel envoyé : il attend la validation du superviseur.</div>}
      {v.stale && <div className="alert alert-warn small">Lien avec Moov Prospect interrompu depuis le {fmtDateTime(v.stale)} : l’étape affichée peut être ancienne.</div>}
      {acts.length > 0 && <div className="op-actions">
        {act(main, true)}
        {rest.length > 0 && <Btn kind="ghost" aria-expanded={more} onClick={() => setMore(!more)}>Plus d’actions <span className={'op-chev' + (more ? ' is-open' : '')} aria-hidden="true">{Icon.right}</span></Btn>}
      </div>}
      {more && rest.length > 0 && <div className="op-more">{rest.map(a => act(a, false))}</div>}
    </section>

    <div className="op-sgrid">
      <div className="op-col">
        <section className="card stack">
          <div className="card-title"><h2>Blocages {openB.length > 0 && <span className="op-h-n">{openB.length}</span>}</h2>
            <Explain>Un <b>blocage</b> a toujours un motif, un responsable, une échéance et une action attendue. Quand l’échéance passe, le superviseur est prévenu automatiquement.</Explain></div>
          {openB.length === 0 && <Empty>Aucun blocage ouvert : rien n’empêche le dossier d’avancer.</Empty>}
          {openB.length > 0 && <div className="op-bcs">{openB.map(b => <div key={b.id} className={'op-bc' + (b.escalated ? ' is-late' : '')}>
            <div className="spread" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}><b>{b.label}</b><Pill tone={b.escalated ? 'bad' : 'warn'}>{b.escalated ? 'Échéance dépassée' : 'Ouvert'}</Pill></div>
            {b.detail && <p className="small muted">{b.detail}</p>}
            <div className="op-bc-owner">
              {b.ownerName ? <Avatar name={b.ownerName} size={38} /> : <span className="op-nobody" aria-hidden="true">?</span>}
              <div className="grow op-trunc">
                <b className={'small' + (b.ownerName ? '' : ' op-bad')}>{b.ownerName || 'Personne n’en est responsable'}</b>
                <div className="tiny muted">{ROLES[b.ownerRole] ? (b.ownerName ? ROLES[b.ownerRole].label : 'Rôle attendu : ' + ROLES[b.ownerRole].label) : b.ownerRole} · avant le {fmtDateTime(b.dueAt)}</div>
              </div>
            </div>
            <span className="small"><span className="muted">À faire :</span> {b.action}</span>
            {role !== 'auditeur' && <div className="row op-bc-act">
              <select className="input op-assign" aria-label="Affecter à" value="" onChange={e => e.target.value && call(token, 'blocker.assign', { blockerId: b.id, userId: e.target.value })}><option value="">Affecter à…</option>{(staff.data || []).filter(u => ['conseiller', 'planificateur', 'superviseur'].includes(u.role)).map(u => <option key={u.id} value={u.id}>{u.name} ({ROLES[u.role].label})</option>)}</select>
              <Btn size="s" kind="primary" onClick={() => { setModal('resolve:' + b.id); setF({}); }}>Résoudre</Btn>
            </div>}
            <span className="tiny muted">Ouvert par {b.openedBy}, le {fmtDateTime(b.openedAt)}</span>
          </div>)}</div>}
          {doneB.length > 0 && <details className="op-details"><summary>Blocages résolus ({doneB.length})</summary>
            <div className="stack-s" style={{ marginTop: 10 }}>{doneB.map(b => <div key={b.id} className="op-item op-item-row"><span className="op-ic op-ic-ok">{Icon.check}</span><div className="grow"><b className="small">{b.label}</b><div className="tiny muted">{b.resolution || 'Résolu'}{b.resolvedBy ? ' · ' + b.resolvedBy : ''}{b.resolvedAt ? ', ' + fmtDateTime(b.resolvedAt) : ''}</div></div></div>)}</div>
          </details>}
        </section>

        <section className="card stack">
          <div className="card-title"><h2>Échanges</h2><span className="tiny muted">{v.messages.length} message{v.messages.length > 1 ? 's' : ''} · {I.notes.length} note{I.notes.length > 1 ? 's' : ''}</span></div>
          <div className="op-thread">
            {thread.length === 0 && <Empty>Aucun échange pour l’instant.</Empty>}
            {thread.map(m => m.kind === 'note' ? <div key={m.id} className="op-line op-line-me">
              <div className="op-note" title="Jamais visible par le client"><span className="tiny op-note-h">{Icon.lock}Note interne · {firstName(m.author)} · {fmtDateTime(m.at)}</span><div className="small">{m.text}</div></div><Avatar name={m.author} size={30} />
            </div> : m.auto ? <div key={m.id} className="op-line op-line-auto">
              <div className="bubble bubble-auto"><div className="small">{m.text}</div><div className="src">Message automatique · {fmtDateTime(m.at)}</div></div>
            </div> : m.from === 'client' ? <div key={m.id} className="op-line">
              <Avatar name={m.author} size={30} /><div className="bubble bubble-them"><div className="small">{m.text}</div><div className="src">{firstName(m.author)} · {fmtDateTime(m.at)}</div></div>
            </div> : <div key={m.id} className="op-line op-line-me">
              <div className="bubble bubble-me"><div className="small">{m.text}</div><div className="src">{firstName(m.author)} · {fmtDateTime(m.at)}</div></div><Avatar name={m.author} size={30} />
            </div>)}
          </div>
          {role !== 'auditeur' && <div className="op-compose">
            {canWrite && <div className="pills pills-soft op-pills-s" role="tablist" aria-label="Type de message">
              <button type="button" role="tab" aria-selected={md === 'msg'} onClick={() => setMode('msg')}>Au client</button>
              <button type="button" role="tab" aria-selected={md === 'note'} onClick={() => setMode('note')}>Note interne</button>
            </div>}
            {md === 'msg' && canWrite ? <>
              <label htmlFor="op-msg" className="sr-only">Message au client (relisez et modifiez avant envoi)</label>
              <textarea id="op-msg" ref={msgRef} className="input" value={msg} onChange={e => setMsg(e.target.value)} placeholder="Écrivez au client. Il le lira dans son application." />
              <div className="spread"><span className="tiny muted">{sum && !sum.error && msg === sum.draft ? 'Brouillon proposé par l’IA : relisez-le.' : 'Relisez avant d’envoyer.'}</span>
                <AsyncBtn kind="primary" disabled={!msg.trim()} onClick={async () => { if ((await call(token, 'msg.reply', { orderId, text: msg, fromAi: !!sum && msg === (sum && sum.draft) })).ok) { setMsg(''); setSum(null); } }}>Envoyer au client</AsyncBtn></div>
            </> : <form className="op-noteform" onSubmit={async e => { e.preventDefault(); if ((await call(token, 'note.add', { orderId, text: note })).ok) setNote(''); }}>
              <input ref={noteRef} className="input" aria-label="Note interne" placeholder="Note pour les équipes (jamais visible par le client)" value={note} onChange={e => setNote(e.target.value)} />
              <Btn type="submit" kind={canWrite ? undefined : 'primary'}>Ajouter</Btn>
            </form>}
          </div>}
          {I.assistantLog.length > 0 && <details className="op-details small"><summary>Questions posées à l’assistant ({I.assistantLog.length})</summary><div className="stack-s" style={{ marginTop: 8 }}>{I.assistantLog.map(a => <div key={a.id} className="tiny"><span className="muted">{fmtDateTime(a.at)} · </span>{a.refused ? <b className="op-bad">refus</b> : a.intent || 'abstention'} · « {a.q} »</div>)}</div></details>}
        </section>
      </div>

      <div className="op-col">
        {canWrite && <section className="card-dark stack op-ai" data-tour="ops-summary">
          <div className="card-title"><h2>Résumé et réponse</h2><span className="op-ai-tag" title="Fonction d’IA (IA-04) : brouillon à relire">IA</span></div>
          {!sum ? <>
            <p className="small muted">L’IA relit l’historique, résume le dossier et prépare une réponse. Vous la relisez avant tout envoi.</p>
            <div><AsyncBtn className="op-lime" onClick={genSum}>Générer le résumé du dossier</AsyncBtn></div>
          </> : sum.error ? <div className="alert alert-bad small">{sum.error}</div> : <>
            <ol className="op-sum">{sum.lines.map((l, i) => <li key={i}>{l.text}{l.ref != null && <span className="op-ref" title={'Source : événement n° ' + l.ref + ' de l’historique'}>{l.ref}</span>}</li>)}</ol>
            <span className="tiny muted">{sum.note}</span>
            <div className="row"><Btn size="s" className="op-lime" onClick={() => focus('msg', msgRef)}>Relire la réponse proposée</Btn><Btn size="s" onClick={() => setSum(null)}>Effacer</Btn></div>
          </>}
        </section>}

        <section className="card stack">
          <div className="pills pills-soft op-pills-s" role="tablist" aria-label="Détails du dossier">
            <button type="button" role="tab" aria-selected={tab === 'docs'} onClick={() => setTab('docs')}>Pièces<span className="count">{v.documents.length}</span></button>
            <button type="button" role="tab" aria-selected={tab === 'rdv'} onClick={() => setTab('rdv')}>Rendez-vous<span className="count">{v.appointments.length}</span></button>
            <button type="button" role="tab" aria-selected={tab === 'mission'} onClick={() => setTab('mission')}>Mission</button>
            <button type="button" role="tab" aria-selected={tab === 'dup'} onClick={() => setTab('dup')}>Doublons<span className="count">{I.duplicates.length}</span></button>
          </div>
          {tab === 'docs' && <div className="stack-s">
            {asked.size > 0 && <div className="op-asked small">{Icon.doc}<span>Demandé au client : <b>{[...asked].map(t => DOC_TYPES[t].label).join(', ')}</b></span></div>}
            {v.documents.length ? [...v.documents].reverse().map(d => <DocReview key={d.id} token={token} d={{ ...d, ref: v.order.ref }} canReview={isC} compact />) : <Empty>Aucune pièce envoyée.</Empty>}
            {!isC && v.documents.some(d => d.status === 'a_valider') && <span className="tiny muted">Seule la conseillère ou le conseiller valide les pièces.</span>}
          </div>}
          {tab === 'rdv' && <div className="stack-s">
            {v.appointments.length ? [...v.appointments].reverse().map(a => <div key={a.id} className="op-item op-item-row"><span className="op-ic">{Icon.cal}</span><div className="grow"><b className="small">{fmtDate(a.date)} · {slotLabel(a.slot)}</b>{a.reason && <div className="tiny muted">{a.reason}</div>}</div><Pill tone={['confirme', 'realise'].includes(a.status) ? 'ok' : ['annule', 'non_honore'].includes(a.status) ? 'bad' : a.status === 'remplace' ? 'neutral' : 'warn'}>{APPT_STATES[a.status] || a.status}</Pill></div>) : <Empty>Aucun rendez-vous pour l’instant.</Empty>}
            {(isC || isP) && appt && ['reserve', 'confirme'].includes(appt.status) && <div><Btn size="s" kind="ghost" onClick={() => { setModal('apptcancel'); setF({}); }}>Annuler ce rendez-vous</Btn></div>}
            <span className="tiny muted">Pour une autre date, le client choisit un nouveau créneau dans son application : l’ancien rendez-vous reste dans l’historique.</span>
          </div>}
          {tab === 'mission' && (wo ? <div className="stack">
            <div className="op-item op-item-row">{staffName(wo.techUserId) ? <Avatar name={staffName(wo.techUserId)} size={40} /> : <span className="op-ic">{Icon.tool}</span>}<div className="grow"><b className="small">{staffName(wo.techUserId) || 'Technicien'}</b><div className="tiny muted">{wo.teamName || (teamList.find(t => t.id === wo.teamId) || {}).name || 'Mission terrain'}</div></div><Pill tone={wo.status === 'terminee' ? 'ok' : wo.status === 'echec' || wo.status === 'annulee' ? 'bad' : 'info'}>{WO_STATUS[wo.status] || wo.status}</Pill></div>
            <dl className="op-kv small">
              <dt>Checklist</dt><dd>{ckSummary(wo.checklist)}</dd>
              <dt>Photos</dt><dd>{wo.photos.length ? <span className="pic-row">{wo.photos.map(p => <Picture key={p.id} token={token} img={p.img} thumb={p.thumb} label={'Photo · ' + p.name} alt={p.name} size={56} />)}</span> : 'aucune'}</dd>
              <dt>N° de série</dt><dd>{wo.serial || 'pas encore'}</dd>
              {wo.comment && <><dt>Commentaire</dt><dd>« {wo.comment} »</dd></>}
              {wo.reception && <><dt>Réception</dt><dd className={wo.reception.status === 'accord' ? '' : 'op-warn'}>{wo.reception.status === 'accord' ? 'Accord du client' : 'Accord avec réserve : ' + (wo.reception.comment || 'sans détail')}</dd></>}
              {wo.failure && <><dt>Échec</dt><dd className="op-bad">{BLOCKER_TYPES[wo.failure.type].label}</dd></>}
            </dl>
            <span className="tiny muted">Version de la mission : {wo.version}</span>
          </div> : <Empty who="Brice Yao">Aucune mission terrain pour ce dossier.</Empty>)}
          {tab === 'dup' && <div className="stack-s">
            {I.linkedTo && <div className="op-item op-item-row"><span className="op-ic">{Icon.plug}</span><div className="grow small">Rapproché de <b>{I.linkedTo}</b></div>{isC && <AsyncBtn size="s" onClick={() => call(token, 'duplicate.unlink', { orderId })}>Séparer</AsyncBtn>}</div>}
            {I.duplicates.length ? I.duplicates.map(d => <div key={d.id} className="op-item op-item-row"><span className="op-ic">{Icon.users}</span><div className="grow op-trunc"><b className="small">{d.ref}</b><div className="tiny muted">{d.why} · {STATE_INFO[d.state].label}</div></div>{isC && !I.linkedTo && <AsyncBtn size="s" onClick={() => call(token, 'duplicate.link', { orderId, otherId: d.id })}>Rapprocher</AsyncBtn>}</div>) : <Empty>Aucun doublon détecté.</Empty>}
            <span className="tiny muted">Rapprocher ne fusionne rien : c’est réversible et noté au journal.</span>
          </div>}
        </section>

        <section className="card stack">
          <div className="card-title"><h2>Historique</h2><Explain>Chaque événement garde sa date, sa source, son auteur et la version du dossier. Une correction est un nouvel événement : rien n’est effacé.</Explain></div>
          <ol className="op-tl">{(allEv ? evs : evs.slice(0, 6)).map(e => <li key={e.seq}>
            <span className="op-tl-dot" aria-hidden="true" />
            <div className="op-tl-body">
              <b className="small">{evLabel(e.type) + holdNote(e)}</b>
              {e.payload && (e.payload.reason || e.payload.text) ? <div className="tiny muted">{e.payload.reason || e.payload.text}</div> : null}
              <div className="op-tl-meta tiny muted">{e.role === 'systeme' ? <span className="op-sys" aria-hidden="true">{Icon.logo}</span> : <Avatar name={e.actor} size={20} />}{e.role === 'systeme' ? 'Automatique' : firstName(e.actor)} · {fmtDateTime(e.effectiveAt)}</div>
            </div>
          </li>)}</ol>
          {evs.length > 6 && <div><button type="button" className="link-btn" onClick={() => setAllEv(!allEv)}>{allEv ? 'Réduire' : 'Tout voir (' + evs.length + ' événements)'}</button></div>}
          <details className="op-details"><summary>Détail technique</summary>
            <div className="stack" style={{ marginTop: 10 }}>
              <span className="tiny muted">Version du dossier : {o.version}</span>
              <div className="tbl-wrap op-techtbl"><table className="tbl"><thead><tr><th>#</th><th>Événement</th><th>Date effective</th><th>Reçu</th><th>Source</th><th>Acteur</th><th>v.</th></tr></thead>
                <tbody>{evs.map(e => <tr key={e.seq}><td className="num">{e.seq}</td><td><b className="small">{e.type}</b>{e.payload && e.payload.reason ? <div className="tiny muted">{e.payload.reason}</div> : null}</td><td className="num tiny">{fmtDateTime(e.effectiveAt)}</td><td className="num tiny">{fmtDateTime(e.receivedAt)}</td><td className="tiny">{e.source}</td><td className="tiny">{e.actor}</td><td className="num tiny">{e.version}</td></tr>)}</tbody></table></div>
              {I.deliveries.length > 0 && <details className="op-details small"><summary>Échanges avec les systèmes Moov ({I.deliveries.length})</summary>{I.deliveries.map(d => <div key={d.id} className="tiny">{d.kind} · {d.eventId} · <b>{d.status}</b> · {d.attempts} essai(s) {d.error ? '· ' + d.error : ''}</div>)}</details>}
            </div>
          </details>
        </section>
      </div>
    </div>

    {modal === 'confirm' && (() => {
      const cells = (teams.data && teams.data.cells) || [];
      const cellOf = t => cells.find(c => c.teamId === t.id && c.date === appt.date && c.slot === appt.slot);
      const heldBy = (cells.find(c => (c.appts || []).some(a => a.id === appt.id)) || {}).teamId;
      const proposed = teamList.find(t => t.id === heldBy);
      const room = t => { const c = cellOf(t); return t.id === heldBy || (c && c.left > 0); };
      return <Modal title="Confirmer et affecter" onClose={() => setModal(null)} actions={<AsyncBtn kind="primary" onClick={async () => { const x = await call(token, 'appt.confirm', { orderId, teamId: f.teamId || undefined }); if (x.ok) { setModal(null); toast('Rendez-vous confirmé : le client et le technicien sont prévenus.'); } }}>Confirmer</AsyncBtn>}>
        <p className="small">Créneau réservé par le client : <b>{fmtDate(appt.date)} {slotLabel(appt.slot)}</b>. Équipe proposée : <b>{proposed ? proposed.name : 'celle qui a de la place'}</b>.</p>
        <Field label="Équipe" id="cf-t"><select id="cf-t" className="input" value={f.teamId} onChange={e => setF({ teamId: e.target.value })}><option value="">Garder l’équipe proposée</option>{teamList.filter(t => t.zones.includes(o.zone)).map(t => <option key={t.id} value={t.id} disabled={!t.available || !room(t)}>{t.name}{!t.available ? ' (indisponible)' : !room(t) ? ' (complet sur ce créneau)' : ''}</option>)}</select></Field>
      </Modal>;
    })()}
    {modal === 'reassign' && <Modal title="Réaffecter la mission" onClose={() => setModal(null)} actions={<AsyncBtn kind="primary" onClick={async () => { if ((await call(token, 'appt.reassign', { orderId, teamId: f.teamId, reason: f.reason })).ok) setModal(null); }}>Réaffecter</AsyncBtn>}>
      <Field label="Nouvelle équipe" id="ra-t"><select id="ra-t" className="input" value={f.teamId || ''} onChange={e => setF({ ...f, teamId: e.target.value })}><option value="">Choisir…</option>{teamList.filter(t => t.zones.includes(o.zone) && (!wo || t.id !== wo.teamId)).map(t => <option key={t.id} value={t.id} disabled={!t.available}>{t.name}{t.available ? '' : ' (indisponible)'}</option>)}</select></Field>
      <Field label="Justification (obligatoire, visible dans le journal)" id="ra-r"><input id="ra-r" className="input" value={f.reason || ''} onChange={e => setF({ ...f, reason: e.target.value })} /></Field>
      <span className="small muted">Le technicien précédent, le nouveau et le client sont prévenus. Le créneau ne change pas.</span>
    </Modal>}
    {modal === 'docreq' && <Modal title="Demander une pièce" onClose={() => setModal(null)} actions={<AsyncBtn kind="primary" onClick={async () => { const x = await call(token, 'doc.request', { orderId, type: f.type, reason: f.reason }); if (x.ok) { setModal(null); toast(x.data && x.data.claimed ? 'Demande envoyée : ' + firstName(o.contactName) + ' la voit dans son application.' : 'Demande enregistrée. Le client la verra quand il aura rattaché ce dossier à son compte.'); } }}>Demander</AsyncBtn>}>
      {!o.claimed && <div className="alert alert-warn small">Ce dossier n’est rattaché à aucun compte client : la demande sera visible quand le client l’aura rattaché. Vérifiez s’il n’existe pas un autre dossier au même nom (onglet Doublons).</div>}
      <Field label="Pièce" id="dr-t"><select id="dr-t" className="input" value={f.type} onChange={e => setF({ ...f, type: e.target.value })}>{Object.entries(DOC_TYPES).map(([k, d]) => <option key={k} value={k} disabled={asked.has(k)}>{d.label}{asked.has(k) ? ' (déjà demandée)' : ''}</option>)}</select></Field>
      <Field label="Précision pour le client (facultatif)" id="dr-r"><input id="dr-r" className="input" value={f.reason || ''} placeholder="Ex. recto et verso, bien lisible" onChange={e => setF({ ...f, reason: e.target.value })} /></Field>
    </Modal>}
    {modal === 'apptcancel' && <Modal title="Annuler le rendez-vous ?" onClose={() => setModal(null)} actions={<AsyncBtn kind="primary" disabled={(f.reason || '').trim().length < 5} onClick={async () => { const x = await call(token, 'appt.cancel', { orderId, reason: f.reason.trim() }); if (x.ok) { setModal(null); toast('Rendez-vous annulé : le client et le technicien sont prévenus.'); } }}>Annuler le rendez-vous</AsyncBtn>}>
      <p className="small">Le créneau est libéré et la mission retirée au technicien. Le client pourra choisir une autre date.</p>
      <Field label="Motif (visible dans l’historique)" id="ac-r"><input id="ac-r" className="input" value={f.reason || ''} onChange={e => setF({ reason: e.target.value })} placeholder="Ex. : le client a demandé un autre jour" /></Field>
    </Modal>}
    {modal === 'escalate' && <Modal title="Escalader au superviseur" onClose={() => setModal(null)} actions={<AsyncBtn kind="primary" onClick={async () => { if ((await call(token, 'escalate', { orderId, reason: f.reason })).ok) setModal(null); }}>Escalader</AsyncBtn>}>
      <Field label="Motif" id="es-r"><textarea id="es-r" className="input" value={f.reason || ''} onChange={e => setF({ reason: e.target.value })} /></Field>
    </Modal>}
    {modal === 'pay' && <Modal title="Rapprochement manuel du paiement" onClose={() => setModal(null)} actions={<AsyncBtn kind="primary" onClick={async () => { if ((await call(token, 'payment.manualRequest', { orderId, justification: f.j })).ok) setModal(null); }}>Soumettre à validation</AsyncBtn>}>
      <p className="small">Procédure d’exception : une deuxième personne (superviseur) doit valider. Une capture d’écran de reçu ne suffit pas.</p>
      <Field label="Justification (référence du relevé Moov Money…)" id="pay-j"><textarea id="pay-j" className="input" value={f.j || ''} onChange={e => setF({ j: e.target.value })} /></Field>
    </Modal>}
    {modal && modal.startsWith('resolve:') && <Modal title="Résoudre le blocage" onClose={() => setModal(null)} actions={<AsyncBtn kind="primary" onClick={async () => { if ((await call(token, 'blocker.resolve', { blockerId: modal.slice(8), resolution: f.res })).ok) setModal(null); }}>Résoudre</AsyncBtn>}>
      <Field label="Ce qui a été fait (reste dans l’historique)" id="rs"><textarea id="rs" className="input" value={f.res || ''} onChange={e => setF({ res: e.target.value })} /></Field>
    </Modal>}
  </div>;
}

// ---------- Planning ----------
function Planning({ token, role, open }) {
  const r = useQ(token, 'planning');
  const staff = useQ(token, 'ops.staff');
  const ords = useQ(token, 'ops.orders');
  const [cell, setCell] = useState(null);
  const [day, setDay] = useState(null);
  if (r.error) return <div className="alert alert-bad">{r.error.message}</div>;
  const p = r.data;
  const names = Object.fromEntries((ords.data || []).map(o => [o.id, o.contactName]));
  const tech = t => ((staff.data || []).find(u => u.id === t.techUserId) || {}).name || t.name;
  const cellOf = (t, d, s) => p.cells.find(c => c.teamId === t && c.date === d && c.slot === s);
  const load = sum(p.cells, c => c.used), cap = sum(p.cells, c => c.cap);
  const canEdit = role === 'planificateur';
  const d0 = p.days.includes(day) ? day : p.days[0];
  const slotName = s => s === 'm' ? 'Matin' : 'Après-midi';
  const dots = c => c.cap === 0 && c.used === 0 ? <span className="tiny">fermé</span> : <span className="op-dots">{Array.from({ length: Math.max(c.cap, c.used) }, (_, i) => <i key={i} className={i < c.used ? 'on' : ''} />)}</span>;
  const capLabel = (c, s) => fmtDate(c.date) + ', ' + slotName(s).toLowerCase() + ' : ' + c.used + ' sur ' + c.cap + ' place(s) prise(s)';
  const slotCell = (c, s, big) => !c ? null : <>
    {canEdit ? <button type="button" className={'op-capbtn' + (c.left <= 0 ? ' is-full' : '')} onClick={() => setCell(c)} aria-label={capLabel(c, s) + '. Modifier la capacité'} title="Modifier la capacité">{big && <span>{slotName(s)}</span>}{dots(c)}</button>
      : <span className={'op-capbtn' + (c.left <= 0 ? ' is-full' : '')} aria-label={capLabel(c, s)} role="img">{big && <span>{slotName(s)}</span>}{dots(c)}</span>}
    {c.appts.map(a => { const n = names[a.orderId]; return <button key={a.id} type="button" className={'op-chip op-chip-' + a.status} onClick={() => open(a.orderId)} title={(n ? n + ' · ' : '') + a.ref + ' · ' + APPT_STATES[a.status]}><Avatar name={n || a.ref} size={big ? 26 : 20} /><span>{n ? firstName(n) : a.ref.slice(-3)}</span></button>; })}
  </>;
  const perDay = p.days.map(d => sum(p.cells.filter(c => c.date === d), c => c.used));
  const maxDay = Math.max(0, ...perDay);
  return <div className="op-planning">
    {p.unassigned.length > 0 && <section className="card stack op-confirm">
      <div className="card-title"><div className="stack-s" style={{ gap: 2 }}><h2>{p.unassigned.length} rendez-vous à confirmer</h2><span className="small muted">Choisis par les clients, pas encore confirmés avec une équipe.</span></div></div>
      <div className="op-crows">{p.unassigned.map(a => { const n = names[a.orderId]; return <div key={a.id} className="op-item op-item-row">
        <Avatar name={n || a.ref} size={40} /><div className="grow op-trunc"><b className="small">{n || a.ref}</b><div className="tiny muted">{a.ref} · {fmtDate(a.date)} · {slotLabel(a.slot)}</div></div>
        <Btn size="s" kind="primary" onClick={() => open(a.orderId)}>Ouvrir</Btn>
      </div>; })}</div>
    </section>}

    <section className="card stack op-plan" data-tour="ops-planning-panel">
      <div className="card-title">
        <div className="stack-s" style={{ gap: 2 }}><h2>Les 10 prochains jours ouvrés</h2><span className="small muted">{canEdit ? 'Touchez les points d’un créneau pour changer sa capacité.' : 'Chaque point est une place d’intervention.'}</span></div>
        <span className="op-capsum"><Ring value={load} max={cap || 1} size={40} stroke={5} color="var(--accent)" /><span><b className="num">{load}/{cap}</b><span className="tiny muted"> places prises</span></span></span>
      </div>
      {p.saturation && <div className="alert alert-sim small">Saturation simulée : une place est retenue sur chaque créneau.</div>}
      <div className="op-legend tiny">
        <span className="op-chip op-chip-confirme op-chip-static">Confirmé</span><span className="op-chip op-chip-reserve op-chip-static">Réservé, à confirmer</span><span className="op-chip op-chip-en_cours op-chip-static">En cours</span><span className="op-chip op-chip-realise op-chip-static">Réalisé</span>
      </div>
      <div className="op-weekbox">
        <div className="op-week-scroll"><div className="op-week" style={{ gridTemplateColumns: '200px 76px repeat(' + p.days.length + ', minmax(84px, 1fr))' }}>
          <div className="op-wh">Équipe</div><div className="op-wh" />{p.days.map(d => <div key={d} className="op-wh op-wh-day"><span>{fmtWd(d)}</span><b>{fmtDn(d)}</b></div>)}
          {p.teams.map(t => <React.Fragment key={t.id}>
            <div className={'op-wteam' + (t.available ? '' : ' is-off')} style={{ gridRow: 'span 2' }}>
              <Avatar name={tech(t)} size={40} dot={t.available ? 'ok' : 'bad'} />
              <div className="op-trunc"><b className="small">{t.name}</b><div className="tiny muted">{t.available ? firstName(tech(t)) + ' · ' + t.zones.map(zoneName).join(', ') : 'Indisponible'}</div></div>
            </div>
            {['m', 'a'].map(s => <React.Fragment key={s}>
              <div className="op-wslot">{slotName(s)}</div>
              {p.days.map(d => <div key={d} className={'op-wcell' + (t.available ? '' : ' is-off')}>{slotCell(cellOf(t.id, d, s), s, false)}</div>)}
            </React.Fragment>)}
          </React.Fragment>)}
        </div></div>
        <div className="op-dayview">
          <div className="op-days" role="tablist" aria-label="Jour">{p.days.map(d => <button key={d} type="button" role="tab" aria-selected={d === d0} onClick={() => setDay(d)}><span>{fmtWd(d)}</span><b>{fmtDn(d)}</b></button>)}</div>
          {p.teams.map(t => <div key={t.id} className={'op-dteam' + (t.available ? '' : ' is-off')}>
            <div className="op-item-h"><Avatar name={tech(t)} size={40} dot={t.available ? 'ok' : 'bad'} /><div className="grow op-trunc"><b className="small">{t.name}</b><div className="tiny muted">{t.available ? firstName(tech(t)) + ' · ' + t.zones.map(zoneName).join(', ') : 'Indisponible'}</div></div></div>
            <div className="op-dslots">{['m', 'a'].map(s => <div key={s} className="op-dslot">{slotCell(cellOf(t.id, d0, s), s, true)}</div>)}</div>
          </div>)}
        </div>
      </div>
    </section>

    <div className="op-dgrid">
      <section className="card stack">
        <div className="card-title"><h2>Charge des équipes</h2><span className="small muted">sur 10 jours</span></div>
        {p.teams.map(t => { const cs = p.cells.filter(c => c.teamId === t.id); const u = sum(cs, c => c.used), k = sum(cs, c => c.cap); const pc = k ? u / k : 0; return <div key={t.id} className="op-load">
          <Avatar name={tech(t)} size={40} dot={t.available ? 'ok' : 'bad'} />
          <div className="grow stack-s" style={{ gap: 6 }}>
            <div className="spread"><b className="small">{t.name}</b><span className="small num"><b>{u}</b><span className="muted">/{k} places</span></span></div>
            <div className="op-meter" role="img" aria-label={Math.round(pc * 100) + ' % des places prises'}><i style={{ width: Math.max(2, pc * 100) + '%', background: pc > 0.8 ? 'var(--accent)' : 'var(--ink)' }} /></div>
          </div>
        </div>; })}
      </section>
      <section className="card-dark stack">
        <div className="card-title"><h2>Rendez-vous par jour</h2><span className="small muted">toutes équipes</span></div>
        <Bars data={p.days.map((d, i) => ({ label: fmtDn(d), value: perDay[i], hi: perDay[i] > 0 && perDay[i] === maxDay }))} height={170} color="var(--dark-3)" hiColor="var(--lime)" />
      </section>
    </div>

    {cell && <Modal title="Capacité du créneau" onClose={() => setCell(null)}>
      <p className="small">{fmtDate(cell.date)} · {slotLabel(cell.slot)} · {cell.used} rendez-vous pris.</p>
      <div className="row">{[0, 1, 2, 3, 4].map(n => <AsyncBtn key={n} size="s" kind={cell.cap === n ? 'primary' : undefined} disabled={n < cell.used} onClick={async () => { if ((await call(token, 'capacity.set', { capId: cell.id, cap: n })).ok) setCell(null); }}>{n}</AsyncBtn>)}</div>
      <span className="tiny muted">Impossible de descendre sous le nombre de rendez-vous déjà pris.</span>
    </Modal>}
  </div>;
}

// ---------- Équipes et ressources ----------
function Teams({ token }) {
  const r = useQ(token, 'planning');
  const staff = useQ(token, 'ops.staff');
  const [reason, setReason] = useState('Arrêt maladie');
  if (r.error) return <div className="alert alert-bad">{r.error.message}</div>;
  const p = r.data;
  const tech = t => ((staff.data || []).find(u => u.id === t.techUserId) || {}).name || t.name;
  return <div className="op-teamsp">
    <div className="op-teams" data-tour="ops-teams-panel">
      {p.teams.map(t => <article key={t.id} className={'card op-team' + (t.available ? '' : ' is-off')}>
        <div className="op-item-h"><Avatar name={tech(t)} size={60} dot={t.available ? 'ok' : 'bad'} />
          <div className="grow op-trunc"><h3>{t.name}</h3><span className="small muted">{tech(t)}{t.contractor ? ' · ' + t.contractor : ''}</span></div></div>
        <div className="op-chips">{t.zones.map(z => <span key={z} className="op-zone op-zone-soft">{zoneName(z)}</span>)}</div>
        <div className="op-team-q">
          <div className="stack-s" style={{ gap: 2 }}><span className="eyebrow">Qualité</span><span className="op-team-v num">{nf1(t.quality)}<span className="muted">/5</span></span></div>
          <div className="stack-s" style={{ gap: 2 }}><span className="eyebrow">Compétences</span><span className="small">{t.skills.join(', ')}</span></div>
        </div>
        <label className="switch op-switch"><input type="checkbox" checked={t.available} aria-label={t.name + ' disponible'} onChange={() => t.available ? call(token, 'team.setAvailable', { teamId: t.id, available: false, reason }) : call(token, 'team.setAvailable', { teamId: t.id, available: true })} /><span><b className="small">{t.available ? 'Disponible' : 'Indisponible'}</b><span className="tiny muted">{t.available ? 'Touchez pour déclarer une absence' : 'Touchez pour la rendre disponible'}</span></span></label>
      </article>)}
    </div>
    <div className="card op-reason">
      <Field label="Motif si vous déclarez une équipe indisponible" id="tm-r"><input id="tm-r" className="input" value={reason} onChange={e => setReason(e.target.value)} /></Field>
      <span className="tiny muted">Une équipe déclarée indisponible ouvre un blocage sur chacun de ses rendez-vous confirmés, avec le planificateur comme responsable.</span>
    </div>
    <div className="op-dgrid op-dgrid-even">
      <section className="card stack">
        <div className="card-title"><h2>Ports fibre par commune</h2><Sim what="référentiel fictif" /></div>
        {Object.entries(p.ports).map(([z, v]) => { const tot = v.free + v.reserved; return <div key={z} className="op-load">
          <span className={'op-ic' + (v.free > 0 ? '' : ' op-ic-bad')}>{Icon.plug}</span>
          <div className="grow stack-s" style={{ gap: 6 }}>
            <div className="spread"><b className="small">{zoneName(z)}</b><span className="small"><b className={v.free > 0 ? '' : 'op-bad'}>{v.free} libre{v.free > 1 ? 's' : ''}</b><span className="muted"> · {v.reserved} réservé{v.reserved > 1 ? 's' : ''}</span></span></div>
            <div className="op-meter" role="img" aria-label={v.reserved + ' réservés sur ' + tot}><i style={{ width: (tot ? v.reserved / tot * 100 : 0) + '%', background: v.free > 0 ? 'var(--ink)' : 'var(--bad)' }} /></div>
          </div>
          {p.zones.includes(z) && <AsyncBtn size="s" onClick={() => call(token, 'network.addPorts', { zone: z, n: 2 })}>+2 ports</AsyncBtn>}
        </div>; })}
        <span className="tiny muted">Aucune de ces valeurs n’est une vraie carte de couverture Moov.</span>
      </section>
      <section className="card stack">
        <div className="card-title"><h2>Matériel</h2><Sim what="inventaire synthétique" /></div>
        {Object.entries(p.stock).map(([m, v]) => <div key={m} className="op-item op-item-row">
          <span className="op-ic">{Icon.box}</span>
          <div className="grow op-trunc"><b className="small">{m}</b><div className="tiny muted">{v.attribue} posé{v.attribue > 1 ? 's' : ''}</div></div>
          {p.shortage ? <Pill tone="bad">Rupture simulée</Pill> : <span className="op-stock num"><b className={v.stock < 4 ? 'op-warn' : ''}>{v.stock}</b><span className="tiny muted"> en stock</span></span>}
        </div>)}
        <span className="small muted">Demande à venir : <b>{p.demand}</b> dossier(s) prêts ou planifiés.</span>
      </section>
    </div>
  </div>;
}

// ---------- Tableau de bord (superviseur) ----------
const PHASES = [
  ['Avant la pose', ['DOSSIER_RECU', 'PAIEMENT_CONFIRME', 'PREPARATION', 'PRET_A_PLANIFIER'], 'var(--info)'],
  ['Rendez-vous et pose', ['RDV_CONFIRME', 'INTERVENTION_EN_COURS', 'INSTALLATION_TERMINEE'], 'var(--warn)'],
  ['Activation', ['ACTIVATION_EN_ATTENTE'], 'var(--sim)'],
  ['Actif', ['SERVICE_ACTIF', 'CLOTURE'], 'var(--ok)'],
];
function KpiVal({ v, unit }) { return v == null ? <span className="op-kpi-v op-kpi-na">Pas encore</span> : <span className="op-kpi-v num">{v}{unit && <small>{unit}</small>}</span>; }
function Dashboard({ token, open, goSearch, goApprovals }) {
  const r = useQ(token, 'dashboard');
  const ords = useQ(token, 'ops.orders');
  const me = useQ(token, 'me');
  const ap = useQ(token, 'admin.refunds');
  const [zone, setZone] = useState(null);
  if (r.error) return <div className="alert alert-bad">{r.error.message}</div>;
  const d = r.data;
  const pct = x => x == null ? null : Math.round(x * 100) + ' %';
  // Arrivées par jour sur 14 jours, calculées à partir de la date de paiement (ou de réception) de chaque dossier.
  const clock = me.data ? me.data.ws.clock : Date.now();
  const N = 14, today = Math.floor(clock / DAY);
  const arrivals = Array.from({ length: N }, () => 0);
  for (const o of ords.data || []) { const k = N - 1 - (today - Math.floor((clock - o.ageD * DAY) / DAY)); if (k >= 0 && k < N) arrivals[k]++; }
  const nArr = sum(arrivals, x => x);
  const zmap = {};
  for (const z of d.byZone) { const id = (ZONES.find(x => x.name === z.zone) || {}).id; if (id) zmap[id] = { count: z.open, tone: z.blocked ? 'bad' : undefined, blocked: z.blocked }; }
  const zsel = zone && zmap[zone] ? zone : null;
  const pending = ap.data ? ap.data.approvals.filter(a => a.status === 'en_attente') : [];
  const stateRows = ORDER_STATES.filter(s => d.byState[s] > 0);
  const maxState = Math.max(1, ...stateRows.map(s => d.byState[s]));
  return <div className="op-dash">
    <p className="op-honest tiny muted"><Sim what="données fictives" /> Indicateurs calculés sur les dossiers inventés de cet espace : ils montrent la méthode, pas un gain réel.</p>
    <div className="op-kpis" data-tour="ops-kpis">
      <div className="op-kpi">
        <div className="op-kpi-h"><span className="eyebrow">Dossiers en cours</span><span className="op-kpi-ic">{Icon.list}</span></div>
        <div className="op-kpi-b"><KpiVal v={d.open} /><Sparkline data={arrivals} width={110} height={40} color="var(--accent)" label={'Dossiers arrivés par jour sur 14 jours : ' + arrivals.join(', ')} /></div>
        <span className="tiny muted">{d.total} au total · courbe : {nArr} arrivé{nArr > 1 ? 's' : ''} en 14 j</span>
      </div>
      <div className="op-kpi">
        <div className="op-kpi-h"><span className="eyebrow">Du paiement au service actif</span><span className="op-kpi-ic">{Icon.clock}</span></div>
        <div className="op-kpi-b"><KpiVal v={d.medianDays == null ? null : nf1(d.medianDays)} unit=" j" /></div>
        <span className="tiny muted">{d.nActive ? 'Médiane · 9 sur 10 en moins de ' + nf1(d.p90Days) + ' j · ' + d.nActive + ' dossier' + (d.nActive > 1 ? 's' : '') + ' mesuré' + (d.nActive > 1 ? 's' : '') : 'Aucun dossier encore activé'}</span>
      </div>
      <div className={'op-kpi' + (d.blockedNoOwner ? ' op-kpi-alert' : '')}>
        <div className="op-kpi-h"><span className="eyebrow">Blocages ouverts</span><span className="op-kpi-ic">{Icon.alert}</span></div>
        <div className="op-kpi-b"><KpiVal v={d.blocked} /></div>
        <span className="tiny"><b className={d.blockedNoOwner ? 'op-bad' : ''}>{d.blockedNoOwner} sans responsable</b><span className="muted"> · {d.overdue} en retard</span></span>
      </div>
      <div className="op-kpi">
        <div className="op-kpi-h"><span className="eyebrow">Satisfaction</span><span className="op-kpi-ic">{Icon.user}</span></div>
        <div className="op-kpi-b"><KpiVal v={d.satisfaction == null ? null : nf1(d.satisfaction)} unit="/5" /></div>
        <span className="tiny muted">{d.feedbackN} avis · taux de réponse {pct(d.feedbackRate) || 'inconnu'}</span>
      </div>
    </div>

    <div className="op-dgrid">
      <section className="card stack">
        <div className="card-title"><div className="stack-s" style={{ gap: 2 }}><h2>Dossiers en cours par commune</h2><span className="small muted">Touchez une commune pour voir ses dossiers. En rouge : au moins un blocage.</span></div></div>
        <div className="op-mapbox">
          <AbidjanMap zones={zmap} onPick={id => zmap[id] && setZone(id === zsel ? null : id)} selected={zsel} height={250} />
          <div className="op-zlist">
            {Object.entries(zmap).sort((a, b) => b[1].count - a[1].count).map(([id, z]) => <button key={id} type="button" className="op-zrow" aria-pressed={zsel === id} onClick={() => setZone(zsel === id ? null : id)}>
              <span className={'op-zdot' + (z.blocked ? ' is-bad' : '')} aria-hidden="true" />
              <span className="grow op-zname"><b className="small">{zoneName(id)}</b><span className={'tiny ' + (z.blocked ? 'op-bad' : 'muted')}>{z.blocked ? z.blocked + ' bloqué' + (z.blocked > 1 ? 's' : '') : 'aucun blocage'}</span></span>
              <span className="op-zn num" aria-label={z.count + ' en cours'}>{z.count}</span>
            </button>)}
            {zsel && <Btn size="s" kind="primary" onClick={() => goSearch(zsel)}>Voir les dossiers de {zoneName(zsel)} {Icon.right}</Btn>}
          </div>
        </div>
      </section>
      <section className="card-dark stack">
        <div className="card-title"><div className="stack-s" style={{ gap: 2 }}><h2>Âge des dossiers non activés</h2><span className="small muted">Depuis le paiement. Au-delà de 7 jours, en vert vif.</span></div></div>
        <Bars data={d.aging.map((a, i) => ({ label: a.label, value: a.n, hi: i >= 2 && a.n > 0 }))} height={190} color="var(--dark-3)" hiColor="var(--lime)" />
        <span className="tiny muted">On regarde toute la répartition, pas seulement la médiane, pour ne pas cacher les dossiers difficiles.</span>
      </section>
    </div>

    <div className="op-dgrid3">
      <section className="card stack">
        <div className="card-title"><h2>Par étape</h2><span className="small muted">{d.total} dossier{d.total > 1 ? 's' : ''}</span></div>
        <Stacked parts={PHASES.map(([l, ss, c]) => ({ label: l, value: sum(ss, s => d.byState[s]), color: c }))} height={12} />
        <div className="op-legend2">{PHASES.map(([l, ss, c]) => <span key={l} className="tiny"><i style={{ background: c }} />{l} <b>{sum(ss, s => d.byState[s])}</b></span>)}</div>
        <div className="stack-s">{stateRows.map(s => <div key={s} className="op-srow"><span className="small grow">{STATE_INFO[s].label}</span><span className="op-sbar"><i style={{ width: d.byState[s] / maxState * 100 + '%' }} /></span><b className="small num">{d.byState[s]}</b></div>)}</div>
      </section>
      <section className="card stack">
        <div className="card-title"><h2>Qualité de service</h2></div>
        <div className="op-mlist">
          <div><span className="small">Rendez-vous non honorés</span><b className="num">{d.missed}</b><span className="tiny muted">{d.done} réalisé{d.done > 1 ? 's' : ''}</span></div>
          <div><span className="small">Échecs d’activation</span><b className="num">{d.activationFails}</b><span className="tiny muted">{d.reopened} « pas d’Internet »</span></div>
          <div><span className="small">Contacts pour 100 commandes</span><b className="num">{d.contactsPer100}</b><span className="tiny muted">messages et rappels</span></div>
          <div><span className="small">L’assistant passe la main</span><b className={'num' + (d.abstainRate == null ? ' op-na' : '')}>{pct(d.abstainRate) || 'Pas encore'}</b><span className="tiny muted">des questions</span></div>
          <div><span className="small">Temps pour lever un blocage</span><b className={'num' + (d.avgResolveH == null ? ' op-na' : '')}>{d.avgResolveH == null ? 'Pas encore' : dur(d.avgResolveH)}</b><span className="tiny muted">en moyenne</span></div>
        </div>
      </section>
      <section className="card stack">
        <div className="card-title"><h2>À valider <span className="op-h-n">{pending.length}</span></h2><button type="button" className="arrow-btn" onClick={goApprovals} aria-label="Ouvrir les validations">{Icon.arrow}</button></div>
        {pending.length ? pending.slice(0, 3).map(a => <div key={a.id} className="op-item op-item-row">
          <Avatar name={a.byName} size={36} /><div className="grow op-trunc"><b className="small">{a.kind === 'paiement' ? 'Paiement à rapprocher' : 'Annulation et remboursement'}</b><div className="tiny muted">{a.ref} · demandé par {firstName(a.byName)}</div></div>
          <Btn size="s" kind="ghost" onClick={() => open(a.orderId)}>Voir</Btn>
        </div>) : <Empty>Aucune validation en attente.</Empty>}
        <div className="card-title" style={{ marginTop: 6 }}><h2>Alertes</h2></div>
        {d.alerts.length ? d.alerts.map(a => <div key={a.id} className="op-alert"><span className={'op-zdot' + (a.level === 'critique' ? ' is-bad' : ' is-warn')} aria-hidden="true" /><div><div className="small">{a.text}</div><div className="tiny muted">{fmtDateTime(a.at)}</div></div></div>) : <Empty>Aucune alerte d’exploitation.</Empty>}
      </section>
    </div>
  </div>;
}

// ---------- Validations (double contrôle) ----------
function Approvals({ token, open }) {
  const r = useQ(token, 'admin.refunds');
  if (r.error) return <div className="alert alert-bad">{r.error.message}</div>;
  const pending = r.data.approvals.filter(a => a.status === 'en_attente');
  const done = r.data.approvals.filter(a => a.status !== 'en_attente');
  return <div className="op-appr">
    <section className="card stack">
      <div className="card-title"><div className="stack-s" style={{ gap: 2 }}><h2>Validations en attente <span className="op-h-n">{pending.length}</span></h2><span className="small muted">Double contrôle : la personne qui demande ne peut pas valider.</span></div>
        <Explain>Les décisions sensibles (paiement rapproché à la main, annulation et remboursement) exigent <b>deux personnes</b>. Par exemple, Nadia demande le rapprochement d’un paiement ; seule une autre personne, ici la superviseure, peut le valider. Chaque décision est notée au journal.</Explain></div>
      {pending.length === 0 ? <Empty who="Salimata Diabaté">Rien à valider pour le moment.</Empty> : <div className="op-aps">{pending.map(a => <article key={a.id} className="op-ap">
        <div className="op-item-h"><Avatar name={a.byName} size={46} /><div className="grow op-trunc"><b>{a.kind === 'paiement' ? 'Paiement à rapprocher' : 'Annulation et remboursement'}</b><div className="tiny muted">{firstName(a.byName)} · {fmtDateTime(a.at)}</div></div><Pill tone="warn">En attente</Pill></div>
        <div className="op-quote small"><span className="tiny muted">Dossier {a.ref}</span><div>« {a.justification} »</div></div>
        <div className="row"><AsyncBtn size="s" kind="primary" onClick={() => call(token, 'approval.decide', { id: a.id, ok: true })}>Valider</AsyncBtn><AsyncBtn size="s" kind="danger" onClick={() => call(token, 'approval.decide', { id: a.id, ok: false })}>Refuser</AsyncBtn><Btn size="s" kind="ghost" onClick={() => open(a.orderId)}>Voir le dossier</Btn></div>
      </article>)}</div>}
      {done.length > 0 && <details className="op-details"><summary>Déjà traitées ({done.length})</summary><div className="stack-s" style={{ marginTop: 10 }}>{done.map(a => <div key={a.id} className="op-item op-item-row"><Avatar name={a.byName} size={30} /><div className="grow op-trunc"><b className="small">{a.kind === 'paiement' ? 'Paiement' : 'Annulation'} · {a.ref}</b><div className="tiny muted">{a.decidedBy ? 'par ' + a.decidedBy : ''}{a.decidedAt ? ', ' + fmtDateTime(a.decidedAt) : ''}</div></div><Pill tone={a.status === 'validee' ? 'ok' : 'bad'}>{a.status === 'validee' ? 'Validée' : 'Refusée'}</Pill></div>)}</div></details>}
    </section>
    <section className="card stack">
      <div className="card-title"><h2>Annulations et remboursements</h2><Sim what="aucun argent réel" /></div>
      {r.data.refunds.length === 0 ? <Empty>Aucune annulation.</Empty> : r.data.refunds.map(x => { const [t, l] = REFUND_STATUS[x.status] || ['neutral', x.status]; return <div key={x.id} className="op-refund">
        <div className="spread"><b className="small">Dossier {x.ref}</b><Pill tone={t}>{l}</Pill></div>
        <ol className="op-rsteps">{x.steps.map((s, i) => <li key={i}><Avatar name={s.by} size={24} /><span className="small">{s.what}</span><span className="tiny muted">{fmtDateTime(s.at)}</span></li>)}</ol>
      </div>; })}
    </section>
  </div>;
}
