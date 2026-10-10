// Espace client (CDC 4, CL-01 à CL-20) : une application mobile dans un cadre de téléphone.
// Mise en page : une carte par idée, un seul bouton principal par écran, le détail derrière « Voir plus ».
import { api, useQ, call, toast, prepareImage, putImage, useOnline, setOnline, netSince, tabGet, tabSet, liveClock, useNow, photoIssues, useImage } from './platform.js';
import { Btn, AsyncBtn, Tag, Sim, Explain, Field, Modal, StateTag, Empty, Stale, Icon, Picture, Avatar, AvatarStack, Ring, HouseScene, VanScene, NotifPopups, TrackMap, trackInfo, hourLabel, firstName, fmtDate, fmtDateTime, fmtAgo, fmtDur, slotLabel, minutes, money, STATE_INFO, ORDER_STATES, APPT_STATES, ROLES } from './kit.jsx';
import { PEOPLE } from './people.jsx';
import { TrackCard } from './trackcard.jsx';
import { DOC_TYPES, PREP_CHECKLIST, REPORT_TYPES, PAYMENT_STATES, DOSSIER_DOCS } from '../server/model.js';
const React = window.React;
const { useState, useEffect, useRef } = React;

// ---------- Petits utilitaires d'affichage ----------
const frDur = h => fmtDur(h).replace('.', ',');
// « 1,5 à 5,5 j » plutôt que « 1.5 j à 5.5 j »
const frRange = (lo, hi) => { const a = frDur(lo), b = frDur(hi); return a.slice(-2) === b.slice(-2) ? a.slice(0, -2) + ' à ' + b : a + ' à ' + b; };
const DP = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Africa/Abidjan', weekday: 'short', day: 'numeric', month: 'short' });
const dparts = t => { const p = {}; for (const x of DP.formatToParts(t)) p[x.type] = x.value; return { wd: String(p.weekday || '').replace('.', ''), d: p.day, m: String(p.month || '').replace('.', '') }; };
// « jeudi 9 oct. », « 9 h 04 » (heure d'Abidjan)
const DL = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Africa/Abidjan', weekday: 'long', day: 'numeric', month: 'short' });
const longDay = t => DL.format(t);
const pad2 = n => String(n).padStart(2, '0');
// « jeudi 9 oct. à 9 h avec Brice » une fois l'heure fixée par le planificateur.
const apptWhen = (appt, mission) => longDay(appt.date) + (appt.time ? ' à ' + hourLabel(appt.time) : ', ' + slotLabel(appt.slot)) + (mission && mission.techName && mission.techName !== '—' ? ' avec ' + firstName(mission.techName) : '');
const callDur = c => { const s = Math.max(0, Math.round(((c.endedAt || 0) - (c.answeredAt || 0)) / 1000)); return s >= 60 ? Math.floor(s / 60) + ' min ' + pad2(s % 60) + ' s' : s + ' s'; };
const andList = a => a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' et ' + a.at(-1);
// Le serveur abrège le nom du technicien (« Brice Y. ») : on retrouve son personnage pour l'avatar.
const fullName = n => { if (!n || PEOPLE[n]) return n; const [f, ...r] = String(n).split(' '); const ini = (r[0] || '')[0]; return Object.keys(PEOPLE).find(k => k.split(' ')[0] === f && (!ini || (k.split(' ')[1] || '')[0] === ini)) || n; };
// Visage de l'équipe Moov selon le rôle qui doit agir (personnages de la démo).
const ROLE_FACE = { Conseiller: 'Nadia Konan', Planificateur: 'Hervé Ouattara', Superviseur: 'Salimata Diabaté' };
const ownerFace = owner => { const m = /\((.+)\)/.exec(owner || ''); return (m && ROLE_FACE[m[1]]) || 'Nadia Konan'; };
const S = d => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>;
const I2 = {
  wallet: S(<><rect x="3" y="6" width="18" height="13" rx="3" /><path d="M3 10h18M16.5 14.5h1.5" /></>),
  star: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.2l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 17l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8z" fill="currentColor" /></svg>,
  send: S(<><path d="M5 12h13M12.5 6l6 6-6 6" /></>),
  chev: S(<path d="M9 6l6 6-6 6" />),
};
const TABS = [['home', 'Accueil', Icon.home], ['rdv', 'Rendez-vous', Icon.cal], ['msg', 'Messages', Icon.chat], ['file', 'Dossier', Icon.doc], ['me', 'Profil', Icon.user]];

export function ClientApp({ token, compact }) {
  const me = useQ(token, 'me');
  const orders = useQ(token, 'client.orders');
  const [tab, setTab] = useState('home');
  const [orderId, setOrderIdRaw] = useState(null);
  // Le dossier choisi est gardé dans l'onglet : un rechargement du téléphone revient sur le même dossier.
  const setOrderId = id => { setOrderIdRaw(id); const m = tabGet('fw:clientOrder', {}); m[token] = id; tabSet('fw:clientOrder', m); };
  const [sub, setSub] = useState(null); // rubrique à ouvrir dans l'onglet Dossier (pièces, adresse)
  const [msgMode, setMsgMode] = useState('ai'); // onglet de Messages (assistant, conseiller, appeler)
  const online = useOnline(token);
  const phoneRef = useRef(null);
  const bodyRef = useRef(null);
  const firstTab = useRef(true);
  // Au changement d'onglet : on remonte en haut de l'écran du téléphone.
  useEffect(() => {
    if (firstTab.current) { firstTab.current = false; return; }
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
    const el = phoneRef.current;
    if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ block: 'start' });
  }, [tab]);
  // Dossier à montrer en premier (par exemple juste après un achat sur le site des offres), puis on l'oublie.
  const listIds = (orders.data || []).map(o => o.id).join(',');
  const focus = tabGet('fw:focusOrder', null);
  const focusOk = !!focus && (orders.data || []).some(o => o.id === focus);
  useEffect(() => { if (focusOk) { setOrderId(focus); setTab('home'); tabSet('fw:focusOrder', null); } }, [token, listIds, focusOk]);
  if (me.error) return <div className="alert alert-bad">{me.error.message}</div>;
  const user = me.data.user;
  const list = orders.data || [];
  const has = id => !!id && list.some(o => o.id === id);
  const saved = tabGet('fw:clientOrder', {})[token];
  // Sans choix : le dossier le plus récemment mis à jour (celui de la démo en cours), pas le plus ancien.
  const recent = list.filter(o => !o.cancelled).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0] || list[0] || {};
  const oid = focusOk ? focus : has(orderId) ? orderId : has(saved) ? saved : recent.id;
  const isRep = user.role === 'representant';
  const scopes = isRep ? ((list.find(o => o.id === oid) || {}).scopes || []) : ['rdv', 'messages'];
  const go = (k, s) => { setSub(s || null); setTab(k); };
  // Toucher une bannière ou une notification : on ouvre le bon dossier, au bon endroit.
  const openNotif = n => {
    const target = has(n.orderId) ? n.orderId : oid;
    if (target !== oid) setOrderId(target);
    // Technicien en route ou arrivé : la carte du trajet est sur l'accueil.
    let moving = false; try { const x = api.q(token, 'client.order', { orderId: target }); moving = !!x.mission && ['en_route', 'sur_place'].includes(x.mission.status); } catch {}
    // « Installation terminée : vérifiez et validez » : on ouvre directement la carte de vérification (en haut de l'accueil).
    if (/vérifiez et validez/i.test(n.title || '')) { go('home'); setTimeout(() => { const el = document.getElementById('cl-signoff'); if (el) { el.scrollIntoView({ block: 'start', behavior: 'smooth' }); try { el.focus({ preventScroll: true }); } catch {} } }, 120); }
    else if (n.kind === 'rdv' && !moving) go('rdv');
    else if (n.kind === 'message') { setMsgMode('human'); go('msg'); }
    else if (n.kind === 'appel') { setMsgMode('cb'); go('msg'); }
    else go('home');
  };
  const noRight = what => <div className="card cl-empty"><Empty who={user.name}>Votre délégation ne comprend pas {what}. Demandez à la cliente de l’ajouter.</Empty></div>;
  return <div className="cl-stage">
    <div className="phone cl-phone" data-tour="client-phone" ref={phoneRef}>
      <div className="phone-top cl-top">
        <div className="cl-hello">
          <Avatar name={user.name} size={42} />
          <div className="cl-hello-t"><span>{isRep ? 'Représentant' : 'Moov Fibre'}</span><b>Bonjour {firstName(user.name)}</b></div>
        </div>
        <div className="cl-top-act">
          {!online && <Tag tone="warn">Hors ligne</Tag>}
          <button type="button" className="icon-btn" onClick={() => setTab('notif')} aria-pressed={tab === 'notif'} aria-label={'Notifications' + (me.data.unread ? ' (' + me.data.unread + ' non lues)' : '')}>{Icon.bell}{me.data.unread > 0 && <span className="badge">{me.data.unread}</span>}</button>
        </div>
      </div>
      {list.length > 1 && <div className="cl-pick-wrap">
        <select className="input cl-pick" aria-label="Choisir le dossier" value={oid || ''} onChange={e => setOrderId(e.target.value)}>
          {list.map(o => <option key={o.id} value={o.id}>{o.ref} · {o.address.commune} · {DZ_LABEL[o.dossier] || STATE_INFO[o.state].label}</option>)}
        </select>
      </div>}
      <div className="phone-body cl-body" ref={bodyRef}>
        {!online && <div className="alert alert-warn small cl-offline"><span>Pas de connexion : vous voyez les dernières informations reçues ({fmtAgo(Date.now() - netSince(token))}). Les actions sont désactivées.</span><Btn size="s" onClick={() => setOnline(true, token)}>Reconnecter</Btn></div>}
        {tab === 'notif' ? <Notifications key={token} token={token} me={me.data} onBack={() => setTab('home')} onOpen={openNotif} />
          : !oid ? (isRep ? <div className="card cl-empty"><Empty who={user.name}>Aucun dossier ne vous est confié en ce moment. La cliente a peut-être retiré votre accès : demandez-lui de vous l’accorder à nouveau.</Empty></div> : <Claim key={token} token={token} me={me.data} onDone={id => { setOrderId(id); setTab('home'); }} />)
          : tab === 'home' ? <Home key={token + oid} token={token} orderId={oid} go={go} me={me.data} isRep={isRep} />
          : tab === 'rdv' ? (scopes.includes('rdv') ? <Appointments key={token + oid} token={token} orderId={oid} go={go} /> : noRight('les rendez-vous'))
          : tab === 'msg' ? (scopes.includes('messages') ? <Messages key={token + oid} token={token} orderId={oid} go={go} me={me.data} mode={msgMode} setMode={setMsgMode} /> : noRight('les messages'))
          : tab === 'file' ? <FileTab key={token + oid} token={token} orderId={oid} isRep={isRep} initial={sub} />
          : <Profile key={token + oid} token={token} orderId={oid} me={me.data} isRep={isRep} go={go} onClaimed={id => { setOrderId(id); setTab('home'); }} />}
      </div>
      <nav className="phone-tabs" aria-label="Navigation client">
        {TABS.map(([k, l, ic]) => <button type="button" key={k} aria-current={tab === k ? 'page' : undefined} onClick={() => go(k)} data-tour={'client-tab-' + k}>{ic}{l}</button>)}
      </nav>
      {oid && scopes.includes('messages') && <CallLayer key={token + oid} token={token} orderId={oid} me={me.data} />}
      <NotifPopups key={token} token={token} variant="phone" max={1} onOpen={openNotif} />
    </div>
    <Side tab={!oid && tab !== 'notif' ? 'claim' : tab} name={user.name} isRep={isRep} go={go} hold={me.data && me.data.ws.holdMinutes} token={token} orderId={oid} deadline={me.data && me.data.ws.dossierDeadlineH} />
  </div>;
}

// ---------- Carte d'Aya à côté du téléphone (grands écrans seulement) ----------
const SIDE = {
  home: ['L’essentiel en un écran', n => n + ' voit son étape, ce qu’il faut faire maintenant et un délai estimé. Quand il n’y a rien à faire, l’application le dit aussi.'],
  rdv: ['Prendre rendez-vous', (n, h) => n + ' choisit une demi-journée où une équipe est vraiment libre. Le créneau est gardé ' + minutes(h) + ' pendant la confirmation.'],
  msg: ['Poser une question', n => 'L’assistant répond avec le dossier de ' + n + ' et les procédures Moov, en citant ses sources. S’il ne sait pas, il passe la main à un conseiller.'],
  file: ['Tout le dossier', n => 'Les étapes datées, les pièces envoyées, l’adresse et le compte rendu du technicien. Rien n’est caché à ' + n + '.'],
  me: ['Réglages et aide', () => 'Signaler un problème, choisir ses notifications, confier le rendez-vous à un proche, suivre son paiement.'],
  claim: ['Retrouver son dossier', n => n + ' n’a pas encore de dossier rattaché. Avec la référence reçue après le paiement et un code envoyé par SMS, le dossier est retrouvé en toute sécurité.'],
  notif: ['Les notifications', n => 'Les alertes restent visibles ici, même si ' + n + ' refuse les SMS. Les envois SMS et WhatsApp sont imités.'],
  dossier: ['Le dossier en ligne', (n, h, dl) => n + ' a payé sur le site : il a ' + (dl || 24) + ' h pour envoyer trois photos, son repère et un créneau. Une photo floue ou sombre est signalée tout de suite, avant l’envoi. Il peut envoyer un dossier incomplet : Nadia lui dira ce qui manque.'],
  track: ['Le technicien arrive', n => 'Comme sur une application de taxi : ' + n + ' voit la camionnette avancer et le temps restant, seconde après seconde. Trajet simulé, sans GPS. Le code de réception se donne seulement à la fin.'],
  sign: ['Vérifier puis valider', n => 'Le technicien a fini. ' + n + ' regarde le voyant de la box, teste Internet, puis valide la visite. Sans réponse, la visite est validée toute seule après un délai. Le technicien est alors libre pour un autre client.'],
  call: ['Appeler le service client', n => n + ' appelle : le téléphone de Nadia sonne dans l’Équipe Moov. Si personne ne décroche, un rappel est créé tout seul. Appel simulé, sans son.'],
};
function Side({ tab, name, isRep, go, hold, token, orderId, deadline }) {
  const r = useQ(token, 'client.order', { orderId });
  const n = firstName(name);
  const v = r.data;
  // Sur l'accueil, la guide parle de ce qui se passe vraiment : dossier à remplir, technicien en route.
  const key = v && (v.calls || []).some(c => ['sonne', 'en_cours'].includes(c.status)) ? 'call'
    : tab === 'home' && v && signPending(v.mission) ? 'sign'
    : tab === 'home' && v && v.mission && ['en_route', 'sur_place'].includes(v.mission.status) ? 'track'
    : tab === 'home' && v && v.dossier && ['a_completer', 'en_retard', 'incomplet'].includes(v.dossier.status) ? 'dossier'
    : tab;
  const [t, d] = SIDE[key] || SIDE.home;
  const i = TABS.findIndex(x => x[0] === tab);
  const next = TABS[(i + 1) % TABS.length];
  return <aside className="cl-side" aria-label="Explications de la guide">
    <section className="card cl-side-card">
      <div className="cl-hello"><Avatar name="Aya" size={44} /><div className="cl-hello-t"><b className="cl-side-who">Aya, votre guide</b><span>Ce que voit {n}</span></div></div>
      <h3 className="cl-side-t">{t}</h3>
      <p className="muted">{d(n, hold, deadline)}</p>
      {isRep && <p className="small cl-side-rep">{n} est représentant : il ne voit que ce que la cliente lui a confié.</p>}
      {i >= 0 && <button type="button" className="cl-side-next" onClick={() => go(next[0])}><span>Ensuite : <b>{next[1]}</b></span><span className="arrow-btn" aria-hidden="true">{Icon.right}</span></button>}
      <div className="cl-side-legend"><Sim /><span className="tiny muted">= système Moov imité (paiement, SMS, activation)</span></div>
    </section>
  </aside>;
}

// ---------- Accueil ----------
function nextAction(v, isRep) {
  const o = v.order;
  const mine = v.blockers.filter(b => b.status === 'ouvert' && b.owner === 'vous');
  if (o.cancelled) return { title: 'Commande annulée', icon: Icon.x, text: v.refund ? 'Remboursement : ' + ({ demande: 'demandé', instruite: 'en cours d’instruction', valide: 'validé', rembourse: 'effectué (simulé)' }[v.refund.status] || v.refund.status) + '.' : '' };
  if (v.refund && !['rejete'].includes(v.refund.status) && !o.cancelled) return { title: 'Annulation en cours', icon: Icon.clock, text: 'Votre demande est vérifiée par un conseiller puis validée par un responsable. Une notification vous prévient à chaque étape.', go: 'me', cta: 'Suivre ma demande' };
  const dz = v.dossier;
  if (dz && DZ_OPEN.includes(dz.status)) return dossierNext(v, isRep);
  if (mine.length && isRep) { const b = mine[0]; return { title: b.action, text: b.text + ' Seule la cliente peut le faire depuis son téléphone.' }; }
  if (mine.length) { const b = mine[0]; return { title: b.action, text: b.text, go: b.type === 'PIECE_MANQUANTE' ? 'file' : b.type === 'ADRESSE_AMBIGUE' ? 'file' : 'rdv', sub: b.type === 'PIECE_MANQUANTE' ? 'docs' : b.type === 'ADRESSE_AMBIGUE' ? 'addr' : null, cta: b.type === 'PIECE_MANQUANTE' ? 'Envoyer la pièce' : b.type === 'ADRESSE_AMBIGUE' ? 'Préciser mon adresse' : 'Choisir une date' }; }
  if (signPending(v.mission)) return v.mission.signoff.state === 'probleme' ? { title: 'L’équipe Moov vous répond', icon: Icon.clock, text: 'Nous avons bien reçu votre souci. Quand tout est réglé, vous pouvez valider la visite.' } : { title: 'Vérifiez l’installation', icon: Icon.check, text: 'Regardez la box, cochez ce que vous voyez, puis validez la visite.' };
  switch (o.state) {
    case 'DOSSIER_RECU': return { title: 'Rien à faire pour l’instant', text: 'Moov vérifie votre paiement Moov Money. Vous recevrez une notification.' };
    case 'PAIEMENT_CONFIRME': case 'PREPARATION': return { title: 'Rien à faire pour l’instant', text: 'Moov vérifie votre adresse et le point de raccordement. Vérifiez que vos coordonnées sont justes.', go: 'file', sub: 'addr', cta: 'Vérifier mon adresse' };
    case 'PRET_A_PLANIFIER': return v.appt && v.appt.status === 'reserve' ? { title: 'Créneau réservé', text: 'Moov confirme l’équipe. En attendant, préparez la visite.', go: 'rdv', cta: 'Voir la préparation' } : { title: 'Choisissez votre créneau', text: 'Tout est vérifié. Réservez la visite du technicien.', go: 'rdv', cta: 'Choisir un créneau' };
    case 'RDV_CONFIRME': if (v.mission && ['en_route', 'sur_place'].includes(v.mission.status)) return { title: v.mission.status === 'en_route' ? 'Le technicien est en route' : 'Le technicien est arrivé', text: 'Votre code de réception, à lui donner à la fin : ' + v.mission.receptionCode + '.' };
      if (v.appt && v.appt.time) return { title: 'Visite ' + apptWhen(v.appt, v.mission), icon: Icon.cal, text: 'Cochez la liste de préparation pour éviter un second déplacement.', go: 'rdv', cta: 'Ma liste de préparation' };
      return { title: 'Préparez la visite du ' + fmtDate(v.appt.date), text: 'Cochez la liste de préparation pour éviter un second déplacement.', go: 'rdv', cta: 'Ma liste de préparation' };
    case 'INTERVENTION_EN_COURS': return { title: 'Le technicien est chez vous', text: 'À la fin, donnez-lui votre code de réception : ' + (v.mission ? v.mission.receptionCode : 'bientôt affiché') + '.' };
    case 'INSTALLATION_TERMINEE': case 'ACTIVATION_EN_ATTENTE': return { title: 'Activation en cours', text: 'Les travaux sont faits. Moov active la ligne à distance. Internet ne marche pas encore : c’est normal.' };
    case 'SERVICE_ACTIF': if (v.blockers.some(b => b.status === 'ouvert')) return { title: 'Nous traitons votre signalement', icon: Icon.clock, text: 'Une équipe Moov s’occupe du problème signalé. Vous recevrez une notification dès qu’il est réglé.' };
      return v.feedback ? { title: 'Tout est en ordre', text: 'Merci pour votre avis.', icon: Icon.check } : { title: 'Testez votre connexion', text: 'Dites-nous si Internet fonctionne, puis donnez votre avis.', go: 'me', cta: 'Tester et donner mon avis' };
    default: return { title: 'Dossier terminé', text: 'Merci pour votre confiance.', icon: Icon.check };
  }
}
const NEXT_ICON = { rdv: Icon.cal, file: Icon.doc, me: Icon.wifi };

// ---------- Dossier rempli en ligne (après un achat sur le site des offres) ----------
const DZ_OPEN = ['a_completer', 'en_retard', 'incomplet', 'a_verifier', 'verifie'];
const DZ_DRAFT = ['a_completer', 'en_retard'];
// Libellé de l'étape côté client tant que le dossier en ligne est ouvert (au lieu de « Vérification technique »).
const DZ_LABEL = { a_completer: 'Dossier à compléter', en_retard: 'Dossier à envoyer', incomplet: 'Dossier incomplet', a_verifier: 'Photos en vérification', verifie: 'Pièces validées' };
const DZ_HERO = { a_completer: 'Envoyez vos photos, votre repère et votre créneau.', en_retard: 'Le délai est passé, mais vous pouvez encore envoyer votre dossier.', incomplet: 'Il manque encore quelque chose à votre dossier.', a_verifier: 'Nadia, votre conseillère, vérifie vos photos.', verifie: 'Vos pièces sont validées : Hervé fixe l’heure de la visite.' };
const ADVISOR = 'Nadia Konan', PLANNER = 'Hervé Ouattara';
const missLabels = dz => dz.missing.map(m => m.label.toLowerCase());
function dossierNext(v, isRep) {
  const dz = v.dossier;
  const onlyHer = isRep ? ' Seule la cliente peut le faire depuis son téléphone.' : '';
  switch (dz.status) {
    case 'a_completer': return { title: 'Complétez votre dossier', icon: Icon.camera, text: 'Trois photos, un repère pour trouver chez vous et un créneau : cinq minutes suffisent.' + onlyHer, wizard: !isRep, cta: 'Commencer' };
    case 'en_retard': return { title: 'Le délai est dépassé', icon: Icon.clock, text: 'Vous pouvez encore envoyer votre dossier. Plus tôt il arrive, plus tôt le technicien passe.' + onlyHer, wizard: !isRep, cta: 'Terminer mon dossier' };
    case 'incomplet': return { title: 'Il manque : ' + andList(missLabels(dz)), icon: Icon.alert, text: 'Ajoutez ce qui manque : Nadia vérifie dès que c’est arrivé.' + onlyHer, go: isRep ? null : 'file', sub: 'docs', cta: 'Ajouter ce qui manque' };
    case 'a_verifier': return { title: 'Nadia vérifie vos photos', icon: Icon.clock, text: 'Rien à faire pour l’instant. Vous recevrez une notification dès que c’est bon, ou s’il faut reprendre une photo.' };
    default: return { title: 'Pièces validées', icon: Icon.check, text: 'Moov choisit le technicien et l’heure de votre visite. Vous recevrez une notification.' };
  }
}

// État de l'assistant de dossier : il survit au changement d'onglet (gardé le temps de la visite).
const wizards = new Map();
const WIZ0 = { open: false, step: 0, info: null, date: null, slot: null, sent: null };
function useWizard(token, orderId) {
  const key = token + '|' + orderId;
  const [w, setW] = useState(() => wizards.get(key) || WIZ0);
  const set = patch => setW(c => { const n = { ...c, ...(typeof patch === 'function' ? patch(c) : patch) }; wizards.set(key, n); return n; });
  return [w, set];
}
const openWizard = (token, orderId) => wizards.set(token + '|' + orderId, { ...(wizards.get(token + '|' + orderId) || WIZ0), open: true });

// Suivi en pastilles, du paiement à l'installation.
const DZ_STEPS = ['Payé', 'Dossier envoyé', 'Pièces vérifiées', 'Heure confirmée', 'Technicien en route', 'Installé'];
function dossierStep(v) {
  const dz = v.dossier, o = v.order, m = v.mission;
  let n = 1;
  if (dz.submittedAt) n = 2;
  if (['verifie', 'valide'].includes(dz.status)) n = 3;
  if (dz.status === 'valide' || (v.appt && v.appt.time && ['confirme', 'en_cours', 'realise'].includes(v.appt.status))) n = 4;
  if (m && ['en_route', 'sur_place', 'en_cours', 'terminee'].includes(m.status)) n = 5;
  if (ORDER_STATES.indexOf(o.state) >= ORDER_STATES.indexOf('INSTALLATION_TERMINEE')) n = 6;
  return n;
}
function DossierSteps({ v }) {
  const n = dossierStep(v);
  return <section className="card cl-trail" aria-label={'Suivi : étape ' + Math.min(n + 1, 6) + ' sur 6'}>
    <span className="eyebrow">Votre suivi</span>
    <ol className="cl-trail-l">{DZ_STEPS.map((s, i) => <li key={s} className={i < n ? 'done' : i === n ? 'next' : ''} title={i < n ? 'Fait' : 'À venir'}>{i < n ? Icon.check : <i />}{s}</li>)}</ol>
  </section>;
}

// Grande carte avec le compte à rebours : temps restant pour envoyer le dossier.
function DossierStart({ v, me, na, onStart }) {
  useNow(1000);
  const dz = v.dossier;
  const now = liveClock(me.ws);
  const left = dz.dueAt - now, late = left <= 0;
  const total = Math.max(1, dz.dueAt - dz.openedAt);
  const s = Math.floor(Math.abs(left) / 1000);
  const hms = pad2(Math.floor(s / 3600)) + ':' + pad2(Math.floor(s / 60) % 60) + ':' + pad2(s % 60);
  const docs = DOSSIER_DOCS.filter(t => v.documents.some(d => d.type === t && !['remplace', 'refuse'].includes(d.status))).length;
  const infoOk = (v.order.address.landmark || '').trim().length >= 8;
  return <section className={'card-dark cl-dz' + (late ? ' cl-dz-late' : '')} data-tour="client-dossier">
    <div className="cl-dz-top">
      <span className="cl-timer" role="timer" aria-label={late ? 'Délai dépassé' : 'Temps restant ' + hms}>
        <Ring value={late ? total : left} max={total} size={92} stroke={8} color={late ? 'var(--bad)' : 'var(--lime)'} track="var(--dark-3)"><span className="cl-dz-ic">{late ? Icon.alert : Icon.clock}</span></Ring>
      </span>
      <div className="cl-dz-time">
        <span className="eyebrow">{late ? 'Délai dépassé depuis' : 'Temps restant'}</span>
        <b className="cl-dz-clock num">{hms}</b>
        <span className="tiny muted">{late ? 'Envoyez quand même' : 'jusqu’au ' + fmtDateTime(dz.dueAt)}</span>
      </div>
    </div>
    <b className="cl-next-t">{na.title}</b>
    <span className="small cl-next-d">{na.text}</span>
    <div className="cl-dz-todo">
      <span className={docs === 3 ? 'on' : ''}>{docs === 3 ? Icon.check : Icon.camera}Photos {docs}/3</span>
      <span className={infoOk ? 'on' : ''}>{infoOk ? Icon.check : Icon.pin}Repère</span>
      <span>{Icon.cal}Créneau</span>
    </div>
    {na.wizard && <Btn kind="primary" block className="cl-lime" onClick={onStart}>{docs || infoOk ? 'Reprendre mon dossier' : na.cta}{Icon.right}</Btn>}
  </section>;
}

// Dossier envoyé mais incomplet : ce qui manque, avec un bouton d'ajout direct pour chaque pièce.
function DossierMissing({ token, v, go, isRep }) {
  const dz = v.dossier;
  const ps = usePhotoSender(token, v.order.id);
  return <section className="card cl-dz-miss" data-tour="client-dossier">
    <div className="spread"><Tag tone="bad"><span className="dot" />Dossier incomplet</Tag>{dz.submittedAt && <span className="tiny muted">envoyé le {fmtDateTime(dz.submittedAt)}</span>}</div>
    <b className="cl-block-t">Il manque : {andList(missLabels(dz))}</b>
    <div className="cl-miss">{dz.missing.map((m, i) => <div key={i} className="cl-miss-row">
      <span className="cl-ic cl-ic-bad">{m.kind === 'doc' ? Icon.camera : m.kind === 'slot' ? Icon.cal : Icon.pin}</span>
      <div className="grow stack-s" style={{ gap: 0 }}><b className="small">{m.label}</b><span className="tiny cl-bad">{m.why}</span></div>
      {!isRep && <div className="cl-miss-act">{m.kind === 'doc' && <Btn size="s" kind="sim" disabled={!!ps.busy} onClick={async () => ps.onFile(m.type, await demoPhoto(m.type))} title="Photo de démonstration (pièce fictive)">Démo</Btn>}
      {(m.kind === 'doc' ? <PhotoBtn id={'miss-' + m.type} type={m.type} busy={ps.busy === m.type} onFile={ps.onFile}>Ajouter</PhotoBtn>
        : <Btn size="s" kind="primary" onClick={() => m.kind === 'slot' ? go('rdv') : go('file', 'addr')}>{m.kind === 'slot' ? 'Choisir' : 'Compléter'}</Btn>)}</div>}
    </div>)}</div>
    <div className="cl-who"><Avatar name={ADVISOR} size={36} /><div className="grow"><span className="tiny muted">Nadia voit aussi ce qui manque</span><b className="small">Elle vérifie dès que c’est arrivé.</b></div></div>
    {ps.modal}
  </section>;
}

// Dossier envoyé et complet : qui s'en occupe maintenant (Nadia pour les photos, Hervé pour l'heure).
function DossierWaiting({ token, v, na }) {
  const dz = v.dossier;
  const herve = dz.status === 'verifie';
  const docs = DOSSIER_DOCS.map(t => v.documents.filter(d => d.type === t && d.status !== 'remplace').at(-1)).filter(Boolean);
  return <section className="card cl-dz-wait" data-tour="client-dossier">
    <div className="cl-dz-who">
      <span className="cl-dz-av"><Avatar name={herve ? PLANNER : ADVISOR} size={58} dot="ok" /></span>
      <div className="grow stack-s" style={{ gap: 2 }}>
        <span className="tiny muted">{herve ? 'Hervé, planificateur' : 'Nadia, votre conseillère'}</span>
        <b className="cl-block-t">{na.title}</b>
      </div>
    </div>
    <span className="small muted">{na.text}</span>
    {docs.length > 0 && <div className="cl-dz-docs">{docs.map(d => <div key={d.id} className="cl-dz-doc">
      <Picture token={token} img={d.img} thumb={d.thumb} label={DOC_TYPES[d.type].label} alt={DOC_TYPES[d.type].label} size={52} />
      <span className="tiny"><b>{DOC_TYPES[d.type].short || DOC_TYPES[d.type].label}</b></span>
      <Tag tone={DOC_TONE[d.status]}>{DOC_SHORT[d.status]}</Tag>
    </div>)}</div>}
  </section>;
}
const DOC_SHORT = { analyse: 'Contrôle', a_valider: 'À vérifier', valide: 'Validée', refuse: 'Refusée', remplace: 'Remplacée' };

// Rappel sur l'accueil quand le rendez-vous est confirmé : la liste de préparation.
function PrepNudge({ v, go }) {
  const o = v.order;
  const items = PREP_CHECKLIST.filter(i => i.need && (!i.when || i.when === o.address.building));
  const done = items.filter(i => o.prep[i.id]).length;
  const all = done === items.length;
  return <button type="button" className="card cl-nudge" onClick={() => go('rdv')}>
    <span role="img" aria-label={done + ' sur ' + items.length}><Ring value={done} max={items.length} size={48} stroke={5} color="var(--ok)"><span className="cl-ring-s num">{done}/{items.length}</span></Ring></span>
    <span className="grow cl-nudge-t"><b>Préparez la visite : {done}/{items.length} indispensables</b><span className="small muted">{all ? 'Tout l’indispensable est prêt, merci !' : 'Présence, accès, prise libre : cochez ce qui est prêt.'}</span></span>
    <span className="cl-chev" aria-hidden="true">{I2.chev}</span>
  </button>;
}

// Suivi du trajet du technicien, comme une application de taxi : carte, minutes restantes, code de réception.
function LiveTrack({ v, me }) {
  useNow(1000);
  const m = v.mission, t = m.track;
  const here = m.status === 'sur_place';
  const ti = t ? trackInfo(t, me.ws) : null;
  const p = here ? 1 : ti ? ti.p : 0;
  const name = firstName(m.techName);
  const title = here ? name + ' est arrivé' : !ti || p >= 1 ? name + ' est tout près' : name + ' arrive dans ' + Math.max(1, ti.leftMin) + ' min';
  const sub = here ? 'Il est devant chez vous : pensez à lui ouvrir.' : !ti ? 'Il est en route vers chez vous.' : p >= 1 ? 'Il cherche votre porte : gardez votre téléphone à portée de main.' : 'Il avance vers chez vous. Trajet simulé pour la démo.';
  const a = v.appt;
  const rdv = a ? 'Rendez-vous le ' + longDay(a.date) + (a.time ? ' à ' + hourLabel(a.time) : ', ' + slotLabel(a.slot)) : '';
  // Le client ne reçoit pas le numéro du technicien : l'appel du technicien viendra plus tard, le service client reste joignable.
  const person = { name: m.techName, avatar: fullName(m.techName), role: m.company, tag: 'Carte ' + m.badge, call: { label: 'Appel bientôt', disabled: true, note: 'Pour toute question, appelez le service client depuis l’onglet Messages.' } };
  return <section className="card cl-live" data-tour="client-track">
    <TrackCard track={t} ws={me.ws} status={m.status} times={m.times || {}} receivedHint={rdv} person={person} title={title} sub={sub} toLabel="Chez vous" fromLabel="Agence" liveTitle mapHeight={186} fallback={<div className="cl-van"><VanScene height={62} /></div>} />
    <div className="cl-code">
      <span className="tiny">Votre code de réception</span>
      <b className="num">{m.receptionCode}</b>
      <span className="tiny">À donner à {name} seulement à la fin, si le travail vous convient.</span>
    </div>
  </section>;
}

// Noter le technicien juste après sa visite.
const rated = new Set();
function RateTech({ token, v }) {
  const [s, setS] = useState(0);
  const [clear, setClear] = useState(null);
  const [problem, setProblem] = useState(null);
  const [c, setC] = useState('');
  const [hide, setHide] = useState(false);
  const lv = v.lastVisit;
  const name = firstName(lv.techName);
  if (v.techRating) return hide ? null : <section className="card cl-rate cl-rate-done">
    <div className="cl-hello"><Avatar name={fullName(lv.techName)} size={48} /><div className="cl-hello-t"><b>Merci pour votre note !</b><span>{name} et son responsable la voient.</span></div></div>
    <div className="cl-rated"><Stars n={v.techRating.score} /><b className="num">{v.techRating.score}/5</b>{v.techRating.problem && <Tag tone="warn">Souci signalé : un responsable vous recontacte</Tag>}</div>
    <Btn size="s" kind="ghost" onClick={() => setHide(true)}>Fermer</Btn>
  </section>;
  const yn = (val, set, a, b) => <div className="cl-yn" role="radiogroup">{[[a[0], a[1]], [b[0], b[1]]].map(([l, x]) => <button type="button" key={l} role="radio" aria-checked={val === x} onClick={() => set(x)}>{l}</button>)}</div>;
  return <section className="card cl-rate" data-tour="client-rate">
    <div className="cl-hello"><Avatar name={fullName(lv.techName)} size={52} /><div className="cl-hello-t"><span>Visite terminée{lv.end ? ' · ' + fmtDateTime(lv.end) : ''}</span><b className="cl-rate-t">Comment s’est passée la visite de {name} ?</b></div></div>
    <div className="cl-stars cl-stars-pick" role="radiogroup" aria-label="Note de la visite">{[1, 2, 3, 4, 5].map(n => <button type="button" key={n} role="radio" aria-checked={s === n} className={n <= s ? 'on' : ''} onClick={() => setS(n)} aria-label={n + ' sur 5'}>{I2.star}</button>)}</div>
    <div className="cl-q"><span className="small">A-t-il bien expliqué ?</span>{yn(clear, setClear, ['Oui', true], ['Non', false])}</div>
    <div className="cl-q"><span className="small">Un souci pendant le rendez-vous ?</span>{yn(problem, setProblem, ['Non', false], ['Oui', true])}</div>
    <textarea className="input" aria-label="Commentaire facultatif" placeholder="Un mot pour lui (facultatif)" value={c} onChange={e => setC(e.target.value)} />
    <AsyncBtn kind="primary" block disabled={!s} onClick={async () => { rated.add(v.order.id); const r = await call(token, 'tech.rate', { orderId: v.order.id, score: s, clear, problem: problem === true, comment: c }); if (!r.ok) rated.delete(v.order.id); }}>Envoyer</AsyncBtn>
  </section>;
}

// ---------- Parcours de la visite : cinq étapes, de « un technicien va vous contacter » à la validation ----------
// Le suivi sur carte (LiveTrack) et la note (RateTech) existent déjà : ce bandeau n'en reprend que le fil.
const VJ = ['Un technicien va vous contacter', 'En route', 'Chez vous', 'Installation en cours', 'Vérification et validation'];
const VJ_AT = { affectee: 1, en_route: 2, sur_place: 3, en_cours: 4, terminee: 5 };
const HM = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Africa/Abidjan', hour: 'numeric', minute: '2-digit' });
const hm = t => HM.format(t).replace(/^0?(\d+):(\d+)/, '$1 h $2'); // « 9 h 04 »
const signDone = so => !!so && ['validee', 'auto'].includes(so.state);
const signPending = m => !!m && m.status === 'terminee' && !!m.signoff && ['attente', 'probleme'].includes(m.signoff.state);
const signMode = so => so.mode || (so.state === 'validee' ? 'verifie' : 'delai');
// Ce que le client lit une fois la visite validée : on distingue « vous avez validé » et « validée automatiquement ».
const SIGN_SAYS = {
  verifie: n => ['Vous avez validé la visite', 'Merci d’avoir vérifié. ' + n + ' est de nouveau disponible pour un autre client.'],
  auto: () => ['Validée automatiquement', 'Vous avez laissé partir le technicien sans vérifier. Un souci plus tard ? Écrivez-nous dans Messages.'],
  delai: () => ['Validée automatiquement', 'Sans réponse de votre part, la visite a été validée toute seule. Un souci ? Écrivez-nous dans Messages.'],
};
const frMin = n => n >= 120 ? Math.floor(n / 60) + ' h ' + pad2(n % 60) : n + ' min';

function VisitJourney({ v }) {
  const m = v.mission;
  if (!m || !VJ_AT[m.status]) return null;
  const so = m.signoff, a = v.appt, t = m.times || {};
  const cur = VJ_AT[m.status];
  // Une visite terminée sur un ancien espace n'a pas de validation : rien à demander au client.
  const done = m.status === 'terminee' && (!so || signDone(so));
  const name = firstName(m.techName);
  const when = a ? longDay(a.date) + (a.time ? ' à ' + hourLabel(a.time) : ', ' + slotLabel(a.slot)) : '';
  const now = [
    name + ' (' + m.company + ') viendra chez vous' + (when ? ' le ' + when : '') + '.',
    m.track ? 'Suivez-le sur la carte.' : name + ' est en route vers chez vous.',
    name + ' est arrivé. Pensez à lui ouvrir.',
    name + ' installe votre box. Restez joignable.',
    done ? (so ? SIGN_SAYS[signMode(so)](name)[0] : 'Visite terminée') + '.' : so && so.state === 'probleme' ? 'Souci signalé : l’équipe Moov vous répond.' : 'À vous : vérifiez et validez.',
  ];
  const past = [null, t.depart && 'Parti à ' + hm(t.depart), t.arrive && 'Arrivé à ' + hm(t.arrive), t.start && 'Commencé à ' + hm(t.start), done && !so ? 'Visite terminée.' : null];
  return <section className="card cl-vj" data-tour="client-journey">
    <div className="spread"><span className="eyebrow">Votre visite</span><Tag tone={done ? 'ok' : 'info'}>{done ? 'Terminée' : 'Étape ' + cur + ' sur 5'}</Tag></div>
    <ol className="cl-vj-l" aria-label={'Parcours de la visite : étape ' + cur + ' sur 5'}>{VJ.map((s, i) => {
      const st = done || i < cur - 1 ? 'done' : i === cur - 1 ? 'now' : '';
      const txt = st === 'now' ? now[i] : st === 'done' ? past[i] : null;
      return <li key={s} className={st} aria-current={st === 'now' ? 'step' : undefined}>
        <span className="cl-vj-dot" aria-hidden="true">{st === 'done' ? Icon.check : i + 1}</span>
        <div className="cl-vj-t"><b>{s}{st === 'done' && <span className="sr-only"> (fait)</span>}</b>{txt && <span className="small muted">{txt}</span>}</div>
      </li>;
    })}</ol>
  </section>;
}

// Fin de visite : le client regarde la box puis valide, signale un souci, ou laisse partir le technicien.
// « Internet fonctionne » n'est exigé qu'une fois le service activé : avant, la ligne n'est pas encore ouverte.
const SIGN_CHECKS = [['voyant', 'Le voyant de la box est allumé', true], ['internet', 'Internet fonctionne sur mon téléphone ou mon ordinateur', 'actif'], ['propre', 'L’espace est propre et rangé', false]];
const signDraft = new Map(); // cases cochées, gardées si le client change d'onglet
function SignoffCard({ token, v, me, isRep }) {
  useNow(1000);
  const m = v.mission, so = m.signoff, o = v.order;
  const key = o.id + '|' + m.woId;
  const [c, setC] = useState(() => signDraft.get(key) || {});
  const [ask, setAsk] = useState(null); // null, 'souci' ou 'partir'
  const [txt, setTxt] = useState('');
  const [err, setErr] = useState(null);
  const name = firstName(m.techName);
  const prob = so.state === 'probleme';
  const left = so.autoAt - liveClock(me.ws);
  const count = left > 0 ? 'Sans réponse de votre part, la visite sera validée automatiquement dans ' + frMin(Math.max(1, Math.ceil(left / 60e3))) + '.' : 'La validation automatique est en cours.';
  const toggle = id => { const n = { ...c, [id]: !c[id] }; signDraft.set(key, n); setC(n); setErr(null); };
  const actif = o.state === 'SERVICE_ACTIF';
  const checks = { voyant: !!c.voyant, internet: !!c.internet, propre: !!c.propre };
  const validate = async () => {
    if (!checks.voyant || (actif && !checks.internet)) { setErr(actif ? 'Cochez que le voyant de la box est allumé et qu’Internet fonctionne, ou choisissez « Il y a un souci ».' : 'Cochez que le voyant de la box est allumé, ou choisissez « Il y a un souci ».'); return; }
    setErr(null);
    const r = await call(token, 'install.validate', { orderId: o.id, mode: 'verifie', checks });
    if (r.ok) signDraft.delete(key);
  };
  const sendProblem = async () => {
    if (txt.trim().length < 5) { setErr('Décrivez le souci en une phrase pour que l’équipe puisse vous aider.'); return; }
    setErr(null);
    const r = await call(token, 'install.validate', { orderId: o.id, mode: 'probleme', text: txt.trim(), checks });
    if (r.ok) { setAsk(null); setTxt(''); }
  };
  const leave = async () => { const r = await call(token, 'install.validate', { orderId: o.id, mode: 'auto' }); if (r.ok) signDraft.delete(key); };
  const head = <div className="cl-hello"><Avatar name={fullName(m.techName)} size={52} dot="ok" /><div className="cl-hello-t"><span>{name} a terminé l’installation</span><b id="cl-sign-t" className="cl-sign-t">Vérifiez l’installation</b></div></div>;
  if (isRep) return <section className="card cl-sign" id="cl-signoff" tabIndex={-1} aria-labelledby="cl-sign-t">
    {head}
    <p className="small muted">Seule la cliente peut vérifier et valider la visite depuis son téléphone.</p>
    {!prob && <span className="small cl-sign-count">{count}</span>}
  </section>;
  return <section className="card cl-sign" id="cl-signoff" tabIndex={-1} aria-labelledby="cl-sign-t" data-tour="client-signoff">
    {head}
    {prob ? <div className="alert alert-warn small stack-s" role="status">
      <b>Nous avons bien reçu votre souci. L’équipe Moov vous répond.</b>
      {so.problem && <span>« {so.problem} »</span>}
      <span>Quand c’est réglé, vous pouvez valider la visite ci-dessous.</span>
    </div> : <p className="small muted">Cela prend une minute. Regardez la box, puis cochez ce que vous voyez.</p>}
    <div className="cl-checks" role="group" aria-label="Vérifications de l’installation">
      {SIGN_CHECKS.map(([id, label, kind]) => { const need = kind === true || (kind === 'actif' && actif); return <label key={id} className={'cl-check cl-check-big' + (c[id] ? ' on' : '')}>
        <input type="checkbox" checked={!!c[id]} onChange={() => toggle(id)} />
        <span className="cl-box" aria-hidden="true">{Icon.check}</span>
        <span className="grow cl-check-l">{label}{need && <span className="cl-need">Indispensable</span>}{kind === 'actif' && !actif && <span className="tiny muted" style={{ display: 'block' }}>Internet arrivera après l’activation, ça peut prendre quelques minutes</span>}</span>
      </label>; })}
    </div>
    <Explain open>
      <span className="cl-sign-help">Le voyant est la petite lumière sur le devant de la box. Il doit rester allumé, sans clignoter en rouge.</span>
      <span className="cl-sign-help">{actif ? 'Pour tester Internet, ouvrez n’importe quel site sur votre téléphone, connecté au wifi de la box.' : 'Internet arrivera après l’activation de la ligne : ne cochez cette case que s’il marche déjà.'}</span>
    </Explain>
    {err && <div className="alert alert-bad small" role="alert">{err}</div>}
    {!prob && <span className="small cl-sign-count" role="timer" aria-live="off">{count}</span>}
    <AsyncBtn kind="primary" block className="cl-big-btn" onClick={validate}>Je valide la visite</AsyncBtn>
    {ask === 'souci' ? <div className="cl-sign-ask stack-s">
      <label className="cl-lab" htmlFor="cl-sign-txt">Quel est le souci ?</label>
      <textarea id="cl-sign-txt" className="input" value={txt} onChange={e => { setTxt(e.target.value); setErr(null); }} placeholder="Ex. : le voyant clignote en rouge, ou Internet ne marche pas." autoFocus />
      <AsyncBtn kind="primary" block className="cl-big-btn" onClick={sendProblem}>Envoyer mon souci</AsyncBtn>
      <Btn block className="cl-big-btn" onClick={() => { setAsk(null); setErr(null); }}>Annuler</Btn>
    </div> : !prob && <Btn block className="cl-big-btn" onClick={() => { setAsk('souci'); setErr(null); }}>Il y a un souci</Btn>}
    {ask === 'partir' ? <div className="alert alert-warn small stack-s" role="alertdialog" aria-label="Confirmer">
      <b>La visite sera validée tout de suite.</b>
      <span>Vous pourrez toujours nous écrire dans Messages si un souci apparaît plus tard.</span>
      <AsyncBtn kind="primary" block className="cl-big-btn" onClick={leave}>Oui, laisser partir {name}</AsyncBtn>
      <Btn block className="cl-big-btn" onClick={() => setAsk(null)}>Non, je vérifie</Btn>
    </div> : !prob && ask !== 'souci' && <button type="button" className="link-btn cl-leave" onClick={() => { setAsk('partir'); setErr(null); }}>Laisser partir le technicien sans vérifier</button>}
  </section>;
}

// Remerciement juste avant la note du technicien (RateTech).
function SignoffThanks({ v, me }) {
  const so = v.lastVisit.signoff;
  const [t, d] = SIGN_SAYS[signMode(so)](firstName(v.lastVisit.techName));
  return <section className="card cl-thanks" role="status">
    <span className="cl-thanks-ic" aria-hidden="true">{Icon.check}</span>
    <div className="grow stack-s" style={{ gap: 2 }}><b className="cl-block-t">{t}. Merci {firstName(me.user.name)} !</b><span className="small muted">{d}</span></div>
  </section>;
}

// Écran de succès après l'envoi du dossier.
function DossierSent({ v, sent, onClose }) {
  const miss = (sent.missing || []).filter(m => m.kind === 'doc');
  const appt = v.appt;
  return <section className="card cl-sent-screen" data-tour="client-dossier-sent">
    <span className="cl-sent-ic">{Icon.check}</span>
    <h2 className="cl-claim-t">Dossier envoyé !</h2>
    <p className="small muted">{miss.length ? 'Il manque encore : ' + andList(miss.map(m => m.label.toLowerCase())) + '. Ajoutez-' + (miss.length > 1 ? 'les' : 'la') + ' dès que possible : Nadia vous le rappellera.' : 'Nadia vérifie vos photos. Ensuite, Hervé choisit l’heure et le technicien : vous recevrez une notification.'}</p>
    {appt && <div className="cl-when">{Icon.cal}<span>Créneau demandé : {longDay(appt.date)}, {slotLabel(appt.slot)}</span></div>}
    <div className="cl-who"><Avatar name={ADVISOR} size={36} /><div className="grow"><span className="tiny muted">Prévenue à l’instant</span><b className="small">Nadia, votre conseillère</b></div></div>
    <Btn kind="primary" block onClick={onClose}>Revenir à l’accueil</Btn>
  </section>;
}

// ---------- Assistant « Complétez votre dossier » (4 étapes, dans l'écran du téléphone) ----------
const WZ_STEPS = ['Photos', 'Infos', 'Créneau', 'Envoi'];
const WZ_TITLES = ['Photos de votre pièce', 'Pour vous trouver', 'Choisir un créneau', 'Vérifier et envoyer'];
const ACCESS_CHIPS = ['Chien à enfermer', 'Gardien à prévenir', 'Portail fermé', 'Badge d’entrée'];
const infoFrom = a => ({ landmark: a.landmark || '', building: a.building || 'maison', floor: a.floor || '', accessNotes: a.accessNotes || '', onsiteContact: a.onsiteContact || '' });
function WizClock({ dz, me }) {
  useNow(1000);
  const left = dz.dueAt - liveClock(me.ws);
  const s = Math.floor(Math.abs(left) / 1000);
  const hms = pad2(Math.floor(s / 3600)) + ':' + pad2(Math.floor(s / 60) % 60) + ':' + pad2(s % 60);
  return <span className={'cl-wiz-clock num' + (left <= 0 ? ' late' : '')} role="timer">{Icon.clock}{left <= 0 ? 'En retard ' : ''}{hms}</span>;
}
function DossierWizard({ token, v, me, wiz, setWiz, go }) {
  const o = v.order, dz = v.dossier;
  const av = useQ(token, 'client.availability', { orderId: o.id });
  const ps = usePhotoSender(token, o.id, { quiet: true });
  const [err, setErr] = useState(null);
  const top = useRef(null);
  const step = wiz.step || 0;
  // Bouton Retour du téléphone : étape précédente de l'assistant, au lieu de quitter la démo.
  const stepRef = useRef(step); stepRef.current = step;
  useEffect(() => {
    try { history.pushState({ fwWiz: 1 }, ''); } catch {}
    const onPop = () => { const n = stepRef.current; if (n > 0) { setWiz({ step: n - 1 }); try { history.pushState({ fwWiz: 1 }, ''); } catch {} } else setWiz({ open: false }); };
    window.addEventListener('popstate', onPop); return () => window.removeEventListener('popstate', onPop);
  }, []);
  useEffect(() => { const el = top.current; if (!el) return; const b = el.closest('.phone-body'); if (b) b.scrollTop = 0; if (el.getBoundingClientRect().top < 120) el.scrollIntoView({ block: 'start' }); }, [step]);
  const info = wiz.info || infoFrom(o.address);
  const setInfo = (k, val) => setWiz(c => ({ info: { ...(c.info || infoFrom(o.address)), [k]: val } }));
  const docOf = t => v.documents.filter(d => d.type === t && d.status !== 'remplace').at(-1);
  const docsOk = DOSSIER_DOCS.filter(t => { const d = docOf(t); return d && d.status !== 'refuse'; });
  const docsMiss = DOSSIER_DOCS.filter(t => !docsOk.includes(t));
  const lmOk = info.landmark.trim().length >= 8;
  const slots = av.data ? av.data.slots : [];
  const picked = wiz.date ? slots.find(s => s.date === wiz.date && s.slot === wiz.slot && s.left > 0) : null;
  const goStep = n => { setErr(null); setWiz({ step: n }); };
  const submit = async () => {
    setErr(null);
    const res = await call(token, 'dossier.submit', { orderId: o.id, info, date: wiz.date, slot: wiz.slot }, { silent: true });
    if (!res.ok) {
      setErr({ msg: res.error.message, alts: (res.error.extra || {}).alternatives || [] });
      if (res.error.code === 'complet') setWiz({ date: null, slot: null });
      return;
    }
    setWiz({ open: false, step: 0, sent: { status: res.data && res.data.status, missing: (res.data && res.data.missing) || [] } });
  };
  const next = [
    { ok: true, label: docsOk.length === 3 ? 'Continuer' : 'Continuer sans toutes les photos', hint: docsOk.length < 3 ? 'Vous pourrez ajouter les photos manquantes plus tard.' : null },
    { ok: lmOk, label: 'Continuer', hint: lmOk ? null : 'Le repère est obligatoire : au moins 8 caractères.' },
    { ok: !!picked, label: 'Continuer', hint: picked ? null : 'Choisissez une demi-journée pour continuer.' },
  ][step];
  return <div className="cl-wiz" ref={top} data-tour="client-wizard">
    <div className="cl-wiz-head">
      <button type="button" className="icon-btn" onClick={() => step ? goStep(step - 1) : setWiz({ open: false })} aria-label={step ? 'Étape précédente' : 'Fermer l’assistant'}>{Icon.left}</button>
      <div className="grow cl-hello-t"><span>Étape {step + 1} sur 4</span><b>{WZ_TITLES[step]}</b></div>
      <WizClock dz={dz} me={me} />
    </div>
    <ol className="cl-wiz-steps" aria-label="Étapes du dossier">{WZ_STEPS.map((s, i) => <li key={s} className={i < step ? 'done' : i === step ? 'now' : ''}>
      <button type="button" onClick={() => goStep(i)} aria-current={i === step ? 'step' : undefined}><i>{i < step ? Icon.check : i + 1}</i><span>{s}</span></button>
    </li>)}</ol>

    {step === 0 && <section className="card stack">
      <div className="cl-hello"><span className="cl-ic cl-ic-accent">{Icon.camera}</span><div className="cl-hello-t"><b>Trois photos</b><span>Recto, verso, puis vous avec la pièce.</span></div></div>
      <div className="cl-tiles">{DOSSIER_DOCS.map(t => <DocTile key={t} token={token} type={t} doc={docOf(t)} busy={ps.busy === t} onFile={ps.onFile} />)}</div>
      <DemoPhotos types={docsMiss.length ? docsMiss : DOSSIER_DOCS} onFile={ps.onFile} busy={!!ps.busy} />
      <div className="cl-res">{DOSSIER_DOCS.map(t => { const d = docOf(t); return <div key={t} className="cl-res-row"><b className="small">{DOC_TYPES[t].short}</b>{d ? <CheckLine d={d} /> : <span className="tiny muted">{DOC_TYPES[t].why}</span>}</div>; })}</div>
      <Explain title="Conseils pour une bonne photo">Posez la pièce à plat, près d’une fenêtre, sans flash. Les quatre coins doivent être visibles. Le téléphone vérifie tout de suite si la photo est floue ou trop sombre. Démo : une photo de test suffit, n’envoyez pas votre vraie pièce.</Explain>
    </section>}

    {step === 1 && <section className="card stack">
      <Field label="Repère pour trouver chez vous (obligatoire)" id="wz-l" hint={<span className={info.landmark && !lmOk ? 'cl-bad' : lmOk ? 'cl-ok' : ''}>{lmOk ? 'Assez précis ✓' : 'Encore ' + (8 - info.landmark.trim().length) + ' caractère' + (8 - info.landmark.trim().length > 1 ? 's' : '') + '. Ex. : portail bleu après la pharmacie.'}</span>}>
        <input id="wz-l" className="input" value={info.landmark} onChange={e => setInfo('landmark', e.target.value)} placeholder="Ex. : portail vert en face du maquis" autoComplete="off" />
      </Field>
      <div className="field"><span className="cl-lab">Logement</span><div className="cl-yn cl-yn-wide" role="radiogroup" aria-label="Logement">{[['maison', 'Maison / villa'], ['immeuble', 'Immeuble']].map(([k, l]) => <button type="button" key={k} role="radio" aria-checked={info.building === k} onClick={() => setInfo('building', k)}>{l}</button>)}</div></div>
      <Field label="Étage / porte" id="wz-f"><input id="wz-f" className="input" value={info.floor} onChange={e => setInfo('floor', e.target.value)} placeholder={info.building === 'immeuble' ? 'Ex. : 3e étage, porte gauche' : 'Ex. : rez-de-chaussée'} /></Field>
      <Field label="Accès" id="wz-a" hint="Chien, gardien, portail, badge… Touchez pour ajouter."><textarea id="wz-a" className="input" value={info.accessNotes} onChange={e => setInfo('accessNotes', e.target.value)} /></Field>
      <div className="cl-chips">{ACCESS_CHIPS.map(c => <button type="button" key={c} className="cl-chip cl-chip-s" onClick={() => setInfo('accessNotes', info.accessNotes.includes(c) ? info.accessNotes : (info.accessNotes.trim() ? info.accessNotes.trim() + ', ' : '') + c)}>+ {c}</button>)}</div>
      <Field label="Personne présente le jour de la visite" id="wz-c" hint="Laissez vide si c’est vous."><input id="wz-c" className="input" value={info.onsiteContact} onChange={e => setInfo('onsiteContact', e.target.value)} placeholder={o.contactName} /></Field>
    </section>}

    {step === 2 && <section className="card cl-book">
      <p className="small muted">Choisissez une demi-journée. Moov vous confirmera l’heure exacte et le technicien après la vérification de vos photos.</p>
      {av.data && av.data.conditional && <div className={'alert small ' + (av.data.conditional === 'bloque' ? 'alert-bad' : 'alert-warn')}>{av.data.conditional === 'bloque' ? 'Matériel indisponible : aucune date ne vous est promise pour l’instant.' : 'Matériel en tension : votre créneau sera confirmé quand l’équipement sera disponible.'} <Sim /></div>}
      {slots.length === 0 && av.data && <Empty>Aucun créneau libre pour le moment. Envoyez votre dossier plus tard ou appelez le service client.</Empty>}
      <SlotGrid slots={slots} isSel={s => wiz.date === s.date && wiz.slot === s.slot} onPick={s => setWiz({ date: s.date, slot: s.slot })} />
      {picked && <div className="cl-when">{Icon.cal}<span>Choisi : {longDay(picked.date)}, {slotLabel(picked.slot)}</span></div>}
    </section>}

    {step === 3 && <section className="card stack cl-recap">
      <RecapRow icon={Icon.camera} title="Photos" bad={docsMiss.length > 0} value={docsMiss.length ? docsOk.length + '/3 · il manque : ' + andList(docsMiss.map(t => DOC_TYPES[t].short.toLowerCase())) : '3/3 envoyées'} onEdit={() => goStep(0)} />
      <RecapRow icon={Icon.pin} title="Repère" bad={!lmOk} value={lmOk ? info.landmark : 'À indiquer (8 caractères minimum)'} onEdit={() => goStep(1)} />
      <RecapRow icon={Icon.home} title="Logement" value={(info.building === 'immeuble' ? 'Immeuble' : 'Maison / villa') + (info.floor ? ' · ' + info.floor : '')} onEdit={() => goStep(1)} />
      <RecapRow icon={Icon.lock} title="Accès" value={info.accessNotes || 'Rien de particulier'} onEdit={() => goStep(1)} />
      <RecapRow icon={Icon.user} title="Présent le jour J" value={info.onsiteContact || 'Vous (' + o.contactName + ')'} onEdit={() => goStep(1)} />
      <RecapRow icon={Icon.cal} title="Créneau" bad={!picked} value={picked ? longDay(picked.date) + ', ' + slotLabel(picked.slot) : 'Pas encore choisi'} onEdit={() => goStep(2)} />
      {docsMiss.length > 0 && <div className="alert alert-warn small">Votre dossier est incomplet. <b>Vous pouvez envoyer quand même : Nadia vous dira ce qui manque.</b></div>}
      {(!lmOk || !picked) && <div className="alert alert-bad small">Avant d’envoyer : {andList([!lmOk && 'indiquez un repère', !picked && 'choisissez un créneau'].filter(Boolean))}.</div>}
      {err && <div className="alert alert-warn small stack-s"><b>{err.msg}</b>{err.alts.length > 0 && <><span>Encore libres :</span><div className="row">{err.alts.map(s => <Btn key={s.date + s.slot} size="s" onClick={() => { setErr(null); setWiz({ date: s.date, slot: s.slot }); }}>{fmtDate(s.date)} · {s.slot === 'm' ? 'matin' : 'après-midi'}</Btn>)}</div></>}</div>}
      <AsyncBtn kind="primary" block className="cl-big-btn" disabled={!lmOk || !picked} onClick={submit}>Envoyer mon dossier{Icon.right}</AsyncBtn>
    </section>}

    {step < 3 && <div className="cl-wiz-foot">
      {next.hint && <span className="tiny muted">{next.hint}</span>}
      <Btn kind="primary" block className="cl-big-btn" disabled={!next.ok} onClick={() => goStep(step + 1)}>{next.label}{Icon.right}</Btn>
    </div>}
    {ps.modal}
  </div>;
}
function RecapRow({ icon, title, value, bad, onEdit }) {
  return <div className={'cl-recap-row' + (bad ? ' bad' : '')}>
    <span className={'cl-ic cl-ic-s' + (bad ? ' cl-ic-bad' : '')}>{icon}</span>
    <div className="grow stack-s" style={{ gap: 0, minWidth: 0 }}><span className="tiny muted">{title}</span><b className="small">{value}</b></div>
    <button type="button" className="link-btn small" onClick={onEdit} aria-label={'Modifier : ' + title}>Modifier</button>
  </div>;
}

// Une tuile par photo : elle ouvre l'appareil photo (caméra arrière pour la pièce, avant pour le selfie).
function DocTile({ token, type, doc, busy, onFile }) {
  const st = useImage(token, doc && doc.img);
  const src = doc ? st.src || doc.thumb : null;
  const c = doc && checkOf(doc);
  const bad = doc && doc.status === 'refuse';
  const tone = bad ? 'bad' : c ? (c.ok ? 'ok' : 'warn') : '';
  const id = 'wz-photo-' + type;
  return <label htmlFor={id} className={'cl-tile' + (doc ? ' has' : '') + (tone ? ' cl-tile-' + tone : '') + (busy ? ' is-busy' : '')}>
    <span className="cl-tile-pic">
      {src ? <img src={src} alt={DOC_TYPES[type].label} /> : <span className="cl-tile-ic">{type === 'selfie_cni' ? Icon.user : Icon.camera}</span>}
      {doc && !busy && <span className="cl-tile-badge" aria-hidden="true">{bad ? Icon.x : c && !c.ok ? '!' : Icon.check}</span>}
      {busy && <span className="cl-tile-wait" aria-hidden="true" />}
    </span>
    <b>{DOC_TYPES[type].short}</b>
    <span className="tiny">{busy ? 'Envoi…' : doc ? 'Reprendre' : type === 'selfie_cni' ? 'Avec la pièce' : 'Photographier'}</span>
    <PhotoInput id={id} type={type} onFile={onFile} disabled={busy} />
  </label>;
}

// Résultat du contrôle automatique de la photo (netteté, lumière, taille).
const checkMem = new Map();
const noteCheck = n => { if (!n) return null; if (/Photo nette et lisible/.test(n)) return { ok: true, issues: [] }; const m = /Photo (.+?) : à regarder de près/.exec(n); return m ? { ok: false, issues: m[1].split(', ') } : null; };
const checkOf = d => d.check || checkMem.get(d.id) || noteCheck(d.scanNote);
function CheckLine({ d }) {
  if (d.status === 'refuse') return <span className="cl-chk cl-chk-bad">{Icon.x}Refusée{d.reason ? ' : ' + d.reason : ''}</span>;
  const c = checkOf(d);
  if (!c) return d.status === 'analyse' && String(d.mime || '').startsWith('image/') ? <span className="cl-chk">{Icon.clock}Contrôle de la photo…</span> : null;
  return c.ok ? <span className="cl-chk cl-chk-ok">Nette et lisible {Icon.check}</span> : <span className="cl-chk cl-chk-warn">{Icon.alert}Photo {andList(c.issues)}</span>;
}

// Prise de photo : on la contrôle sur le téléphone avant l'envoi ; si elle semble floue ou sombre, on propose de la reprendre.
function PhotoInput({ id, type, onFile, disabled, pdf }) {
  // Pas d'attribut « capture » : le téléphone propose l'appareil photo OU la galerie (photos de test préparées).
  return <input id={id} type="file" accept={pdf ? 'image/*,application/pdf' : 'image/*'} className="cl-file" disabled={disabled} onChange={e => { const f = e.target.files[0]; e.target.value = ''; onFile(type, f, id); }} />;
}
// Photo de démonstration : une pièce fictive « SPÉCIMEN » dessinée sur le téléphone, nette ou floue.
// Elle passe par le même contrôle que les vraies photos (la floue déclenche l'avertissement).
export function demoPhoto(type, blurry = false) {
  return new Promise(resolve => {
    try {
      const W = 1200, H = 800;
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const g = c.getContext('2d');
      const rr = (x, y, w, h, r, fill) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); g.fillStyle = fill; g.fill(); };
      const face = (x, y, k) => { g.fillStyle = '#7a4a2a'; g.beginPath(); g.arc(x, y, 60 * k, 0, 7); g.fill(); g.fillStyle = '#1d1d22'; g.beginPath(); g.arc(x, y - 30 * k, 62 * k, Math.PI, 0); g.fill(); g.fillStyle = '#2b6cb0'; g.fillRect(x - 95 * k, y + 70 * k, 190 * k, 160 * k); };
      const card = (x, y, w, h, verso) => {
        rr(x + 8, y + 10, w, h, 28, 'rgba(0,0,0,.25)'); rr(x, y, w, h, 28, '#eef3f8');
        rr(x, y, w, h * 0.17, 28, '#0f766e'); g.fillStyle = '#fff'; g.font = 'bold ' + Math.round(h * 0.07) + 'px sans-serif'; g.fillText(verso ? 'VERSO · SPÉCIMEN DE DÉMO' : 'PIÈCE FICTIVE · SPÉCIMEN', x + w * 0.05, y + h * 0.12);
        g.fillStyle = '#334155'; g.font = Math.round(h * 0.06) + 'px sans-serif';
        if (!verso) { rr(x + w * 0.05, y + h * 0.25, w * 0.26, h * 0.6, 14, '#cbd5e1'); g.save(); g.beginPath(); g.rect(x + w * 0.05, y + h * 0.25, w * 0.26, h * 0.6); g.clip(); face(x + w * 0.18, y + h * 0.5, h / 500); g.restore(); ['NOM : CLIENT DÉMO', 'NÉ(E) LE : 01.01.1990', 'N° : DEMO-0000-0000', 'DOCUMENT SANS VALEUR'].forEach((t, i) => g.fillText(t, x + w * 0.36, y + h * (0.34 + i * 0.14))); }
        else { for (let i = 0; i < 46; i++) { g.fillStyle = i % 3 ? '#1e293b' : '#94a3b8'; g.fillRect(x + w * 0.06 + i * (w * 0.019), y + h * 0.28, w * 0.012, h * 0.2); } ['ADRESSE : ABIDJAN (FICTIVE)', 'DÉLIVRÉE POUR LA DÉMO', '<<<DEMO<<<<<<<<<<<<<<<<<<<'].forEach((t, i) => g.fillText(t, x + w * 0.06, y + h * (0.62 + i * 0.12))); }
      };
      if (type === 'selfie_cni') { g.fillStyle = '#d9cbb3'; g.fillRect(0, 0, W, H); g.fillStyle = '#c2b296'; g.fillRect(0, H * 0.72, W, H); face(W * 0.42, H * 0.38, 2.2); card(W * 0.55, H * 0.45, W * 0.38, H * 0.36, false); }
      else { g.fillStyle = '#a07850'; g.fillRect(0, 0, W, H); for (let i = 0; i < 12; i++) { g.fillStyle = i % 2 ? '#93693f' : '#a98159'; g.fillRect(0, i * H / 12, W, 4); } card(W * 0.12, H * 0.16, W * 0.76, H * 0.66, type === 'cni_verso'); }
      let out = c;
      // Photo floue : réduite puis agrandie (marche sur tous les navigateurs, sans filtre).
      if (blurry) { const sm = document.createElement('canvas'); sm.width = 60; sm.height = 40; sm.getContext('2d').drawImage(c, 0, 0, 60, 40); out = document.createElement('canvas'); out.width = W; out.height = H; const o = out.getContext('2d'); o.imageSmoothingEnabled = true; o.drawImage(sm, 0, 0, W, H); }
      out.toBlob(b => resolve(b ? new File([b], 'demo-' + type + (blurry ? '-floue' : '') + '.jpg', { type: 'image/jpeg' }) : null), 'image/jpeg', 0.86);
    } catch { resolve(null); }
  });
}
function DemoPhotos({ types, onFile, busy }) {
  const send = async blurry => { for (const t of (blurry ? ['selfie_cni'] : types)) { const f = await demoPhoto(t, blurry); if (f) await onFile(t, f); } };
  return <div className="cl-demo-ph">
    <span className="tiny muted">Pour la démo, sans vraie pièce :</span>
    <div className="row"><Btn size="s" kind="sim" disabled={busy} onClick={() => send(false)}>{Icon.camera}Photos de démonstration</Btn><Btn size="s" kind="ghost" disabled={busy} onClick={() => send(true)}>Une photo floue</Btn></div>
  </div>;
}
function PhotoBtn({ id, type, busy, onFile, children, kind = 'primary', pdf }) {
  return <label className={'btn btn-s ' + (kind ? 'btn-' + kind : '') + ' cl-photo-btn' + (busy ? ' is-busy' : '')} htmlFor={id} aria-disabled={busy ? 'true' : undefined}>
    {busy ? 'Envoi…' : <>{Icon.camera}{children}</>}
    <PhotoInput id={id} type={type} onFile={onFile} disabled={busy} pdf={pdf} />
  </label>;
}
function usePhotoSender(token, orderId, opts = {}) {
  const [busy, setBusy] = useState(null);
  const [ask, setAsk] = useState(null);
  const send = async (type, f, pic) => { setBusy(type); try { await sendDoc(token, orderId, type, f, pic, opts); } finally { setBusy(null); } };
  const onFile = async (type, f, inputId) => {
    if (!f) return;
    setBusy(type);
    let pic = null;
    try { pic = await prepareImage(f); } catch { pic = null; }
    const issues = pic ? photoIssues(pic.quality) : [];
    if (issues.length) { setBusy(null); setAsk({ type, f, pic, issues, inputId }); return; }
    try { await sendDoc(token, orderId, type, f, pic, opts); } finally { setBusy(null); }
  };
  const retake = () => { const id = ask.inputId; setAsk(null); const el = id && document.getElementById(id); if (el) el.click(); };
  const modal = ask && <Modal title={'Cette photo semble ' + andList(ask.issues)} onClose={() => setAsk(null)} actions={<><Btn kind="primary" onClick={retake}>{Icon.camera}Reprendre</Btn><AsyncBtn onClick={async () => { const a = ask; setAsk(null); await send(a.type, a.f, a.pic); }}>Envoyer quand même</AsyncBtn></>}>
    <div className="cl-ask">
      {ask.pic && <img src={ask.pic.thumb} alt="" />}
      <div className="stack-s" style={{ gap: 2 }}><b>La reprendre ?</b><span className="small muted">Une photo nette évite que Nadia vous la redemande. Posez la pièce à plat, près d’une fenêtre, sans flash.</span></div>
    </div>
  </Modal>;
  return { busy, onFile, modal };
}

// Choix d'une demi-journée (même présentation dans l'assistant et dans Rendez-vous).
function SlotGrid({ slots, isSel, onPick, limit = 4 }) {
  const [more, setMore] = useState(false);
  const days = [];
  for (const s of slots) { let d = days.find(x => x.date === s.date); if (!d) days.push(d = { date: s.date, list: [] }); d.list.push(s); }
  const shown = more ? days : days.slice(0, limit);
  return <>
    <div className="cl-days" data-tour="client-slots">
      {shown.map(d => <div key={d.date} className="cl-day">
        <DateTile t={d.date} />
        <div className="cl-day-slots">{['m', 'a'].map(k => {
          const s = d.list.find(x => x.slot === k);
          if (!s) return <span key={k} className="cl-slot-none" />;
          return <button type="button" key={k} className="slot cl-slot" disabled={s.left <= 0} aria-pressed={isSel(s)} onClick={() => onPick(s)} aria-label={fmtDate(s.date) + ', ' + slotLabel(s.slot) + ', ' + (s.left > 0 ? s.left + ' place(s)' : 'complet')}>
            <b>{k === 'm' ? 'Matin' : 'Après-midi'}</b><span className="tiny">{slotLabel(k)}</span><span className="tiny muted">{s.left > 0 ? s.left + (s.left > 1 ? ' places' : ' place') : 'complet'}</span>
          </button>;
        })}</div>
      </div>)}
    </div>
    {days.length > limit && <button type="button" className="link-btn cl-moredates" onClick={() => setMore(!more)}>{more ? 'Moins de dates' : 'Plus de dates (' + (days.length - limit) + ')'}</button>}
  </>;
}

function Home({ token, orderId, go, me, isRep }) {
  const r = useQ(token, 'client.order', { orderId });
  const [wiz, setWiz] = useWizard(token, orderId);
  if (r.error) return <div className="alert alert-bad">{r.error.message}</div>;
  const v = r.data; const o = v.order; const dz = v.dossier;
  const na = nextAction(v, isRep);
  const dzOpen = !!dz && DZ_OPEN.includes(dz.status) && !o.cancelled;
  const draft = dzOpen && DZ_DRAFT.includes(dz.status);
  // L'assistant de dossier et l'écran de succès prennent tout l'écran du téléphone.
  if (draft && wiz.open && !isRep) return <DossierWizard token={token} v={v} me={me} wiz={wiz} setWiz={setWiz} go={go} />;
  if (wiz.sent && dz && dz.submittedAt) return <DossierSent v={v} sent={wiz.sent} onClose={() => setWiz({ sent: null })} />;
  // Un dossier incomplet montre déjà la pièce manquante : on n'affiche pas le blocage une seconde fois.
  const open = v.blockers.filter(b => b.status === 'ouvert' && !(dz && dz.status === 'incomplet' && b.type === 'PIECE_MANQUANTE'));
  const idx = ORDER_STATES.indexOf(o.state);
  const last = ORDER_STATES.length;
  const finished = ['SERVICE_ACTIF', 'CLOTURE'].includes(o.state);
  const live = !!v.mission && (v.mission.status === 'sur_place' || (v.mission.status === 'en_route' && !!v.mission.track));
  // Le technicien n'est noté qu'une fois la visite validée (ou si aucune validation n'était demandée).
  const rate = !!v.lastVisit && !isRep && (!v.lastVisit.signoff || signDone(v.lastVisit.signoff)) && (!v.techRating || rated.has(o.id));
  const sign = signPending(v.mission) && !o.cancelled;
  const journey = !!v.mission && !!VJ_AT[v.mission.status] && !finished && !o.cancelled;
  const prep = !live && o.state === 'RDV_CONFIRME' && v.appt && v.appt.status === 'confirme' && !(v.mission && ['en_route', 'sur_place', 'en_cours'].includes(v.mission.status));
  const dzCard = !dzOpen ? null
    : draft ? <DossierStart v={v} me={me} na={na} onStart={() => setWiz({ open: true })} />
    : dz.status === 'incomplet' ? <DossierMissing token={token} v={v} go={go} isRep={isRep} />
    : <DossierWaiting token={token} v={v} na={na} />;
  return <>
    <Stale at={v.stale} />
    {sign && <SignoffCard token={token} v={v} me={me} isRep={isRep} />}
    {journey && <VisitJourney v={v} />}
    {live && <LiveTrack v={v} me={me} />}
    {live && v.mission.status === 'en_route' && !isRep && <Prep token={token} v={v} arriving />}
    {rate && !v.techRating && !!v.lastVisit.signoff && <SignoffThanks v={v} me={me} />}
    {rate && <RateTech key={v.lastVisit.woId} token={token} v={v} />}
    {dzCard}
    {dz && !o.cancelled && !finished && !journey && <DossierSteps v={v} />}
    {prep && <PrepNudge v={v} go={go} />}
    <section className="card cl-hero" data-tour="client-state">
      <div className="cl-scene">
        <span className="cl-scene-tag">{dzOpen && DZ_LABEL[dz.status] ? <Tag tone={dz.status === 'incomplet' || dz.status === 'en_retard' ? 'bad' : dz.status === 'verifie' ? 'ok' : 'info'}>{DZ_LABEL[dz.status]}</Tag> : <StateTag state={o.state} cancelled={o.cancelled} />}</span>
        <HouseScene progress={finished ? 1 : idx / (last - 1)} height={112} />
      </div>
      <div className="cl-hero-row">
        <div className="big">{o.cancelled ? 'Votre commande est annulée.' : dzOpen && DZ_HERO[dz.status] ? DZ_HERO[dz.status] : STATE_INFO[o.state].client}</div>
        <span className="cl-ring" role="img" aria-label={'Étape ' + (idx + 1) + ' sur ' + last}>
          <Ring value={idx + 1} max={last} size={56} stroke={6} color={finished ? 'var(--ok)' : 'var(--accent)'}><span className="num">{idx + 1}<small>/{last}</small></span></Ring>
        </span>
      </div>
      <span className="tiny muted">Dossier {o.ref} · mis à jour {fmtAgo(Math.max(0, v.estimate.at - o.updatedAt))}{o.paidAt && <> · payé le {fmtDate(o.paidAt)}</>}</span>
      <Explain>{STATE_INFO[o.state].clear}</Explain>
    </section>
    {!dzCard && <section className="next cl-next" data-tour="client-next">
      <div className="spread cl-next-top"><span className="eyebrow">Votre prochaine action</span><span className="cl-next-ic" aria-hidden="true">{na.icon || NEXT_ICON[na.go] || Icon.clock}</span></div>
      <b className="cl-next-t">{na.title}</b>
      {na.text && <span className="small cl-next-d">{na.text}</span>}
      {na.go && <Btn onClick={() => go(na.go, na.sub)}>{na.cta}{Icon.right}</Btn>}
    </section>}
    {open.map(b => {
      const mine = b.owner === 'vous';
      return <section key={b.id} className="card cl-block" data-tour="client-blocker">
        <div className="spread"><Tag tone="bad"><span className="dot" />Point bloquant</Tag><span className="tiny muted">avant le {fmtDateTime(b.dueAt)}</span></div>
        <div className="stack-s"><b className="cl-block-t">{b.label}</b><span className="small muted">{b.text}</span></div>
        <div className={'cl-who' + (mine ? ' cl-who-me' : '')}>
          <Avatar name={mine ? me.user.name : ownerFace(b.owner)} size={36} />
          <div className="grow"><span className="tiny muted">{mine ? 'À vous d’agir' : 'Qui agit : ' + b.owner.replace(' (', ' · ').replace(')', '')}</span><b className="small">{b.action}</b></div>
        </div>
      </section>;
    })}
    {!live && v.mission && ['affectee', 'en_route', 'sur_place', 'en_cours'].includes(v.mission.status) && v.appt && <MissionCard v={v} />}
    {!live && <Estimate v={v} />}
    {o.paidAt && <DelayCard v={v} />}
  </>;
}

function MissionCard({ v }) {
  const m = v.mission;
  const lab = { affectee: 'Équipe affectée', en_route: 'En route vers chez vous', sur_place: 'Arrivé', en_cours: 'Installation en cours' }[m.status];
  return <section className="card cl-mission" data-tour="client-mission">
    <div className="card-title"><h3>Votre technicien</h3><Tag tone={m.status === 'en_route' ? 'warn' : 'info'}>{lab}</Tag></div>
    <div className="cl-tech">
      <Avatar name={fullName(m.techName)} size={56} dot={m.status === 'affectee' ? undefined : 'ok'} />
      <div className="grow"><b>{m.techName}</b><span className="small muted">{m.company}</span><span className="tiny muted">Carte {m.badge}</span></div>
    </div>
    {m.status === 'en_route' && <div className="cl-van"><VanScene height={62} /></div>}
    <div className="cl-when">{Icon.cal}<span>{v.appt.time ? apptWhen(v.appt, null) : fmtDate(v.appt.date) + ', ' + slotLabel(v.appt.slot)}</span></div>
    <div className="cl-code">
      <span className="tiny">Votre code de réception</span>
      <b className="num">{m.receptionCode}</b>
      <span className="tiny">À donner au technicien seulement à la fin, si le travail vous convient.</span>
    </div>
    <span className="tiny muted">Pour le joindre, écrivez dans Messages : votre conseiller le prévient. Son numéro personnel n’est jamais partagé.</span>
  </section>;
}

function Estimate({ v }) {
  const e = v.estimate;
  if (e.done) return null;
  const rel = { bonne: 'ok', moyenne: 'warn', faible: 'bad' }[e.reliability];
  return <section className="card cl-est" data-tour="client-estimate">
    <div className="card-title"><h3>Délai restant estimé</h3><Sim what="IA" /></div>
    {e.abstain ? <p className="small muted">{e.reason}</p> : <>
      <div className="cl-est-v"><span className="cl-big num">{frRange(e.loH, e.hiH)}</span>{rel && <Tag tone={rel}>Fiabilité {e.reliability}</Tag>}</div>
      <RangeBar lo={e.loH} med={e.medianH} hi={e.hiH} />
      {e.confirmedAppt && <div className="alert alert-ok small">Engagement ferme : rendez-vous confirmé le {fmtDate(e.confirmedAppt.date)} ({slotLabel(e.confirmedAppt.slot)}). L’estimation reste une prévision.</div>}
      {e.risk && <div className="alert alert-warn small">{e.risk}</div>}
      <details className="cl-more">
        <summary>Pourquoi cette estimation ?</summary>
        <div className="cl-more-in">
          <div className="cl-causes">{e.causes.map((c, i) => <div key={i} className="cl-cause"><span className="dot" />{c.label}{c.effect !== 'référence' && c.effect !== 'neutre' && <em>{c.effect}</em>}</div>)}</div>
          <p className="small">Une <b>estimation</b> est une prévision avec une fourchette, calculée à partir de dossiers comparables. Elle peut changer. Un <b>rendez-vous confirmé</b>, lui, est un engagement de Moov.</p>
          <span className="tiny muted">Calculé le {fmtDateTime(e.at)} · modèle {e.modelVersion}</span>
        </div>
      </details>
    </>}
    <span className="tiny muted">IA entraînée sur des données inventées : elle montre le fonctionnement, pas la précision réelle.</span>
  </section>;
}

// Fourchette du délai (bas, probable, haut), sur une échelle qui part d'aujourd'hui.
function RangeBar({ lo, med, hi }) {
  const max = hi * 1.12 || 1;
  const p = x => Math.max(0, Math.min(100, x / max * 100));
  return <div className="cl-range">
    <div className="cl-range-track" aria-hidden="true"><i style={{ left: p(lo) + '%', width: (p(hi) - p(lo)) + '%' }} /><b style={{ left: p(med) + '%' }} /></div>
    <div className="cl-range-l"><span>Aujourd’hui</span><span><i className="cl-range-dot" />Le plus probable : {frDur(med)}</span></div>
  </div>;
}

function DelayCard({ v }) {
  const o = v.order;
  const days = Math.max(0, Math.round((v.estimate.at - o.paidAt) / 864e5 * 10) / 10);
  const ref = Math.round((v.contractDue - o.paidAt) / 864e5);
  const pct = ref ? Math.min(100, days / ref * 100) : 0;
  return <section className="card cl-mini">
    <div className="cl-mini-top">
      <span className="cl-ic">{Icon.clock}</span>
      <div className="grow"><span className="tiny muted">Depuis votre paiement</span><b className="cl-mini-v num">{String(days).replace('.', ',')} j</b></div>
      <span className="small muted cl-mini-ref">sur {ref} j prévus</span>
    </div>
    <div className="bar" aria-hidden="true"><i style={{ width: pct + '%', background: days > ref ? 'var(--bad)' : 'var(--ink)' }} /></div>
    <span className="tiny muted">Ce compteur ne s’arrête jamais, même si une étape est suspendue. Délai de référence de démonstration, paramétrable.</span>
  </section>;
}

// ---------- Rendez-vous ----------
function Appointments({ token, orderId, go }) {
  const r = useQ(token, 'client.order', { orderId });
  const av = useQ(token, 'client.availability', { orderId });
  const [sel, setSel] = useState(null);
  const [changing, setChanging] = useState(false);
  const [alts, setAlts] = useState(null);
  const [cancelAsk, setCancelAsk] = useState(false);
  if (r.error) return <div className="alert alert-bad">{r.error.message}</div>;
  const v = r.data; const o = v.order;
  const appt = v.appt && ['reserve', 'confirme', 'en_cours'].includes(v.appt.status) ? v.appt : null;
  const underway = o.state === 'INTERVENTION_EN_COURS' || (!!v.mission && ['en_route', 'sur_place', 'en_cours'].includes(v.mission.status));
  const cancelling = !!v.refund && v.refund.status !== 'rejete';
  const dz = v.dossier;
  // Dossier en ligne déjà envoyé : le créneau peut se changer dès l'état « préparation » (le serveur l'autorise).
  const canBook = (['PRET_A_PLANIFIER', 'RDV_CONFIRME'].includes(o.state) || (o.state === 'PREPARATION' && !!dz && !!dz.submittedAt)) && !o.cancelled && !underway && !cancelling;
  const hold = v.hold;
  const isSel = s => !!sel && sel.date === s.date && sel.slot === s.slot;
  const doHold = async s => {
    setAlts(null);
    const res = await call(token, 'appt.hold', { orderId, date: s.date, slot: s.slot }, { silent: true });
    if (!res.ok) { setAlts({ msg: res.error.message, list: (res.error.extra || {}).alternatives || [] }); return; }
    setSel(null);
  };
  const slots = av.data ? av.data.slots : [];
  return <>
    <div className="cl-h"><h2>Rendez-vous</h2></div>
    {!!v.mission && !!VJ_AT[v.mission.status] && !o.cancelled && !['SERVICE_ACTIF', 'CLOTURE'].includes(o.state) && <VisitJourney v={v} />}
    {appt && <section className="card cl-appt" data-tour="client-appt">
      <div className="cl-appt-main">
        <DateTile t={appt.date} tone="lime" />
        <div className="grow stack-s" style={{ gap: 2 }}>
          <span className="tiny muted">Votre visite</span>
          {appt.time ? <b className="cl-appt-t cl-appt-cap">{apptWhen(appt, v.mission)}</b> : <b className="cl-appt-t">{appt.slot === 'm' ? 'Le matin' : 'L’après-midi'}, {slotLabel(appt.slot)}</b>}
          <span><Tag tone={appt.status === 'confirme' ? 'ok' : 'warn'}>{appt.status === 'reserve' && dz ? 'Heure à confirmer' : APPT_STATES[appt.status]}</Tag></span>
        </div>
        {appt.time && v.mission && <Avatar name={fullName(v.mission.techName)} size={44} />}
      </div>
      {!underway && <p className="small muted">{appt.status === 'reserve' ? (dz ? 'Créneau demandé. Moov confirme l’heure exacte et le technicien après la vérification de vos photos.' : 'Le créneau vous est réservé. Moov confirme l’équipe sous peu.') : appt.time ? 'Le technicien vient à cette heure. Vous recevrez un rappel la veille, puis son trajet en direct.' : 'Une équipe est affectée. Vous recevrez un rappel la veille.'}</p>}
      {underway && <p className="small cl-note">Le technicien est déjà en route ou chez vous : pour changer ce rendez-vous, écrivez à votre conseiller dans Messages.</p>}
      {!changing && !underway && <div className="row"><Btn size="s" onClick={() => setChanging(true)}>Modifier</Btn><Btn size="s" kind="ghost" className="cl-danger-link" onClick={() => setCancelAsk(true)}>Annuler le rendez-vous</Btn></div>}
    </section>}
    {cancelAsk && <Modal title="Annuler ce rendez-vous ?" onClose={() => setCancelAsk(false)} actions={<><AsyncBtn kind="primary" onClick={async () => { await call(token, 'appt.cancel', { orderId, reason: 'Annulé par le client' }); setCancelAsk(false); }}>Oui, annuler</AsyncBtn><Btn onClick={() => setCancelAsk(false)}>Garder</Btn></>}>
      <p>Le créneau sera libéré pour un autre client. Votre commande reste active : vous pourrez choisir une autre date.</p>
    </Modal>}
    {canBook && (!appt || changing) && <>
      {hold ? <section className="card-dark cl-hold">
        <div className="cl-hold-row">
          <HoldTimer key={hold.id} hold={hold} />
          <div className="stack-s" style={{ gap: 2 }}><span className="eyebrow">Créneau gardé pour vous</span><b className="cl-hold-t">{fmtDate(hold.date)}</b><span className="small">{slotLabel(hold.slot)}</span></div>
        </div>
        <AsyncBtn kind="primary" block className="cl-lime" onClick={async () => { const x = await call(token, 'appt.book', { orderId, holdId: hold.id }); if (x.ok) setChanging(false); }}>Confirmer ce créneau</AsyncBtn>
        <span className="tiny muted">Personne d’autre ne peut le prendre pendant ce temps. Sans confirmation, il est relâché. Délai réel, non accéléré.</span>
      </section> : <section className="card cl-book">
        <div className="card-title"><h3>Choisir une demi-journée</h3>{changing && <Btn size="s" kind="ghost" onClick={() => setChanging(false)}>Retour</Btn>}</div>
        <p className="small muted">Seuls les créneaux où une équipe est vraiment libre sont affichés.</p>
        {av.data && av.data.conditional && <div className={'alert small ' + (av.data.conditional === 'bloque' ? 'alert-bad' : 'alert-warn')}>{av.data.conditional === 'bloque' ? 'Matériel indisponible : la prise de rendez-vous est suspendue. Aucune date ne vous est promise.' : 'Matériel en tension : votre créneau sera confirmé seulement quand l’équipement sera disponible.'} <Sim /></div>}
        {alts && <div className="alert alert-warn small stack-s"><b>{alts.msg}</b><div className="row">{alts.list.map(s => <Btn key={s.date + s.slot} size="s" onClick={() => doHold(s)}>{fmtDate(s.date)} · {slotLabel(s.slot)}</Btn>)}</div></div>}
        {slots.length === 0 && av.data && <Empty>Aucun créneau libre pour le moment. Revenez plus tard ou demandez à être rappelé.</Empty>}
        <SlotGrid slots={slots} isSel={isSel} onPick={setSel} />
        <div className="cl-book-go">
          {sel && <span className="small">Choisi : <b>{fmtDate(sel.date)}, {slotLabel(sel.slot)}</b></span>}
          <AsyncBtn kind="primary" block disabled={!sel} onClick={() => doHold(sel)}>Réserver ce créneau</AsyncBtn>
        </div>
        <Explain>Quand vous choisissez un créneau, il est <b>gardé {minutes(av.data && av.data.holdMinutes)}</b> rien que pour vous : personne d’autre ne peut le prendre pendant que vous confirmez. Sans confirmation, il est relâché.</Explain>
      </section>}
    </>}
    {!canBook && !appt && dz && DZ_DRAFT.includes(dz.status) && <section className="card stack cl-empty">
      <Empty>Vous choisissez votre créneau dans votre dossier en ligne, juste après les photos et votre repère.</Empty>
      {go && <Btn kind="primary" block onClick={() => { openWizard(token, orderId); go('home'); }}>Compléter mon dossier{Icon.right}</Btn>}
    </section>}
    {!canBook && !appt && !(dz && DZ_DRAFT.includes(dz.status)) && <div className="card cl-empty"><Empty>{o.state === 'SERVICE_ACTIF' || o.state === 'CLOTURE' ? 'L’installation est faite.' : 'Les créneaux s’ouvrent quand la vérification technique est terminée. Vous recevrez une notification.'}</Empty></div>}
    <Prep token={token} v={v} />
    {v.appointments.length > 1 && <details className="card cl-more">
      <summary>Historique des rendez-vous ({v.appointments.length})</summary>
      <div className="cl-more-in">{v.appointments.map(a => <div key={a.id} className="cl-hist"><span className="grow">{fmtDate(a.date)}, {slotLabel(a.slot)}{a.reason ? <span className="tiny muted"> · {a.reason}</span> : null}</span><Tag tone={a.status === 'confirme' || a.status === 'realise' ? 'ok' : a.status === 'annule' || a.status === 'non_honore' ? 'bad' : ''}>{APPT_STATES[a.status]}</Tag></div>)}</div>
    </details>}
  </>;
}

function DateTile({ t, tone }) {
  const p = dparts(t);
  return <span className={'cl-date' + (tone ? ' cl-date-' + tone : '')} aria-hidden="true"><span>{p.wd}</span><b className="num">{p.d}</b><span>{p.m}</span></span>;
}

function HoldTimer({ hold }) {
  const [, t] = useState(0);
  const total = useRef(null);
  useEffect(() => { const i = setInterval(() => t(x => x + 1), 1000); return () => clearInterval(i); }, []);
  const s = Math.max(0, Math.round((hold.expiresReal - Date.now()) / 1000));
  if (total.current == null) total.current = Math.max(1, s);
  const label = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  return <span className="cl-timer" role="timer" aria-label={'Expire dans ' + Math.floor(s / 60) + ' min ' + (s % 60) + ' s'}>
    <Ring value={s} max={total.current} size={82} stroke={7} color="var(--lime)" track="var(--dark-3)"><span className="num">{label}</span></Ring>
  </span>;
}

function Prep({ token, v, arriving }) {
  const o = v.order;
  const items = PREP_CHECKLIST.filter(i => !i.when || i.when === o.address.building);
  // Le compteur suit les points indispensables, comme sur l'accueil (les autres sont conseillés).
  const need = items.filter(i => i.need);
  const done = need.filter(i => o.prep[i.id]).length;
  const all = done === need.length;
  const locked = o.cancelled || ORDER_STATES.indexOf(o.state) >= ORDER_STATES.indexOf('INSTALLATION_TERMINEE');
  return <section className="card cl-prep" data-tour="client-prep">
    <div className="card-title">
      <div className="stack-s" style={{ gap: 0 }}><h3>{arriving ? 'Avant son arrivée : vérifiez' : 'Préparer la visite'}</h3><span className="tiny muted">{arriving && !all ? 'Cochez ce qui est prêt : le technicien le voit sur son téléphone.' : items.every(i => o.prep[i.id]) ? 'Tout est prêt, merci !' : all ? 'L’indispensable est prêt, merci !' : 'Indispensable : ' + done + ' sur ' + need.length + ' · pour éviter un second déplacement'}</span></div>
      <span role="img" aria-label={done + ' sur ' + need.length + ' indispensables cochés'}><Ring value={done} max={need.length} size={50} stroke={5} color="var(--ok)"><span className="cl-ring-s num">{done}/{need.length}</span></Ring></span>
    </div>
    <div className="cl-checks">
      {items.map(i => <label key={i.id} className={'cl-check' + (o.prep[i.id] ? ' on' : '')}>
        <input type="checkbox" disabled={locked} checked={!!o.prep[i.id]} onChange={e => call(token, 'prep.toggle', { orderId: o.id, id: i.id, value: e.target.checked })} />
        <span className="cl-box" aria-hidden="true">{Icon.check}</span>
        <span className="grow cl-check-l">{i.label}{i.need && <span className="cl-need">Indispensable</span>}</span>
      </label>)}
    </div>
    {o.address.building === 'immeuble' && <span className="tiny muted">Vous habitez en immeuble : l’accord du propriétaire ou du syndic peut être demandé.</span>}
  </section>;
}

// ---------- Messages ----------
const QUESTIONS = ['Où en est mon dossier ?', 'Pourquoi faut-il attendre ?', 'Que dois-je préparer ?', 'Comment modifier mon rendez-vous ?'];
const Bot = ({ size = 32 }) => <span className="cl-bot" style={{ width: size, height: size }} role="img" aria-label="Assistant Moov">{Icon.logo}</span>;

// La conversation avec l'assistant est gardée le temps de la visite (changer d'onglet ne l'efface pas).
const chats = new Map();
function Messages({ token, orderId, go, me, mode: mode0, setMode: setMode0 }) {
  const r = useQ(token, 'client.order', { orderId });
  const [modeL, setModeL] = useState('ai');
  const mode = mode0 || modeL, setMode = setMode0 || setModeL;
  const [text, setText] = useState('');
  const [aiText, setAiText] = useState('');
  const [chat, setChatRaw] = useState(() => chats.get(token + orderId) || []);
  const setChat = f => setChatRaw(c => { const n = typeof f === 'function' ? f(c) : f; chats.set(token + orderId, n); return n; });
  const endRef = useRef(null);
  useEffect(() => { if (chat.length && endRef.current) endRef.current.scrollIntoView({ block: 'nearest' }); }, [chat.length]);
  if (r.error) return <div className="alert alert-bad">{r.error.message}</div>;
  const v = r.data;
  const ask = async q => {
    if (!q.trim()) return;
    setChat(c => [...c, { me: true, text: q }]); setAiText('');
    const res = await call(token, 'assistant.ask', { orderId, question: q }, { silent: true });
    setChat(c => [...c, res.ok ? { ans: res.data, q } : { err: res.error.message }]);
  };
  const send = async () => { if (!text.trim()) return; if ((await call(token, 'msg.send', { orderId, text })).ok) setText(''); };
  // Pastille : réponses arrivées depuis votre dernier message.
  const lastMine = v.messages.filter(m => m.from === 'client').at(-1);
  const staffN = v.messages.filter(m => m.from === 'staff' && (!lastMine || m.at >= lastMine.at && m.id !== lastMine.id && m.eventSeq > (lastMine.eventSeq || 0))).length;
  const tabs = [['ai', 'Assistant'], ['human', 'Conseiller', staffN], ['cb', 'Appeler']];
  return <>
    <div className="pills pills-soft cl-tabs" role="tablist" aria-label="Type d’échange">
      {tabs.map(([k, l, n]) => <button type="button" key={k} role="tab" aria-selected={mode === k} onClick={() => setMode(k)}>{l}{n > 0 && <span className="count">{n}</span>}</button>)}
    </div>
    {mode === 'ai' && <div className="cl-chat" data-tour="client-assistant">
      <div className="cl-bot-head"><Bot size={44} /><div className="cl-hello-t"><b>Assistant Moov</b><span>Réponse automatique, sources citées</span></div></div>
      <div className="cl-msg"><Bot /><div className="bubble bubble-them">Bonjour {firstName(me.user.name)}. Je lis votre dossier et les procédures Moov approuvées. Je ne peux ni confirmer un paiement, ni promettre une date. Si je ne sais pas, je le dis et je vous passe un conseiller.</div></div>
      {chat.map((m, i) => m.me ? <div key={i} className="cl-me"><div className="bubble bubble-me">{m.text}</div></div>
        : m.err ? <div key={i} className="alert alert-warn small">{m.err}</div>
        : <AiAnswer key={i} a={m.ans} q={m.q} token={token} orderId={orderId} go={go} />)}
      <div className="cl-chips" aria-label="Questions suggérées">{QUESTIONS.map(q => <button type="button" key={q} className="cl-chip" onClick={() => ask(q)}>{q}</button>)}</div>
      <form className="cl-compose" ref={endRef} onSubmit={e => { e.preventDefault(); ask(aiText); }}>
        <input id="ai-q" value={aiText} onChange={e => setAiText(e.target.value)} placeholder="Posez votre question" aria-label="Question pour l’assistant" autoComplete="off" />
        <button type="submit" className="cl-send" aria-label="Envoyer" disabled={!aiText.trim()}>{I2.send}</button>
      </form>
    </div>}
    {mode === 'human' && <div className="cl-chat">
      {v.messages.length === 0 && <div className="card cl-empty"><Empty who="Nadia Konan">Aucun échange pour l’instant. Écrivez-nous : un conseiller vous répond, en général sous 4 h ouvrées.</Empty></div>}
      {v.messages.map(m => m.auto ? <div key={m.id} className="cl-sys">{m.text}<span> · {fmtDateTime(m.at)}</span></div>
        : m.from === 'client' ? <div key={m.id} className="cl-me"><div className="bubble bubble-me">{m.text}</div><span className="src">{m.author === me.user.name ? 'Vous' : firstName(m.author)} · {fmtDateTime(m.at)}</span></div>
        : <div key={m.id} className="cl-msg"><Avatar name={m.author} size={32} /><div className="cl-msg-in"><span className="src"><b>{firstName(m.author)}</b> · {((ROLES[m.role] || {}).label || 'Conseiller').toLowerCase()} (humain) · {fmtDateTime(m.at)}</span><div className="bubble bubble-them">{m.text}</div></div></div>)}
      <form className="cl-compose" onSubmit={e => { e.preventDefault(); send(); }}>
        <input id="msg-t" value={text} onChange={e => setText(e.target.value)} placeholder="Écrire au service client" aria-label="Message" autoComplete="off" />
        <button type="submit" className="cl-send" aria-label="Envoyer" disabled={!text.trim()}>{I2.send}</button>
      </form>
    </div>}
    {mode === 'cb' && <><CallStart token={token} v={v} /><Callback token={token} v={v} /></>}
  </>;
}

const BLOCK_COLOR = { fact: 'var(--ok)', doc: 'var(--info)', estimate: 'var(--sim)', abstain: 'var(--warn)', guard: 'var(--bad)', warn: 'var(--warn)', action: 'var(--ink)' };
function AiAnswer({ a, q, token, orderId, go }) {
  const [sent, setSent] = useState(false);
  const handoff = label => sent ? <span className="small cl-sent">{Icon.check}Transmis à un conseiller.</span> : <div><AsyncBtn size="s" onClick={async () => { if ((await call(token, 'assistant.handoff', { orderId, question: q })).ok) setSent(true); }}>{label}</AsyncBtn></div>;
  return <div className="cl-msg"><Bot /><div className="bubble bubble-them cl-ans">
    {a.blocks.map((b, i) => <div key={i} className="cl-blk">
      <span className="cl-blk-t"><i style={{ background: BLOCK_COLOR[b.kind] }} />{b.title}</span>
      <span className="small">{b.text}</span>
      {b.source && <span className="src">Source : {b.source}{b.fresh ? ' · ' + b.fresh.label : ''}</span>}
      {b.doc && <span className="src">Procédure {b.doc.id} « {b.doc.title} », version {b.doc.version}</span>}
      {b.action && b.action.go && <div><Btn size="s" onClick={() => go(b.action.go === 'prep' ? 'rdv' : b.action.go)}>Ouvrir{Icon.right}</Btn></div>}
      {b.action && b.action.handoff && handoff('Transférer à un conseiller')}
    </div>)}
    {a.handoff && !a.blocks.some(b => b.action) && handoff('Parler à un conseiller')}
  </div></div>;
}

const hasOwner = c => !!c.ownerName && c.ownerName !== '\u2014'; // le serveur met un tiret long quand personne n’est désigné
function Callback({ token, v }) {
  const [reason, setReason] = useState('');
  const [when, setWhen] = useState('Dès que possible');
  return <div className="stack">
    {v.callbacks.map(c => <section key={c.id} className="card cl-cb">
      {hasOwner(c) ? <Avatar name={c.ownerName} size={42} /> : <span className="cl-ic">{Icon.phone}</span>}
      <div className="grow stack-s" style={{ gap: 1 }}>
        <b className="small">{c.status === 'fait' ? 'Rappel effectué' : hasOwner(c) ? firstName(c.ownerName) + ' va vous rappeler' : 'Rappel demandé'}</b>
        <span className="small muted">{c.availability}{c.reason ? ' · ' + c.reason : ''}</span>
        <span className="tiny muted">Demandé le {fmtDateTime(c.at)}</span>
      </div>
      <Tag tone={c.status === 'fait' ? 'ok' : c.status === 'echec' ? 'bad' : 'warn'}>{CB_LAB[c.status] || 'En cours'}</Tag>
    </section>)}
    <section className="card stack">
      <div className="cl-hello"><span className="cl-ic">{Icon.clock}</span><div className="cl-hello-t"><b>Plutôt être rappelé ?</b><span>Un conseiller vous appelle au moment choisi.</span></div></div>
      <Field label="Motif" id="cb-r"><input id="cb-r" className="input" value={reason} onChange={e => setReason(e.target.value)} placeholder="Ex. : question sur l’installation" /></Field>
      <Field label="Quand êtes-vous joignable ?" id="cb-w"><select id="cb-w" className="input" value={when} onChange={e => setWhen(e.target.value)}>{['Dès que possible', 'Ce matin (8 h – 12 h)', 'Cet après-midi (13 h – 17 h)', 'Demain', 'Après 18 h'].map(x => <option key={x}>{x}</option>)}</select></Field>
      <AsyncBtn kind="primary" block onClick={async () => { if ((await call(token, 'callback.request', { orderId: v.order.id, reason, availability: when })).ok) setReason(''); }}>Demander un rappel</AsyncBtn>
    </section>
  </div>;
}

// Appel simulé au service client : le téléphone de la conseillère sonne dans l'Équipe Moov.
const CALL_END = { termine: 'Terminé', manque: 'Manqué', refuse: 'Manqué', annule: 'Annulé' };
function CallStart({ token, v }) {
  const [reason, setReason] = useState('');
  const liveCall = (v.calls || []).some(c => ['sonne', 'en_cours'].includes(c.status));
  const past = (v.calls || []).filter(c => CALL_END[c.status]).slice(-3).reverse();
  return <section className="card stack cl-callnow" data-tour="client-call">
    <div className="cl-hello"><Avatar name={ADVISOR} size={48} dot="ok" /><div className="cl-hello-t"><b>Service client Moov</b><span>Nadia ou une collègue vous répond.</span></div></div>
    <Field label="Motif (facultatif)" id="call-r"><input id="call-r" className="input" value={reason} onChange={e => setReason(e.target.value)} placeholder="Ex. : question sur mon rendez-vous" autoComplete="off" /></Field>
    <AsyncBtn kind="primary" block className="cl-callbtn" disabled={liveCall} onClick={async () => { if ((await call(token, 'call.start', { orderId: v.order.id, reason })).ok) setReason(''); }}>{Icon.handset}{liveCall ? 'Appel en cours…' : 'Appeler le service client'}</AsyncBtn>
    <span className="tiny muted">Appel simulé : pas de son, aucun vrai numéro composé. Sans réponse, un rappel est créé tout seul.</span>
    {past.length > 0 && <div className="cl-calls">{past.map(c => <div key={c.id} className="cl-calls-row">
      <span className={'cl-ic cl-ic-s' + (c.status === 'termine' ? ' cl-ic-ok' : ' cl-ic-warn')}>{Icon.handset}</span>
      <span className="grow small">{c.status === 'termine' ? 'Appel avec ' + firstName(c.toName) + ' · ' + callDur(c) : c.status === 'annule' ? 'Appel annulé' : 'Appel manqué · rappel prévu'}<span className="tiny muted"> · {fmtDateTime(c.startedAt)}</span></span>
      <Tag tone={c.status === 'termine' ? 'ok' : c.status === 'annule' ? '' : 'warn'}>{CALL_END[c.status]}</Tag>
    </div>)}</div>}
  </section>;
}

// Écran d'appel par-dessus le téléphone, quel que soit l'onglet ouvert.
const callsSeen = new Set();
function CallLayer({ token, orderId, me }) {
  const r = useQ(token, 'client.order', { orderId });
  const [closed, setClosed] = useState([]);
  useNow(1000);
  // Seulement les appels de la personne connectée (le représentant ne voit pas l'appel de la cliente).
  const calls = ((r.data && r.data.calls) || []).filter(c => c.mine !== false);
  const live = calls.find(c => ['sonne', 'en_cours'].includes(c.status));
  if (live) callsSeen.add(live.id);
  // Fin d'un appel vu en direct : on affiche le résultat jusqu'à ce que la personne ferme.
  const c = live || calls.filter(x => callsSeen.has(x.id) && !closed.includes(x.id) && CALL_END[x.status]).at(-1);
  if (!c) return null;
  const who = firstName(c.toName);
  const sec = c.answeredAt ? Math.max(0, Math.floor((liveClock(me.ws) - c.answeredAt) / 1000)) : 0;
  const st = c.status === 'sonne' ? 'Appel en cours…' : c.status === 'en_cours' ? pad2(Math.floor(sec / 60)) + ':' + pad2(sec % 60)
    : c.status === 'termine' ? 'Appel terminé (' + callDur(c) + ')' : c.status === 'annule' ? 'Appel annulé' : who + ' vous rappelle dès que possible';
  return <div className={'cl-call cl-call-' + c.status} role="dialog" aria-modal="true" aria-label="Appel au service client">
    <span className="cl-call-sim">{Icon.handset}Appel simulé : pas de son</span>
    <div className="cl-call-who">
      <span className={'cl-call-av' + (c.status === 'sonne' ? ' ringing' : c.status === 'en_cours' ? ' talking' : '')}><i /><i /><i /><Avatar name={c.toName} size={116} /></span>
      <b className="cl-call-name">{c.toName}</b>
      <span className="cl-call-role">Service client Moov</span>
      <span className={'cl-call-st' + (c.status === 'en_cours' ? ' num' : '')} role="timer" aria-live="polite">{st}</span>
      {c.status === 'sonne' && <span className="cl-call-hint">Le téléphone de {who} sonne dans l’Équipe Moov.</span>}
      {c.status === 'en_cours' && <span className="cl-call-hint">{who} a décroché.</span>}
      {['manque', 'refuse'].includes(c.status) && <span className="cl-call-hint">Un rappel a été créé : vous le suivez dans Messages.</span>}
    </div>
    {live ? <div className="cl-call-act">
      <AsyncBtn className="cl-call-end" aria-label="Raccrocher" onClick={() => call(token, 'call.end', { id: c.id })}>{Icon.handset}</AsyncBtn>
      <span>Raccrocher</span>
    </div> : <div className="cl-call-act"><Btn kind="primary" block className="cl-lime" onClick={() => setClosed(x => [...x, c.id])}>Fermer</Btn></div>}
  </div>;
}

// ---------- Dossier ----------
function FileTab({ token, orderId, isRep, initial }) {
  const r = useQ(token, 'client.order', { orderId });
  const [sub, setSub] = useState(initial || 'timeline');
  if (r.error) return <div className="alert alert-bad">{r.error.message}</div>;
  const v = r.data;
  const need = v.order.requiredDocs.filter(t => !v.documents.some(d => d.type === t && ['analyse', 'a_valider', 'valide'].includes(d.status))).length;
  return <>
    <div className="pills pills-soft cl-tabs" role="tablist" aria-label="Rubriques du dossier">
      {[['timeline', 'Historique'], ['docs', 'Pièces', need], ['addr', 'Adresse'], ['report', 'Compte rendu']].map(([k, l, n]) => <button type="button" key={k} role="tab" aria-selected={sub === k} onClick={() => setSub(k)}>{l}{n > 0 && <span className="count">{n}</span>}</button>)}
    </div>
    {sub === 'timeline' && <Timeline v={v} />}
    {sub === 'docs' && <Docs token={token} v={v} readOnly={isRep} />}
    {sub === 'addr' && <Address token={token} v={v} readOnly={isRep} />}
    {sub === 'report' && <Report token={token} v={v} />}
  </>;
}

function Timeline({ v }) {
  const idx = ORDER_STATES.indexOf(v.order.state);
  const reached = s => v.timeline.find(e => e.type === s);
  return <>
    <section className="card cl-tl" data-tour="client-timeline">
      <div className="card-title"><h3>Les étapes</h3><span className="tiny muted">{idx + 1} sur {ORDER_STATES.length}</span></div>
      <ol className="cl-steps">{ORDER_STATES.map((s, i) => {
        const e = reached(s);
        const cls = i < idx || (i === idx && ['SERVICE_ACTIF', 'CLOTURE'].includes(s)) ? 'done' : i === idx ? 'now' : 'todo';
        return <li key={s} className={cls}>
          <span className="cl-mark">{cls === 'done' ? Icon.check : i + 1}</span>
          <div><b className="small">{STATE_INFO[s].label}</b>{e ? <span className="tiny muted">{fmtDateTime(e.at)}</span> : cls === 'todo' ? <span className="tiny">À venir</span> : null}</div>
          {cls === 'now' && <Tag tone="accent">En cours</Tag>}
        </li>;
      })}</ol>
    </section>
    <details className="card cl-more">
      <summary>Tous les événements ({v.timeline.length})</summary>
      <div className="cl-more-in cl-events">{[...v.timeline].reverse().map(e => <div key={e.seq} className="cl-event">
        <span className="dot" />
        <div className="grow"><div className="small">{e.text}</div><div className="tiny muted">{fmtDateTime(e.at)} · {e.source}{e.receivedAt - e.at > 60e3 ? ' · reçu ' + fmtDateTime(e.receivedAt) : ''}</div></div>
      </div>)}</div>
    </details>
  </>;
}

// Envoi d'une pièce : la photo est allégée sur le téléphone, rangée dans la photothèque de l'espace,
// puis le dossier reçoit la référence. Le conseiller est prévenu tout de suite.
// pre : image déjà préparée (et contrôlée) par l'écran ; opts.quiet : pas de message ; opts.draft : dossier pas encore envoyé.
export async function sendDoc(token, orderId, type, f, pre, opts = {}) {
  if (!f) return false;
  const pic = pre !== undefined ? pre : await prepareImage(f);
  if (f.type && f.type.startsWith('image/') && !pic) { toast('Cette image ne peut pas être lue ici. Essayez une photo au format JPG ou PNG.', true); return false; }
  if (!pic && f.type !== 'application/pdf') { toast('Format refusé. Envoyez une photo (JPG, PNG) ou un PDF.', true); return false; }
  let img = null;
  if (pic) { try { img = await putImage(api.session(token).wsId, pic.full); } catch { img = null; } }
  const r = await call(token, 'doc.upload', { orderId, type, name: f.name, size: pic ? pic.bytes : f.size, mime: pic ? 'image/jpeg' : f.type, thumb: pic ? pic.thumb : null, img, quality: pic ? pic.quality : null });
  if (r.ok && r.data && r.data.check) checkMem.set(r.data.id, r.data.check);
  if (r.ok && !opts.quiet) toast(DOC_TYPES[type].label + (opts.draft ? ' enregistrée : elle partira avec votre dossier.' : ' envoyée : votre conseiller la reçoit tout de suite.'));
  return r.ok;
}

const CB_LAB = { demande: 'Demandé', fait: 'Fait', echec: 'Injoignable', planifie: 'Prévu' };
const REFUND_LAB = { demande: 'Demandée', instruite: 'En cours d’examen', valide: 'Acceptée', rembourse: 'Remboursée (simulé)', rejete: 'Non acceptée' };
const DOC_TONE = { analyse: 'info', a_valider: 'warn', valide: 'ok', refuse: 'bad', remplace: '' };
const DOC_LAB = { analyse: 'Contrôle automatique', a_valider: 'En attente de vérification', valide: 'Validée', refuse: 'Refusée', remplace: 'Remplacée' };
function Docs({ token, v, readOnly }) {
  const live = t => v.documents.filter(d => d.type === t && d.status !== 'remplace');
  const needed = (v.order.requiredDocs || []).filter(t => DOC_TYPES[t]);
  const missing = needed.find(t => !live(t).some(d => d.status !== 'refuse'));
  const [picked, setPicked] = useState(null);
  const type = picked || missing || needed[0] || 'justif_domicile';
  // Chaque photo est contrôlée sur le téléphone avant l'envoi (floue, sombre…) : on demande confirmation si besoin.
  const ps = usePhotoSender(token, v.order.id, { draft: !!v.dossier && !v.dossier.submittedAt });
  const busy = ps.busy;
  const send = (t, f, id) => ps.onFile(t, f, id);
  return <div className="stack" data-tour="client-docs">
    {needed.length === 0 && v.documents.length === 0 && <div className="card cl-empty"><Empty>Aucune pièce n’est demandée pour votre dossier. Moov ne demande que les pièces vraiment nécessaires.</Empty></div>}
    {needed.map(t => { const last = live(t).slice(-1)[0]; const todo = !last || last.status === 'refuse'; return <section key={t} className="card cl-needdoc">
      <span className={'cl-ic ' + (todo ? 'cl-ic-warn' : '')}>{Icon.doc}</span>
      <div className="grow stack-s" style={{ gap: 1 }}><b className="small">{DOC_TYPES[t].label}</b><span className="tiny muted">{last && last.status === 'refuse' ? 'Refusée : ' + last.reason : (v.order.docNotes || {})[t] ? 'Précision du conseiller : ' + v.order.docNotes[t] : DOC_TYPES[t].why}</span></div>
      {todo && !readOnly ? <PhotoBtn id={'doc-need-' + t} type={t} busy={busy === t} onFile={send} pdf={!DOSSIER_DOCS.includes(t)}>{last ? 'Renvoyer' : 'Envoyer'}</PhotoBtn> : <Tag tone={todo ? 'warn' : DOC_TONE[last.status]}>{todo ? 'Demandée' : DOC_LAB[last.status]}</Tag>}
    </section>; })}
    {v.documents.length > 0 && <section className="card stack">
      <div className="card-title"><h3>Mes pièces</h3><span className="tiny muted">{v.documents.length}</span></div>
      {[...v.documents].reverse().map(d => <div key={d.id} className="cl-doc">
        <Picture token={token} img={d.img} thumb={d.thumb} label={DOC_TYPES[d.type].label} alt={DOC_TYPES[d.type].label} kind={d.mime === 'application/pdf' ? 'PDF' : null} />
        <div className="grow stack-s" style={{ gap: 2 }}>
          <b className="small">{DOC_TYPES[d.type].label}</b>
          <span className="tiny muted cl-ellipsis">{d.name} · {fmtDateTime(d.at)}</span>
          <span><Tag tone={DOC_TONE[d.status]}>{DOC_LAB[d.status]}</Tag></span>
          {d.status !== 'refuse' && d.status !== 'remplace' && <CheckLine d={d} />}
          {d.reason && d.status === 'refuse' && <span className="small cl-bad">Motif : {d.reason}. Envoyez une nouvelle pièce pour la remplacer.</span>}
        </div>
      </div>)}
    </section>}
    {!readOnly && <section className="card stack cl-upload">
      <h3>Envoyer une pièce</h3>
      <Field label="Type de pièce" id="doc-type"><select id="doc-type" className="input" value={type} onChange={e => setPicked(e.target.value)}>{Object.entries(DOC_TYPES).map(([k, d]) => <option key={k} value={k}>{d.label}</option>)}</select></Field>
      <label className={'cl-drop' + (busy ? ' is-busy' : '')} htmlFor="doc-file"><span className="cl-ic">{Icon.camera}</span><b>{busy ? 'Envoi en cours…' : 'Prendre une photo ou choisir un fichier'}</b><span className="tiny muted">Photo ou PDF. Les grosses photos sont allégées automatiquement.</span></label>
      <input id="doc-file" type="file" accept="image/*,application/pdf" onChange={e => { const f = e.target.files[0]; e.target.value = ''; send(type, f, 'doc-file'); }} className="cl-file" disabled={!!busy} />
      <span className="tiny muted">Démo : n’envoyez pas votre vraie pièce d’identité, une photo de test suffit. La pièce n’est visible que par vous, votre conseiller et le technicien de votre visite.</span>
    </section>}
    {ps.modal}
  </div>;
}

function Address({ token, v, readOnly }) {
  const a = v.order.address;
  const [f, setF] = useState({ landmark: a.landmark || '', accessNotes: a.accessNotes || '', floor: a.floor || '', building: a.building, onsiteContact: a.onsiteContact || '' });
  const [gps, setGps] = useState(a.lat != null);
  const set = k => e => setF({ ...f, [k]: e.target.value });
  const amb = v.blockers.find(b => b.type === 'ADRESSE_AMBIGUE' && b.status === 'ouvert');
  return <div className="stack" data-tour="client-address">
    {amb && <div className="alert alert-bad small"><b>Précision demandée.</b> {amb.text} Indiquez un repère connu de tous (au moins 8 caractères).</div>}
    <section className="card cl-addr">
      <div className="cl-hello"><span className="cl-ic cl-ic-accent">{Icon.pin}</span><div className="cl-hello-t"><b>{a.street}</b><span>{a.commune}</span></div></div>
      <div className="cl-facts">
        <div><span className="tiny muted">Offre</span><b className="small">{v.order.offer}</b></div>
        <div><span className="tiny muted">Téléphone vérifié</span><b className="small num">{v.order.contactPhone}</b></div>
      </div>
    </section>
    <section className="card stack">
      <h3>Aider le technicien à vous trouver</h3>
      <Field label="Repère local" id="ad-l" hint="Ex. : portail bleu après le maquis, en face de la pharmacie"><input id="ad-l" className="input" disabled={readOnly} value={f.landmark} onChange={set('landmark')} /></Field>
      <div className="cl-two">
        <Field label="Logement" id="ad-b"><select id="ad-b" className="input" disabled={readOnly} value={f.building} onChange={set('building')}><option value="maison">Maison / villa</option><option value="immeuble">Immeuble</option></select></Field>
        <Field label="Étage / porte" id="ad-f"><input id="ad-f" className="input" disabled={readOnly} value={f.floor} onChange={set('floor')} /></Field>
      </div>
      <Field label="Contraintes d’accès" id="ad-a" hint="Gardien, horaires, chien, badge…"><textarea id="ad-a" className="input" disabled={readOnly} value={f.accessNotes} onChange={set('accessNotes')} /></Field>
      <Field label="Personne présente le jour J" id="ad-c" hint="Laissez vide si c’est vous."><input id="ad-c" className="input" disabled={readOnly} value={f.onsiteContact} onChange={set('onsiteContact')} placeholder={v.order.contactName} /></Field>
      <label className="switch cl-switch"><span className="grow small">Ajouter un point sur la carte (facultatif)</span><input type="checkbox" disabled={readOnly} checked={gps} onChange={e => setGps(e.target.checked)} /></label>
      <span className="tiny muted">Dans cette démo, un point fictif proche de la commune est utilisé : la localisation de votre téléphone n’est jamais demandée.</span>
      {!readOnly && <AsyncBtn kind="primary" block onClick={async () => {
        if (amb && f.landmark.trim().length < 8) { toast('Le repère est trop court : décrivez un lieu connu de tous (au moins 8 caractères).', true); return; }
        const r = await call(token, 'order.updateAddress', { orderId: v.order.id, ...f, ...(gps ? (a.lat != null ? {} : { lat: 5.35 + Math.random() * 0.05, lng: -3.98 + Math.random() * 0.05 }) : { gps: false }) });
        if (r.ok) toast(r.data && r.data.unchanged ? 'Rien n’a changé.' : 'Adresse enregistrée : le conseiller et le technicien la voient.');
      }}>Enregistrer</AsyncBtn>}
      {readOnly && <span className="tiny muted">Lecture seule : seule la cliente peut modifier l’adresse.</span>}
    </section>
  </div>;
}

const TICKET_LAB = { insatisfaction: 'Votre avis', question_assistant: 'Question à l’assistant' };
const TICKET_STATUS = { ouvert: 'en cours', traite: 'traité', repondu: 'répondu' };
// Signalements proposés selon l'étape du dossier.
const reportOk = (k, v) => k === 'tech_absent' ? !!v.mission && ['affectee', 'en_route', 'sur_place'].includes(v.mission.status) : k === 'pas_internet' ? ORDER_STATES.indexOf(v.order.state) >= ORDER_STATES.indexOf('INSTALLATION_TERMINEE') : true;
const ACT_LAB = { demandee: 'en cours', confirmee: 'confirmée par le système Moov', echouee: 'en échec, une équipe s’en occupe', anomalie: 'vérification en cours' };
function Report({ token, v }) {
  const m = v.mission;
  const act = v.activation.at(-1);
  const val = c => c.value === true ? 'oui' : c.value === false ? 'non' : c.value == null ? 'non renseigné' : String(c.value).replace('.', ',').replace(/^-/, '−') + (c.unit ? ' ' + c.unit : '');
  return <div className="stack">
    <section className="card stack cl-rep">
      <div className="cl-rep-h"><span className="cl-num">1</span><h3 className="grow">Réception des travaux</h3>{m && m.report && <Tag tone="ok">Terminé</Tag>}</div>
      {m && m.report ? <>
        <div className="cl-hello"><Avatar name={fullName(m.techName)} size={38} /><div className="cl-hello-t"><b className="small">{m.techName} · {m.company}</b><span>Travaux terminés le {fmtDateTime(m.times.end)}</span></div></div>
        <ul className="cl-checklist">{m.report.checklist.map((c, i) => <li key={i}><span className={'cl-tick' + (c.value === false || c.value == null ? ' off' : '')}>{c.value === false || c.value == null ? Icon.x : Icon.check}</span><span className="grow">{c.label}</span><b className="num">{val(c)}</b></li>)}</ul>
        <span className="tiny muted">Box installée : {m.report.serial} · {m.report.photos.length} photo{m.report.photos.length > 1 ? 's' : ''} de preuve</span>
        {m.report.photos.length > 0 && <span className="pic-row">{m.report.photos.map(p => <Picture key={p.id} token={token} img={p.img} thumb={p.thumb} label={'Photo du technicien · ' + p.name} alt={p.name} size={56} />)}</span>}
        {m.report.comment && <p className="small cl-note">Mot du technicien : « {m.report.comment} »</p>}
        {m.reception && <span><Tag tone={m.reception.status === 'accord' ? 'ok' : 'warn'}>{m.reception.status === 'accord' ? 'Vous avez donné votre accord' : 'Réserve : ' + m.reception.comment}</Tag></span>}
      </> : <p className="small muted">Disponible après le passage du technicien.</p>}
    </section>
    <section className="card stack cl-rep">
      <div className="cl-rep-h"><span className="cl-num">2</span><h3 className="grow">Activation de la ligne</h3><Sim what="émulateur" /></div>
      {act ? <p className="small">Demande {act.ref} : <b>{ACT_LAB[act.status] || act.status}</b></p> : <p className="small muted">Pas encore demandée.</p>}
    </section>
    <Explain>Ce sont deux choses différentes. La <b>réception des travaux</b> dit que le matériel est posé. L’<b>activation</b> est faite à distance par Moov : tant qu’elle n’est pas confirmée, votre dossier n’est jamais affiché « actif ».</Explain>
  </div>;
}

// ---------- Profil ----------
function Row({ icon, title, sub, right, children, tone, tour }) {
  return <details className={'cl-row' + (tone ? ' cl-row-' + tone : '')} data-tour={tour}>
    <summary><span className="cl-ic">{icon}</span><span className="cl-row-t"><b>{title}</b>{sub && <span>{sub}</span>}</span>{right}<span className="cl-chev" aria-hidden="true">{I2.chev}</span></summary>
    <div className="cl-row-body">{children}</div>
  </details>;
}

function Profile({ token, orderId, me, isRep, go, onClaimed }) {
  const r = useQ(token, 'client.order', { orderId });
  const dels = useQ(token, isRep ? 'me' : 'delegates');
  const [modal, setModal] = useState(null);
  const [f, setF] = useState({});
  if (r.error) return <div className="alert alert-bad">{r.error.message}</div>;
  const v = r.data; const o = v.order;
  const prefs = me.user.prefs;
  const activeDel = v.delegations.filter(d => !d.revoked);
  const scopeLab = s => s.map(x => x === 'rdv' ? 'rendez-vous' : x).join(', ');
  const myTickets = v.tickets.filter(t => t.type.startsWith('signalement:') || t.type === 'insatisfaction');
  const openTickets = myTickets.filter(t => t.status === 'ouvert').length;
  return <div className="stack">
    <section className="card cl-profile">
      <Avatar name={me.user.name} size={62} />
      <div className="grow stack-s" style={{ gap: 1 }}>
        <b className="cl-name">{me.user.name}</b>
        <span className="small muted num">{me.user.phone}</span>
        <span className="tiny muted">{ROLES[me.user.role].label} · {o.offer}</span>
      </div>
    </section>
    {o.state === 'SERVICE_ACTIF' && !isRep && <section className="card stack cl-active" data-tour="client-activation">
      <div className="cl-hello"><span className="cl-ic cl-ic-ok">{Icon.wifi}</span><div className="cl-hello-t"><b>Votre fibre est active</b><span>Vérifions que tout marche chez vous.</span></div></div>
      {!o.clientCheck ? <>
        <p className="small">Connectez un appareil au Wi-Fi de la box. Est-ce qu’Internet fonctionne ?</p>
        <div className="cl-two"><AsyncBtn kind="primary" onClick={() => call(token, 'activation.feedback', { orderId, works: true })}>Oui, ça marche</AsyncBtn><AsyncBtn onClick={() => call(token, 'activation.feedback', { orderId, works: false })}>Non, pas d’Internet</AsyncBtn></div>
        <span className="tiny muted">Un test de débit sur téléphone mesure aussi votre Wi-Fi et votre appareil : il ne prouve pas seul que la ligne est conforme.</span>
      </> : <span><Tag tone={o.clientCheck.works ? 'ok' : 'bad'}>{o.clientCheck.works ? 'Connexion confirmée' : 'Incident ouvert : une équipe vous recontacte'}</Tag></span>}
      {!v.feedback ? <Feedback token={token} orderId={orderId} /> : <div className="cl-rated"><span className="small">Votre avis</span><Stars n={v.feedback.score} />{v.feedback.followUp && <span className="tiny muted">Un responsable va vous contacter.</span>}</div>}
    </section>}
    <section className="card stack-s" data-tour="client-notifprefs">
      <div className="card-title"><h3>Mes notifications</h3><Sim what="envoi simulé" /></div>
      {[['sms', 'SMS', Icon.chat], ['whatsapp', 'WhatsApp', Icon.phone], ['push', 'Notification sur le téléphone', Icon.bell]].map(([k, l, ic]) => <label key={k} className="switch cl-switch">
        <span className="cl-ic cl-ic-s">{ic}</span><span className="grow small">{l}</span>
        <input type="checkbox" checked={!!prefs[k]} onChange={e => call(token, 'prefs.set', { [k]: e.target.checked })} />
      </label>)}
      <span className="tiny muted">Les alertes restent toujours visibles dans l’application, même si vous refusez tout.</span>
    </section>
    <section className="card cl-list" aria-label="Réglages">
      <Row icon={Icon.alert} title="Signaler un problème" sub={openTickets ? openTickets + ' signalement' + (openTickets > 1 ? 's' : '') + ' en cours' : 'Dossier bloqué, technicien absent…'}>
        {Object.entries(REPORT_TYPES).filter(([k]) => reportOk(k, v)).map(([k, l]) => <button type="button" key={k} className="cl-opt" onClick={() => { setModal('report:' + k); setF({}); }}><span>{l}</span>{I2.chev}</button>)}
        {myTickets.map(t => <span key={t.id} className="tiny muted">{TICKET_LAB[t.type] || REPORT_TYPES[t.type.replace('signalement:', '')] || 'Demande'} · {TICKET_STATUS[t.status] || t.status} · {fmtDateTime(t.at)}</span>)}
      </Row>
      {!isRep && <Row icon={Icon.users} title="Délégation" sub={activeDel.length ? activeDel.map(d => firstName(d.delegate)).join(', ') + ' peut vous aider' : 'Confier le rendez-vous à un proche'} right={activeDel.length ? <AvatarStack names={activeDel.map(d => d.delegate)} size={28} /> : null}>
        <span className="small muted">Autorisez un proche ou un gardien à gérer le rendez-vous. Vous pouvez retirer ce droit à tout moment.</span>
        {v.delegations.map(d => <div key={d.id} className="cl-del">
          <Avatar name={d.delegate} size={36} />
          <div className="grow stack-s" style={{ gap: 0 }}><b className="small">{d.delegate}</b><span className="tiny muted">{scopeLab(d.scopes)} · jusqu’au {fmtDate(d.until)}{d.revoked ? ' · révoquée' : ''}</span></div>
          {!d.revoked && <AsyncBtn size="s" onClick={() => call(token, 'delegation.revoke', { id: d.id })}>Révoquer</AsyncBtn>}
        </div>)}
        {dels.data && Array.isArray(dels.data) && dels.data.filter(u => !v.delegations.some(d => d.delegateId === u.id && !d.revoked)).map(u => <AsyncBtn key={u.id} size="s" onClick={() => call(token, 'delegation.add', { orderId, delegateId: u.id, scopes: ['rdv', 'messages'], days: 30 })}>Autoriser {u.name} (30 jours)</AsyncBtn>)}
      </Row>}
      <Row icon={I2.wallet} title="Paiement" sub={money(o.payment.amount) + ' · ' + PAYMENT_STATES[o.payment.status]}>
        <div className="cl-facts">
          <div><span className="tiny muted">Montant</span><b className="small num">{money(o.payment.amount)}</b></div>
          <div><span className="tiny muted">Référence Moov Money</span><b className="small num">{o.payment.ref}</b></div>
        </div>
        <div className="row"><Tag tone={o.payment.status === 'confirme' ? 'ok' : 'warn'}>{PAYMENT_STATES[o.payment.status]}</Tag><Sim what="Moov Money simulé" /></div>
      </Row>
      {!isRep && <Row icon={Icon.shield} title="Mes données personnelles" sub="Accès, correction, suppression">
        <span className="small muted">Dans cette démo, toutes les données sont fictives et effacées après 24 h.</span>
        {['Accès à mes données', 'Correction', 'Suppression'].map(k => <AsyncBtn key={k} size="s" className="cl-opt-btn" onClick={async () => { const r = await call(token, 'privacy.request', { kind: k }); if (r.ok) toast('Demande « ' + k + ' » envoyée. Réponse sous 30 jours.'); }}>{k}</AsyncBtn>)}
      </Row>}
      {!isRep && <Row icon={Icon.search} title="Rattacher un autre dossier" sub="Une autre adresse à suivre"><Claim token={token} me={me} embedded onDone={onClaimed} /></Row>}
    </section>
    {v.refund && <section className="card stack-s">
      <div className="card-title"><h3>Annulation</h3><Tag tone={v.refund.status === 'rejete' ? 'bad' : v.refund.status === 'rembourse' ? 'ok' : 'warn'}>{REFUND_LAB[v.refund.status] || v.refund.status}</Tag></div>
      {v.refund.steps.map((s, i) => <div key={i} className="cl-event"><span className="dot" /><div className="grow"><div className="small">{s.what}</div><div className="tiny muted">{fmtDateTime(s.at)} · {s.by}</div></div></div>)}
    </section>}
    {!isRep && !o.cancelled && (!v.refund || v.refund.status === 'rejete') && ORDER_STATES.indexOf(o.state) < ORDER_STATES.indexOf('INTERVENTION_EN_COURS') && !(v.mission && ['en_route', 'sur_place', 'en_cours'].includes(v.mission.status)) && <Btn kind="danger" block className="cl-cancel" onClick={() => { setModal('cancel'); setF({}); }}>Annuler ma commande</Btn>}
    {modal && modal.startsWith('report:') && <Modal title={REPORT_TYPES[modal.slice(7)]} onClose={() => setModal(null)} actions={<AsyncBtn kind="primary" onClick={async () => { if ((await call(token, 'report.create', { orderId, type: modal.slice(7), text: f.text })).ok) setModal(null); }}>Envoyer le signalement</AsyncBtn>}>
      <Field label="Détails (facultatif)" id="rep-t"><textarea id="rep-t" className="input" value={f.text || ''} onChange={e => setF({ text: e.target.value })} /></Field>
      <span className="small muted">Un responsable est désigné avec une échéance. Vous suivez l’avancement dans l’accueil.</span>
    </Modal>}
    {modal === 'cancel' && <Modal title="Annuler la commande ?" onClose={() => setModal(null)} actions={<AsyncBtn kind="primary" onClick={async () => { if ((await call(token, 'cancel.request', { orderId, reason: f.text })).ok) setModal(null); }}>Envoyer la demande</AsyncBtn>}>
      <p className="small">Votre demande sera vérifiée par un conseiller puis validée par un responsable. Le montant éventuel du remboursement suit la procédure Moov : il ne vous est pas annoncé automatiquement.</p>
      <Field label="Motif" id="can-t"><textarea id="can-t" className="input" value={f.text || ''} onChange={e => setF({ text: e.target.value })} /></Field>
    </Modal>}
  </div>;
}

const Stars = ({ n }) => <span className="cl-stars" role="img" aria-label={n + ' sur 5'}>{[1, 2, 3, 4, 5].map(k => <span key={k} className={k <= n ? 'on' : ''}>{I2.star}</span>)}</span>;

function Feedback({ token, orderId }) {
  const [s, setS] = useState(0); const [c, setC] = useState('');
  return <div className="stack-s cl-feedback">
    <span className="small"><b>Votre avis sur l’installation</b></span>
    <div className="cl-stars cl-stars-pick" role="radiogroup" aria-label="Note">{[1, 2, 3, 4, 5].map(n => <button type="button" key={n} role="radio" aria-checked={s === n} className={n <= s ? 'on' : ''} onClick={() => setS(n)} aria-label={n + ' sur 5'}>{I2.star}</button>)}</div>
    <textarea className="input" id="fb-c" aria-label="Commentaire facultatif" placeholder="Commentaire (facultatif)" value={c} onChange={e => setC(e.target.value)} />
    <AsyncBtn kind="primary" block disabled={!s} onClick={() => call(token, 'feedback.submit', { orderId, score: s, comment: c })}>Envoyer mon avis</AsyncBtn>
  </div>;
}

// ---------- Rattacher un dossier ----------
function Claim({ token, me, embedded, onDone }) {
  const [ref, setRef] = useState(me.user.id === 'U1' ? 'FW-2026-103' : '');
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState(null);
  const form = <>
    <Field label="Référence de commande" id="cl-ref"><input id="cl-ref" className="input" value={ref} onChange={e => setRef(e.target.value)} /></Field>
    <AsyncBtn block onClick={async () => { const r = await call(token, 'claim.start', { ref }); if (r.ok) setMsg(r.data.message); }}>Recevoir un code</AsyncBtn>
    {msg && <div className="alert alert-info small">{msg}</div>}
    <Field label="Code reçu par SMS" id="cl-code"><input id="cl-code" className="input num" inputMode="numeric" value={code} onChange={e => setCode(e.target.value)} /></Field>
    <AsyncBtn kind="primary" block onClick={async () => { const r = await call(token, 'claim.verify', { ref, code }); if (r.ok) { toast('Dossier ' + ref.trim().toUpperCase() + ' rattaché à votre compte.'); setRef(''); setCode(''); setMsg(null); if (onDone) onDone(r.data.orderId); } }}>Rattacher le dossier</AsyncBtn>
  </>;
  const explain = <Explain>Pour la démo, le SMS n’est pas vraiment envoyé : le code apparaît dans la <b>boîte d’envoi simulée</b> du Laboratoire. Essayez aussi une référence qui n’est pas à vous : la réponse est la même, pour ne pas révéler si un dossier existe.</Explain>;
  if (embedded) return <div className="stack" data-tour="client-claim">
    <span className="small muted">Saisissez la référence reçue après votre paiement. Un code est envoyé au {me.user.phone}. La référence seule ne suffit pas.</span>
    {form}{explain}
  </div>;
  return <div className="stack" data-tour="client-claim">
    <section className="card stack cl-claim">
      <div className="cl-claim-art"><HouseScene progress={0} height={100} /><Avatar name={me.user.name} size={58} className="cl-claim-av" /></div>
      <div className="stack-s"><h2 className="cl-claim-t">Retrouvons votre dossier</h2>
        <p className="small muted">Saisissez la référence reçue après votre paiement. Un code est envoyé au numéro vérifié ({me.user.phone}). La référence seule ne suffit pas à ouvrir un dossier.</p></div>
      {form}
    </section>
    {explain}
  </div>;
}

// ---------- Notifications ----------
const NOTIF_ICON = { rdv: Icon.cal, message: Icon.chat, alerte: Icon.alert, tache: Icon.list, action: Icon.doc, succes: Icon.check, info: Icon.bell, appel: Icon.handset };
const NOTIF_TONE = { action: 'warn', alerte: 'warn', succes: 'ok', appel: 'ok', rdv: 'accent' };
function Notifications({ token, me, onBack, onOpen }) {
  const r = useQ(token, 'notifications');
  const out = useQ(token, 'outbox');
  const list = r.data || [];
  const unread = list.filter(n => !n.read).length;
  return <div className="stack">
    <div className="cl-head">
      <button type="button" className="icon-btn" onClick={onBack} aria-label="Retour">{Icon.left}</button>
      <h2>Notifications</h2>
      {unread > 0 && <AsyncBtn size="s" kind="ghost" onClick={() => call(token, 'notif.read', { all: true })}>Tout marquer lu</AsyncBtn>}
    </div>
    {list.length === 0 ? <div className="card cl-empty"><Empty>Aucune notification pour l’instant.</Empty></div>
      : <section className="card cl-notifs">{list.map(n => { const who = /^Réponse de (.+)$/.exec(n.title || '') || (/^Technicien en route/.test(n.title || '') && /^(.+?) est en route/.exec(n.body || '')); return <div key={n.id} className={'cl-notif' + (n.read ? '' : ' unread') + (n.orderId ? ' cl-notif-go' : '')} role={n.orderId ? 'button' : undefined} tabIndex={n.orderId ? 0 : undefined} onClick={() => { if (!n.read) call(token, 'notif.read', { id: n.id }, { silent: true }); if (n.orderId && onOpen) onOpen(n); }} onKeyDown={e => { if (e.key === 'Enter' && n.orderId && onOpen) { call(token, 'notif.read', { id: n.id }, { silent: true }); onOpen(n); } }}>
        {who ? <span className={'cl-notif-av' + (n.read ? '' : ' cl-ic-dot')}><Avatar name={who[1]} size={40} /></span> : <span className={'cl-ic' + (NOTIF_TONE[n.kind] ? ' cl-ic-' + NOTIF_TONE[n.kind] : '') + (n.read ? '' : ' cl-ic-dot')}>{NOTIF_ICON[n.kind] || Icon.bell}</span>}
        <div className="grow stack-s" style={{ gap: 2 }}>
          <div className="spread" style={{ flexWrap: 'nowrap', alignItems: 'baseline' }}><b className="small">{n.title}</b><span className="tiny muted cl-nowrap">{fmtDateTime(n.at)}</span></div>
          <span className="small muted">{n.body}</span>
        </div>
      </div>; })}</section>}
    <details className="card cl-more">
      <summary>Envois SMS / WhatsApp (simulés)</summary>
      <div className="cl-more-in">{(out.data || []).length === 0 ? <span className="small muted">Aucun envoi.</span> : (out.data || []).map(o => <div key={o.id} className="cl-out">
        <div className="spread"><Tag tone="sim">{o.channel === 'sms' ? 'SMS' : o.channel === 'whatsapp' ? 'WhatsApp' : o.channel}</Tag><span className="tiny muted">{o.status}</span></div>
        <span className="small">{o.text}</span><span className="tiny muted num">{o.to}</span>
      </div>)}</div>
    </details>
  </div>;
}
