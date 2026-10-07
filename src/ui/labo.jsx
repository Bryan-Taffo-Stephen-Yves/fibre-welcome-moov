// Accueil explicatif et laboratoire public (CDC 7) : présentation, espaces de test, scénarios, simulateur, journal.
import { useQ, call, api, toast, tokenFor, refresh, cloud, useCloud, tabGet, tabSet } from './platform.js';
import { Btn, AsyncBtn, Tag, Sim, Explain, Field, Modal, Empty, Icon, Avatar, AvatarStack, Say, HouseScene, CAST, Ring, Bars, lookFor, firstName, fmtDateTime, STATE_INFO, ORDER_STATES, BLOCKER_TYPES, ROLES } from './kit.jsx';
import { GLOSSARY, ZONES } from '../server/model.js';
import { inviteLink } from './admin.jsx';
import { QR } from './app.jsx';
const React = window.React;
const { useState } = React;

const TZ = 'Africa/Abidjan';
const DAY = 864e5;
const fmtTime = t => new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(t);
const fmtLongDay = t => new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' }).format(t);
const fmtWeekday = t => { const w = new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, weekday: 'short' }).format(t).replace('.', ''); return w.charAt(0).toUpperCase() + w.slice(1); };
const cap = t => t.charAt(0).toUpperCase() + t.slice(1);

// ---------------------------------------------------------------- Accueil

// Qui agit à chaque étape du parcours (d'après le scénario nominal SC-01).
const STEP_WHO = {
  DOSSIER_RECU: ['Awa Kouassi', 'Awa commande la fibre chez Moov.'],
  PAIEMENT_CONFIRME: ['Awa Kouassi', 'Awa paie avec Moov Money.'],
  PREPARATION: ['Hervé Ouattara', 'Hervé, le planificateur, vérifie l’adresse et le réseau.'],
  PRET_A_PLANIFIER: ['Awa Kouassi', 'Awa choisit son créneau dans l’application.'],
  RDV_CONFIRME: ['Hervé Ouattara', 'Hervé confirme le créneau et choisit l’équipe.'],
  INTERVENTION_EN_COURS: ['Brice Yao', 'Brice, le technicien, installe la fibre.'],
  INSTALLATION_TERMINEE: ['Brice Yao', 'Brice termine sa checklist, avec photo et code client.'],
  ACTIVATION_EN_ATTENTE: [null, 'Le système de Moov active la ligne, à distance.'],
  SERVICE_ACTIF: ['Awa Kouassi', 'Awa confirme que la connexion marche.'],
  CLOTURE: ['Salimata Diabaté', 'Salimata, la superviseure, vérifie que tout est en ordre.'],
};
const HERO_SAYS = [
  ['Awa Kouassi', 'Awa, cliente', 'Mon rendez-vous est confirmé', 'lb-b1'],
  ['Brice Yao', 'Brice, technicien', 'J’arrive vers 14 h', 'lb-b2'],
  ['Nadia Konan', 'Nadia, service client', 'Pièce reçue, le dossier repart', 'lb-b3'],
];
const REAL = [
  ['ok', Icon.check, 'Tout ce que vous touchez marche', 'Écrans, droits de chaque rôle, rendez-vous, messages, blocages, journal, calculs de l’IA.'],
  ['sim', Icon.plug, 'Les systèmes de Moov sont imités', 'Commandes, paiement Moov Money, activation, SMS et stock. Des imitateurs répondent à leur place, pannes comprises.'],
  ['warn', Icon.alert, 'À valider avec Moov', 'La précision de l’IA (apprise sur des données inventées), les délais, les règles de remboursement.'],
];

// Démo en direct (SC-17) : les cinq moments forts, du téléphone de la cliente à l'ordinateur de l'équipe Moov.
const LIVE_STEPS = [
  [['Awa Kouassi'], 'Awa paie et envoie son dossier', 'Téléphone'],
  [['Nadia Konan'], 'Nadia vérifie les photos', 'Ordinateur'],
  [['Hervé Ouattara'], 'Hervé choisit le technicien et l’heure', 'Ordinateur'],
  [['Brice Yao', 'Awa Kouassi'], 'Le technicien part, Awa suit le trajet', 'Les deux'],
  [['Awa Kouassi'], 'Awa note la visite', 'Téléphone'],
];
function LiveDemo({ go, owner, openRoom }) {
  const cs = useCloud();
  const [phone, setPhone] = useState(false);
  const base = cs.mode === 'server' && cs.status === 'on' ? cloud.roomLink() : null;
  const link = base ? base + '&vue=client#offres' : null;
  const guide = async () => { const r = await call(owner, 'demo.scenario', { code: 'SC-17' }); if (r.ok) { tabSet('fw:laboOpen', 'SC-17'); toast('Guide SC-17 prêt : suivez les étapes.'); go('labo'); } };
  return <section className="card-strong lb-live" aria-labelledby="lb-live-t">
    <div className="lb-live-head">
      <div className="stack-s">
        <span className="lb-live-kicker"><i />Démo en direct</span>
        <h2 id="lb-live-t" className="lb-live-title">Un téléphone pour la cliente, un ordinateur pour l’équipe Moov.</h2>
        <p className="small muted">Chaque action d’un côté apparaît tout de suite de l’autre, avec une notification.</p>
      </div>
      <div className="lb-live-devices" aria-hidden="true"><span className="lb-live-ph">{Icon.phone}</span><span className="lb-live-link" /><span className="lb-live-pc">{Icon.columns}</span></div>
    </div>
    <ol className="lb-live-steps">{LIVE_STEPS.map(([faces, t, where], i) => <li key={t} className="lb-live-step">
      <span className="lb-live-faces">{faces.map(n => <Avatar key={n} name={n} size={faces.length > 1 ? 40 : 48} ring />)}</span>
      <span className="lb-live-n num">{i + 1}</span>
      <b>{t}</b>
      <span className={'lb-live-where lb-live-' + (where === 'Téléphone' ? 'ph' : where === 'Ordinateur' ? 'pc' : 'both')}>{where === 'Téléphone' ? Icon.phone : where === 'Ordinateur' ? Icon.columns : Icon.users}{where}</span>
    </li>)}</ol>
    <div className="lb-live-btns">
      <Btn kind="accent" onClick={() => go('offres')}>{Icon.box}Ouvrir le site des offres</Btn>
      <Btn onClick={() => setPhone(true)}>{Icon.phone}Ouvrir sur le téléphone</Btn>
      <Btn onClick={() => openRoom && openRoom(['conseiller', 'planificateur', 'technicien'])}>{Icon.columns}Nadia, Hervé et le technicien côte à côte</Btn>
      {owner && <AsyncBtn kind="ghost" onClick={guide}>{Icon.compass}Suivre le guide pas à pas</AsyncBtn>}
    </div>
    {phone && <Modal title="Ouvrir sur le téléphone" onClose={() => setPhone(false)} actions={<Btn kind="primary" onClick={() => setPhone(false)}>Compris</Btn>}>
      {link ? <>
        <Say name="Awa Kouassi">Scannez ce carré avec l’appareil photo du téléphone : le <b>site des offres</b> s’ouvre, comme chez un vrai client.</Say>
        <div className="room-share"><QR text={link} /><div className="stack-s grow" style={{ minWidth: 0 }}><span className="tiny muted">Ou ouvrez ce lien sur le téléphone :</span><code className="room-link">{link}</code></div></div>
      </> : cs.mode === 'artifact' && cs.status === 'on' ? <>
        <Say name="Awa Kouassi">Sur le téléphone, ouvrez <b>le même lien d’aperçu</b> que sur cet ordinateur. L’espace partagé s’ouvre tout seul.</Say>
        <ol className="small stack-s lb-live-ol"><li>Sur l’accueil du téléphone, touchez <b>« Ouvrir le site des offres »</b>.</li><li>Choisissez une offre et payez (paiement simulé).</li><li>Sur l’ordinateur, ouvrez <b>« Nadia, Hervé et le technicien côte à côte »</b>.</li></ol>
        <p className="tiny muted">La personne qui tient le téléphone doit avoir accès à l’aperçu (bouton Partager de claude.ai).</p>
      </> : <>
        <Say name="Aya">Pour l’instant, cet espace reste <b>sur cet appareil</b> : un téléphone ne verrait pas les mêmes dossiers. {cs.status === 'connecting' ? 'Je me connecte au partage, réessayez dans un instant.' : 'Le partage s’active avec une connexion Internet (pastille « Partagé » en haut).'}</Say>
        <ol className="small stack-s lb-live-ol"><li>En attendant, jouez les deux côtés ici : ouvrez <b>le site des offres</b> dans un onglet…</li><li>… et <b>Nadia, Hervé et le technicien côte à côte</b> dans un autre onglet de ce navigateur.</li></ol>
      </>}
      <div><Sim what="paiement simulé : aucun argent ne circule" /></div>
    </Modal>}
  </section>;
}

export function Home({ go, startTour, hasWs, createWs, users = [], pick, owner, openRoom }) {
  const cs = useCloud();
  const [step, setStep] = useState(5);
  const playAs = c => { const u = users.find(x => x.name === c.name); if (u && pick) pick(c.space, u.id); go(c.space); };
  const st = ORDER_STATES[step], info = STATE_INFO[st], who = STEP_WHO[st];
  const people = users.length ? users.map(u => u.name) : CAST.map(c => c.name);
  const term = ([t, d]) => <div key={t} className="lb-term"><dt>{t}</dt><dd>{d}</dd></div>;
  return <div className="page lb-home">
    {hasWs && <LiveDemo go={go} owner={owner} openRoom={openRoom} />}
    <section className="lb-hero">
      <div className="card-strong lb-hero-main">
        <div className="lb-hero-text">
          <span className="lb-kicker"><i className="dot" />Moov Africa Côte d’Ivoire · démonstrateur</span>
          <h1 className="lb-h1">Après le paiement, le client sait <em>où en est</em> son installation fibre.</h1>
          <p className="lb-lede">Fini l’attente sans nouvelles. Le client, le service client, le planificateur et le technicien suivent le même dossier : chacun sait ce qui bloque et qui doit agir.</p>
          <div className="lb-cta">
            {hasWs ? <Btn kind="primary" onClick={startTour} data-tour="home-tour">{Icon.compass}Commencer la visite guidée</Btn> : <AsyncBtn kind="primary" onClick={createWs}>Créer mon espace de test</AsyncBtn>}
            <Btn onClick={() => go('salle')}>{Icon.columns}Voir trois rôles côte à côte</Btn>
          </div>
          <div className="lb-hero-foot"><AvatarStack names={people} size={34} max={5} /><span className="small muted"><b className="lb-ink">{people.length} personnages</b> à jouer, une visite de 3 min avec Aya</span></div>
        </div>
        <div className="lb-art" aria-hidden="true">
          <span className="lb-art-sun" />
          {HERO_SAYS.map(([n, who, t, c]) => <div key={n} className={'lb-bub ' + c}><Avatar name={n} size={34} /><span><b>{t}</b><span className="lb-bub-who">{who}</span></span></div>)}
          <HouseScene progress={1} height={190} />
        </div>
      </div>
      <section className="card-strong lb-real" data-tour="home-real">
        <div><h2 className="lb-h2">Ce qui est vrai, ce qui est imité</h2><p className="small muted">Pour savoir ce que vous testez vraiment.</p></div>
        {REAL.map(([tone, ic, t, d]) => <div key={t} className="lb-real-row"><span className={'lb-ico lb-ico-' + tone}>{ic}</span><div><b>{t}</b><span className="small muted">{d}</span></div></div>)}
        <div className="lb-real-foot">{Icon.lock}<span>{cs.status === 'on' ? (cs.mode === 'server' ? 'Les règles tournent dans votre navigateur ; l’espace est gardé sur le serveur de démonstration et partagé entre vos appareils : dossiers inventés, aucune donnée personnelle.' : 'Tout tourne dans votre navigateur. Dans cet aperçu en ligne, l’espace est aussi partagé entre vos appareils : dossiers inventés, aucune donnée personnelle.') : 'Tout tourne dans votre navigateur : aucune donnée personnelle.'}</span></div>
      </section>
    </section>

    <section className="lb-block">
      <div className="lb-sec-head"><div><h2 className="lb-h2">Qui utilise quoi</h2><p className="small muted">Choisissez un personnage : vous jouez son rôle, dans son espace.</p></div></div>
      <div className="lb-players">
        {CAST.map(c => <button key={c.name} type="button" className="lb-player" onClick={() => playAs(c)}>
          <span className="lb-player-art" style={{ '--lb-bg': lookFor(c.name).bg }}><Avatar name={c.name} size={118} /></span>
          <span className="lb-player-body">
            <span className="lb-player-role">{ROLES[c.role].label}</span>
            <b className="lb-player-name">{c.name}</b>
            <span className="lb-player-line">{c.line}</span>
          </span>
          <span className="arrow-btn lb-player-go" aria-hidden="true">{Icon.arrow}</span>
        </button>)}
        <button type="button" className="lb-player lb-player-lab" onClick={() => go('labo')}>
          <span className="lb-player-art lb-lab-art"><span className="lb-flask">{Icon.flask}</span></span>
          <span className="lb-player-body">
            <span className="lb-player-role">Bac à sable</span>
            <b className="lb-player-name">Laboratoire</b>
            <span className="lb-player-line">17 scénarios guidés et des pannes à provoquer</span>
          </span>
          <span className="arrow-btn lb-player-go" aria-hidden="true">{Icon.arrow}</span>
        </button>
      </div>
    </section>

    <section className="card-dark lb-journey">
      <div className="lb-sec-head">
        <div><h2 className="lb-h2">Le parcours d’un dossier, en 10 étapes</h2><p className="small muted">Touchez une étape pour voir ce que lit le client et ce que cela veut dire.</p></div>
        <span className="lb-jcount num">{step + 1}<small> / {ORDER_STATES.length}</small></span>
      </div>
      <div className="lb-track-wrap">
        <div className="lb-track">
          <span className="lb-track-line" /><span className="lb-track-fill" style={{ width: (step / (ORDER_STATES.length - 1)) * 90 + '%' }} />
          <ol>{ORDER_STATES.map((s, i) => <li key={s}><button type="button" className={'lb-jstep' + (i < step ? ' done' : i === step ? ' now' : '')} aria-pressed={i === step} onClick={() => setStep(i)} title={STATE_INFO[s].clear}>
            <span className="lb-jn">{i < step ? Icon.check : i + 1}</span><span className="lb-jl">{STATE_INFO[s].label}</span>
          </button></li>)}</ol>
        </div>
      </div>
      <div className="lb-jdetail">
        <div className="lb-jtext">
          <div className="lb-jwho">{who[0] ? <Avatar name={who[0]} size={54} /> : <span className="lb-jsys">{Icon.wifi}</span>}<div><span className="small muted">Étape {step + 1} : {info.label}</span><b>{who[1]}</b></div></div>
          <div className="lb-quote"><span className="lb-q-l">Ce que lit le client</span><p>« {info.client} »</p></div>
          <div className="lb-quote"><span className="lb-q-l">En clair</span><p>{info.clear}</p></div>
        </div>
        <div className="lb-jscene" aria-hidden="true"><HouseScene progress={step >= 8 ? 1 : step >= 5 ? 0.6 : 0.2} height={170} /></div>
      </div>
      <div className="lb-jnote">{Icon.alert}<span>À côté de ces étapes, des <b>blocages</b> peuvent apparaître : pièce manquante, client absent, activation échouée. Chacun a un responsable, une échéance et une action attendue.</span></div>
    </section>

    <section className="card-strong lb-gloss">
      <div className="lb-sec-head"><div><h2 className="lb-h2">Petit lexique</h2><p className="small muted">Les mots techniques, expliqués simplement.</p></div><span className="lb-ico lb-ico-info">{Icon.book}</span></div>
      <dl className="lb-gloss-grid">{GLOSSARY.slice(0, 6).map(term)}</dl>
      {GLOSSARY.length > 6 && <details className="lb-more"><summary>Voir les {GLOSSARY.length - 6} autres mots</summary><dl className="lb-gloss-grid">{GLOSSARY.slice(6).map(term)}</dl></details>}
    </section>
  </div>;
}

// ---------------------------------------------------------------- Laboratoire

const ROLE_FACE = { client: 'Awa Kouassi', conseiller: 'Nadia Konan', planificateur: 'Hervé Ouattara', technicien: 'Brice Yao', superviseur: 'Salimata Diabaté', admin: 'Jean-Marc N’Guessan', labo: 'Aya', auto: 'Aya' };
const ROLE_NAME = { labo: 'Vous, dans le labo', client: 'Client', conseiller: 'Conseiller', planificateur: 'Planificateur', technicien: 'Technicien', superviseur: 'Superviseur', admin: 'Administrateur', auto: 'Automatique' };
// « Client : choisir un créneau » : le rôle est déjà affiché à côté, on ne le répète pas.
const stepText = t => { const m = /^(Client|Conseiller|Planificateur|Technicien|Superviseur|Administrateur|Admin) : (.+)$/.exec(t); return m ? cap(m[2]) : t; };
const WH_LABEL = { traite: 'Traité', rejete: 'Rejeté', anomalie: 'Anomalie détectée', doublon: 'Doublon ignoré', ignore: 'Sans effet' };
const CHANNEL = { sms: 'SMS', whatsapp: 'WhatsApp', push: 'Notification' };
const EV_LABEL = {
  RDV_RESERVE: 'Rendez-vous réservé', RDV_REPLANIFIE: 'Rendez-vous replanifié', RDV_ANNULE: 'Rendez-vous annulé', CRENEAU_TENU: 'Créneau gardé',
  PIECE_DEPOSEE: 'Pièce déposée', PIECE_VALIDEE: 'Pièce validée', PIECE_REFUSEE: 'Pièce refusée', BLOCAGE_OUVERT: 'Blocage ouvert', BLOCAGE_RESOLU: 'Blocage résolu', BLOCAGE_AFFECTE: 'Blocage affecté',
  MISSION_REAFFECTEE: 'Mission réaffectée', EQUIPEMENT_ATTRIBUE: 'Équipement attribué', TECH_EN_ROUTE: 'Technicien en route', INCIDENT_TERRAIN: 'Incident terrain', COMMENTAIRE_TECHNICIEN: 'Commentaire du technicien', TECH_ARRIVE: 'Technicien arrivé', ADRESSE_PRECISEE: 'Adresse précisée',
  ACTIVATION_RELANCEE: 'Activation relancée', REMBOURSEMENT_SIMULE: 'Remboursement (simulé)', DOUBLON_RAPPROCHE: 'Doublon rapproché', DOSSIER_RATTACHE: 'Dossier rattaché', DELEGATION: 'Délégation donnée',
  DELEGATION_REVOQUEE: 'Délégation révoquée', COMMANDE_ANNULEE: 'Commande annulée', PREUVE_AJOUTEE: 'Preuve ajoutée', RECEPTION_CLIENT: 'Réception par le client', CONTROLE_CLIENT: 'Contrôle du client',
  AVIS_CLIENT: 'Avis du client', RAPPEL_FAIT: 'Rappel fait', RAPPEL_DEMANDE: 'Rappel demandé', NOTE_INTERNE: 'Note interne', MESSAGE: 'Message', ESCALADE: 'Escalade', SIGNALEMENT: 'Signalement du client',
};
const holdNote = e => (e && e.type === 'CRENEAU_TENU' && e.payload && e.payload.expiresInMin ? ' ' + e.payload.expiresInMin + ' min' : '');
const evLabel = t => (STATE_INFO[t] && STATE_INFO[t].label) || EV_LABEL[t] || (BLOCKER_TYPES[t] && BLOCKER_TYPES[t].label) || cap(String(t).toLowerCase().replace(/_/g, ' '));

export function Labo({ owner, setOwner, go, openRoom }) {
  const st = useQ(owner, 'labo.state');
  const [confirm, setConfirm] = useState(null);
  // Scénario demandé depuis l'accueil (« Suivre le guide pas à pas ») : affiché d'emblée.
  const [open, setOpen] = useState(() => { const c = tabGet('fw:laboOpen', null); if (c) tabSet('fw:laboOpen', null); return c; });
  const asked = React.useRef(open);
  React.useEffect(() => { if (asked.current) setTimeout(() => { const el = document.getElementById('lb-feat'); if (el) el.scrollIntoView({ block: 'start' }); window.scrollBy(0, -80); }, 80); }, []);
  const [orderId, setOrderId] = useState(null);
  const [roleInv, setRoleInv] = useState('U6');
  const [lastInv, setLastInv] = useState(null);
  const [newName, setNewName] = useState('Espace B');
  const [filter, setFilter] = useState('all');
  const cs = useCloud();
  if (st.error) return <div className="page"><div className="alert alert-bad">{st.error.message}</div></div>;
  const s = st.data;
  const list = api.listWorkspaces();
  const orders = s.orders;
  const sharedOn = cs.status === 'on';
  const oid = orderId && orders.some(o => o.id === orderId) ? orderId : (orders.find(o => o.scenario) || orders[0]).id;
  const sim = (cmd, args, msg) => call(owner, cmd, args).then(r => { if (r.ok && msg) toast(msg); return r; });
  const race = async run => {
    const tA = tokenFor(owner, 'U1'), tB = tokenFor(owner, 'U2');
    const args = { date: run.meta.date, slot: run.meta.slot };
    const [r1, r2] = await Promise.all([api.exec(tA, 'appt.hold', { orderId: run.orderIds[0], ...args }), api.exec(tB, 'appt.hold', { orderId: run.orderIds[1], ...args })]);
    const win = r1.ok ? [tA, run.orderIds[0], r1.data, 'Awa'] : r2.ok ? [tB, run.orderIds[1], r2.data, 'Koffi'] : null;
    if (win) await api.exec(win[0], 'appt.book', { orderId: win[1], holdId: win[2].id });
    const lose = r1.ok ? r2 : r1;
    toast((win ? win[3] + ' obtient la place. ' : '') + 'L’autre demande reçoit : « ' + (lose.ok ? 'réussite' : lose.error.message) + ' »' + (lose.error && lose.error.extra && lose.error.extra.alternatives ? ' avec ' + lose.error.extra.alternatives.length + ' alternative(s).' : ''));
    refresh();
  };
  const roomFor = sc => { const roles = [...new Set(sc.steps.map(x => x.role))].filter(r => !['labo', 'auto'].includes(r)); openRoom(roles.slice(0, 3)); };

  // Scénarios : l'un est mis en avant (celui qu'on vient d'ouvrir, sinon celui en cours).
  const scs = s.scenarios.map(sc => ({ ...sc, nDone: sc.steps.filter(x => x.done === true).length }));
  const isDone = sc => sc.active && sc.nDone === sc.steps.length;
  const running = sc => sc.active && !isDone(sc);
  // Scénario qui se vérifie à l'œil (rien à mesurer côté serveur), comme SC-16.
  const observeOnly = sc => sc.active && sc.steps.every(x => x.done === null);
  const featured = open === '' ? null : scs.find(sc => sc.code === open) || scs.find(running) || null;
  const showFeat = () => setTimeout(() => { const el = document.getElementById('lb-feat'); if (!el) return; const r = el.getBoundingClientRect(); if (r.top < 70 || r.top > window.innerHeight - 160) el.scrollIntoView({ block: 'start', behavior: 'smooth' }); }, 60);
  const launch = async sc => { const r = await sim('demo.scenario', { code: sc.code }, 'Scénario ' + sc.code + ' prêt.'); if (r.ok) { setOpen(sc.code); if (r.data.orderIds[0]) setOrderId(r.data.orderIds[0]); showFeat(); } };
  const toggle = sc => { const on = featured && featured.code === sc.code; setOpen(on ? '' : sc.code); if (!on) showFeat(); };
  const counts = { all: scs.length, run: scs.filter(running).length, ok: scs.filter(isDone).length };
  const shown = scs.filter(sc => filter === 'all' || (filter === 'run' ? running(sc) : isDone(sc)));
  const faces = sc => [...new Set(sc.steps.map(x => ROLE_FACE[x.role] || 'Aya'))];
  const refsOf = sc => (sc.run ? sc.run.orderIds.map(id => (orders.find(o => o.id === id) || {}).ref).filter(Boolean) : []);

  // Chiffres de l'espace et activité par jour (calculés sur les données réelles de l'espace).
  const nEvents = s.events.length ? s.events[0].seq : 0;
  const blocked = orders.filter(o => o.blockers.length).length;
  const today = Math.floor(s.ws.clock / DAY);
  const bars = Array.from({ length: 7 }, (_, i) => today - 6 + i).map((d, i) => ({ label: fmtWeekday(d * DAY + DAY / 2), value: s.events.filter(e => Math.floor(e.effectiveAt / DAY) === d).length, hi: i === 6 }));
  const upCount = Object.values(s.ws.integrations).filter(i => i.up).length;
  const invUser = s.users.find(u => u.id === roleInv) || s.users[0];
  const adminId = (s.users.find(u => u.role === 'admin') || {}).id;
  const sc01 = scs.find(sc => sc.code === 'SC-01');

  return <div className="page lb-labo">
    <section className="lb-top">
      <div className="card-strong lb-ws">
        <div className="lb-ws-head">
          <span className="lb-ws-icon">{Icon.flask}</span>
          <div className="grow"><span className="eyebrow">Votre laboratoire</span><h1 className="lb-ws-name">{s.ws.name}</h1></div>
        </div>
        <p className="muted">{cloud.isShared(s.ws.id) ? 'Un bac à sable partagé entre vos appareils : dossiers inventés, systèmes Moov imités.' : 'Un bac à sable privé : dossiers inventés, systèmes Moov imités. Rien ne sort de ce navigateur.'}</p>
        <div className="lb-stats">
          <div className="lb-stat"><span className="lb-stat-v num">{orders.length}</span><span className="lb-stat-l">Dossiers</span></div>
          <div className={'lb-stat' + (blocked ? ' lb-stat-bad' : '')}><span className="lb-stat-v num">{blocked}</span><span className="lb-stat-l">Bloqués</span></div>
          <div className="lb-stat"><span className="lb-stat-v num">{nEvents}</span><span className="lb-stat-l">Événements</span></div>
          <div className="lb-stat"><span className="lb-stat-v num">{scs.filter(sc => sc.active).length}<small>/{scs.length}</small></span><span className="lb-stat-l">Scénarios lancés</span></div>
        </div>
        <div className="lb-ws-foot">
          <span className="lb-chip">{Icon.clock}Expire le {fmtDateTime(s.ws.expiresAt)}</span>
          <div className="row">
            <AsyncBtn size="s" kind="ghost" onClick={() => api.renew(owner).then(() => { refresh(); toast('Espace prolongé de 24 h.'); })}>Prolonger de 24 h</AsyncBtn>
            <Btn size="s" kind="ghost" onClick={() => setConfirm('reset')}>Réinitialiser</Btn>
            <Btn size="s" kind="danger" onClick={() => setConfirm('delete')}>Supprimer</Btn>
          </div>
        </div>
      </div>
      <section className="card-strong lb-clock" data-tour="labo-clock">
        <div className="lb-sec-head"><div><h2 className="lb-h3">Horloge du scénario</h2><span className="small muted">Heure simulée à Abidjan</span></div><span className="lb-ico lb-ico-sim">{Icon.clock}</span></div>
        <div><div className="lb-time num">{fmtTime(s.ws.clock)}</div><span className="lb-date">{cap(fmtLongDay(s.ws.clock))}</span></div>
        <div className="lb-clock-btns">{[[1, '+1 heure'], [6, '+6 heures'], [24, '+1 jour'], [72, '+3 jours']].map(([h, l]) => <AsyncBtn key={h} size="s" kind="sim" onClick={() => sim('demo.clock', { hours: h })}>{l}</AsyncBtn>)}</div>
        <Explain>Le temps du scénario avance avec le vrai temps. Accélérez-le pour voir les délais, les rappels et les escalades. Les sessions, invitations et réservations temporaires gardent leur vraie durée.</Explain>
      </section>
    </section>

    <section className="lb-block" data-tour="labo-scenarios">
      <div className="lb-sc-head">
        <div><h2 className="lb-h2">Scénarios guidés</h2><p className="small muted">Lancez un scénario, agissez dans les bons espaces : les étapes se cochent toutes seules.</p></div>
        <div className="pills pills-soft" role="tablist" aria-label="Filtrer les scénarios">
          {[['all', 'Tous'], ['run', 'En cours'], ['ok', 'Réussis']].map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={filter === k} onClick={() => setFilter(k)}>{l} <span className="count">{counts[k]}</span></button>)}
        </div>
      </div>

      {featured ? <section id="lb-feat" className="card-dark lb-feat" aria-label={'Scénario ' + featured.code}>
        <div className="lb-feat-side">
          <div className="lb-feat-top">
            <span className="lb-code lb-code-dark">{featured.code}</span>
            {isDone(featured) ? <Tag tone="lime">Réussi</Tag> : observeOnly(featured) ? <Tag>À vérifier vous-même</Tag> : featured.active ? <Tag>En cours</Tag> : <Tag>Pas encore lancé</Tag>}
            <span className="grow" />
            <button type="button" className="icon-btn lb-x" onClick={() => setOpen('')} aria-label="Fermer ce scénario">{Icon.x}</button>
          </div>
          <h3 className="lb-feat-title">{featured.title}</h3>
          <p className="lb-feat-goal">{featured.goal}</p>
          <div className="lb-feat-prog">
            <Ring value={featured.nDone} max={featured.steps.length} size={88} stroke={9} color="var(--lime)" track="var(--dark-3)"><span className="lb-ring-v num">{featured.nDone}<small>/{featured.steps.length}</small></span></Ring>
            <div className="stack-s">
              <b>{!featured.active ? 'Lancez le scénario pour commencer' : isDone(featured) ? 'Toutes les étapes sont faites' : observeOnly(featured) ? 'Suivez les étapes et vérifiez vous-même le résultat' : featured.nDone + ' étape' + (featured.nDone > 1 ? 's' : '') + ' sur ' + featured.steps.length}</b>
              {refsOf(featured).length > 0 && <span className="small muted">Dossier(s) du scénario : <b className="lb-ref">{refsOf(featured).join(', ')}</b></span>}
            </div>
          </div>
          <div className="lb-feat-actions">
            {featured.active ? <Btn className="lb-lime" onClick={() => roomFor(featured)}>{Icon.columns}Ouvrir les rôles utiles côte à côte</Btn> : <AsyncBtn className="lb-lime" onClick={() => launch(featured)}>Lancer {featured.code}</AsyncBtn>}
            {featured.code === 'SC-17' && <Btn onClick={() => go('offres')}>{Icon.box}Ouvrir le site des offres</Btn>}
            {featured.code === 'SC-05' && featured.run && <AsyncBtn kind="sim" onClick={() => race(featured.run)}>Lancer les deux demandes simultanées</AsyncBtn>}
            {featured.active && <AsyncBtn onClick={() => launch(featured)}>Relancer</AsyncBtn>}
          </div>
          {featured.code === 'SC-16' && <p className="small muted">Créez un autre espace dans « Mes espaces », plus bas, puis réinitialisez celui-ci : l’autre espace garde sa génération.</p>}
          <Explain title="Comment ça marche ?">« Lancer » crée un dossier fictif préparé pour le scénario. Ensuite, c’est vous qui agissez dans les bons espaces. Chaque étape se coche <b>toute seule</b> quand le serveur constate que c’est vraiment fait : le guide ne triche pas.</Explain>
        </div>
        <ol className="lb-steps" aria-label="Étapes du scénario">{featured.steps.map((x, i) => {
          const k = x.done === true ? 'done' : x.done === null ? 'watch' : 'todo';
          return <li key={i} className={'lb-step lb-step-' + k}>
            <span className="lb-step-n">{k === 'done' ? Icon.check : i + 1}</span>
            <Avatar name={ROLE_FACE[x.role] || 'Aya'} size={38} />
            <span className="lb-step-t"><span className="lb-step-who">{ROLE_NAME[x.role] || x.role}</span><span className="lb-step-x">{stepText(x.text)}</span></span>
            <span className="lb-step-s">{k === 'done' ? 'Fait' : k === 'watch' ? 'À observer' : 'À faire'}</span>
          </li>;
        })}</ol>
      </section>
        : <section id="lb-feat" className="card-dark lb-feat lb-feat-intro">
          <Avatar name="Aya" size={68} />
          <div className="stack-s">
            <b className="lb-feat-title">Choisissez un scénario, je vous guide.</b>
            <p className="lb-feat-goal">« Lancer » prépare un dossier fictif. Vous agissez ensuite dans les bons espaces, et je coche chaque étape quand elle est vraiment faite.</p>
          </div>
          {sc01 && (sc01.active ? <Btn className="lb-lime" onClick={() => toggle(sc01)}>Reprendre SC-01</Btn> : <AsyncBtn className="lb-lime" onClick={() => launch(sc01)}>Commencer par SC-01</AsyncBtn>)}
        </section>}

      <div className="lb-sc-grid">
        {shown.map(sc => {
          const on = !!featured && featured.code === sc.code;
          const n = sc.steps.length;
          return <article key={sc.code} className={'card lb-sc' + (on ? ' is-on' : '')}>
            <div className="lb-sc-top">
              <span className="lb-code">{sc.code}</span>
              {isDone(sc) && <Tag tone="ok">Réussi</Tag>}
              <span className="grow" />
              <button type="button" className="arrow-btn" aria-expanded={on} aria-label={'Voir les étapes de ' + sc.code} onClick={() => toggle(sc)}>{Icon.arrow}</button>
            </div>
            <button type="button" className="lb-sc-title" onClick={() => toggle(sc)}>{sc.title}</button>
            <p className="lb-sc-goal">{sc.goal}</p>
            <div className="lb-sc-foot">
              {sc.active
                ? <span className="lb-sc-prog"><Ring value={sc.nDone} max={n} size={40} stroke={4.5} color={isDone(sc) ? 'var(--ok)' : 'var(--accent)'}><span className="lb-ring-s num">{sc.nDone}/{n}</span></Ring><span className="tiny muted">étapes faites</span></span>
                : <span className="lb-sc-prog"><AvatarStack names={faces(sc)} size={28} max={4} /><span className="tiny muted">{n} étapes</span></span>}
              <AsyncBtn size="s" kind={sc.active ? undefined : 'primary'} onClick={() => launch(sc)}>{sc.active ? 'Relancer' : 'Lancer'}</AsyncBtn>
            </div>
          </article>;
        })}
        {!shown.length && <div className="card-strong lb-sc-empty"><Empty>{filter === 'run' ? 'Aucun scénario en cours. Lancez-en un depuis « Tous ».' : 'Aucun scénario réussi pour l’instant.'}</Empty></div>}
      </div>
    </section>

    <section className="card-strong lb-sim" data-tour="labo-sim">
      <div className="lb-sec-head">
        <div><h2 className="lb-h2">Simulateur des systèmes Moov</h2><p className="small muted">Envoyez des événements, coupez un système, provoquez une panne : l’application doit bien réagir.</p></div>
        <Sim what="tout est imité ici" />
      </div>
      <div className="lb-sim-grid">
        <div className="lb-box">
          <div className="lb-box-h"><span className="lb-ico lb-ico-sim">{Icon.plug}</span><div><b>Envoyer un événement</b><span className="tiny muted">Comme si un système Moov l’envoyait</span></div></div>
          <Field label="Dossier ciblé" id="sim-o"><select id="sim-o" className="input" value={oid} onChange={e => setOrderId(e.target.value)}>{orders.map(o => <option key={o.id} value={o.id}>{o.ref} · {STATE_INFO[o.state].label}{o.scenario ? ' · ' + o.scenario : ''}</option>)}</select></Field>
          <div className="lb-hooks">
            <AsyncBtn size="s" kind="sim" onClick={() => sim('demo.webhook', { orderId: oid, kind: 'payment' })}>Paiement Moov Money</AsyncBtn>
            <AsyncBtn size="s" kind="sim" onClick={() => sim('demo.webhook', { orderId: oid, kind: 'payment', duplicate: true })}>Paiement ×2</AsyncBtn>
            <AsyncBtn size="s" kind="sim" onClick={() => sim('demo.webhook', { orderId: oid, kind: 'payment', amount: 20000 })}>Montant incohérent</AsyncBtn>
            <AsyncBtn size="s" kind="sim" onClick={() => sim('demo.webhook', { orderId: oid, kind: 'payment', badSig: true })}>Signature falsifiée</AsyncBtn>
            <AsyncBtn size="s" kind="sim" onClick={() => sim('demo.webhook', { orderId: oid, kind: 'old' })}>Événement ancien</AsyncBtn>
            <AsyncBtn size="s" kind="sim" onClick={() => sim('demo.webhook', { orderId: oid, kind: 'wrongEquipment' })}>Activation d’une autre box</AsyncBtn>
          </div>
          {s.lastWebhooks.length > 0 && <div className="lb-results" aria-live="polite">{s.lastWebhooks.map((w, i) => {
            const tone = w.status === 'traite' ? 'ok' : w.status === 'rejete' || w.status === 'anomalie' ? 'bad' : 'info';
            return <div key={i} className={'alert alert-' + tone + ' lb-result'} title={'Événement ' + w.eventId}><span className="lb-rdot">{tone === 'ok' ? Icon.check : tone === 'bad' ? Icon.x : Icon.clock}</span><div><b>{WH_LABEL[w.status] || w.status}</b><span className="small">{w.note}</span></div></div>;
          })}</div>}
        </div>
        <div className="lb-box">
          <div className="lb-box-h"><span className="lb-ico lb-ico-ok">{Icon.wifi}</span><div><b>Systèmes Moov</b><span className="tiny muted">{upCount} sur {Object.keys(s.ws.integrations).length} répondent</span></div></div>
          <div className="lb-switches">{Object.entries(s.ws.integrations).map(([k, i]) => <label key={k} className="switch lb-switch"><input type="checkbox" checked={i.up} onChange={e => sim('demo.integration', { provider: k, up: e.target.checked })} /><span className="lb-switch-t"><b>{i.name}</b><span className={'lb-state ' + (i.up ? 'is-up' : 'is-down')}>{i.up ? 'Répond' : 'En panne'}</span></span></label>)}</div>
        </div>
        <div className="lb-box">
          <div className="lb-box-h"><span className="lb-ico lb-ico-bad">{Icon.alert}</span><div><b>Pannes programmées</b><span className="tiny muted">Activez pour déclencher</span></div></div>
          <div className="lb-switches">{[['failNextActivation', 'La prochaine activation échoue'], ['saturation', 'Équipes saturées (hausse de charge)'], ['equipmentShortage', 'Rupture de matériel (box)']].map(([k, l]) => <label key={k} className="switch lb-switch lb-switch-bad"><input type="checkbox" checked={!!s.ws.sim[k]} onChange={e => sim('demo.flag', { key: k, value: e.target.checked })} /><span className="lb-switch-t"><b>{l}</b></span></label>)}</div>
          <div className="lb-box-h lb-box-sep"><span className="lb-ico lb-ico-info">{Icon.box}</span><div><b>Nouvelle commande</b><span className="tiny muted">Pour Awa, dans la commune choisie</span></div></div>
          <div className="lb-zones">{ZONES.map(z => <AsyncBtn key={z.id} size="s" onClick={() => sim('demo.createOrder', { zone: z.id, customerId: 'U1' }, 'Commande fictive créée pour Awa à ' + z.name + '.')}>{Icon.pin}{z.name}</AsyncBtn>)}</div>
        </div>
      </div>
    </section>

    <div className="lb-row3">
      <section className="card-strong lb-panel" data-tour="labo-invite">
        <div className="lb-sec-head"><div><h2 className="lb-h3">Inviter quelqu’un</h2><p className="small muted">Un collègue joue un rôle dans votre espace.</p></div><span className="lb-ico lb-ico-info">{Icon.users}</span></div>
        <div className="lb-inv-pick">
          {invUser && <Avatar name={invUser.name} size={42} />}
          <select className="input" aria-label="Rôle à inviter" value={roleInv} onChange={e => setRoleInv(e.target.value)}>{s.users.map(u => <option key={u.id} value={u.id}>{ROLES[u.role].label} · {u.name}</option>)}</select>
        </div>
        <AsyncBtn kind="primary" block onClick={async () => { try { setLastInv(await api.invite(owner, roleInv, 2)); refresh(); } catch (e) { toast(e.message, true); } }}>{Icon.plug}Créer le lien (2 h)</AsyncBtn>
        {lastInv && <div className="lb-link"><input className="input" readOnly value={inviteLink(s.ws.id, lastInv.token)} aria-label="Lien d’invitation" onFocus={e => e.target.select()} /><a className="btn btn-s" href={inviteLink(s.ws.id, lastInv.token)} target="_blank" rel="noopener">Ouvrir dans un nouvel onglet</a></div>}
        {s.invites.length > 0 && <div className="lb-invs">{s.invites.slice(-4).reverse().map(i => {
          const u = s.users.find(x => x.id === i.userId);
          const state = i.revoked ? ['Révoquée', 'bad'] : i.expiresReal < Date.now() ? ['Expirée', ''] : ['Active', 'ok'];
          return <div key={i.token} className="lb-inv-row">
            <Avatar name={u ? u.name : ROLES[i.role].label} size={32} />
            <span className="grow"><b className="small">{u ? firstName(u.name) : ROLES[i.role].label}</b><span className="tiny muted">{ROLES[i.role].label} · {i.uses} utilisation(s)</span></span>
            <Tag tone={state[1]}>{state[0]}</Tag>
            {!i.revoked && adminId && <AsyncBtn size="s" kind="ghost" onClick={() => call(tokenFor(owner, adminId), 'invite.revoke', { token: i.token })}>Révoquer</AsyncBtn>}
          </div>;
        })}</div>}
        {sharedOn
          ? <Explain>Le lien ouvre ce rôle dans un autre onglet de ce navigateur. <b>Sur un autre appareil</b> (votre téléphone, l’ordinateur d’un collègue), c’est plus simple : {cs.mode === 'server' ? <>touchez « Partagé » en haut et scannez le code QR (ou envoyez le lien), l’espace s’ouvre tout seul, puis choisissez le personnage.</> : <>ouvrez le même lien d’aperçu, l’espace partagé s’ouvre tout seul, puis choisissez le personnage. La personne doit avoir accès à l’aperçu (bouton Partager de claude.ai, niveau « Contributeur »).</>}</Explain>
          : <Explain>Envoyez un lien à un collègue : il joue ce rôle dans <b>votre</b> espace. Ici, tout est stocké dans ce navigateur : le lien marche dans un autre onglet de ce navigateur. Pour jouer sur plusieurs appareils, il faut une connexion Internet : l’espace est alors partagé (pastille « Partagé » en haut).</Explain>}
      </section>

      <section className="card-strong lb-panel" data-tour="labo-outbox">
        <div className="lb-sec-head"><div><h2 className="lb-h3">SMS envoyés</h2><p className="small muted">Aucun vrai SMS ne part. Les codes de rattachement arrivent ici.</p></div><Sim what="simulé" /></div>
        <div className="lb-sms">
          <div className="lb-sms-top"><span className="lb-sms-cam" /><b>Messages</b><span className="tiny muted">{s.outbox.length}</span></div>
          <div className="lb-sms-list">{s.outbox.length ? s.outbox.map(o => {
            const u = s.users.find(x => x.id === o.userId);
            return <div key={o.id} className="lb-sms-msg">
              <span className="lb-sms-meta" title={o.to}>{u && <Avatar name={u.name} size={20} />}À {u ? firstName(u.name) : o.to} · {CHANNEL[o.channel] || o.channel} · {fmtDateTime(o.at)}</span>
              <span className="lb-sms-bubble">{o.text}</span>
              <span className="lb-sms-status">{String(o.status).replace(/_/g, ' ')}</span>
            </div>;
          }) : <Empty>Rien pour l’instant. Les messages envoyés aux clients apparaîtront ici.</Empty>}</div>
        </div>
      </section>

      <section className="card-strong lb-panel" data-tour="labo-spaces">
        <div className="lb-sec-head"><div><h2 className="lb-h3">Mes espaces</h2><p className="small muted">{sharedOn ? 'L’espace marqué « Partagé » est le même sur tous vos appareils. Les autres restent dans ce navigateur.' : cs.status === 'off' || cs.status === 'local' ? 'Dans ce navigateur. Chacun est séparé des autres. Pour voir le même espace sur un téléphone et un ordinateur, il faut une connexion Internet.' : 'Dans ce navigateur. Chacun est séparé des autres.'}</p></div><span className="lb-ico">{Icon.grid}</span></div>
        <div className="lb-spaces">{list.map(w => {
          const cur = w.id === s.ws.id;
          return <div key={w.id} className={'lb-space' + (cur ? ' is-cur' : '')}>
            <span className="lb-space-dot">{(w.name || '?').charAt(0)}</span>
            <span className="grow"><b className="small">{w.name}</b><span className="tiny muted">{cloud.isShared(w.id) ? 'Partagé entre vos appareils' : 'Sur cet appareil'} · génération {w.generation}</span></span>
            {sharedOn && !cloud.isShared(w.id) && <AsyncBtn size="s" kind="ghost" onClick={async () => { try { if (!(await cloud.share(w.id))) return toast('Cet espace n’existe plus.', true); } catch (e) { return toast('Partage impossible pour le moment : ' + (e.message || 'serveur injoignable') + '.', true); } if (!cur && w.ownerToken) setOwner(w.ownerToken); toast('« ' + w.name + ' » est maintenant l’espace partagé entre vos appareils.'); }}>Partager</AsyncBtn>}
            {cur ? <Tag tone="ok">Ouvert</Tag> : w.ownerToken && <Btn size="s" onClick={() => setOwner(w.ownerToken)}>Ouvrir</Btn>}
          </div>;
        })}</div>
        <div className="lb-new"><input className="input" aria-label="Nom du nouvel espace" value={newName} onChange={e => setNewName(e.target.value)} /><AsyncBtn size="s" kind="primary" onClick={async () => { api.createWorkspace({ name: newName }); refresh(); toast('Espace « ' + newName + ' » créé. Il est totalement séparé de celui-ci.'); }}>Créer un espace</AsyncBtn></div>
        <details className="lb-more"><summary>Voir le détail</summary><p className="small muted">Graine {s.ws.seed} · génération {s.ws.generation} · créé le {fmtDateTime(s.ws.createdAt)}. Chaque espace a ses propres utilisateurs, dossiers, événements et tâches : réinitialiser l’un ne touche pas les autres.</p></details>
      </section>
    </div>

    <section className="card-dark lb-journal" data-tour="labo-journal">
      <div className="lb-sec-head"><div><h2 className="lb-h2">Journal des événements</h2><p className="small muted">Tout ce qui arrive aux dossiers, du plus récent au plus ancien. Les 80 derniers.</p></div></div>
      <div className="lb-journal-grid">
        <div className="lb-activity">
          <span className="small muted">Aujourd’hui (heure simulée)</span>
          <span className="lb-big num">{bars[6].value}</span>
          <span className="tiny muted">événements, sur {nEvents} au total</span>
          {bars.some(b => b.value > 0) && <div className="lb-bars"><Bars data={bars} height={120} color="var(--dark-3)" hiColor="var(--lime)" /></div>}
        </div>
        <div className="tbl-wrap lb-tbl"><table className="tbl"><thead><tr><th>Quand</th><th>Dossier</th><th>Événement</th><th>Acteur</th><th>Source</th></tr></thead><tbody>
          {s.events.map(e => {
            const ref = (orders.find(o => o.id === e.orderId) || {}).ref;
            const person = e.actor && e.actor !== 'Système' && e.actor !== 'Testeur';
            return <tr key={e.seq} title={'Événement n° ' + e.seq + ' · ' + e.type}>
              <td className="small num lb-nowrap">{fmtDateTime(e.effectiveAt)}</td>
              <td className="small lb-nowrap">{ref || <span className="muted">Espace</span>}</td>
              <td className="small"><b>{evLabel(e.type) + holdNote(e)}</b></td>
              <td><span className="who-cell lb-nowrap">{person ? <Avatar name={e.actor} size={26} /> : <span className="lb-sys-av">{e.actor === 'Testeur' ? Icon.user : Icon.settings}</span>}<span className="small">{e.actor === 'Testeur' ? 'Vous' : e.actor || 'Système'}</span></span></td>
              <td className="small lb-nowrap">{/simul|émulat/i.test(e.source || '') && <i className="lb-simdot" title="Système simulé" />}{e.source}</td>
            </tr>;
          })}
        </tbody></table></div>
      </div>
    </section>

    {confirm && <Modal title={confirm === 'reset' ? 'Réinitialiser cet espace ?' : 'Supprimer cet espace ?'} onClose={() => setConfirm(null)} actions={<><AsyncBtn kind="primary" onClick={async () => {
      try {
        if (confirm === 'reset') { const r = await api.resetWorkspace(owner); setOwner(r.token); toast('Espace réinitialisé. Les anciens liens ne fonctionnent plus.'); }
        else {
          const wasShared = cloud.isShared(s.ws.id);
          if (wasShared) await cloud.drop(s.ws.id);
          api.deleteWorkspace(owner);
          if (wasShared) {
            const w = api.createWorkspace({ name: 'Espace partagé' }); setOwner(w.token);
            try { await cloud.share(w.wsId); toast('Espace supprimé sur tous vos appareils. Un nouvel espace partagé le remplace.'); }
            catch { toast('Espace supprimé sur tous vos appareils. Le nouvel espace sera partagé dès que le serveur répondra.'); }
          }
          else { setOwner(null); toast('Espace supprimé.'); }
          go('accueil');
        }
      } catch (e) { toast(e.message, true); }
      setConfirm(null);
    }}>{confirm === 'reset' ? 'Réinitialiser' : 'Supprimer définitivement'}</AsyncBtn><Btn onClick={() => setConfirm(null)}>Annuler</Btn></>}>
      <p className="small">{confirm === 'reset' ? 'Les dossiers reviennent à leur état de départ (même graine). Les invitations, les sessions des autres onglets et les tâches en cours de l’ancienne génération deviennent invalides.' : (cloud.isShared(s.ws.id) ? 'Cet espace est partagé : il sera effacé sur tous vos appareils, et un nouvel espace partagé le remplacera.' : 'Toutes les données de cet espace sont effacées de ce navigateur. Les autres espaces ne sont pas touchés.')}</p>
    </Modal>}
  </div>;
}
