// Coquille de l'application : rail d'icônes, barre du haut en pilules, choix du personnage,
// salle « côte à côte », visite guidée avec Aya, invitations.
import { api, useQ, useTick, tokenFor, tabGet, tabSet, useToasts, toast, refresh, useOnline, storage, cloud, useCloud, tabLock, localImage } from './platform.js';
import { Btn, AsyncBtn, Tag, Modal, Icon, Avatar, AvatarStack, Say, PersonChip, CAST, firstName, fmtDateTime, minutes, ROLES } from './kit.jsx';
import { ClientApp } from './client.jsx';
import { FieldApp } from './field.jsx';
import { OpsConsole } from './ops.jsx';
import { AdminConsole } from './admin.jsx';
import { Home, Labo } from './labo.jsx';
import { GLOSSARY } from '../server/model.js';
import qrcode from './vendor/qrcode.js';
const React = window.React;
const { useState, useEffect, useLayoutEffect, useRef } = React;

const SPACE_ROLES = { client: ['client', 'representant'], terrain: ['technicien'], ops: ['conseiller', 'planificateur', 'superviseur'], admin: ['admin', 'auditeur'] };
// Navigation principale (pilules) ; la salle « côte à côte » est dans le rail.
const NAV = [['accueil', 'Accueil'], ['client', 'Client'], ['terrain', 'Technicien'], ['ops', 'Équipe Moov'], ['admin', 'Admin'], ['labo', 'Labo']];
const ROUTES = [...NAV, ['salle', 'Côte à côte']];
const spaceOfRole = r => Object.keys(SPACE_ROLES).find(k => SPACE_ROLES[k].includes(r));
const lsGet = (k, d) => { try { const v = window.localStorage.getItem(k); return v == null ? d : v; } catch { return d; } };
const lsSet = (k, v) => { try { window.localStorage.setItem(k, v); } catch {} };

function readHash() { try { return decodeURIComponent((location.hash || '').slice(1)); } catch { return ''; } }

export function App() {
  useTick();
  const toasts = useToasts();
  const [owner, setOwnerState] = useState(() => tabGet('fw:owner', null));
  const [guest, setGuest] = useState(() => tabGet('fw:guest', null));
  const [route, setRoute] = useState(() => { const h = readHash(); return ROUTES.some(r => r[0] === h) ? h : 'accueil'; });
  const [picks, setPicks] = useState(() => tabGet('fw:picks', {}));
  const [room, setRoom] = useState(() => tabGet('fw:room', null));
  const [tour, setTour] = useState(null);
  const [welcome, setWelcome] = useState(() => lsGet('fw:welcomed', '') !== '1');
  const [gloss, setGloss] = useState(false);
  // Le thème choisi est gardé dans ce navigateur (tous les onglets).
  const [theme, setTheme] = useState(() => { try { const t = localStorage.getItem('fw:theme'); if (t === 'dark' || t === 'light') return t; } catch {} return tabGet('fw:theme', null); });
  const [joinErr, setJoinErr] = useState(null);

  const setOwner = t => { tabSet('fw:owner', t); setOwnerState(t); tabSet('fw:tokmap', null); };
  // Partage entre appareils (aperçu en ligne ou serveur de démonstration) : démarre une fois, sans retarder l'affichage.
  const ownerRef = useRef(owner); ownerRef.current = owner;
  useEffect(() => {
    const curWs = () => { try { return api.session(ownerRef.current).wsId; } catch { return null; } };
    cloud.start({
      storage,
      adopt: id => api.adopt(id),
      currentWsId: () => { const id = curWs(); if (id) return id; const l = api.listWorkspaces(); if (l.length) return l[0].id; const w = api.createWorkspace({ name: 'Espace partagé' }); return w.wsId; },
      onOwner: tok => { if (tok && tok !== ownerRef.current) setOwner(tok); },
      onGeneration: id => { try { const tok = api.adopt(id); if (curWs() === id || !curWs()) { setOwner(tok); toast('L’espace a été réinitialisé depuis un autre appareil.'); } } catch {} },
      onDeleted: id => { try { const tok = api.ownerToken(id); if (tok) api.deleteWorkspace(tok); } catch {} refresh(); },
      changed: () => refresh(),
      markShared: id => { const tok = api.ownerToken(id); if (tok) api.markShared(tok).catch(() => {}); },
      freshWsId: () => api.createWorkspace({ name: 'Espace partagé' }).wsId,
      forget: id => api.forget(id),
      lockLocal: (id, fn) => tabLock('fw-' + id, fn),
      notify: (msg, err) => toast(msg, err),
      loadImage: (id, img) => localImage(id, img),
    });
  }, []);
  const go = r => { setRoute(r); try { history.replaceState(null, '', '#' + r); } catch {} window.scrollTo(0, 0); };

  useEffect(() => { if (theme) document.documentElement.setAttribute('data-theme', theme); else document.documentElement.removeAttribute('data-theme'); tabSet('fw:theme', theme); try { theme ? localStorage.setItem('fw:theme', theme) : localStorage.removeItem('fw:theme'); } catch {} }, [theme]);

  // Invitation : #join.<espace>.<jeton>. L'identifiant d'espace ne donne aucun droit, seul le jeton validé ouvre une session.
  useEffect(() => {
    const h = readHash();
    if (h.startsWith('join.')) {
      const [, wsId, tok] = h.split('.');
      api.join(wsId, tok).then(t => { tabSet('fw:guest', t); setGuest(t); const s = api.session(t); go(spaceOfRole(s.role)); }).catch(e => setJoinErr(e.message));
    }
    const f = () => { const x = readHash(); if (ROUTES.some(r => r[0] === x)) setRoute(x); };
    window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f);
  }, []);

  // Un espace de test existe toujours : la page s'ouvre sur un état réel, pas sur un écran vide.
  let ownerOk = null;
  try { if (owner) { api.session(owner); ownerOk = owner; } } catch {}
  useEffect(() => {
    if (ownerOk || guest) return;
    // On reprend le premier espace encore utilisable ; s'il n'y en a aucun, on en crée un neuf.
    const usable = api.listWorkspaces().filter(w => w.ownerToken).map(w => w.ownerToken).find(t => { try { api.session(t); return true; } catch { return false; } });
    if (usable) setOwner(usable);
    else { const { token } = api.createWorkspace({ name: 'Mon espace de test' }); setOwner(token); }
  }, [ownerOk, guest]);

  let guestInfo = null;
  if (guest) { try { guestInfo = api.session(guest); } catch (e) { guestInfo = { error: e.message }; } }

  // Moteur de l'espace : tâches différées, émulateur d'activation, reprises (toutes les 2 s).
  const wsId = ownerOk ? api.session(ownerOk).wsId : guestInfo && guestInfo.wsId;
  useEffect(() => { if (!wsId) return; const i = setInterval(() => api.pump(wsId).catch(() => {}), 2000); return () => clearInterval(i); }, [wsId]);

  const me = useQ(ownerOk, 'me');
  const users = (me.data && me.data.users) || [];
  const userFor = space => { const id = picks[space]; const ok = users.find(u => u.id === id && SPACE_ROLES[space].includes(u.role)); return ok ? ok.id : (users.find(u => SPACE_ROLES[space].includes(u.role)) || {}).id; };
  const pick = (space, id) => { const p = { ...picks, [space]: id }; setPicks(p); tabSet('fw:picks', p); };
  const tok = space => guestInfo && !guestInfo.error ? guest : tokenFor(ownerOk, userFor(space));
  const openRoom = roles => {
    const panes = roles.map(r => { const u = users.find(x => x.role === r); return { space: spaceOfRole(r), userId: u && u.id }; }).filter(p => p.userId);
    const r = panes.length ? panes : null; setRoom(r); tabSet('fw:room', r); go('salle');
  };
  const cloudOn = useCloud().status === 'on';
  const shellProps = { toasts, theme, setTheme, route, go, onTour: () => setTour(0), onGloss: () => setGloss(true) };

  if (guest) {
    if (guestInfo.error) return <Shell {...shellProps} guestMode><div className="page stack"><div className="alert alert-bad">{guestInfo.error}</div><div><Btn onClick={() => { tabSet('fw:guest', null); setGuest(null); go('accueil'); }}>Revenir à mon propre espace</Btn></div></div></Shell>;
    const space = spaceOfRole(guestInfo.role);
    const gu = { name: guestInfo.userName || guestInfo.name };
    return <Shell {...shellProps} guestMode sub={<><Tag tone="info">Invité · {ROLES[guestInfo.role].label}</Tag><Btn size="s" onClick={() => { tabSet('fw:guest', null); setGuest(null); }}>Quitter</Btn></>}>
      <div className="page"><SpaceView space={space} token={guest} /></div>
    </Shell>;
  }

  const ws = me.data && me.data.ws;
  const steps = TOUR;
  return <Shell {...shellProps} ws={ws}>
    {joinErr && <div className="page" style={{ paddingBottom: 0 }}><div className="alert alert-warn spread"><span><b>Ce lien d’invitation ne marche pas ici.</b> {joinErr} {cloudOn ? 'Vos appareils partagent déjà le même espace : choisissez simplement votre personnage.' : 'Une invitation ne fonctionne que dans le navigateur où l’espace de test a été créé (les données restent sur cet ordinateur). Ouvrez le lien dans un autre onglet de ce même navigateur.'}</span><Btn size="s" onClick={() => { setJoinErr(null); try { history.replaceState(null, '', location.pathname); } catch {} }}>Fermer</Btn></div></div>}
    {!ownerOk ? <div className="page"><Say>Je prépare votre espace de test…</Say></div>
      : route === 'accueil' ? <Home go={go} hasWs={!!ownerOk} startTour={() => setTour(0)} createWs={() => { const { token } = api.createWorkspace({}); setOwner(token); }} users={users} pick={pick} />
      : route === 'labo' ? <Labo owner={ownerOk} setOwner={setOwner} go={go} openRoom={openRoom} />
      : route === 'salle' ? <Room owner={ownerOk} users={users} room={room} setRoom={r => { setRoom(r); tabSet('fw:room', r); }} />
      : <div className="page">
        <SpaceHead space={route} users={users} current={userFor(route)} onPick={id => pick(route, id)} />
        <SpaceView space={route} token={tok(route)} />
      </div>}
    {welcome && ownerOk && <Modal title="Bienvenue dans Fibre Welcome" onClose={() => { lsSet('fw:welcomed', '1'); setWelcome(false); }} actions={<><Btn kind="primary" onClick={() => { lsSet('fw:welcomed', '1'); setWelcome(false); setTour(0); }}>Faire la visite (3 min)</Btn><Btn onClick={() => { lsSet('fw:welcomed', '1'); setWelcome(false); }}>Explorer seul</Btn></>}>
      <Say name="Aya" size={44}>Bonjour, je suis <b>Aya</b>, votre guide. Cette application suit une installation de fibre Moov, <b>du paiement jusqu’à la connexion qui marche</b>.</Say>
      <div className="card-soft stack-s">
        <div className="row"><AvatarStack names={CAST.map(c => c.name)} size={34} max={6} /><span className="small muted">Vous pouvez jouer chacun de ces personnages.</span></div>
      </div>
      <ul className="small stack-s" style={{ paddingLeft: 18, margin: 0 }}>
        <li>Un <b>espace de test</b> vient d’être créé pour vous, avec des dossiers inventés.{cloudOn ? ' Il est partagé entre vos appareils : touchez « Partagé » en haut pour l’ouvrir aussi sur votre téléphone et jouer deux rôles en même temps.' : ' Rien ne quitte votre navigateur.'}</li>
        <li>Les systèmes de Moov (paiement, activation, SMS) sont <b>imités</b> : c’est toujours signalé en violet <Tag tone="sim">◇ simulé</Tag>.</li>
        <li>Les petits <b>« ? En clair »</b> expliquent les mots techniques.</li>
      </ul>
    </Modal>}
    {gloss && <Modal title="Lexique" onClose={() => setGloss(false)}><dl className="gloss">{GLOSSARY.map(([t, d]) => <React.Fragment key={t}><dt>{t}</dt><dd>{d}</dd></React.Fragment>)}</dl></Modal>}
    {tour != null && <Tour step={tour} steps={steps} hold={ws && ws.holdMinutes} onStep={i => { const s = steps[i]; if (s.pick) for (const [sp, role] of Object.entries(s.pick)) { const u = users.find(x => x.role === role); if (u) pick(sp, u.id); } if (s.route && s.route !== route) go(s.route); setTour(i); }} onEnd={() => setTour(null)} />}
  </Shell>;
}

function ThemeToggle({ theme, setTheme }) {
  return <div className="theme-toggle" role="group" aria-label="Thème">
    <button type="button" aria-pressed={theme === 'light'} onClick={() => setTheme(theme === 'light' ? null : 'light')} title="Thème clair" aria-label="Thème clair">{Icon.sun}</button>
    <button type="button" aria-pressed={theme === 'dark'} onClick={() => setTheme(theme === 'dark' ? null : 'dark')} title="Thème sombre" aria-label="Thème sombre">{Icon.moon}</button>
  </div>;
}

const osDark = () => { try { return window.matchMedia('(prefers-color-scheme: dark)').matches; } catch { return false; } };
function Shell({ children, toasts, theme, setTheme, ws, route, go, onTour, onGloss, sub, guestMode }) {
  const dark = theme === 'dark' || (theme == null && osDark());
  const online = useOnline();
  return <div className="app">
    <aside className="rail" aria-label="Outils">
      <button type="button" className="rail-logo" onClick={() => !guestMode && go('accueil')} aria-label="Accueil de Fibre Welcome">{Icon.logo}</button>
      {!guestMode && <>
        <button type="button" className="rail-btn" onClick={onTour} data-tour="tour-btn" aria-label="Visite guidée">{Icon.compass}<span className="tip">Visite guidée</span></button>
        <button type="button" className="rail-btn" aria-current={route === 'salle' ? 'page' : undefined} onClick={() => go('salle')} data-tour="nav-salle" aria-label="Côte à côte : plusieurs rôles">{Icon.columns}<span className="tip">Côte à côte : plusieurs rôles</span></button>
        <button type="button" className="rail-btn" onClick={onGloss} aria-label="Lexique">{Icon.book}<span className="tip">Lexique des mots techniques</span></button>
      </>}
      <span className="rail-sp" />
      <button type="button" className="rail-btn" onClick={() => setTheme(dark ? 'light' : 'dark')} aria-label="Changer le thème">{dark ? Icon.sun : Icon.moon}<span className="tip">Thème clair ou sombre</span></button>
    </aside>
    <div className="main">
      <header className="topbar">
        <div className="topbar-in">
          <button type="button" className="brand" onClick={() => !guestMode && go('accueil')}><span className="brand-mark mobile-only">{Icon.logo}</span>Fibre Welcome</button>
          {!guestMode && <nav className="pills" aria-label="Espaces">{NAV.map(([k, l]) => <button key={k} type="button" aria-current={route === k ? 'page' : undefined} onClick={() => go(k)} data-tour={'nav-' + k}>{l}</button>)}</nav>}
          <div className="top-actions">
            {!online && <Tag tone="warn">Hors ligne</Tag>}
            {ws && <span className="clock hide-narrow num" title="Heure simulée de l’espace (Abidjan)">{Icon.clock && <span style={{ verticalAlign: '-3px', display: 'inline-block', width: 15, height: 15, marginRight: 5 }}>{Icon.clock}</span>}{fmtDateTime(ws.clock)}{ws.degraded ? ' · mode dégradé' : ''}</span>}
            <span className="env hide-narrow" title="Démonstration : données inventées, systèmes Moov simulés">◇ Démo</span>
            {ws && <SyncPill wsId={ws.id} />}
            {sub}
            {!guestMode && <>
              <button type="button" className="icon-btn mobile-only" onClick={onTour} aria-label="Visite guidée">{Icon.compass}</button>
              <button type="button" className="icon-btn mobile-only" onClick={() => go('salle')} aria-label="Côte à côte">{Icon.columns}</button>
              <button type="button" className="icon-btn mobile-only" onClick={onGloss} aria-label="Lexique">{Icon.book}</button>
            </>}
            <span className="hide-narrow"><ThemeToggle theme={theme} setTheme={setTheme} /></span>
            <button type="button" className="icon-btn mobile-only" onClick={() => setTheme(dark ? 'light' : 'dark')} aria-label="Changer le thème">{dark ? Icon.sun : Icon.moon}</button>
          </div>
        </div>
      </header>
      <main>{children}</main>
    </div>
    <div className="toasts" aria-live="polite">{toasts.map(t => <div key={t.id} className={'toast' + (t.err ? ' err' : '')}>{t.msg}</div>)}</div>
  </div>;
}

// Indicateur du partage entre appareils (aperçu en ligne ou serveur de démonstration).
export function SyncPill({ wsId }) {
  const c = useCloud();
  const [info, setInfo] = useState(false);
  if (c.status === 'off') return null;
  const shared = c.status === 'on' && c.wsId === wsId;
  // Ce qui retient un envoi : réseau coupé, refus du serveur, espace trop gros, écritures croisées.
  const held = { offline: ['busy', 'En attente du réseau'], refused: ['bad', 'Envoi refusé'], big: ['bad', 'Partage en panne'], busy: ['busy', 'Envoi en attente'] };
  const [cls, label] = c.status === 'connecting' ? ['busy', 'Connexion…'] : !shared ? ['', 'Cet appareil seulement'] : c.pending ? ['busy', 'Envoi…'] : c.message ? held[c.msgKind] || held.offline : ['on', 'Partagé'];
  return <>
    <button type="button" className={'sync-pill ' + cls} onClick={() => setInfo(true)} title="Partage entre vos appareils" data-tour="sync-pill"><i aria-hidden="true" /><span className="hide-narrow">{label}</span><span className="mobile-only sr-only">{label}</span></button>
    {info && <Modal portal title="Partage entre vos appareils" onClose={() => setInfo(false)} actions={<Btn kind="primary" onClick={() => setInfo(false)}>Compris</Btn>}>
      {shared && c.message && <p className="small" style={{ color: held[c.msgKind] && held[c.msgKind][0] === 'bad' ? 'var(--bad)' : undefined }}>{c.message}</p>}
      {c.mode === 'server' ? <RoomShare c={c} shared={shared} /> : <>
        <Say>{shared ? <>Cet espace est <b>partagé</b>. Ouvrez ce même lien d’aperçu sur votre téléphone et sur votre ordinateur : les deux voient les mêmes dossiers, les mêmes messages et les mêmes pièces.</> : c.status === 'connecting' ? 'Je me connecte au partage…' : c.message || <>Cet espace reste <b>sur cet appareil</b>. L’espace partagé se choisit dans le Labo, rubrique « Mes espaces ».</>}</Say>
        {shared && <TryIt />}
        {shared && <p className="tiny muted">Une action prend une à deux secondes de plus, le temps de prévenir les autres appareils. Tous ceux qui ont accès à ce lien voient cet espace : n’y mettez pas de vraies données personnelles.</p>}
      </>}
      {c.lastSync > 0 && <p className="tiny muted">Dernier échange : {fmtDateTime(c.lastSync)}.</p>}
    </Modal>}
  </>;
}
const TryIt = () => <ol className="small stack-s" style={{ paddingLeft: 18, margin: 0 }}>
  <li>Sur le téléphone : ouvrez <b>Client</b> et choisissez Awa.</li>
  <li>Sur l’ordinateur : ouvrez <b>Équipe Moov</b> et choisissez Nadia (conseillère).</li>
  <li>Envoyez une pièce depuis le téléphone : elle apparaît chez Nadia en quelques secondes.</li>
</ol>;

// Serveur de démonstration : la salle, son code QR, son lien, et rejoindre une autre salle.
// Le code de 8 caractères est affiché en deux groupes de 4, plus faciles à lire et à dicter.
const roomLabel = r => (r ? r.slice(0, 4) + ' ' + r.slice(4) : '');
function RoomShare({ c, shared }) {
  const link = cloud.roomLink();
  const [code, setCode] = useState('');
  const [err, setErr] = useState(null);
  const copy = () => { try { navigator.clipboard.writeText(link).then(() => toast('Lien copié.'), () => toast('Sélectionnez le lien et copiez-le.', true)); } catch { toast('Sélectionnez le lien et copiez-le.', true); } };
  return <>
    <Say>{shared ? <>Cet espace est <b>partagé</b>. Son code est <b className="room-code">{roomLabel(c.room)}</b>. Pour l’ouvrir sur votre téléphone, <b>scannez ce carré</b> avec l’appareil photo.</> : c.status === 'connecting' ? 'Je me connecte au serveur…' : c.message || 'Cet espace reste sur cet appareil.'}</Say>
    {shared && link && <div className="room-share">
      <QR text={link} />
      <div className="stack-s grow" style={{ minWidth: 0 }}>
        <span className="tiny muted">Ou ouvrez ce lien :</span>
        <code className="room-link">{link}</code>
        <div><Btn size="s" onClick={copy}>Copier le lien</Btn></div>
      </div>
    </div>}
    {shared && <TryIt />}
    <details className="room-join-d" open={!shared || undefined}><summary className="small"><b>Vous avez un code ?</b> Rejoindre un autre espace</summary>
    <form className="room-join" onSubmit={async e => { e.preventDefault(); setErr(null); const r = await cloud.joinRoom(code); if (r.ok) { setCode(''); toast('Vous avez rejoint l’espace ' + roomLabel(cloud.state.room) + '.'); } else setErr(r.message); }}>
      <label className="small sr-only" htmlFor="room-code">Code de l’espace à rejoindre</label>
      <div className="row" style={{ flexWrap: 'nowrap' }}><input id="room-code" className="input" value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="Ex. K7MP 2QXR" maxLength={9} autoComplete="off" autoCapitalize="characters" /><Btn size="s" type="submit" disabled={!code.trim()}>Rejoindre</Btn></div>
      {err && <span className="small" style={{ color: 'var(--bad)' }}>{err}</span>}
    </form></details>
    <p className="tiny muted">Les données sont gardées sur le serveur de démonstration de Fibre Welcome. Toute personne qui a ce code voit cet espace : n’y mettez pas de vraies données personnelles. Un espace sans activité pendant 14 jours est effacé.</p>
  </>;
}
function QR({ text, size = 168 }) {
  const q = React.useMemo(() => {
    try { const qr = qrcode(0, 'M'); qr.addData(text); qr.make(); const n = qr.getModuleCount(); let d = ''; for (let r = 0; r < n; r++) for (let x = 0; x < n; x++) if (qr.isDark(r, x)) d += 'M' + x + ' ' + r + 'h1v1h-1z'; return { n, d }; } catch { return null; }
  }, [text]);
  if (!q) return null;
  return <svg className="room-qr" width={size} height={size} viewBox={'-2 -2 ' + (q.n + 4) + ' ' + (q.n + 4)} role="img" aria-label="Code QR du lien de partage" shapeRendering="crispEdges"><rect x="-2" y="-2" width={q.n + 4} height={q.n + 4} fill="#fff" /><path d={q.d} fill="#15161a" /></svg>;
}

const SPACE_INFO = {
  client: ['Espace client', 'L’application du client sur son téléphone : où en est son installation et quoi faire ensuite.'],
  terrain: ['Espace technicien', 'L’application du technicien. Elle marche aussi sans réseau.'],
  ops: ['Équipe Moov', 'Pour le service client, la planification et la supervision.'],
  admin: ['Administration', 'Comptes, réglages, systèmes connectés, journal et sauvegardes.'],
};
function SpaceHead({ space, users, current, onPick }) {
  const opts = users.filter(u => SPACE_ROLES[space].includes(u.role));
  const cur = opts.find(u => u.id === current) || opts[0] || {};
  return <div className="page-head">
    <div className="stack-s"><h1>{SPACE_INFO[space][0]}</h1><span className="lead">{SPACE_INFO[space][1]}</span></div>
    <div className="stack-s" data-tour="space-user" style={{ alignItems: 'flex-start' }}>
      <span className="eyebrow">Vous jouez</span>
      <div className="persona-list" role="group" aria-label="Choisir le personnage">
        {opts.map(u => <button key={u.id} type="button" className="persona-chip" data-user={u.id} aria-pressed={u.id === cur.id} onClick={() => onPick(u.id)} title={ROLES[u.role].clear}>
          <Avatar name={u.name} size={30} />{firstName(u.name)}<small>{ROLES[u.role].label}</small>
        </button>)}
      </div>
      {cur.role && <span className="tiny muted">{ROLES[cur.role].clear}</span>}
    </div>
  </div>;
}

function SpaceView({ space, token }) {
  if (!token) return <div className="alert">Session indisponible.</div>;
  if (space === 'client') return <ClientApp token={token} />;
  if (space === 'terrain') return <FieldApp token={token} />;
  if (space === 'ops') return <OpsConsole token={token} />;
  return <AdminConsole token={token} />;
}

function Room({ owner, users, room, setRoom }) {
  const def = [{ space: 'client', userId: 'U1' }, { space: 'ops', userId: (users.find(u => u.role === 'planificateur') || {}).id }, { space: 'terrain', userId: (users.find(u => u.role === 'technicien') || {}).id }];
  const panes = room && room.length ? room : def;
  const setPane = (i, p) => { const n = [...panes]; n[i] = p; setRoom(n); };
  return <div className="page stack">
    <div className="page-head"><div className="stack-s"><h1>Côte à côte</h1><span className="lead">Plusieurs personnes, un seul dossier. Agissez dans un volet : les autres se mettent à jour tout de suite.</span></div>
      <div className="row">{panes.length < 4 && <Btn size="s" onClick={() => setRoom([...panes, { space: 'ops', userId: (users.find(u => u.role === 'conseiller') || {}).id }])}>+ Ajouter un volet</Btn>}<Btn size="s" kind="ghost" onClick={() => setRoom(null)}>Disposition par défaut</Btn></div></div>
    <div className="room" data-tour="room">{panes.map((p, i) => {
      const t = tokenFor(owner, p.userId);
      const u = users.find(x => x.id === p.userId) || {};
      return <div key={i} className="pane">
        <div className="pane-head">
          {u.name && <Avatar name={u.name} size={34} />}
          <select className="input" style={{ width: 'auto', flex: 1, background: 'var(--surface-2)' }} aria-label={'Personnage du volet ' + (i + 1)} value={p.userId} onChange={e => { const x = users.find(y => y.id === e.target.value); setPane(i, { space: spaceOfRole(x.role), userId: x.id }); }}>
            {users.map(x => <option key={x.id} value={x.id}>{x.name} · {ROLES[x.role].label}</option>)}
          </select>
          {panes.length > 1 && <button type="button" className="icon-btn" aria-label="Fermer ce volet" onClick={() => setRoom(panes.filter((_, k) => k !== i))}>{Icon.x}</button>}
        </div>
        <div className="pane-body cq"><SpaceView space={p.space} token={t} /></div>
      </div>;
    })}</div>
  </div>;
}

// ---------- Visite guidée (Aya présente l'application) ----------
const TOUR = [
  { route: 'accueil', sel: 'home-real', title: 'Ce qui est vrai, ce qui est imité', text: 'Tout ce que vous touchez marche vraiment : écrans, droits, rendez-vous, messages, calculs. Seuls les systèmes de Moov sont imités, et c’est toujours marqué en violet.' },
  { route: 'client', sel: 'client-state', click: 'client-tab-home', pick: { client: 'client' }, title: 'Awa voit où en est son dossier', text: 'Dès l’ouverture, Awa voit son étape, sa progression et la dernière mise à jour. Le « ? En clair » explique chaque étape avec des mots simples.' },
  { route: 'client', sel: 'client-next', click: 'client-tab-home', title: 'Et ce qu’elle doit faire', text: 'La prochaine action est toujours mise en avant. Quand Awa n’a rien à faire, l’application le lui dit aussi.' },
  { route: 'client', sel: 'client-estimate', click: 'client-tab-home', title: 'Une estimation honnête', text: 'Le délai restant est une fourchette avec un niveau de confiance. Ce n’est jamais présenté comme un rendez-vous confirmé.' },
  { route: 'client', sel: 'client-tab-rdv', title: 'Prendre rendez-vous', text: h => 'Ici, Awa choisit un créneau. Il lui est gardé ' + minutes(h) + ' pendant qu’elle confirme : deux personnes ne peuvent pas prendre la dernière place.' },
  { route: 'client', sel: 'client-tab-msg', title: 'Poser une question', text: 'L’assistant répond à partir du dossier et des procédures Moov, en citant ses sources. S’il ne sait pas, il passe la main à un conseiller.' },
  { route: 'ops', sel: 'ops-queues-panel', click: 'ops-queues', pick: { ops: 'conseiller' }, title: 'Côté Moov : Nadia débloque les dossiers', text: 'La conseillère voit les dossiers bloqués, en retard ou oubliés, triés par priorité. Chaque priorité est expliquée en toutes lettres.' },
  { route: 'ops', sel: 'ops-planning-panel', click: 'ops-planning', pick: { ops: 'planificateur' }, title: 'Hervé organise les équipes', text: 'Le planificateur voit la charge de chaque équipe, confirme les rendez-vous et réaffecte une mission si un technicien est absent.' },
  { route: 'terrain', sel: 'field-network', title: 'Brice, même sans réseau', text: 'Ce bouton coupe le réseau de cet onglet. Les actions de Brice restent sur son téléphone et partent une seule fois au retour du réseau.' },
  { route: 'admin', sel: 'admin-audit-panel', click: 'admin-audit', pick: { admin: 'admin' }, title: 'Tout est tracé', text: 'Le journal garde chaque action, chaque accès refusé et chaque décision de l’IA. L’auditrice peut le lire sans rien modifier.' },
  { route: 'salle', sel: 'room', title: 'Plusieurs rôles à la fois', text: 'Ici, la cliente, le planificateur et le technicien sont côte à côte. Agissez dans un volet : les autres se mettent à jour.' },
  { route: 'labo', sel: 'labo-scenarios', title: 'À vous de jouer', text: 'Lancez « SC-01 Installation nominale » : le guide vous dit quoi faire et coche chaque étape quand elle est vraiment faite. Il y a 16 scénarios.' },
  { route: 'labo', sel: 'labo-sim', title: 'Provoquer des pannes', text: 'Le simulateur envoie des paiements, les double, coupe un système Moov ou fait échouer une activation, pour voir comment l’application réagit.' },
];

function Tour({ step, steps, onStep, onEnd, hold }) {
  const s = steps[step];
  const [rect, setRect] = useState(null);
  useEffect(() => { onStep(step); }, []);
  useLayoutEffect(() => {
    let alive = true;
    let clicked = false;
    const find = (n = 0) => {
      if (!alive) return;
      // Certaines étapes ouvrent d'abord le bon onglet (ex. le journal d'audit) avant de le montrer.
      if (s.click && !clicked) { const b = document.querySelector('[data-tour="' + s.click + '"]'); if (b) { clicked = true; if (b.getAttribute('aria-selected') !== 'true' && b.getAttribute('aria-current') !== 'page') b.click(); setTimeout(() => find(n + 1), 120); return; } }
      const el = document.querySelector('[data-tour="' + s.sel + '"]');
      if (!el) { if (n < 10) setTimeout(() => find(n + 1), 80); else setRect(null); return; }
      // Sur téléphone, la bulle de la visite est posée en bas : la cible est remontée en haut de l'écran.
      // Une cible très haute est montrée par son début, sous la barre du haut.
      if (window.innerWidth < 600) { el.scrollIntoView({ block: 'start', behavior: 'auto' }); window.scrollBy(0, -110); }
      else if (el.getBoundingClientRect().height > window.innerHeight * 0.7) { el.scrollIntoView({ block: 'start', behavior: 'auto' }); window.scrollBy(0, -84); }
      else el.scrollIntoView({ block: 'center', behavior: 'auto' });
      setTimeout(() => { if (alive) { const r = el.getBoundingClientRect(); setRect({ top: r.top, left: r.left, width: r.width, height: Math.min(r.height, window.innerHeight - 40) }); } }, 60);
    };
    setRect(null); setTimeout(() => find(), 60);
    const re = () => { const el = document.querySelector('[data-tour="' + s.sel + '"]'); if (el) { const r = el.getBoundingClientRect(); setRect({ top: r.top, left: r.left, width: r.width, height: Math.min(r.height, window.innerHeight - 40) }); } };
    window.addEventListener('resize', re); window.addEventListener('scroll', re, true);
    return () => { alive = false; window.removeEventListener('resize', re); window.removeEventListener('scroll', re, true); };
  }, [step]);
  useEffect(() => { const k = e => { if (e.key === 'Escape') onEnd(); if (e.key === 'ArrowRight' && step < steps.length - 1) onStep(step + 1); if (e.key === 'ArrowLeft' && step > 0) onStep(step - 1); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [step]);
  const cardRef = React.useRef(null);
  const [cardH, setCardH] = useState(260);
  useLayoutEffect(() => { if (cardRef.current) { const h = cardRef.current.offsetHeight; if (Math.abs(h - cardH) > 4) setCardH(h); } });
  const W = Math.min(390, window.innerWidth - 32);
  let pos = { left: 16, bottom: 16 };
  // Sur téléphone, si la cible est en bas de l'écran (barre d'onglets), la bulle passe en haut.
  if (rect && window.innerWidth < 600 && rect.top + rect.height > window.innerHeight - cardH - 24 && rect.top > cardH + 24) pos = { left: 16, top: 16 };
  if (rect && window.innerWidth >= 600) {
    const below = rect.top + rect.height + 14;
    const left = Math.max(16, Math.min(rect.left, window.innerWidth - W - 16));
    pos = below + cardH + 16 < window.innerHeight ? { top: below, left } : rect.top - cardH - 14 > 16 ? { top: rect.top - cardH - 14, left } : { bottom: 16, left: window.innerWidth - W - 16 };
  }
  return <>
    {rect && <div className="tour-ring" style={{ top: rect.top - 6, left: rect.left - 6, width: rect.width + 12, height: rect.height + 12 }} />}
    {!rect && <div className="backdrop" style={{ background: 'rgba(12,13,16,.45)' }} onClick={onEnd} />}
    <div className="tour-card" ref={cardRef} style={pos} role="dialog" aria-label="Visite guidée">
      <div className="spread" style={{ flexWrap: 'nowrap' }}>
        <div className="row" style={{ flexWrap: 'nowrap' }}><Avatar name="Aya" size={40} /><div className="stack-s" style={{ gap: 0 }}><b style={{ fontSize: 15 }}>Aya, votre guide</b><span className="tiny muted">Étape {step + 1} sur {steps.length}</span></div></div>
        <button type="button" className="icon-btn" onClick={onEnd} aria-label="Fermer la visite">{Icon.x}</button>
      </div>
      <b style={{ fontSize: 17 }}>{s.title}</b>
      <p className="small muted">{typeof s.text === 'function' ? s.text(hold) : s.text}</p>
      <div className="spread">
        <div className="tour-dots" aria-hidden="true">{steps.map((_, i) => <i key={i} className={i === step ? 'on' : ''} />)}</div>
        <div className="row">{step > 0 && <Btn size="s" onClick={() => onStep(step - 1)}>Précédent</Btn>}{step < steps.length - 1 ? <Btn size="s" kind="primary" onClick={() => onStep(step + 1)}>Suivant</Btn> : <Btn size="s" kind="primary" onClick={onEnd}>Terminer</Btn>}</div>
      </div>
    </div>
  </>;
}
