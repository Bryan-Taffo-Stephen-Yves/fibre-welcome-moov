// Console d'administration (MO-01 à MO-12) : comptes, réglages, intégrations, audit, IA, continuité.
// Mise en page « tableau de bord » : sections en pilules, cartes arrondies, personnages pour chaque personne.
import { useQ, call, toast } from './platform.js';
import { Btn, AsyncBtn, Tag, Sim, Explain, Field, Modal, Panel, Empty, Avatar, AvatarStack, Say, Ring, Stacked, Icon, firstName, money, fmtDate, fmtDateTime, fmtAgo, STATE_INFO, ORDER_STATES, ROLES } from './kit.jsx';
import { ZONES } from '../server/model.js';
const React = window.React;
const { useState, useEffect, useRef } = React;

// ---------- Petits outils ----------
const svg = d => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>;
const IC = {
  wallet: svg(<><rect x="3.5" y="6" width="17" height="13" rx="3" /><path d="M3.5 10h13.5a3.5 3.5 0 000-4" /><circle cx="16.5" cy="14.5" r="1.2" fill="currentColor" stroke="none" /></>),
  plus: svg(<path d="M12 5v14M5 12h14" />),
  down: svg(<path d="M12 5v14M6 13l6 6 6-6" />),
  up: svg(<path d="M12 19V5M6 11l6-6 6 6" />),
  save: svg(<><path d="M5 4.5h11l3.5 3.5v11a1.5 1.5 0 01-1.5 1.5H5A1.5 1.5 0 013.5 19V6A1.5 1.5 0 015 4.5z" /><path d="M8 4.5v5h7v-5M8 20.5v-6h8v6" /></>),
  replay: svg(<><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" /><path d="M4.5 4.5v4h4" /></>),
};
const Err = ({ e }) => <div className="alert alert-bad small">{e.message}</div>;
const zoneName = id => (ZONES.find(z => z.id === id) || {}).name || id;
const pct = x => Math.round(x * 100) + ' %';
const hrs = x => Math.round(x) + ' h';
// « Moov Prospect (commandes) » -> ['Moov Prospect', 'commandes']
const splitName = n => { const m = /^(.*?)\s*\((.*)\)\s*$/.exec(n || ''); return m ? [m[1], m[2]] : [n || '', '']; };
const roleLabel = r => (ROLES[r] || {}).label || (r === 'systeme' ? 'Système' : r === 'testeur' ? 'Labo' : r);

// Qui a agi : un personnage pour chaque personne, une icône pour le système et le simulateur.
function Who({ name, role, size = 34, sub }) {
  const machine = role === 'systeme' || role === 'testeur';
  return <div className="who-cell ad-who">
    {machine ? <span className="ad-bot" style={{ width: size, height: size }} aria-hidden="true">{role === 'systeme' ? Icon.settings : Icon.flask}</span> : <Avatar name={name} size={size} />}
    <div className="ad-who-t"><b>{name}</b>{sub !== false && <span>{sub || roleLabel(role)}</span>}</div>
  </div>;
}

// Chiffre clé : grand nombre léger, petite variation colorée.
function Stat({ label, value, sub, delta, goodDown, tone, onGo, goLabel, children, className = '' }) {
  const good = delta == null ? null : goodDown ? delta < 0 : delta > 0;
  return <div className={'card ad-stat ' + className}>
    <div className="ad-stat-h"><span className="eyebrow">{label}</span>{onGo && <button type="button" className="arrow-btn" onClick={onGo} aria-label={goLabel || 'Voir le détail'} title={goLabel}>{Icon.arrow}</button>}</div>
    <div className="ad-stat-v"><span className={'num' + (tone ? ' ad-t-' + tone : '')}>{value}</span>
      {delta != null && <span className={'ad-delta ' + (good ? 'ad-good' : 'ad-bad')}>{delta < 0 ? IC.down : IC.up}{Math.abs(Math.round(delta * 100))} %</span>}</div>
    {sub && <span className="tiny muted">{sub}</span>}
    {children}
  </div>;
}

function SecHead({ title, lead, children }) {
  return <div className="ad-head">
    <div className="ad-head-t"><h2>{title}</h2>{lead && <p className="muted small">{lead}</p>}</div>
    {children && <div className="ad-head-a">{children}</div>}
  </div>;
}

// Pilules de filtre (claires, ou sombres dans une carte sombre).
function Filter({ value, onChange, options, dark, label }) {
  return <div className={'pills ' + (dark ? 'ad-dpills' : 'pills-soft ad-fpills')} role="tablist" aria-label={label}>
    {options.map(([k, l, n]) => <button key={k} type="button" role="tab" aria-selected={value === k} onClick={() => onChange(k)}>{l}{n != null && <span className="count">{n}</span>}</button>)}
  </div>;
}

// Voir plus : on n'affiche que les premières lignes.
function More({ shown, total, onMore, dark }) {
  if (total <= shown) return null;
  return <button type="button" className={'ad-more-btn' + (dark ? ' ad-on-dark' : '')} onClick={onMore}>Voir plus ({total - shown} de plus)</button>;
}

// ---------- Console ----------
const SECTIONS = [
  ['users', 'Comptes', Icon.users],
  ['config', 'Réglages', Icon.settings],
  ['integrations', 'Intégrations', Icon.plug],
  ['audit', 'Journal', Icon.list],
  ['models', 'Modèles IA', Icon.flask],
  ['kb', 'Procédures', Icon.book],
  ['health', 'Continuité', Icon.shield],
  ['payments', 'Paiements', IC.wallet],
];

export function AdminConsole({ token }) {
  const me = useQ(token, 'me');
  const health = useQ(token, 'admin.health');
  const [sec, setSec] = useState('users');
  const bar = useRef(null);
  useEffect(() => {
    const b = bar.current; const el = b && b.querySelector('[aria-selected="true"]');
    if (el && b.scrollWidth > b.clientWidth) { const x = el.getBoundingClientRect().left - b.getBoundingClientRect().left + b.scrollLeft - (b.clientWidth - el.offsetWidth) / 2; b.scrollTo({ left: Math.max(0, x), behavior: 'smooth' }); }
  }, [sec]);
  if (me.error) return <Err e={me.error} />;
  const ro = me.data.user.role === 'auditeur';
  const dead = health.data ? health.data.deliveries.dead : 0;
  const keys = SECTIONS.map(s => s[0]);
  const onKey = e => { const i = keys.indexOf(sec); if (e.key === 'ArrowRight') setSec(keys[(i + 1) % keys.length]); if (e.key === 'ArrowLeft') setSec(keys[(i + keys.length - 1) % keys.length]); };
  const P = { token, ro, me: me.data, go: setSec };
  return <div className="ad">
    <div className="ad-bar">
      <nav className="pills ad-tabs" role="tablist" aria-label="Sections d’administration" ref={bar} onKeyDown={onKey}>
        {SECTIONS.map(([k, l, ic]) => <button key={k} type="button" role="tab" aria-selected={sec === k} tabIndex={sec === k ? 0 : -1} onClick={() => setSec(k)} data-tour={'admin-' + k}>
          <span className="ad-tab-ic">{ic}</span>{l}{k === 'integrations' && dead > 0 && <span className="count ad-count-bad" title="Échanges abandonnés à rejouer">{dead}</span>}
        </button>)}
      </nav>
      {ro && <span className="ad-ro" title="L’auditeur peut tout lire mais ne peut rien modifier. C’est le serveur qui le vérifie.">{Icon.lock}Lecture seule</span>}
    </div>
    <div className="ad-body" role="tabpanel" aria-label={(SECTIONS.find(s => s[0] === sec) || [])[1]}>
      {sec === 'users' ? <Users {...P} /> : sec === 'config' ? <Config {...P} /> : sec === 'integrations' ? <Integrations {...P} /> : sec === 'audit' ? <Audit {...P} /> : sec === 'models' ? <Models {...P} /> : sec === 'kb' ? <Kb {...P} /> : sec === 'health' ? <Health {...P} /> : <Payments {...P} />}
    </div>
  </div>;
}

// ---------- Comptes et accès ----------
const GROUPS = { moov: ['conseiller', 'planificateur', 'superviseur', 'admin', 'auditeur'], tech: ['technicien'], client: ['client', 'representant'] };

function Users({ token, ro, me }) {
  const r = useQ(token, 'admin.users');
  const [inv, setInv] = useState(null);
  const [grp, setGrp] = useState('all');
  if (r.error) return <Err e={r.error} />;
  const { users, invites, privacy } = r.data;
  const list = grp === 'all' ? users : users.filter(u => GROUPS[grp].includes(u.role));
  const nb = g => users.filter(u => GROUPS[g].includes(u.role)).length;
  const active = users.filter(u => u.active).length;
  const live = invites.filter(i => !i.revoked && i.expiresReal >= Date.now()).length;
  const invUser = inv && users.find(u => u.id === inv.userId);
  return <>
    <SecHead title="Comptes et accès" lead="Qui peut entrer, avec quel rôle, et sur quelles zones d’Abidjan.">
      {!ro && <Btn kind="primary" onClick={() => setInv({ userId: users.find(u => u.role === 'technicien').id, hours: 2 })}>{IC.plus}Inviter quelqu’un</Btn>}
    </SecHead>
    <div className="ad-cols">
      <section className="card stack ad-people-card">
        <div className="card-title">
          <div className="ad-title-n"><h2>Personnes</h2><span className="muted small">{active} actives sur {users.length}</span></div>
          <Explain>Chaque personne a un rôle et des zones. Couper un compte ferme tout de suite ses sessions : le serveur le vérifie à chaque action.</Explain>
        </div>
        <Filter label="Filtrer les comptes" value={grp} onChange={setGrp} options={[['all', 'Tous', users.length], ['moov', 'Équipe Moov', nb('moov')], ['tech', 'Techniciens', nb('tech')], ['client', 'Clients', nb('client')]]} />
        <ul className="ad-people">
          {list.map(u => {
            const client = GROUPS.client.includes(u.role);
            const z = u.zones || [];
            return <li key={u.id} className={'ad-person' + (u.active ? '' : ' ad-off')}>
              <Avatar name={u.name} size={42} dot={u.active ? 'ok' : 'off'} />
              <div className="ad-person-id"><b>{u.name}</b><span className="tiny muted">{u.phone}{u.contractor ? ' · ' + u.contractor : ''}</span></div>
              <div className="ad-person-meta">
                <span className="ad-role">{ROLES[u.role].label}</span>
                <span className="ad-zones">{client ? <span className="small muted">Ses dossiers</span> : z.length >= ZONES.length ? <span className="ad-chip">Toutes les zones</span> : z.length ? z.map(x => <span key={x} className="ad-chip">{zoneName(x)}</span>) : <span className="small muted">Aucune zone</span>}</span>
              </div>
              <div className="ad-person-act">{ro ? <Tag tone={u.active ? 'ok' : 'bad'}>{u.active ? 'Actif' : 'Désactivé'}</Tag> : <ActiveSwitch u={u} token={token} self={u.id === me.user.id} />}</div>
            </li>;
          })}
        </ul>
      </section>
      <div className="ad-side">
        <Panel title="Invitations" right={<span className="tag">{live} en cours</span>}>
          {invites.length === 0 ? <Empty>Aucune invitation. Un lien d’invitation fait jouer un rôle pendant quelques heures.</Empty>
            : <div className="stack">{invites.slice().reverse().map(i => <InviteRow key={i.token} i={i} token={token} ro={ro} wsId={me.ws.id} />)}</div>}
          <p className="tiny muted">Un lien donne un rôle précis, pour une durée limitée, et peut être révoqué. Il s’ouvre dans un autre onglet du même navigateur et ne marche plus si l’espace est réinitialisé.</p>
        </Panel>
        <Panel title="Données personnelles" right={privacy.length ? <span className="tag tag-warn">{privacy.length} à traiter</span> : null}>
          {privacy.length ? <div className="stack">{privacy.map(p => { const u = users.find(x => x.id === p.userId) || {}; return <div key={p.id} className="ad-line">
            <Avatar name={u.name || '?'} size={36} />
            <div className="grow"><b className="small">{u.name}</b><div className="tiny muted">Demande : {p.kind} · reçue le {fmtDateTime(p.at)}</div></div>
            <div className="ad-line-end"><Tag tone="warn">{p.status}</Tag><span className="tiny muted">avant le {fmtDate(p.due)}</span></div>
          </div>; })}</div> : <Empty>Aucune demande sur les données personnelles.</Empty>}
        </Panel>
      </div>
    </div>
    {inv && <Modal title="Inviter quelqu’un" onClose={() => setInv(null)} actions={<AsyncBtn kind="primary" onClick={async () => { const x = await call(token, 'invite.create', inv); if (x.ok) setInv(null); }}>Créer l’invitation</AsyncBtn>}>
      {invUser && <div className="ad-inv-who"><Avatar name={invUser.name} size={52} /><div><b>{invUser.name}</b><div className="small muted">{ROLES[invUser.role].clear}</div></div></div>}
      <Field label="Rôle joué" id="iv-u"><select id="iv-u" className="input" value={inv.userId} onChange={e => setInv({ ...inv, userId: e.target.value })}>{users.map(u => <option key={u.id} value={u.id}>{ROLES[u.role].label} · {u.name}</option>)}</select></Field>
      <Field label="Durée de validité" id="iv-h"><select id="iv-h" className="input" value={inv.hours} onChange={e => setInv({ ...inv, hours: Number(e.target.value) })}>{[1, 2, 8, 24].map(h => <option key={h} value={h}>{h} h</option>)}</select></Field>
    </Modal>}
  </>;
}

function ActiveSwitch({ u, token, self }) {
  const [busy, setBusy] = useState(false);
  return <label className="switch ad-switch" title={self ? 'Vous ne pouvez pas couper votre propre compte.' : undefined}>
    <input type="checkbox" checked={!!u.active} disabled={busy || self} aria-label={(u.active ? 'Désactiver' : 'Réactiver') + ' le compte de ' + u.name}
      onChange={async () => { setBusy(true); try { await call(token, 'user.setActive', { userId: u.id, active: !u.active, reason: 'Revue d’accès' }); } finally { setBusy(false); } }} />
    <span className="small">{self ? 'Vous' : u.active ? 'Actif' : 'Coupé'}</span>
  </label>;
}

export function inviteLink(wsId, t) { const base = location.href.split('#')[0]; return base + '#join.' + wsId + '.' + t; }
function InviteRow({ i, token, ro, wsId }) {
  const link = wsId ? inviteLink(wsId, i.token) : '';
  const expired = i.expiresReal < Date.now();
  const copy = () => { try { navigator.clipboard.writeText(link).then(() => toast('Lien copié.'), () => toast('Sélectionnez le lien et copiez-le.', true)); } catch { toast('Sélectionnez le lien et copiez-le.', true); } };
  return <div className={'ad-invite' + (i.revoked || expired ? ' ad-off' : '')}>
    <div className="ad-line">
      <Avatar name={i.user} size={36} />
      <div className="grow"><b className="small">{i.user}</b><div className="tiny muted">{ROLES[i.role].label} · créée par {firstName(i.by)} · utilisée {i.uses} fois</div></div>
      {i.revoked ? <Tag tone="bad">Révoquée</Tag> : expired ? <Tag>Expirée</Tag> : <Tag tone="ok">Jusqu’à {new Date(i.expiresReal).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</Tag>}
    </div>
    {!i.revoked && <div className="ad-link">
      <input className="input" readOnly value={link} aria-label="Lien d’invitation" onFocus={e => e.target.select()} />
      <Btn size="s" onClick={copy}>Copier</Btn>
      {!ro && <AsyncBtn size="s" kind="danger" onClick={() => call(token, 'invite.revoke', { token: i.token })}>Révoquer</AsyncBtn>}
    </div>}
  </div>;
}

// ---------- Référentiels et délais ----------
const TEMPLATE_LABEL = { rdv_confirme: 'Rendez-vous confirmé', rappel: 'Rappel avant la visite', actif: 'Ligne activée' };

function Config({ token, ro }) {
  const r = useQ(token, 'admin.config');
  const [nb, setNb] = useState(6);
  if (r.error) return <Err e={r.error} />;
  const c = r.data.config;
  const save = (key, value) => call(token, 'config.set', { key, value });
  const steps = ORDER_STATES.filter(s => c.slaH[s]);
  const maxH = Math.max(1, ...steps.map(s => c.slaH[s]));
  const blockers = Object.entries(r.data.blockerTypes);
  return <>
    <SecHead title="Référentiels et délais" lead={ro ? 'Délais, rendez-vous et messages envoyés aux clients.' : 'Délais, rendez-vous et messages. Chaque champ est enregistré dès que vous le quittez.'} />
    <div className="ad-cols ad-cols-half">
      <div className="ad-side">
        <Panel title="Délai maximum par étape" right={<Explain>Quand un dossier reste plus longtemps que ce délai dans une étape, il passe dans la file « En retard » et son risque monte. Ces valeurs sont des exemples, à fixer avec Moov.</Explain>}>
          <div className="ad-sla">{steps.map(s => <div key={s} className="ad-sla-row">
            <span className="ad-sla-l small">{STATE_INFO[s].label}</span>
            <span className="ad-sla-bar" aria-hidden="true"><i style={{ width: Math.max(4, c.slaH[s] / maxH * 100) + '%' }} /></span>
            <span className="ad-unit"><input key={s + c.slaH[s]} className="input num" inputMode="numeric" aria-label={'Seuil ' + STATE_INFO[s].label} disabled={ro} defaultValue={c.slaH[s]} onBlur={e => Number(e.target.value) !== c.slaH[s] && save('slaH.' + s, e.target.value)} /><em>h</em></span>
          </div>)}</div>
        </Panel>
        <Panel dark title="Motifs de blocage" right={<span className="small muted">{blockers.length} motifs</span>}>
          <div className="tbl-wrap"><table className="tbl ad-rt ad-rt-bl"><thead><tr><th>Motif</th><th>Qui agit</th><th>Délai</th><th>Action attendue</th></tr></thead><tbody>
            {blockers.slice(0, nb).map(([k, b]) => <tr key={k}><td className="ad-c-main"><b>{b.label}</b></td><td className="ad-c-who"><span className="ad-pill-d">{ROLES[b.owner] ? ROLES[b.owner].label : b.owner}</span></td><td className="num ad-c-end">{b.slaH} h</td><td className="small muted ad-c-full">{b.action}</td></tr>)}
          </tbody></table></div>
          <More dark shown={nb} total={blockers.length} onMore={() => setNb(blockers.length)} />
          <details className="ad-details"><summary>Détails techniques</summary><p className="tiny muted">Secret de signature des événements : {c.webhookSecret}</p></details>
        </Panel>
      </div>
      <div className="ad-side">
        <Panel title="Rendez-vous">
          <div className="ad-form2">
            <Field label="Réservation temporaire" id="cf-h"><span className="ad-unit ad-unit-w"><input id="cf-h" key={'h' + c.holdMinutes} className="input num" inputMode="numeric" disabled={ro} defaultValue={c.holdMinutes} onBlur={e => save('holdMinutes', e.target.value)} /><em>min</em></span></Field>
            <Field label="Délai promis après paiement" id="cf-d"><span className="ad-unit ad-unit-w"><input id="cf-d" key={'d' + c.contractDays} className="input num" inputMode="numeric" disabled={ro} defaultValue={c.contractDays} onBlur={e => save('contractDays', e.target.value)} /><em>jours</em></span></Field>
          </div>
          {/* Parcours « démo en direct » : délai laissé au client pour son dossier, et durée du trajet du technicien. */}
          <div className="ad-form2 ad-form2-end">
            <Field label="Délai pour envoyer le dossier après l’achat (heures)" id="cf-dd"><span className="ad-unit ad-unit-w"><input id="cf-dd" key={'dd' + c.dossierDeadlineH} className="input num" inputMode="numeric" disabled={ro} defaultValue={c.dossierDeadlineH ?? 24} onBlur={e => save('dossierDeadlineH', e.target.value)} /><em>h</em></span></Field>
            <Field label="Durée du trajet simulé du technicien (minutes)" id="cf-tr"><span className="ad-unit ad-unit-w"><input id="cf-tr" key={'tr' + c.travelMin} className="input num" inputMode="numeric" disabled={ro} defaultValue={c.travelMin ?? 4} onBlur={e => save('travelMin', e.target.value)} /><em>min</em></span></Field>
          </div>
          <Field label="Si le matériel manque" id="cf-p"><select id="cf-p" className="input" disabled={ro} value={c.policyEquipment} onChange={e => save('policyEquipment', e.target.value)}><option value="conditionnel">Réservation possible, confirmation bloquée</option><option value="bloquer">Aucune réservation</option></select></Field>
          <label className="switch"><input type="checkbox" disabled={ro} checked={c.autoConfirm} onChange={e => save('autoConfirm', e.target.checked)} /><span className="small">Confirmer les réservations tout seul, sans planificateur</span></label>
          <Field label="Jours fériés" id="cf-hol" hint="Format AAAA-MM-JJ, séparés par des virgules."><input id="cf-hol" key={'hol' + c.holidays.join()} className="input" disabled={ro} placeholder="2026-12-25, 2027-01-01" defaultValue={c.holidays.join(', ')} onBlur={e => save('holidays', e.target.value)} /></Field>
          <span className="tiny muted">Heures stockées en UTC et affichées à l’heure d’Abidjan. Dimanche fermé dans cette démo.</span>
        </Panel>
        <Panel title="Messages envoyés aux clients">
          {Object.entries(c.templates).map(([k, t]) => <Field key={k} label={TEMPLATE_LABEL[k] || k} id={'tp-' + k}><textarea id={'tp-' + k} className="input" rows={2} disabled={ro} defaultValue={t} onBlur={e => e.target.value !== t && save('templates.' + k, e.target.value)} /></Field>)}
          <span className="tiny muted">Mots remplacés automatiquement : {'{date}'} et {'{slot}'}.</span>
        </Panel>
      </div>
    </div>
  </>;
}

// ---------- Intégrations ----------
const DLV = { ok: ['ok', 'Livré'], traite: ['ok', 'Traité'], en_attente: ['warn', 'En reprise'], abandon: ['bad', 'Abandonné'], rejete: ['bad', 'Rejeté'], doublon: ['info', 'Doublon ignoré'], ignore: ['info', 'Sans effet'], anomalie: ['bad', 'Anomalie'] };
const TODO = ['abandon', 'rejete', 'anomalie', 'en_attente'];
const SYS_IC = { prospect: Icon.list, money: IC.wallet, activation: Icon.wifi, sms: Icon.chat, stock: Icon.box };
const KIND = { 'activation.request': 'Demande d’activation', 'entrant:payment.confirmed': 'Paiement reçu', 'entrant:order.status': 'Statut de commande', 'entrant:activation.result': 'Résultat d’activation' };
const kindLabel = k => KIND[k] || String(k || '').replace(/^entrant:/, '');
const St = ({ s }) => { const [tone, l] = DLV[s] || ['', s]; return <span className={'ad-st ad-st-' + tone}><i />{l}</span>; };

function Integrations({ token, ro, me }) {
  const r = useQ(token, 'admin.integrations');
  const u = useQ(token, 'admin.users');
  const [f, setF] = useState('all');
  const [nd, setNd] = useState(12);
  const [no, setNo] = useState(3);
  const [na, setNa] = useState(4);
  if (r.error) return <Err e={r.error} />;
  const d = r.data;
  const now = me.ws.clock;
  const users = (u.data && u.data.users) || [];
  const prov = p => d.integrations[p] ? splitName(d.integrations[p].name)[0] : String(p || '').replace(/\s*\(.*\)\s*$/, '');
  const todo = d.deliveries.filter(x => TODO.includes(x.status));
  const rows = f === 'todo' ? todo : f === 'done' ? d.deliveries.filter(x => !TODO.includes(x.status)) : d.deliveries;
  const down = Object.values(d.integrations).filter(i => !i.up).length;
  return <>
    <SecHead title="Intégrations" lead="Les systèmes Moov branchés à l’application, et les messages échangés avec eux.">
      {down ? <Tag tone="bad">{down} système{down > 1 ? 's' : ''} en panne</Tag> : <Tag tone="ok">Tout répond</Tag>}
    </SecHead>
    <div className="ad-sys-grid">
      {Object.entries(d.integrations).map(([k, i]) => { const [n, what] = splitName(i.name); return <div key={k} className={'card ad-sys' + (i.up ? '' : ' ad-sys-down')}>
        <div className="spread"><span className="ad-sys-ic">{SYS_IC[k] || Icon.plug}</span><span className={'ad-live' + (i.up ? '' : ' ad-live-bad')}><i />{i.up ? 'En ligne' : 'En panne'}</span></div>
        <div><b>{n}</b>{what && <div className="tiny muted">{what}</div>}</div>
        <div className="ad-sys-f"><span className="tiny muted" title={'Dernière synchro : ' + fmtDateTime(i.lastSync)}>Synchro {fmtAgo(now - i.lastSync)}</span><Sim what={i.mode} /></div>
      </div>; })}
    </div>
    <div className="ad-cols ad-cols-wide">
    <Panel dark title="Échanges avec les systèmes" right={<Explain>Aucun système Moov réel n’est branché. Chaque connecteur est un <b>simulateur</b> qui imite aussi les pannes. Le jour du pilote, on remplace le simulateur par le vrai connecteur, sans changer les écrans.</Explain>}>
      <Filter dark label="Filtrer les échanges" value={f} onChange={setF} options={[['all', 'Tous', d.deliveries.length], ['todo', 'À surveiller', todo.length], ['done', 'Réglés', d.deliveries.length - todo.length]]} />
      {rows.length === 0 ? <p className="small muted ad-pad">Aucun échange ici pour l’instant.</p> : <div className="tbl-wrap"><table className="tbl ad-rt ad-rt-dl"><thead><tr><th>Système</th><th>Échange</th><th>État</th><th>Quand</th><th>Détail</th><th><span className="sr-only">Action</span></th></tr></thead><tbody>
        {rows.slice(0, nd).map(x => <tr key={x.id}>
          <td className="ad-c-main"><b>{prov(x.provider)}</b></td>
          <td className="ad-c-kind">{kindLabel(x.kind)}<div className="tiny muted" title="Identifiant de l’événement">{x.eventId}</div></td>
          <td className="ad-c-end"><St s={x.status} /><div className="tiny muted ad-tries">{x.attempts} essai{x.attempts > 1 ? 's' : ''}</div></td>
          <td className="tiny muted ad-c-when">{fmtDateTime(x.createdAt)}</td>
          <td className="small muted ad-c-full">{x.error || ''}</td>
          <td className="ad-c-full ad-c-act">{x.status === 'abandon' && !ro && <AsyncBtn size="s" className="ad-lime" onClick={() => call(token, 'integration.replay', { id: x.id })}>{IC.replay}Rejouer</AsyncBtn>}</td>
        </tr>)}
      </tbody></table></div>}
      <More dark shown={nd} total={rows.length} onMore={() => setNd(nd + 20)} />
      <span className="tiny muted">Reprises automatiques : 5 essais au plus, espacés de 2, 4, 8 puis 16 min (avec une part de hasard). Ensuite, rejeu à la main.</span>
    </Panel>
    <div className="ad-side">
      <Panel title="Alertes" right={d.alerts.length ? <span className="tag">{d.alerts.length}</span> : null}>
        {d.alerts.length ? <ul className="ad-list">{d.alerts.slice(0, na).map(a => { const lv = a.level === 'critique' ? 'bad' : a.level === 'info' ? 'ok' : 'warn'; return <li key={a.id} className="ad-alert">
          <span className={'ad-alert-ic ad-bg-' + lv}>{lv === 'ok' ? Icon.check : Icon.alert}</span>
          <div className="grow"><span className="small">{a.text}</span><div className="tiny muted">{fmtDateTime(a.at)}</div></div>
        </li>; })}</ul> : <Empty>Aucune alerte. Tous les échanges se passent bien.</Empty>}
        <More shown={na} total={d.alerts.length} onMore={() => setNa(na + 10)} />
      </Panel>
      <Panel title="SMS et WhatsApp envoyés" right={<Sim />}>
        {d.outbox.length ? <ul className="ad-list">{d.outbox.slice(0, no).map(o => { const who = users.find(x => x.id === o.userId); const okS = /^livr/i.test(o.status), bad = /échec|refus/i.test(o.status); return <li key={o.id} className="ad-msg">
          <Avatar name={who ? who.name : o.to} size={34} />
          <div className="grow stack-s">
            <div className="spread"><b className="small">{who ? who.name : o.to}</b><span className="tiny muted">{fmtDateTime(o.at)}</span></div>
            <div className="ad-bubble small">{o.text}</div>
            <span className="tiny muted"><span className={'ad-st ad-st-' + (okS ? 'ok' : bad ? 'bad' : 'warn')}><i />{o.status}</span> · {o.channel.toUpperCase()} · {o.to}</span>
          </div>
        </li>; })}</ul> : <Empty>Aucun message envoyé pour l’instant.</Empty>}
        <More shown={no} total={d.outbox.length} onMore={() => setNo(no + 10)} />
      </Panel>
    </div>
    </div>
  </>;
}

// ---------- Journal d'audit ----------
const ACT = {
  'acces.refuse': 'Accès refusé', 'activation.relancer': 'Activation relancée', 'annulation.instruire': 'Annulation instruite', 'blocage.affecter': 'Blocage confié', 'blocage.ouvrir': 'Blocage ouvert', 'blocage.resoudre': 'Blocage levé',
  'capacite.modifier': 'Capacité modifiée', 'compte.activer': 'Compte réactivé', 'compte.desactiver': 'Compte coupé', 'compte.perimetre': 'Zones modifiées', 'config.modifier': 'Réglage modifié', 'continuite.mode_degrade': 'Mode dégradé',
  'dossier.cloturer': 'Dossier clôturé', 'dossier.consulter': 'Fiche consultée', 'doublon.rapprocher': 'Doublon rapproché', 'doublon.separer': 'Doublon séparé', 'equipe.disponible': 'Équipe disponible', 'equipe.indisponible': 'Équipe indisponible',
  escalade: 'Escalade', 'espace.creer': 'Espace créé', 'export.dossiers': 'Export des dossiers', 'ia.assistant': 'Question à l’assistant', 'ia.modele.activer': 'Modèle activé', 'ia.modele.desactiver': 'Estimations coupées', 'ia.resume.utilise': 'Résumé IA utilisé',
  'integration.rejet': 'Événement rejeté', 'integration.rejouer': 'Échange rejoué', 'invitation.creer': 'Invitation créée', 'invitation.revoquer': 'Invitation révoquée', 'mission.reaffecter': 'Mission réaffectée', 'paiement.rapprochement_manuel.demande': 'Rapprochement demandé',
  'procedure.reviser': 'Procédure révisée', 'rattachement.demande': 'Rattachement demandé', 'rattachement.valide': 'Rattachement validé', 'rdv.annuler': 'Rendez-vous annulé', 'rdv.confirmer': 'Rendez-vous confirmé', 'rdv.reserver': 'Rendez-vous réservé', 'reseau.ports': 'Ports ajoutés',
  // Commandes enregistrées telles quelles par le serveur
  'user.setActive': 'Compte modifié', 'user.setZones': 'Zones modifiées', 'invite.create': 'Invitation', 'invite.revoke': 'Révocation d’invitation', 'config.set': 'Réglage', 'model.activate': 'Choix du modèle', 'kb.update': 'Révision de procédure',
  'integration.replay': 'Rejeu demandé', 'backup.create': 'Sauvegarde', 'degraded.set': 'Mode dégradé', 'order.open': 'Fiche ouverte', 'export.orders': 'Export des dossiers',
  'claim.start': 'Rattachement commencé', 'claim.verify': 'Rattachement vérifié', 'order.updateAddress': 'Adresse modifiée', 'doc.upload': 'Pièce envoyée', 'doc.request': 'Pièce demandée', 'doc.review': 'Pièce vérifiée',
  'appt.hold': 'Créneau gardé', 'appt.book': 'Rendez-vous pris', 'appt.cancel': 'Rendez-vous annulé', 'appt.confirm': 'Rendez-vous confirmé', 'appt.reassign': 'Rendez-vous réaffecté', 'prep.toggle': 'Préparation cochée',
  'msg.send': 'Message du client', 'msg.reply': 'Réponse envoyée', 'note.add': 'Note interne', 'assistant.handoff': 'Passage à un conseiller', 'callback.request': 'Rappel demandé', 'callback.update': 'Rappel mis à jour', 'report.create': 'Signalement',
  'prefs.set': 'Préférences', 'notif.read': 'Notification lue', 'activation.feedback': 'Retour sur l’activation', 'feedback.submit': 'Avis du client', 'cancel.request': 'Annulation demandée', 'cancel.instruct': 'Annulation instruite', 'privacy.request': 'Demande sur les données',
  'delegation.add': 'Délégation ajoutée', 'delegation.revoke': 'Délégation retirée', 'address.requestPrecision': 'Précision d’adresse demandée', 'order.markReady': 'Dossier prêt', 'blocker.assign': 'Blocage confié', 'blocker.resolve': 'Blocage levé', 'blocker.escalateCheck': 'Contrôle d’escalade',
  'network.addPorts': 'Ports ajoutés', 'ticket.close': 'Ticket fermé', 'team.setAvailable': 'Disponibilité d’équipe', 'capacity.set': 'Capacité modifiée', 'wo.action': 'Action du technicien', 'payment.manualRequest': 'Rapprochement demandé', 'approval.decide': 'Décision de validation',
  'order.close': 'Dossier clôturé', 'activation.retry': 'Activation relancée', 'duplicate.link': 'Doublon rapproché', 'duplicate.unlink': 'Doublon séparé',
  'demo.scenario': 'Scénario lancé', 'demo.clock': 'Horloge avancée', 'demo.webhook': 'Événement simulé', 'demo.integration': 'Panne simulée', 'demo.flag': 'Réglage du simulateur', 'demo.createOrder': 'Commande fictive', 'demo.restore': 'Restauration',
  'sauvegarde.creer': 'Sauvegarde créée', 'sauvegarde.restaurer': 'Sauvegarde restaurée', 'piece.valide': 'Pièce validée', 'piece.refuse': 'Pièce refusée', 'piece.refusee': 'Pièce refusée',
};
const actLabel = a => ACT[a] || a;
const isRefus = a => a.action === 'acces.refuse' || a.action === 'integration.rejet' || /^REFUS/.test(a.detail || '');

function Audit({ token }) {
  const [q, setQ] = useState(''); const [ai, setAi] = useState(false);
  const r = useQ(token, 'admin.audit', { q, ai });
  const [csv, setCsv] = useState(null);
  const [refus, setRefus] = useState(false);
  const [n, setN] = useState(15);
  const u = useQ(token, 'admin.users');
  const all = r.data || [];
  const rows = refus ? all.filter(isRefus) : all;
  const mode = ai ? 'ai' : refus ? 'refus' : 'all';
  const setMode = k => { setAi(k === 'ai'); setRefus(k === 'refus'); setN(15); };
  const top = {}; for (const a of rows) { const k = a.actor; (top[k] ||= { name: a.actor, role: a.role, n: 0 }).n++; }
  const tops = Object.values(top).sort((x, y) => y.n - x.n).slice(0, 5);
  const refusals = all.filter(isRefus).slice(0, 4);
  const users = (u.data && u.data.users) || [];
  const target = x => { const p = /^U\d+$/.test(x || '') && users.find(y => y.id === x); return p ? p.name : x; };
  const objet = a => (a.action === 'acces.refuse' ? actLabel(a.resource) : target(a.resource));
  return <>
    <SecHead title="Journal d’audit" lead="Chaque action, chaque accès refusé et chaque décision de l’IA, dans l’ordre.">
      <AsyncBtn kind="primary" onClick={async () => { const x = await call(token, 'export.orders', {}); if (x.ok) setCsv(x.data); }}>{Icon.doc}Exporter les dossiers</AsyncBtn>
    </SecHead>
    <div className="ad-cols ad-cols-wide">
      <section className="card-dark stack ad-audit" data-tour="admin-audit-panel">
        <div className="card-title"><div className="ad-title-n"><h2>Ce qui s’est passé</h2><span className="small muted">{rows.length} entrée{rows.length > 1 ? 's' : ''}</span></div></div>
        <div className="ad-toolbar">
          <label className="ad-search">{Icon.search}<input className="input" aria-label="Filtrer le journal" placeholder="Nom, action, dossier…" value={q} onChange={e => { setQ(e.target.value); setN(15); }} /></label>
          <Filter dark label="Type d’entrées" value={mode} onChange={setMode} options={[['all', 'Tout'], ['ai', 'Décisions IA'], ['refus', 'Refus']]} />
        </div>
        {r.error ? <Err e={r.error} /> : rows.length === 0 ? <p className="small muted ad-pad">Rien ne correspond à ce filtre.</p> : <div className="tbl-wrap"><table className="tbl ad-rt ad-rt-au"><thead><tr><th>Qui</th><th>Action</th><th>Objet</th><th>Détail</th><th className="ad-r">Quand</th></tr></thead><tbody>
          {rows.slice(0, n).map(a => { const bad = isRefus(a); return <tr key={a.seq} className={bad ? 'ad-refus' : ''}>
            <td className="ad-c-main"><Who name={a.actor} role={a.role} size={32} /></td>
            <td className="ad-c-act2"><span title={a.action}>{actLabel(a.action)}</span>{a.ai && <span className="ad-chip-ai">IA</span>}{bad && <span className="ad-st ad-st-bad"><i />Refus</span>}</td>
            <td className="small ad-c-obj" title={a.resource}>{objet(a)}</td>
            <td className="small muted ad-c-full ad-c-detail">{a.detail}</td>
            <td className="tiny muted ad-c-end ad-c-when ad-r"><span className="num">{fmtDateTime(a.at)}</span><div>n° {a.seq}</div></td>
          </tr>; })}
        </tbody></table></div>}
        <More dark shown={n} total={rows.length} onMore={() => setN(n + 60)} />
        <span className="tiny muted">Le journal ne contient jamais de secret. Les accès refusés y sont aussi.</span>
      </section>
      <div className="ad-side">
        <Panel title="Les plus actifs" right={<span className="tiny muted">dans cette liste</span>}>
          {tops.length ? <ul className="ad-list">{tops.map(t => <li key={t.name} className="ad-top">
            <Who name={t.name} role={t.role} size={36} />
            <div className="ad-top-bar"><i style={{ width: t.n / tops[0].n * 100 + '%' }} /></div>
            <b className="num">{t.n}</b>
          </li>)}</ul> : <Empty>Personne pour l’instant.</Empty>}
        </Panel>
        <Panel title="Refus récents" right={refusals.length ? <span className="tag tag-bad">{refusals.length}</span> : null}>
          {refusals.length ? <ul className="ad-list">{refusals.map(a => <li key={a.seq} className="ad-line">
            <Who name={a.actor} role={a.role} size={34} sub={actLabel(a.action) + ' · ' + objet(a)} />
            <span className="tiny muted ad-line-end">{fmtDateTime(a.at)}</span>
          </li>)}</ul> : <Empty who="Fatou Touré">Aucun accès refusé dans cette liste.</Empty>}
        </Panel>
      </div>
    </div>
    {csv && <Modal title="Export des dossiers (CSV)" onClose={() => setCsv(null)} actions={<Btn kind="primary" onClick={() => { try { navigator.clipboard.writeText(csv).then(() => toast('Export copié.'), () => toast('Sélectionnez le texte pour le copier.', true)); } catch {} }}>Copier</Btn>}>
      <p className="small">Champs réduits au minimum : ni nom, ni téléphone. Toute cellule qui commence par = + - @ est neutralisée pour ne pas s’exécuter dans un tableur. L’export est lui-même journalisé.</p>
      <div className="pre">{csv}</div>
    </Modal>}
  </>;
}

// ---------- Modèles IA ----------
const MODEL_NAME = { 'baseline-1': 'Référence simple', 'quantiles-2': 'Modèle v2' };
const INTENT = { status: 'Où en est mon dossier', why: 'Pourquoi ce blocage', prepare: 'Préparer la visite', appt: 'Rendez-vous', when: 'Délai', payment: 'Paiement', activation: 'Activation', refund: 'Remboursement', human: 'Parler à quelqu’un' };

function Models({ token, ro }) {
  const r = useQ(token, 'admin.models');
  const u = useQ(token, 'admin.users');
  const [na, setNa] = useState(4);
  if (r.error) return <Err e={r.error} />;
  const d = r.data; const e = d.evaluation;
  const b = e.versions['baseline-1'], m = e.versions['quantiles-2'];
  const users = (u.data && u.data.users) || [];
  const rel = (x, y) => (y ? (x - y) / y : 0);
  const zones = [{ label: 'Toutes', a: b.mae, b: m.mae }, ...Object.keys(m.zones).map(z => ({ label: zoneName(z), a: b.zones[z], b: m.zones[z] }))];
  const active = d.models.find(x => x.active);
  return <>
    <SecHead title="Modèles IA" lead="Le délai annoncé aux clients vient d’un calcul vérifiable, jamais d’un chatbot." />
    <div className="ad-simnote"><Sim what="données synthétiques" /><span className="small muted">Ces chiffres montrent que l’évaluation marche. Ils ne disent rien de la précision réelle chez Moov.</span>
      <details className="ad-details"><summary>Voir le détail</summary><p className="small muted">Entraîné sur {e.train + e.test} dossiers générés (graine {d.seed}). Entraînement sur les {e.train} premiers dossiers, test sur les {e.test} suivants dans le temps. {e.censoredTest} dossier(s) de test non terminés sont comptés à part, pas supprimés en silence.</p></details>
    </div>
    <div className="ad-kpis">
      <Stat label="Erreur moyenne" value={hrs(m.mae)} delta={rel(m.mae, b.mae)} goodDown sub={'Écart moyen entre délai estimé et délai réel. Référence : ' + hrs(b.mae) + '.'} />
      <Stat label="Délais réels dans la fourchette" value={pct(m.coverage)} sub={'Objectif 80 %. Référence : ' + pct(b.coverage) + '.'} />
      <Stat label="Largeur de la fourchette" value={hrs(m.width)} delta={rel(m.width, b.width)} goodDown sub={'Plus étroite, plus utile. Référence : ' + hrs(b.width) + '.'} />
      <div className="card-dark ad-stat ad-pass">
        <span className="eyebrow">Critères de recette</span>
        <div className="row ad-pass-in"><Ring value={Math.max(0, e.gain)} max={0.1} size={76} stroke={8} color="var(--lime)" track="var(--dark-3)"><span className="num">{pct(e.gain)}</span></Ring>
          <div className="stack-s"><b>{e.passes ? 'Atteints' : 'Pas encore atteints'}</b><span className="tiny muted">Gain d’erreur visé : 10 % ou plus.</span><span className="tiny muted">Pire zone : {e.worstZoneRegression > 0 ? '+' : ''}{pct(e.worstZoneRegression)}</span></div></div>
      </div>
    </div>
    <div className="ad-cols">
      <Panel dark title="Erreur moyenne par zone" right={<div className="ad-legend"><span><i className="ad-lg-a" />Référence</span><span><i className="ad-lg-b" />Modèle v2</span></div>}>
        <GroupBars rows={zones} />
        <span className="tiny muted">En heures, sur des dossiers que le modèle n’a jamais vus. Plus c’est bas, mieux c’est.</span>
      </Panel>
      <Panel title="Versions" right={active ? <Tag tone="ok">{MODEL_NAME[active.version] || active.version} actif</Tag> : <Tag tone="warn">Aucune estimation</Tag>}>
        <div className="stack">{d.models.map(x => <div key={x.version} className={'ad-ver' + (x.active ? ' ad-ver-on' : '')}>
          <span className="ad-ver-ic">{Icon.flask}</span>
          <div className="grow"><b>{MODEL_NAME[x.version] || x.version}</b> <span className="tiny muted">{x.version}</span><div className="small muted">{x.kind}</div><div className="tiny muted">Créé le {fmtDate(x.createdAt)} · {x.trainedOn}</div></div>
          {x.active ? <span className="ad-live"><i />Actif</span> : !ro && <AsyncBtn size="s" kind="primary" onClick={() => call(token, 'model.activate', { version: x.version, reason: 'Choix administrateur' })}>{x.version === 'baseline-1' ? 'Revenir à cette version' : 'Activer'}</AsyncBtn>}
        </div>)}</div>
        <Explain>On part d’une <b>référence simple</b> (délai médian par zone et étape). On n’active un modèle plus fin que s’il fait mieux sur des dossiers qu’il n’a jamais vus, sans dégrader une zone.</Explain>
        {!ro && <details className="ad-details"><summary>Plus d’actions</summary><div className="stack-s"><p className="small muted">Couper toute estimation : les clients ne voient plus de délai estimé.</p><div><AsyncBtn size="s" kind="danger" onClick={async () => { const r = await call(token, 'model.activate', { version: null, reason: 'Désactivation' }); if (r.ok) toast('Estimations coupées : les clients ne voient plus de délai estimé.'); }}>Désactiver toute estimation</AsyncBtn></div></div></details>}
      </Panel>
    </div>
    <div className="ad-cols ad-cols-half">
      <Panel title="Suivi en direct">
        <div className="ad-duo">
          <div><span className="eyebrow">Estimations faites</span><div className="ad-big num">{d.live.predictions}</div></div>
          <div><span className="eyebrow">Avec résultat connu</span><div className="ad-big num">{d.live.withOutcome}</div></div>
        </div>
        <span className="tiny muted">{d.live.mae != null ? 'Erreur constatée ' + hrs(d.live.mae) + ' · délais dans la fourchette ' + pct(d.live.coverage) : 'La dérive sera mesurée quand des dossiers arriveront au bout.'}</span>
      </Panel>
      <Panel title="Assistant : dernières questions">
        {d.assistant.length ? <ul className="ad-list">{d.assistant.slice(0, na).map(a => { const who = users.find(x => x.id === a.userId); return <li key={a.id} className="ad-msg">
          <Avatar name={who ? who.name : 'Client'} size={34} />
          <div className="grow stack-s">
            <div className="spread"><b className="small">{who ? who.name : 'Client'}</b><span className="tiny muted">{fmtDateTime(a.at)}</span></div>
            <div className="ad-bubble small">« {a.q} »</div>
            <div>{a.refused ? <Tag tone="bad">Refus</Tag> : a.intent ? <Tag tone="ok">{INTENT[a.intent] || a.intent}</Tag> : <Tag tone="warn">Abstention</Tag>}</div>
          </div>
        </li>; })}</ul> : <Empty>Aucune question posée à l’assistant pour l’instant.</Empty>}
        <More shown={na} total={d.assistant.length} onMore={() => setNa(na + 10)} />
      </Panel>
    </div>
  </>;
}

// Barres groupées : référence (gris) contre modèle (vert citron), valeurs réelles en heures.
function GroupBars({ rows }) {
  const max = Math.max(1, ...rows.flatMap(r => [r.a, r.b]));
  return <div className="ad-gbars" role="img" aria-label={rows.map(r => r.label + ' : référence ' + hrs(r.a) + ', modèle ' + hrs(r.b)).join(' ; ')}>
    {rows.map(r => <div key={r.label} className="ad-gb-col">
      <div className="ad-gb-pair">
        <div className="ad-gb-bar ad-gb-a" style={{ height: r.a / max * 100 + '%' }}><span>{Math.round(r.a)}</span></div>
        <div className="ad-gb-bar ad-gb-b" style={{ height: r.b / max * 100 + '%' }}><span>{Math.round(r.b)}</span></div>
      </div>
      <span className="ad-gb-l">{r.label}</span>
    </div>)}
  </div>;
}

// ---------- Base documentaire ----------
function Kb({ token, ro }) {
  const r = useQ(token, 'admin.config');
  const meQ = useQ(token, 'me');
  const [f, setF] = useState('all');
  if (r.error) return <Err e={r.error} />;
  const now = (meQ.data || { ws: { clock: Date.now() } }).ws.clock;
  const docs = r.data.docs;
  const soon = x => x.expires - now < 7 * 864e5;
  const list = f === 'public' ? docs.filter(x => x.scope === 'public') : f === 'interne' ? docs.filter(x => x.scope !== 'public') : docs;
  const nSoon = docs.filter(soon).length;
  return <>
    <SecHead title="Base documentaire" lead="Les procédures approuvées : les seuls textes que l’assistant a le droit de citer.">
      {nSoon > 0 && <Tag tone="warn">{nSoon} à revoir bientôt</Tag>}
    </SecHead>
    <div className="spread">
      <Filter label="Filtrer les procédures" value={f} onChange={setF} options={[['all', 'Toutes', docs.length], ['public', 'Pour les clients', docs.filter(x => x.scope === 'public').length], ['interne', 'Internes', docs.filter(x => x.scope !== 'public').length]]} />
      <Explain>L’assistant cite ces procédures avec leur numéro et leur version. Une procédure interne n’est jamais montrée à un client, même par l’assistant.</Explain>
    </div>
    <div className="ad-docs">{list.map(x => <article key={x.id} className={'card ad-doc ad-doc-' + (x.scope === 'public' ? 'pub' : 'int') + (soon(x) ? ' ad-doc-soon' : '')}>
      <div className="spread"><span className="ad-doc-ic">{x.scope === 'public' ? Icon.doc : Icon.lock}</span><span className="ad-ver-chip">v{x.version}</span></div>
      <div className="stack-s ad-doc-t"><span className="tiny muted">{x.id}</span><h3>{x.title}</h3><span className="small muted">{x.owner}</span></div>
      <div className="ad-doc-f">
        <div className="stack-s">{x.scope === 'public' ? <Tag tone="info">Visible des clients</Tag> : <Tag>Interne</Tag>}<span className={'tiny ' + (soon(x) ? 'ad-t-warn' : 'muted')}>{soon(x) ? 'Expire bientôt : ' : 'Valable jusqu’au '}{fmtDate(x.expires)}</span></div>
        {!ro && <AsyncBtn size="s" onClick={async () => { const r = await call(token, 'kb.update', { id: x.id }); if (r.ok) toast('« ' + x.title + ' » révisée : nouvelle version publiée.'); }}>Réviser</AsyncBtn>}
      </div>
    </article>)}</div>
  </>;
}

// ---------- Continuité ----------
function Health({ token, ro, go }) {
  const r = useQ(token, 'admin.health');
  const me = useQ(token, 'me');
  const [busy, setBusy] = useState(false);
  if (r.error) return <Err e={r.error} />;
  const h = r.data;
  const owner = me.data && me.data.owner;
  return <>
    <SecHead title="Continuité" lead="Tenir le service en cas d’incident : sauvegardes, reprises et mode dégradé.">
      {!ro && <AsyncBtn kind="primary" onClick={() => call(token, 'backup.create', {})}>{IC.save}Créer une sauvegarde</AsyncBtn>}
    </SecHead>
    <div className="ad-kpis ad-kpis-3">
      <Stat label="Tâches en attente" value={h.jobs.pending} sub={h.jobs.dropped + ' ignorée(s) (ancienne génération)'} />
      <Stat label="Livraisons en reprise" value={h.deliveries.pending} sub={<span className={h.deliveries.dead ? 'ad-t-bad' : ''}>{h.deliveries.dead ? h.deliveries.dead + ' abandonnée(s), à rejouer à la main' : 'Aucune abandonnée'}</span>} onGo={() => go('integrations')} goLabel="Voir les échanges" />
      <Stat label="Taille de l’espace" value={h.storageKb + ' Ko'} sub="Stockage local du navigateur" />
    </div>
    <div className="ad-cols ad-cols-half ad-cols-stretch">
      <section className={'card stack ad-degr' + (h.degraded ? ' ad-degr-on' : '')}>
        <div className="card-title"><h2>Mode dégradé</h2><span className={'ad-live' + (h.degraded ? ' ad-live-warn' : '')}><i />{h.degraded ? 'Actif' : 'Non'}</span></div>
        <Say name="Aya" size={40} tone={h.degraded ? 'warn' : undefined}>{h.degraded ? 'L’assistant IA est coupé. Tout le reste continue normalement.' : 'En cas d’incident, on coupe ce qui n’est pas essentiel pour garder l’essentiel.'}</Say>
        <div className="ad-degr-grid">
          <div><span className="eyebrow">Continue toujours</span><ul className="ad-keep">{['Suivi des dossiers', 'Rendez-vous', 'Messages humains'].map(x => <li key={x}><span className="ad-st ad-st-ok"><i />{x}</span></li>)}</ul></div>
          <div><span className="eyebrow">{h.degraded ? 'Coupé maintenant' : 'Coupé en mode dégradé'}</span><ul className="ad-keep"><li><span className={'ad-st ' + (h.degraded ? 'ad-st-bad' : '')}><i />Assistant IA</span></li></ul></div>
        </div>
        {!ro && <label className="switch ad-degr-sw"><input type="checkbox" checked={!!h.degraded} disabled={busy} onChange={async () => { setBusy(true); try { await call(token, 'degraded.set', { on: !h.degraded }); } finally { setBusy(false); } }} /><span>{h.degraded ? 'Quitter le mode dégradé' : 'Passer en mode dégradé'}</span></label>}
      </section>
      <Panel dark title="État des systèmes" right={<button type="button" className="arrow-btn" onClick={() => go('integrations')} aria-label="Voir les intégrations">{Icon.arrow}</button>}>
        <ul className="ad-list ad-sys-list">{Object.entries(h.integrations).map(([k, i]) => { const [n] = splitName(i.name); return <li key={k}>
          <span className="ad-sys-ic ad-sys-ic-d">{SYS_IC[k] || Icon.plug}</span><span className="grow">{n}</span><span className={'ad-st ad-st-' + (i.up ? 'ok' : 'bad')}><i />{i.up ? 'En ligne' : 'En panne'}</span>
        </li>; })}</ul>
      </Panel>
    </div>
    <Panel title="Sauvegardes" right={h.backups.length ? <span className="tag">{h.backups.length}</span> : null}>
      {h.backups.length === 0 && <Empty>Aucune sauvegarde. Une sauvegarde n’est jugée utilisable qu’après un test de restauration.</Empty>}
      {h.backups.length > 0 && <ul className="ad-list">{h.backups.slice().reverse().map(b => <li key={b.n} className="ad-line ad-backup">
        <span className="ad-sys-ic">{IC.save}</span>
        <div className="grow"><b className="small">Sauvegarde n° {b.n}</b><div className="tiny muted">{fmtDateTime(b.at)} · {Math.round(b.size / 1024)} Ko · {b.events} événements</div></div>
        <span className="ad-by"><Avatar name={b.by} size={26} /><span className="tiny muted">{firstName(b.by)}</span></span>
        {!ro && owner && <SureBtn label="Restaurer" sure="Remplacer tout l’espace par cette sauvegarde ?" onGo={async () => { const r = await call(token, 'demo.restore', { n: b.n }); if (r.ok) toast('Espace remis à l’état de la sauvegarde n° ' + b.n + '.'); }} />}
      </li>)}</ul>}
    </Panel>
  </>;
}

// ---------- Paiements ----------
const PAY = { confirme: ['ok', 'Confirmé'], en_attente: ['warn', 'En attente'], rembourse_demande: ['info', 'Remboursement demandé'], rembourse_valide: ['info', 'Remboursement validé'], rembourse: ['info', 'Remboursé'], rejete: ['bad', 'Rejeté'] };

// Bouton qui demande une confirmation sur place avant une action lourde.
function SureBtn({ label, sure, onGo, kind, size = 's' }) {
  const [ask, setAsk] = useState(false);
  if (!ask) return <Btn size={size} kind={kind} onClick={() => setAsk(true)}>{label}</Btn>;
  return <span className="row ad-sure"><span className="small">{sure}</span><AsyncBtn size={size} kind="primary" onClick={async () => { await onGo(); setAsk(false); }}>Oui</AsyncBtn><Btn size={size} onClick={() => setAsk(false)}>Non</Btn></span>;
}
const REFUND = { demande: ['warn', 'Demandée'], instruite: ['info', 'Instruite'], valide: ['ok', 'Validée'], rembourse: ['ok', 'Remboursée'], rejete: ['bad', 'Rejetée'] };

function Payments({ token }) {
  const r = useQ(token, 'admin.refunds');
  const o = useQ(token, 'ops.orders');
  const [f, setF] = useState('all');
  const [n, setN] = useState(10);
  if (r.error) return <Err e={r.error} />;
  const { payments, refunds, approvals } = r.data;
  const names = {}; for (const x of (o.data || [])) names[x.id] = x.contactName;
  const by = s => payments.filter(p => p.status === s);
  const conf = by('confirme'), wait = by('en_attente');
  const other = payments.filter(p => !['confirme', 'en_attente'].includes(p.status));
  const cashed = conf.reduce((s, p) => s + p.amount, 0);
  const list = f === 'ok' ? conf : f === 'wait' ? wait : f === 'other' ? other : payments;
  return <>
    <SecHead title="Paiements et remboursements" lead="Les paiements Moov Money des dossiers, et les demandes d’annulation."><Sim what="Moov Money simulé" /></SecHead>
    <section className="card ad-paysum">
      <div className="ad-paysum-n">
        <div><span className="eyebrow">Paiements confirmés</span><div className="ad-big num">{money(cashed)}</div><span className="tiny muted">{conf.length} dossier{conf.length > 1 ? 's' : ''}</span></div>
        <div><span className="eyebrow">En attente</span><div className="ad-big num">{wait.length}</div><span className="tiny muted">à rapprocher</span></div>
        <div><span className="eyebrow">Remboursements</span><div className="ad-big num">{refunds.length}</div><span className="tiny muted">{approvals.filter(a => a.status === 'en_attente').length} à valider</span></div>
      </div>
      <Stacked height={12} parts={[{ value: conf.length, color: 'var(--ok)', label: 'Confirmés' }, { value: wait.length, color: 'var(--warn)', label: 'En attente' }, { value: other.length, color: 'var(--info)', label: 'Remboursement' }]} />
      <div className="ad-legend ad-legend-l"><span><i style={{ background: 'var(--ok)' }} />Confirmés {conf.length}</span><span><i style={{ background: 'var(--warn)' }} />En attente {wait.length}</span><span><i style={{ background: 'var(--info)' }} />Remboursement {other.length}</span></div>
    </section>
    <div className="ad-cols ad-cols-wide">
      <Panel title="Paiements par dossier">
        <Filter label="Filtrer les paiements" value={f} onChange={k => { setF(k); setN(10); }} options={[['all', 'Tous', payments.length], ['ok', 'Confirmés', conf.length], ['wait', 'En attente', wait.length], ['other', 'Remboursement', other.length]]} />
        {list.length === 0 ? <Empty>Aucun paiement dans cette liste.</Empty> : <div className="tbl-wrap"><table className="tbl ad-rt ad-rt-pay"><thead><tr><th>Client</th><th>Référence Moov Money</th><th className="ad-r">Montant</th><th>Paiement</th><th>Étape du dossier</th></tr></thead><tbody>
          {list.slice(0, n).map(p => { const t = PAY[p.status] || ['', p.status]; return <tr key={p.id}>
            <td className="ad-c-main"><Who name={names[p.id] || p.orderRef} size={34} sub={p.orderRef} /></td>
            <td className="small muted ad-c-full ad-c-ref">{p.ref}</td>
            <td className="num ad-c-end ad-r"><b>{p.amount.toLocaleString('fr-FR')}</b> <span className="tiny muted">{p.currency === 'XOF' ? 'F CFA' : p.currency}</span></td>
            <td className="ad-c-tag"><Tag tone={t[0]}>{t[1]}</Tag></td>
            <td className="small ad-c-step">{STATE_INFO[p.state].label}</td>
          </tr>; })}
        </tbody></table></div>}
        <More shown={n} total={list.length} onMore={() => setN(n + 20)} />
        <span className="tiny muted">L’application ne garde aucune clé ni code PIN de paiement. Aucune écriture financière libre n’est possible.</span>
      </Panel>
      <Panel title="Annulations et remboursements">
        {refunds.length ? <ul className="ad-list">{refunds.map(x => { const t = REFUND[x.status] || ['', x.status]; const ap = approvals.find(a => a.refundId === x.id && a.status === 'en_attente'); return <li key={x.id} className="ad-refund">
          <div className="ad-line"><Avatar name={names[x.orderId] || x.ref} size={36} /><div className="grow"><b className="small">{names[x.orderId] || 'Client'}</b><div className="tiny muted">{x.ref}{x.reason ? ' · « ' + x.reason + ' »' : ''}</div></div><Tag tone={t[0]}>{t[1]}</Tag></div>
          <ol className="ad-steps">{x.steps.map((s, i) => <li key={i}><span className="tiny"><b>{s.what}</b></span><span className="tiny muted">{s.by} · {fmtDateTime(s.at)}</span></li>)}</ol>
          {ap && <div className="ad-wait tiny"><AvatarStack names={[ap.byName]} size={22} />Validation par un superviseur attendue (demandée par {firstName(ap.byName)}).</div>}
        </li>; })}</ul> : <Empty>Aucune demande d’annulation.</Empty>}
      </Panel>
    </div>
  </>;
}

