// Espace terrain (TE-01 à TE-08) : l’application du technicien. Missions, étapes, preuves, travail hors ligne.
// Sur grand écran, le téléphone est entouré de cartes d’accompagnement (profil, carte, synchronisation).
import { api, useQ, call, toast, useOnline, setOnline, isOnline, readQueue, updateQueue, replay, watchQueue, prepareImage, putImage } from './platform.js';
import { Btn, AsyncBtn, Tag, Sim, Explain, Field, Modal, Empty, Icon, Picture, NotifBell, Avatar, Say, Ring, Bars, AbidjanMap, VanScene, HouseScene, firstName, fmtDate, fmtDateTime, fmtAgo, slotLabel, BLOCKER_TYPES } from './kit.jsx';
import { CHECKLIST_TECH, ZONES, DOC_TYPES } from '../server/model.js';
const React = window.React;
const { useState, useEffect, useRef } = React;

const WO_LABEL = { affectee: 'À faire', en_route: 'En route', sur_place: 'Sur place', en_cours: 'En cours', terminee: 'Terminée', echec: 'Échec', annulee: 'Annulée' };
const WO_TONE = { affectee: 'info', en_route: 'info', sur_place: 'info', en_cours: 'warn', terminee: 'ok', echec: 'bad', annulee: 'bad' };
const LIVE = ['affectee', 'en_route', 'sur_place', 'en_cours'];
const RANK = { en_cours: 0, sur_place: 1, en_route: 2, affectee: 3 };
const STEPS = ['En route', 'Sur place', 'Installation', 'Terminé'];
const REACHED = { affectee: 0, en_route: 1, sur_place: 2, en_cours: 2, terminee: 4 };
const ACT_LABEL = { start: 'Démarrer', depart: 'Départ', arrive: 'Arrivée', checklist: 'Checklist', serial: 'Numéro de série', photo: 'Photo', comment: 'Commentaire', reception: 'Réception client', finish: 'Fin de mission', fail: 'Échec', incident: 'Incident' };
const ACT_ICON = { start: Icon.tool, depart: Icon.right, arrive: Icon.pin, checklist: Icon.list, serial: Icon.box, photo: Icon.camera, comment: Icon.chat, reception: Icon.user, finish: Icon.check, fail: Icon.x, incident: Icon.alert };
const FAIL_TYPES = ['CLIENT_ABSENT', 'ACCES_IMPOSSIBLE', 'MATERIEL_PANNE', 'CAPACITE_RESEAU'];

const S = d => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>;
const WIFI_OFF = S(<><path d="M2.5 9a14 14 0 015-3.2M11 5.1a14 14 0 0110.5 3.9M5.5 12.5a9.5 9.5 0 014-2.3M14.8 10.6a9.5 9.5 0 013.7 1.9M9 16a4.5 4.5 0 016 0" /><circle cx="12" cy="19.2" r=".8" fill="currentColor" /><path d="M3.5 3.5l17 17" /></>);
const CHEV = S(<path d="M6 9.5l6 6 6-6" />);
const SCAN = S(<><path d="M4 8V6a2 2 0 012-2h2M16 4h2a2 2 0 012 2v2M20 16v2a2 2 0 01-2 2h-2M8 20H6a2 2 0 01-2-2v-2" /><path d="M8 8.5v7M11 8.5v7M14 8.5v7M17 8.5v7" /></>);

const tz = { timeZone: 'Africa/Abidjan' };
const hhmm = t => (t ? new Intl.DateTimeFormat('fr-FR', { ...tz, hour: '2-digit', minute: '2-digit' }).format(t).replace(':', 'h') : '');
const dayShort = t => new Intl.DateTimeFormat('fr-FR', { ...tz, weekday: 'short', day: 'numeric' }).format(t);
const zoneOf = commune => (ZONES.find(z => z.name === commune) || {}).id;
const toNum = v => (v === '' || v == null ? '' : Number(String(v).replace(',', '.').replace('−', '-')));
const isWaiting = s => s === 'en attente de réseau' || s === 'à réessayer';
const fmtNum = n => String(n).replace('.', ',').replace(/^-/, '−');
// Étapes qui font avancer la mission : hors ligne, l'écran avance tout de suite, sans attendre le réseau.
const NEXT_STATUS = { depart: 'en_route', arrive: 'sur_place', start: 'en_cours', finish: 'terminee', fail: 'echec' };
const INCIDENTS = [
  ['MATERIEL_PANNE', 'Matériel manquant ou en panne', 'Le client est prévenu et le planificateur réapprovisionne.'],
  ['CAPACITE_RESEAU', 'Problème sur le réseau (point de raccordement)', 'Le client est prévenu et le planificateur cherche une solution.'],
  ['ACCES_IMPOSSIBLE', 'Accès bloqué pendant les travaux', 'Le client est prévenu, le conseiller obtient l’accès.'],
  ['AUTRE', 'Autre souci (outil, échelle, retard…)', 'Seul le planificateur est prévenu. Le client ne voit rien.'],
];
const byRank = (a, b) => (RANK[a.status] - RANK[b.status]) || (((a.appt && a.appt.date) || 0) - ((b.appt && b.appt.date) || 0)) || ((a.appt && a.appt.slot) || '').localeCompare((b.appt && b.appt.slot) || '');
const when = w => (w.appt ? fmtDate(w.appt.date) + ' · ' + slotLabel(w.appt.slot) : 'Date à fixer');

export function FieldApp({ token }) {
  const me = useQ(token, 'me');
  const ms = useQ(token, 'tech.missions');
  const online = useOnline(token);
  const [sel, setSel] = useState(null);
  const [tab, setTab] = useState('missions');
  const bodyRef = useRef(null);
  const selStatus = ((ms.data || []).find(w => w.id === sel) || {}).status;
  useEffect(() => { watchQueue(token); setSel(null); setTab('missions'); }, [token]);
  useEffect(() => {
    const b = bodyRef.current; if (!b) return;
    b.scrollTop = 0;
    const ph = b.parentElement; if (!ph) return;
    const top = ph.getBoundingClientRect().top, margin = parseFloat(getComputedStyle(ph).scrollMarginTop) || 0;
    if (top < margin) ph.scrollIntoView({ block: 'start' });
  }, [sel, tab, selStatus]);
  if (me.error) return <div className="alert alert-bad">{me.error.message}</div>;
  const user = me.data.user;
  const list = ms.data || [];
  const q = readQueue(token);
  const pending = q.filter(x => ['en attente de réseau', 'refusé'].includes(x.status)).length;
  const waitBy = {}; for (const x of q) if (x.status === 'en attente de réseau') waitBy[x.args.woId] = (waitBy[x.args.woId] || 0) + 1;
  const cur = list.find(w => w.id === sel);
  const openMission = id => { setSel(id); setTab('missions'); };
  const live = list.filter(w => LIVE.includes(w.status)).sort(byRank);
  return <div className="fd-wrap">
    <div className="fd-stage">
      <div className="phone fd-phone" data-tour="field-phone">
        <div className="phone-top fd-top">
          <div className="fd-hello">
            <Avatar name={user.name} size={42} dot={online ? 'ok' : 'off'} />
            <span className="fd-hello-t"><b>Bonjour {firstName(user.name)}</b><span>{user.contractor ? user.contractor + ' pour Moov' : 'Moov Terrain'}</span></span>
          </div>
          <NotifBell token={token} onOpen={oid => { const w = list.find(x => x.orderId === oid); if (w) openMission(w.id); }} />
          <button type="button" className={'fd-net' + (online ? '' : ' off')} onClick={() => setOnline(!online, token)} data-tour="field-network" aria-pressed={!online} title={online ? 'Couper le réseau de cet onglet (simulation)' : 'Rétablir le réseau'}>
            {online ? Icon.wifi : WIFI_OFF}<span>{online ? 'Connecté' : 'Hors ligne'}</span><i className="fd-knob" aria-hidden="true" />
          </button>
        </div>
        <div className="phone-body fd-body" ref={bodyRef}>
          {!online && <div className="fd-offline" role="status">
            <span className="fd-ic">{WIFI_OFF}</span>
            <span><b>Mode hors ligne (simulation)</b>Vos actions sont gardées sur le téléphone et partiront une seule fois au retour du réseau. L’activation et les nouvelles réservations attendent le réseau.</span>
          </div>}
          {tab === 'queue' ? <Queue token={token} missions={list} />
            : cur ? <Mission key={cur.id} token={token} wo={cur} onBack={() => setSel(null)} online={online} onQueue={() => setTab('queue')} />
            : <Home list={list} live={live} waitBy={waitBy} onOpen={openMission} />}
        </div>
        <nav className="phone-tabs fd-tabs" aria-label="Application terrain">
          <button type="button" aria-current={tab === 'missions' ? 'page' : undefined} onClick={() => { if (tab === 'missions') setSel(null); else setTab('missions'); }}>{Icon.list}Missions</button>
          <button type="button" aria-current={tab === 'queue' ? 'page' : undefined} onClick={() => setTab('queue')} data-tour="field-queue">{online ? Icon.wifi : WIFI_OFF}Synchronisation{pending > 0 && <span className="badge">{pending}</span>}</button>
        </nav>
      </div>
      <aside className="fd-side fd-side-l" aria-label="Journée du technicien">
        <SideProfile user={user} list={list} live={live} online={online} />
        <section className="card fd-card">
          <Say name="Aya" size={38}>{firstName(user.name)} ne voit que <b>ses</b> missions, jamais l’ensemble des clients. Il ne peut ni valider un paiement, ni confirmer une activation.</Say>
          <p className="tiny muted fd-tip">Essayez : coupez le réseau en haut du téléphone, faites une action, puis rétablissez-le.</p>
        </section>
      </aside>
      <aside className="fd-side fd-side-r" aria-label="Carte et synchronisation">
        <SideMap live={live} current={cur} onOpen={openMission} />
        <SideSync q={q} online={online} name={firstName(user.name)} onOpen={() => setTab('queue')} />
      </aside>
    </div>
  </div>;
}

// ---------- Accueil : la mission du moment, puis les suivantes ----------
function Home({ list, live, waitBy, onOpen }) {
  const next = live[0];
  const rest = live.slice(1);
  const closed = list.filter(w => !LIVE.includes(w.status)).sort((a, b) => ((b.appt && b.appt.date) || 0) - ((a.appt && a.appt.date) || 0));
  return <>
    <div className="fd-h"><h2>Vos missions</h2>{list.length > 0 && <span className="small muted">{live.length} à faire</span>}</div>
    {list.length === 0 && <div className="card fd-empty">
      <VanScene height={64} />
      <Empty>Aucune mission pour l’instant. Elles arrivent ici dès que le planificateur confirme un rendez-vous.</Empty>
    </div>}
    {next && <NextCard wo={next} waiting={waitBy[next.id]} onOpen={onOpen} />}
    {rest.length > 0 && <span className="fd-sec">Ensuite</span>}
    {rest.map(w => <MissionCard key={w.id} wo={w} waiting={waitBy[w.id]} onOpen={onOpen} />)}
    {closed.length > 0 && <span className="fd-sec">Terminées ou clôturées</span>}
    {closed.map(w => <MissionCard key={w.id} wo={w} waiting={waitBy[w.id]} onOpen={onOpen} closed />)}
    <div className="fd-narrow-only"><Explain>Le technicien ne voit que <b>ses</b> missions, jamais l’ensemble des clients. Il ne peut pas valider un paiement ni confirmer une activation.</Explain></div>
  </>;
}

function NextCard({ wo, waiting, onOpen }) {
  const a = wo.address;
  return <button type="button" className="card card-dark fd-next" onClick={() => onOpen(wo.id)}>
    <span className="fd-next-top"><span>{wo.status === 'affectee' ? 'Prochaine mission' : 'Mission en cours'}</span><span className="tag tag-lime">{WO_LABEL[wo.status]}</span></span>
    <span className="fd-who"><Avatar name={wo.contactName} size={48} /><span className="fd-who-t"><b>{wo.contactName}</b><span>{wo.ref} · {wo.offer}</span></span></span>
    <span className="fd-chips"><span className="fd-chip">{Icon.clock}{when(wo)}</span><span className="fd-chip">{Icon.pin}{a.commune}</span></span>
    <span className="fd-next-foot">
      <span className="fd-next-addr">{a.street}{a.landmark ? <em>Repère : {a.landmark}</em> : null}</span>
      <span className="fd-go" aria-hidden="true">{Icon.arrow}</span>
    </span>
    {waiting > 0 && <span className="fd-wait fd-wait-dark">{Icon.clock}{waiting} action{waiting > 1 ? 's' : ''} en attente de réseau</span>}
  </button>;
}

function MissionCard({ wo, waiting, onOpen, closed }) {
  const a = wo.address;
  return <button type="button" className={'card fd-mcard' + (closed ? ' closed' : '')} onClick={() => onOpen(wo.id)}>
    <span className="fd-who"><Avatar name={wo.contactName} size={40} /><span className="fd-who-t"><b>{wo.contactName}</b><span>{wo.ref}</span></span><Tag tone={WO_TONE[wo.status]}>{WO_LABEL[wo.status]}</Tag></span>
    <span className="fd-mc-meta">
      <span>{Icon.clock}{when(wo)}</span>
      <span>{Icon.pin}{a.commune} · {a.street}</span>
    </span>
    {waiting > 0 && <span className="fd-wait">{Icon.clock}{waiting} action{waiting > 1 ? 's' : ''} en attente de réseau</span>}
  </button>;
}

// ---------- Détail d’une mission ----------
function Mission({ token, wo, onBack, online, onQueue }) {
  const [vals, setVals] = useState(() => ({ ...wo.checklist }));
  const [serial, setSerial] = useState(wo.serial || '');
  const [code, setCode] = useState('');
  const [fail, setFail] = useState(null);
  const [incident, setIncident] = useState(false);
  const [comment, setComment] = useState('');
  const [reserve, setReserve] = useState('');
  const [open, setOpen] = useState(null);
  const act = (action, args = {}) => call(token, 'wo.action', { woId: wo.id, action, args: { ...args, offline: !isOnline(token) }, expectedVersion: wo.version }, { meta: { ref: wo.ref } });
  // Après une photo, le bloc reste ouvert pour en ajouter d'autres ; sinon on passe au suivant.
  const step = async (action, args, keep = false) => { const r = await act(action, args); if (r && r.ok) setOpen(keep ? action : null); return r; };
  const q = readQueue(token).filter(x => x.args.woId === wo.id && x.status === 'en attente de réseau');
  const queued = new Set(q.map(x => x.args.action));
  let st = wo.status; for (const x of q) if (NEXT_STATUS[x.args.action] && LIVE.includes(st)) st = NEXT_STATUS[x.args.action];
  const qPhotos = q.filter(x => x.args.action === 'photo').map(x => ({ id: x.id, ...(x.args.args || {}) }));
  const [incType, setIncType] = useState('MATERIEL_PANNE');
  const [incText, setIncText] = useState('');
  const live = LIVE.includes(st);
  const a = wo.address;
  const fillDemo = () => { const v = { puissance: (-17 - Math.random() * 5).toFixed(1), pto: true, cheminement: true, ont_led: true, wifi: true }; setVals(v); setSerial('ZTE-F670-4821' + Math.floor(Math.random() * 10)); };
  const scan = () => setSerial('ZTE-F670-4821' + Math.floor(Math.random() * 10));
  const [shooting, setShooting] = useState(false);
  const onPhoto = async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    if (!/^image\//.test(f.type || '')) { toast('Choisissez une photo (JPG ou PNG).', true); return; }
    setShooting(true);
    try {
      const pic = await prepareImage(f);
      if (!pic) { toast('Cette image ne peut pas être lue ici. Essayez une photo au format JPG ou PNG.', true); return; }
      let img = null; try { img = await putImage(api.session(token).wsId, pic.full); } catch {}
      await step('photo', { name: f.name, thumb: pic.thumb, img, capturedAt: Date.now() }, true);
    } finally { setShooting(false); }
  };

  // Les quatre étapes de l’installation, calculées à partir de la mission enregistrée.
  const ck = wo.checklist || {};
  const bools = CHECKLIST_TECH.filter(c => c.type === 'bool');
  const measures = CHECKLIST_TECH.filter(c => c.type !== 'bool');
  const pw = Number(ck.puissance);
  const ckDone = CHECKLIST_TECH.filter(c => c.required).every(c => c.type === 'bool' ? ck[c.id] === true : ck[c.id] !== undefined && ck[c.id] !== '' && ck[c.id] !== null) && pw >= -27 && pw <= -8;
  const ticks = bools.filter(c => ck[c.id] === true).length;
  const tasks = [
    { id: 'checklist', title: 'Mesures et checklist', tour: 'field-checklist', done: ckDone, sum: ckDone ? fmtNum(pw) + ' dBm · ' + ticks + ' sur ' + bools.length + ' points' : ticks || ck.puissance != null ? 'Incomplète : ' + ticks + ' sur ' + bools.length + ' points' : 'À remplir' },
    { id: 'serial', title: 'Box installée', done: !!wo.serial, sum: wo.serial || 'Scanner ou saisir le numéro' },
    { id: 'photo', title: 'Photos et commentaire', done: wo.photos.length > 0, sum: wo.photos.length ? wo.photos.length + ' photo' + (wo.photos.length > 1 ? 's' : '') + (wo.comment ? ' · commentaire' : '') : 'Au moins une photo' },
    { id: 'reception', title: 'Réception par le client', tour: 'field-reception', done: !!wo.reception, sum: wo.reception ? (wo.reception.status === 'accord' ? 'Accord du client' : 'Accord avec réserve') : 'Code du client' },
  ].map(t => ({ ...t, pending: !t.done && queued.has(t.id) }));
  const firstTodo = (tasks.find(t => !t.done && !t.pending) || {}).id;
  const isOpen = id => (open === null ? id === firstTodo : open === id);
  const toggle = id => setOpen(isOpen(id) ? '' : id);
  const doneCount = tasks.filter(t => t.done).length;
  const left = tasks.filter(t => !t.done && !t.pending).map(t => t.title.split(' ')[0].toLowerCase());
  const waitingN = tasks.filter(t => t.pending).length;

  const reached = REACHED[st] ?? 0;
  const flow = {
    affectee: ['Prêt à partir ?', 'Le client est prévenu dès que vous partez.', 'depart', 'Je pars'],
    en_route: ['En route vers ' + firstName(wo.contactName), wo.times.depart ? 'Parti à ' + hhmm(wo.times.depart) + '.' : 'Bonne route.', 'arrive', 'Je suis arrivé'],
    sur_place: ['Vous êtes sur place', (wo.times.arrive ? 'Arrivé à ' + hhmm(wo.times.arrive) + '. ' : '') + 'Démarrez quand les travaux commencent.', 'start', 'Démarrer l’installation'],
    en_cours: ['Installation en cours', (wo.times.start ? 'Commencée à ' + hhmm(wo.times.start) + '. ' : '') + doneCount + ' étape' + (doneCount > 1 ? 's' : '') + ' sur 4 faite' + (doneCount > 1 ? 's' : '') + '.'],
    terminee: ['Mission terminée', wo.times.end ? 'Le ' + fmtDateTime(wo.times.end) + '.' : ''],
  }[st];

  return <div className="stack fd-mission">
    <div className="fd-bar">
      <button type="button" className="fd-back" onClick={onBack}>{Icon.left}Missions</button>
      <span className="fd-bar-ref">{wo.ref}</span>
      <Tag tone={WO_TONE[st]}>{WO_LABEL[st]}</Tag>
    </div>

    <section className="card fd-client">
      <span className="fd-who"><Avatar name={wo.contactName} size={52} /><span className="fd-who-t"><b className="fd-big">{wo.contactName}</b><span>{wo.offer}</span></span></span>
      <ul className="fd-info">
        <li><span className="fd-ic">{Icon.clock}</span><span><b>{wo.appt ? fmtDate(wo.appt.date) : 'Date à fixer'}</b>{wo.appt ? ' · ' + slotLabel(wo.appt.slot) : ''}</span></li>
        <li><span className="fd-ic">{Icon.pin}</span><span><b>{a.street}, {a.commune}</b>{a.floor ? ' · ' + a.floor : ''}<em>Repère : {a.landmark || 'aucun'} · {a.building}</em></span></li>
        {a.accessNotes && <li><span className="fd-ic">{Icon.lock}</span><span>Accès : {a.accessNotes}</span></li>}
        {a.onsiteContact && <li><span className="fd-ic">{Icon.user}</span><span>Personne présente : <b>{a.onsiteContact}</b></span></li>}
      </ul>
      <details className="fd-more">
        <summary>Voir le détail</summary>
        <div className="stack-s small">
          <span>Box attendue : <b>{wo.equipmentModel}</b></span>
          <span>Préparation du client : {Object.values(wo.prep || {}).filter(Boolean).length} point(s) confirmé(s).</span>
          <span className="muted">Contact avec le client via l’application uniquement.</span>
        </div>
      </details>
      {(wo.documents || []).length > 0 && <div className="fd-docs">
        <b className="small">Pièces du client pour cette visite</b>
        {wo.documents.map(d => <div key={d.id} className="fd-doc">
          <Picture token={token} img={d.img} thumb={d.thumb} label={DOC_TYPES[d.type].label + ' · ' + wo.contactName} alt={DOC_TYPES[d.type].label} />
          <span className="grow"><b className="small">{DOC_TYPES[d.type].label}</b><span className="tiny muted">{d.status === 'valide' ? 'Validée par le conseiller' : d.status === 'refuse' ? 'Refusée, une nouvelle pièce est attendue' : 'Pas encore vérifiée par le conseiller'}</span></span>
          <Tag tone={d.status === 'valide' ? 'ok' : d.status === 'refuse' ? 'bad' : 'warn'}>{d.status === 'valide' ? 'Validée' : d.status === 'refuse' ? 'Refusée' : 'À vérifier'}</Tag>
        </div>)}
        <span className="tiny muted">{wo.documents.some(d => d.type === 'cni') ? 'Pour vérifier à votre arrivée que vous parlez bien au titulaire. ' : ''}Visible seulement pendant votre mission.</span>
      </div>}
      {wo.notes.map(n => <div key={n.id} className="fd-note"><Avatar name={n.author || 'Équipe'} size={26} /><span><b>{firstName(n.author) || 'Équipe'}</b>, note interne : {n.text}</span></div>)}
    </section>

    {q.length > 0 && <button type="button" className="fd-wait fd-wait-btn" onClick={onQueue}>{Icon.clock}{q.length} action{q.length > 1 ? 's' : ''} en attente de réseau pour cette mission</button>}

    {st === 'annulee' && <div className="card fd-state bad"><span className="fd-ic">{Icon.x}</span><span><b>Mission retirée ou annulée</b>{wo.cancelReason ? 'Motif : ' + wo.cancelReason + '. ' : 'La planification l’a retirée. '}Plus aucune action n’est possible.</span></div>}
    {st === 'echec' && wo.failure && <div className="card fd-state bad"><span className="fd-ic">{Icon.alert}</span><span><b>Visite non réalisée : {BLOCKER_TYPES[wo.failure.type].label}</b>{wo.failure.comment ? '« ' + wo.failure.comment + ' ». ' : ''}Un conseiller reprend le dossier.</span></div>}

    {flow && <section className="card-dark fd-flow">
      <ol className="fd-steps" aria-label={'Étape ' + Math.min(reached + 1, 4) + ' sur 4'}>
        {STEPS.map((s, i) => <li key={s} className={i < reached ? 'done' : i === reached ? 'now' : ''} aria-current={i === reached ? 'step' : undefined}><span className="fd-dot">{i < reached ? Icon.check : i + 1}</span>{s}</li>)}
      </ol>
      <div className="fd-flow-t"><b>{flow[0]}</b><span>{flow[1]}</span></div>
      {flow[2] && <AsyncBtn className="fd-lime" block onClick={() => act(flow[2])} data-tour={flow[2] === 'start' ? 'field-start' : undefined}>{flow[3]}{Icon.right}</AsyncBtn>}
    </section>}

    {live && st !== 'en_cours' && <div className="fd-alt">
      {st !== 'sur_place' && <AsyncBtn size="s" kind="ghost" onClick={() => act('start')} data-tour="field-start">{Icon.tool}Démarrer l’installation</AsyncBtn>}
      <Btn size="s" kind="ghost" className="fd-danger" onClick={() => setFail('CLIENT_ABSENT')}>{Icon.x}Visite impossible</Btn>
    </div>}

    {st === 'en_cours' && <>
      <div className="stack-s fd-tasks">
        {tasks.map((t, i) => <Task key={t.id} n={i + 1} t={t} open={isOpen(t.id)} onToggle={() => toggle(t.id)}>
          {t.id === 'checklist' && <>
            <span className="fd-helper"><span className="small muted">Pour aller vite :</span><Btn size="s" kind="sim" onClick={fillDemo}>Remplir pour la démo</Btn></span>
            {measures.map(c => { const v = toNum(vals[c.id]); const ok = v !== '' && v >= c.min && v <= c.max; return <div key={c.id} className="fd-measure">
              <label htmlFor={'ck-' + c.id}>{c.label}</label>
              <span className="fd-unit"><input id={'ck-' + c.id} className="input num" inputMode="decimal" placeholder="-19,5" value={vals[c.id] ?? ''} onChange={e => setVals({ ...vals, [c.id]: e.target.value })} /><span>{c.unit}</span></span>
              {v !== '' && !Number.isNaN(v) ? <span className={'fd-range ' + (ok ? 'ok' : 'bad')}>{ok ? Icon.check : Icon.alert}{ok ? 'Bonne ligne' : 'Hors plage : attendu entre ' + fmtNum(c.min) + ' et ' + fmtNum(c.max) + ' ' + c.unit}</span> : <span className="tiny muted">{c.help}</span>}
            </div>; })}
            <div className="fd-switches">
              {bools.map(c => <label key={c.id} className="switch fd-switch"><input type="checkbox" checked={!!vals[c.id]} onChange={e => setVals({ ...vals, [c.id]: e.target.checked })} /><span>{c.label}{!c.required && <span className="muted"> (facultatif)</span>}</span></label>)}
            </div>
            <AsyncBtn kind="primary" block onClick={() => { const bad = measures.find(c => vals[c.id] !== '' && vals[c.id] != null && Number.isNaN(toNum(vals[c.id]))); if (bad) { toast(bad.label + ' : saisissez un nombre (ex. −19,5).', true); return; } return step('checklist', { values: { ...vals, puissance: toNum(vals.puissance) } }); }}>Enregistrer la checklist</AsyncBtn>
          </>}
          {t.id === 'serial' && <>
            <span className="small muted">Box attendue : <b className="fd-ink">{wo.equipmentModel}</b></span>
            <Field label="Numéro de série" id="sn">
              <span className="fd-inrow"><input id="sn" className="input" value={serial} onChange={e => setSerial(e.target.value)} placeholder="ZTE-F670-48210" autoComplete="off" /><button type="button" className="fd-scan" onClick={scan} title="Scanner le code-barres (démo : prend un numéro du stock fictif)" aria-label="Scanner le code-barres (démo)">{SCAN}</button></span>
            </Field>
            {wo.serial && <span className="fd-range ok">{Icon.check}Box attribuée : {wo.serial}</span>}
            <AsyncBtn kind="primary" block onClick={() => step('serial', { serial })}>Vérifier et attribuer</AsyncBtn>
            <span className="tiny muted">Le numéro est comparé à la commande et au stock : une box déjà attribuée à un autre client est refusée. <Sim what="stock fictif" /></span>
          </>}
          {t.id === 'photo' && <>
            <div className="fd-photos">
              {wo.photos.map(p => <figure key={p.id} className="fd-ph" title={p.name + ' · prise ' + fmtDateTime(p.at) + (p.takenOffline ? ' · hors ligne, synchronisée' : '')}>
                {p.thumb || p.img ? <Picture token={token} img={p.img} thumb={p.thumb} label={'Photo · ' + p.name} alt={p.name} size="100%" /> : <span className="fd-ph-none">{Icon.camera}<span>{p.name}</span></span>}
                <figcaption>{hhmm(p.at)}{p.takenOffline ? ' · hors ligne' : ''}</figcaption>
              </figure>)}
              {qPhotos.map(p => <figure key={p.id} className="fd-ph fd-ph-wait" title={(p.name || 'photo') + ' · en attente de réseau'}>
                {p.thumb ? <Picture token={token} thumb={p.thumb} label={'Photo · ' + (p.name || '')} alt={p.name || 'photo'} size="100%" /> : <span className="fd-ph-none">{Icon.camera}<span>{p.name}</span></span>}
                <figcaption>En attente</figcaption>
              </figure>)}
              <label className={'fd-ph fd-ph-add' + (shooting ? ' is-busy' : '')} htmlFor={'ph-' + wo.id}>{Icon.camera}<span>{shooting ? 'Envoi…' : 'Prendre une photo'}</span></label>
              <TileBtn className="fd-ph fd-ph-sim" onClick={() => step('photo', { name: 'photo-demo-' + (wo.photos.length + qPhotos.length + 1) + '.jpg' }, true)}>{Icon.camera}<span>Photo de démonstration</span></TileBtn>
            </div>
            <input id={'ph-' + wo.id} type="file" accept="image/*" onChange={onPhoto} className="fd-file" />
            <Field label="Commentaire" id="wo-c"><textarea id="wo-c" className="input" rows={2} value={comment} onChange={e => setComment(e.target.value)} placeholder="Ex. câble passé par la gaine du salon" /></Field>
            {wo.comment && <span className="tiny muted">Enregistré : « {wo.comment} »</span>}
            <div className="fd-btns"><AsyncBtn size="s" onClick={async () => { if (!comment.trim()) { toast('Écrivez d’abord le commentaire.', true); return; } const r = await act('comment', { text: comment }); if (r && r.ok) { setComment(''); if (!r.queued) toast('Commentaire enregistré.'); } }}>Enregistrer le commentaire</AsyncBtn></div>
            <span className="tiny muted">Photos et code client sont des preuves. Seules, elles ne prouvent pas que la ligne est activée.</span>
          </>}
          {t.id === 'reception' && (wo.reception
            ? <span className={'fd-range ' + (wo.reception.status === 'accord' ? 'ok' : 'warn')}>{wo.reception.status === 'accord' ? Icon.check : Icon.alert}{wo.reception.status === 'accord' ? 'Le client a donné son accord' : 'Réserve : ' + wo.reception.comment}</span>
            : <>
              <Field label="Code affiché dans l’application du client" id="rc"><input id="rc" className="input num fd-code" inputMode="numeric" autoComplete="off" placeholder="0000" value={code} onChange={e => setCode(e.target.value)} /></Field>
              <span className="fd-demo"><span><b>Astuce démo :</b> le client voit ce code dans son espace (carte « Votre technicien »), ici : <b className="num">{wo.receptionCode}</b></span><button type="button" className="link-btn" onClick={() => setCode(wo.receptionCode)}>Utiliser ce code</button></span>
              <AsyncBtn kind="primary" block onClick={() => step('reception', { mode: 'code', code, status: 'accord' })}>Valider l’accord</AsyncBtn>
              <details className="fd-more">
                <summary>Le client a une réserve ?</summary>
                <div className="stack-s">
                  <Field label="Réserve du client" id="rc-note"><input id="rc-note" className="input" value={reserve} onChange={e => setReserve(e.target.value)} placeholder="Ex. trace de colle sur le mur" /></Field>
                  <AsyncBtn onClick={() => step('reception', { mode: 'code', code, status: 'reserve', comment: reserve || comment || 'Réserve sans détail' })}>Accord avec réserve</AsyncBtn>
                </div>
              </details>
            </>)}
        </Task>)}
      </div>
      <section className="card-dark fd-finish">
        <div className="fd-finish-top">
          <Ring value={doneCount} max={4} size={54} stroke={6} color={doneCount ? 'var(--lime)' : 'transparent'} track="var(--dark-3)"><span className="num">{doneCount}/4</span></Ring>
          <span className="fd-flow-t"><b>{doneCount === 4 ? 'Tout est prêt' : 'Avant de terminer'}</b><span>{doneCount === 4 ? 'La demande d’activation partira vers Moov.' : (left.length ? 'Il reste : ' + left.join(', ') + '.' : '') + (waitingN ? ' ' + waitingN + ' étape' + (waitingN > 1 ? 's' : '') + ' en attente de réseau.' : '')}</span></span>
        </div>
        <AsyncBtn className="fd-lime" block onClick={() => act('finish')}>Terminer la mission</AsyncBtn>
      </section>
      <div className="fd-alt">
        <Btn size="s" kind="ghost" onClick={() => setIncident(true)}>{Icon.alert}Signaler un incident</Btn>
        <Btn size="s" kind="ghost" className="fd-danger" onClick={() => setFail('ACCES_IMPOSSIBLE')}>{Icon.x}Visite impossible</Btn>
      </div>
    </>}

    {st === 'terminee' && <section className="card fd-done">
      <HouseScene progress={0.7} height={96} />
      <b>Et maintenant ?</b>
      <span className="small">La demande d’activation est partie vers Moov. Le dossier n’est pas « actif » tant que le système ne l’a pas confirmé. <Sim what="activation simulée" /></span>
      <details className="fd-more">
        <summary>Voir le rapport</summary>
        <ul className="fd-kv">
          {CHECKLIST_TECH.map(c => <li key={c.id}><span>{c.label}</span><b>{c.type === 'bool' ? (ck[c.id] ? 'Oui' : 'Non') : (ck[c.id] != null ? fmtNum(ck[c.id]) : '?') + ' ' + c.unit}</b></li>)}
          <li><span>Box</span><b>{wo.serial || '?'}</b></li>
          <li><span>Photos</span><b>{wo.photos.length}</b></li>
          <li><span>Réception</span><b>{wo.reception ? (wo.reception.status === 'accord' ? 'Accord' : 'Réserve : ' + (wo.reception.comment || 'sans détail')) : '?'}</b></li>
          {wo.comment && <li><span>Commentaire</span><b>{wo.comment}</b></li>}
        </ul>
      </details>
    </section>}

    <details className="fd-more fd-times">
      <summary>Horaires de la mission</summary>
      <ul className="fd-kv">
        {[['Départ', wo.times.depart], ['Arrivée', wo.times.arrive], ['Début', wo.times.start], ['Fin', wo.times.end]].map(([l, t]) => <li key={l}><span>{l}</span><b>{t ? fmtDateTime(t) : 'pas encore'}</b></li>)}
        <li><span>Version</span><b>{wo.version}</b></li>
      </ul>
    </details>

    {fail && <FailModal onClose={() => setFail(null)} initial={fail} onSend={async (reason, c) => { const r = await act('fail', { reason, comment: c }); if (r.ok) setFail(null); }} />}
    {incident && <Modal title="Signaler un incident" onClose={() => setIncident(false)} actions={<AsyncBtn kind="primary" disabled={incText.trim().length < 5} onClick={async () => { const r = await act('incident', { type: incType, comment: incText.trim() }); if (r.ok) { setIncident(false); setIncText(''); if (!r.queued) toast('Incident envoyé au planificateur.'); } }}>Envoyer</AsyncBtn>}>
      <p className="small muted">Choisissez ce qui se passe. L’incident part avec un responsable et une échéance.</p>
      <div className="fd-reasons">
        {INCIDENTS.map(([k, label, next]) => <label key={k} className={'fd-reason' + (incType === k ? ' on' : '')}><input type="radio" name="inc-type" checked={incType === k} onChange={() => setIncType(k)} /><span><b>{label}</b><span className="tiny muted">{next}</span></span></label>)}
      </div>
      <Field label="Ce qui se passe" id="inc"><textarea id="inc" className="input" value={incText} onChange={e => setIncText(e.target.value)} placeholder="Ex. la box livrée ne s’allume pas" /></Field>
    </Modal>}
  </div>;
}

function Task({ n, t, open, onToggle, children }) {
  return <section className={'card fd-task' + (t.done ? ' done' : '') + (open ? ' open' : '')} data-tour={t.tour}>
    <button type="button" className="fd-task-h" onClick={onToggle} aria-expanded={open}>
      <span className="fd-task-n">{t.done ? Icon.check : t.pending ? Icon.clock : n}</span>
      <span className="fd-task-t"><b>{t.title}</b><span className={t.pending ? 'warn' : ''}>{t.pending ? 'En attente de réseau' : t.sum}</span></span>
      <span className="fd-chev">{CHEV}</span>
    </button>
    {open && <div className="fd-task-b">{children}</div>}
  </section>;
}

// Tuile cliquable qui attend la fin de l’action (évite les doubles envois).
function TileBtn({ onClick, className, children }) {
  const [busy, setBusy] = useState(false);
  return <button type="button" className={className} disabled={busy} onClick={async () => { setBusy(true); try { await onClick(); } finally { setBusy(false); } }}>{children}</button>;
}

function FailModal({ onClose, onSend, initial }) {
  const [r, setR] = useState(initial); const [c, setC] = useState('');
  return <Modal title="Visite non réalisée" onClose={onClose} actions={<AsyncBtn kind="primary" onClick={() => onSend(r, c)}>Enregistrer le motif</AsyncBtn>}>
    <p className="small muted">Choisissez le motif. Le bon responsable reprend ensuite le dossier.</p>
    <div className="fd-reasons">
      {FAIL_TYPES.map(k => <label key={k} className={'fd-reason' + (r === k ? ' on' : '')}><input type="radio" name="fail" checked={r === k} onChange={() => setR(k)} /><span><b>{BLOCKER_TYPES[k].label}</b><span className="tiny muted">Ensuite : {BLOCKER_TYPES[k].action}</span></span></label>)}
    </div>
    <Field label="Commentaire" id="fail-c"><textarea id="fail-c" className="input" value={c} onChange={e => setC(e.target.value)} /></Field>
  </Modal>;
}

// ---------- Synchronisation : la file d’actions gardées sur le téléphone ----------
// Libellé court pour la pastille, et phrase complète pour le détail.
const Q_STATUS = s => s === 'refusé' ? ['bad', 'Refusée', 'Refusée par le serveur'] : s.startsWith('en attente') ? ['warn', 'En attente', 'En attente de réseau'] : s === 'à réessayer' ? ['warn', 'À réessayer', 'Renvoi en cours sur la version actuelle'] : s.startsWith('abandonné') ? ['', 'Abandonnée', 'Abandonnée, brouillon gardé'] : s.startsWith('déjà') ? ['ok', 'Sans doublon', 'Déjà reçue par le serveur : aucun doublon'] : ['ok', 'Synchronisée', 'Synchronisée'];

function draftText(it) {
  const a = it.args.args || {};
  switch (it.args.action) {
    case 'checklist': { const v = a.values || {}; const n = CHECKLIST_TECH.filter(c => c.type === 'bool' && v[c.id]).length; return (v.puissance !== '' && v.puissance != null ? v.puissance + ' dBm, ' : '') + n + ' point(s) coché(s)'; }
    case 'serial': return 'Numéro ' + (a.serial || 'vide');
    case 'photo': return a.name || 'photo';
    case 'comment': return '« ' + (a.text || '') + ' »';
    case 'reception': return (a.status === 'reserve' ? 'Accord avec réserve' : 'Accord') + ', code ' + (a.code || 'vide');
    case 'fail': return BLOCKER_TYPES[a.reason] ? BLOCKER_TYPES[a.reason].label : a.reason;
    case 'incident': return a.comment || 'Incident';
    default: return null;
  }
}

function syncCounts(q) {
  return { waiting: q.filter(x => isWaiting(x.status)).length, sent: q.filter(x => x.status === 'synchronisé' || x.status.startsWith('déjà')).length, refused: q.filter(x => x.status === 'refusé').length };
}

function Queue({ token, missions }) {
  const q = readQueue(token);
  const online = useOnline(token);
  const n = syncCounts(q);
  const refOf = id => (missions.find(m => m.id === id) || {}).ref;
  return <div className="stack">
    <div className="fd-h"><h2>Synchronisation</h2>{online && <AsyncBtn size="s" kind="primary" onClick={() => replay(token)}>Synchroniser</AsyncBtn>}</div>
    <section className="card-dark fd-sync">
      <div className="fd-counts">
        <span><b className="num">{n.waiting}</b><i className="warn" />En attente</span>
        <span><b className="num">{n.sent}</b><i className="ok" />Envoyées</span>
        <span><b className="num">{n.refused}</b><i className="bad" />Refusées</span>
      </div>
      <span className="small fd-dim">{online ? 'Réseau connecté : les actions partent tout de suite.' : 'Hors ligne : les actions attendent sur le téléphone.'}</span>
    </section>
    <Explain title="Pourquoi rien n’est envoyé deux fois ?">Chaque action porte une <b>clé unique</b>. Si le réseau coupe au mauvais moment et qu’elle est renvoyée, le serveur ne l’applique qu’une fois.</Explain>
    {q.length === 0 && <Empty>{online ? 'Rien en attente. Coupez le réseau en haut du téléphone pour essayer.' : 'Rien en attente. Faites une action : elle sera gardée ici jusqu’au retour du réseau.'}</Empty>}
    {q.length > 0 && <span className="fd-sec">Historique</span>}
    {[...q].reverse().map(it => {
      const [tone, label, long] = Q_STATUS(it.status);
      const d = draftText(it);
      return <div key={it.id} className={'card fd-qi' + (it.status === 'refusé' ? ' refused' : '')}>
        <div className="fd-qi-h">
          <span className="fd-ic">{ACT_ICON[it.args.action] || Icon.doc}</span>
          <span className="fd-who-t"><b>{ACT_LABEL[it.args.action] || it.args.action}</b><span>{it.ref || refOf(it.args.woId) || 'Mission'} · {fmtAgo(Date.now() - it.at)}</span></span>
          <Tag tone={tone}>{label}</Tag>
        </div>
        {it.status === 'refusé' && <div className="fd-refused">
          <p className="small"><b>Le serveur a refusé cette action.</b> {it.error}</p>
          <p className="tiny muted">Votre saisie n’est pas perdue : elle est gardée comme brouillon.{it.code === 'conflit' ? ' Vous pouvez la renvoyer sur l’état actuel de la mission, ou l’abandonner.' : ' Vous pouvez l’abandonner.'}</p>
          <div className="fd-btns">
            {it.code === 'retiree' && <p className="tiny muted">La mission a été confiée à une autre équipe : elle n’apparaît plus dans votre liste.</p>}
            {it.code === 'conflit' && <AsyncBtn size="s" kind="primary" onClick={async () => { updateQueue(token, l => l.map(x => x.id === it.id ? { ...x, id: x.id + '-r', status: 'à réessayer', args: { ...x.args, expectedVersion: null } } : x)); await replay(token); }}>Réappliquer sur la version actuelle</AsyncBtn>}
            <Btn size="s" onClick={() => updateQueue(token, l => l.map(x => x.id === it.id ? { ...x, status: 'abandonné (brouillon gardé)' } : x))}>Abandonner</Btn>
          </div>
        </div>}
        <details className="fd-more">
          <summary>{it.status.startsWith('abandonné') ? 'Voir le brouillon' : 'Détails'}</summary>
          <ul className="fd-kv">
            <li><span>État</span><b>{long}</b></li>
            {d && <li><span>Contenu</span><b>{d}</b></li>}
            <li><span>Créée</span><b>{fmtDateTime(it.at)}</b></li>
            {it.syncedAt && <li><span>Envoyée</span><b>{fmtDateTime(it.syncedAt)}</b></li>}
            <li><span>Clé unique</span><b className="fd-mono">{it.id}</b></li>
            <li><span>Version attendue</span><b>{it.args.expectedVersion ?? 'actuelle'}</b></li>
          </ul>
        </details>
      </div>;
    })}
    {q.length > 0 && <div><Btn size="s" kind="ghost" onClick={() => updateQueue(token, l => l.filter(x => isWaiting(x.status) || x.status === 'refusé' || x.status.startsWith('abandonné')))}>Effacer l’historique synchronisé</Btn></div>}
  </div>;
}

// ---------- Cartes d’accompagnement (grand écran seulement) ----------
function SideProfile({ user, list, live, online }) {
  const done = list.filter(w => w.status === 'terminee').length;
  const byDay = {}; for (const w of list) if (w.appt) byDay[w.appt.date] = (byDay[w.appt.date] || 0) + 1;
  const next = live[0];
  const days = Object.keys(byDay).map(Number).sort((a, b) => a - b).slice(0, 6).map(d => ({ label: dayShort(d), value: byDay[d], hi: !!(next && next.appt && next.appt.date === d) }));
  return <section className="card fd-card">
    <div className="fd-who"><Avatar name={user.name} size={58} dot={online ? 'ok' : 'off'} /><span className="fd-who-t"><b className="fd-big">{user.name}</b><span>Technicien · {user.contractor || 'Moov Africa'}</span></span></div>
    <div className="fd-stat">
      <span className="fd-stat-n"><b className="num">{list.length}</b><span>mission{list.length > 1 ? 's' : ''} affectée{list.length > 1 ? 's' : ''}</span></span>
      {list.length > 0 && <span className="fd-stat-r"><Ring value={done} max={list.length} size={58} stroke={6} color={done ? 'var(--ok)' : 'transparent'}><span className="num">{done}</span></Ring><span className="tiny muted">terminée{done > 1 ? 's' : ''}</span></span>}
    </div>
    {days.length > 1 && <div className="stack-s"><span className="eyebrow">Rendez-vous par jour</span><Bars data={days} height={96} hiColor="var(--ink)" /></div>}
    {days.length === 1 && <span className="small muted">Tous ses rendez-vous tombent le {fmtDate(Number(Object.keys(byDay)[0]))}</span>}
  </section>;
}

function SideMap({ live, current, onOpen }) {
  const zones = {}; for (const w of live) { const z = zoneOf(w.address.commune); if (z) zones[z] = { count: ((zones[z] || {}).count || 0) + 1 }; }
  const focus = current && LIVE.includes(current.status) ? current : live[0];
  const sel = focus && zoneOf(focus.address.commune);
  const pick = z => { const w = live.find(x => zoneOf(x.address.commune) === z); if (w) onOpen(w.id); };
  return <section className="card fd-card">
    <div className="card-title"><h3>Adresses à visiter</h3><span className="tiny muted">{live.length} mission{live.length > 1 ? 's' : ''}</span></div>
    <AbidjanMap zones={zones} selected={sel} onPick={pick} height={190} />
    <span className="tiny muted">{live.length ? 'Touchez une commune pour ouvrir sa mission.' : 'Aucune adresse à visiter pour le moment.'}</span>
  </section>;
}

function SideSync({ q, online, name, onOpen }) {
  const n = syncCounts(q);
  return <section className="card-dark fd-card fd-sync">
    <div className="card-title"><h3>Téléphone de {name}</h3><span className={'fd-state-pill' + (online ? '' : ' off')}><i />{online ? 'Connecté' : 'Hors ligne'}</span></div>
    <div className="fd-counts">
      <span><b className="num">{n.waiting}</b><i className="warn" />En attente</span>
      <span><b className="num">{n.sent}</b><i className="ok" />Envoyées</span>
      <span><b className="num">{n.refused}</b><i className="bad" />Refusées</span>
    </div>
    <Btn className="fd-lime" onClick={onOpen}>Voir la synchronisation{Icon.right}</Btn>
  </section>;
}
