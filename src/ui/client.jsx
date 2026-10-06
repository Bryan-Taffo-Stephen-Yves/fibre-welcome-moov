// Espace client (CDC 4, CL-01 à CL-20) : une application mobile dans un cadre de téléphone.
// Mise en page : une carte par idée, un seul bouton principal par écran, le détail derrière « Voir plus ».
import { api, useQ, call, toast, prepareImage, putImage, useOnline, setOnline, netSince } from './platform.js';
import { Btn, AsyncBtn, Tag, Sim, Explain, Field, Modal, StateTag, Empty, Stale, Icon, Picture, Avatar, AvatarStack, Ring, HouseScene, VanScene, firstName, fmtDate, fmtDateTime, fmtAgo, fmtDur, slotLabel, minutes, money, STATE_INFO, ORDER_STATES, APPT_STATES, ROLES } from './kit.jsx';
import { PEOPLE } from './people.jsx';
import { DOC_TYPES, PREP_CHECKLIST, REPORT_TYPES, PAYMENT_STATES } from '../server/model.js';
const React = window.React;
const { useState, useEffect, useRef } = React;

// ---------- Petits utilitaires d'affichage ----------
const frDur = h => fmtDur(h).replace('.', ',');
// « 1,5 à 5,5 j » plutôt que « 1.5 j à 5.5 j »
const frRange = (lo, hi) => { const a = frDur(lo), b = frDur(hi); return a.slice(-2) === b.slice(-2) ? a.slice(0, -2) + ' à ' + b : a + ' à ' + b; };
const DP = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Africa/Abidjan', weekday: 'short', day: 'numeric', month: 'short' });
const dparts = t => { const p = {}; for (const x of DP.formatToParts(t)) p[x.type] = x.value; return { wd: String(p.weekday || '').replace('.', ''), d: p.day, m: String(p.month || '').replace('.', '') }; };
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
  const [orderId, setOrderId] = useState(null);
  const [sub, setSub] = useState(null); // rubrique à ouvrir dans l'onglet Dossier (pièces, adresse)
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
  if (me.error) return <div className="alert alert-bad">{me.error.message}</div>;
  const user = me.data.user;
  const list = orders.data || [];
  const oid = orderId && list.some(o => o.id === orderId) ? orderId : (list[0] || {}).id;
  const isRep = user.role === 'representant';
  const scopes = isRep ? ((list.find(o => o.id === oid) || {}).scopes || []) : ['rdv', 'messages'];
  const go = (k, s) => { setSub(s || null); setTab(k); };
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
          {list.map(o => <option key={o.id} value={o.id}>{o.ref} · {o.address.commune} · {STATE_INFO[o.state].label}</option>)}
        </select>
      </div>}
      <div className="phone-body cl-body" ref={bodyRef}>
        {!online && <div className="alert alert-warn small cl-offline"><span>Pas de connexion : vous voyez les dernières informations reçues ({fmtAgo(Date.now() - netSince(token))}). Les actions sont désactivées.</span><Btn size="s" onClick={() => setOnline(true, token)}>Reconnecter</Btn></div>}
        {tab === 'notif' ? <Notifications key={token} token={token} me={me.data} onBack={() => setTab('home')} onOpen={id => { if (list.some(o => o.id === id)) setOrderId(id); setTab('home'); }} />
          : !oid ? (isRep ? <div className="card cl-empty"><Empty who={user.name}>Aucun dossier ne vous est confié en ce moment. La cliente a peut-être retiré votre accès : demandez-lui de vous l’accorder à nouveau.</Empty></div> : <Claim key={token} token={token} me={me.data} onDone={id => { setOrderId(id); setTab('home'); }} />)
          : tab === 'home' ? <Home key={token + oid} token={token} orderId={oid} go={go} me={me.data} isRep={isRep} />
          : tab === 'rdv' ? (scopes.includes('rdv') ? <Appointments key={token + oid} token={token} orderId={oid} /> : noRight('les rendez-vous'))
          : tab === 'msg' ? (scopes.includes('messages') ? <Messages key={token + oid} token={token} orderId={oid} go={go} me={me.data} /> : noRight('les messages'))
          : tab === 'file' ? <FileTab key={token + oid} token={token} orderId={oid} isRep={isRep} initial={sub} />
          : <Profile key={token + oid} token={token} orderId={oid} me={me.data} isRep={isRep} go={go} onClaimed={id => { setOrderId(id); setTab('home'); }} />}
      </div>
      <nav className="phone-tabs" aria-label="Navigation client">
        {TABS.map(([k, l, ic]) => <button type="button" key={k} aria-current={tab === k ? 'page' : undefined} onClick={() => go(k)} data-tour={'client-tab-' + k}>{ic}{l}</button>)}
      </nav>
    </div>
    <Side tab={!oid && tab !== 'notif' ? 'claim' : tab} name={user.name} isRep={isRep} go={go} hold={me.data && me.data.ws.holdMinutes} />
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
};
function Side({ tab, name, isRep, go, hold }) {
  const n = firstName(name);
  const [t, d] = SIDE[tab] || SIDE.home;
  const i = TABS.findIndex(x => x[0] === tab);
  const next = TABS[(i + 1) % TABS.length];
  return <aside className="cl-side" aria-label="Explications de la guide">
    <section className="card cl-side-card">
      <div className="cl-hello"><Avatar name="Aya" size={44} /><div className="cl-hello-t"><b className="cl-side-who">Aya, votre guide</b><span>Ce que voit {n}</span></div></div>
      <h3 className="cl-side-t">{t}</h3>
      <p className="muted">{d(n, hold)}</p>
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
  if (v.refund && !['rejete'].includes(v.refund.status) && !o.cancelled) return { title: 'Annulation en cours', icon: Icon.clock, text: 'Votre demande est vérifiée par un conseiller puis validée par un responsable. Vous êtes prévenu à chaque étape.', go: 'me', cta: 'Suivre ma demande' };
  if (mine.length && isRep) { const b = mine[0]; return { title: b.action, text: b.text + ' Seule la cliente peut le faire depuis son téléphone.' }; }
  if (mine.length) { const b = mine[0]; return { title: b.action, text: b.text, go: b.type === 'PIECE_MANQUANTE' ? 'file' : b.type === 'ADRESSE_AMBIGUE' ? 'file' : 'rdv', sub: b.type === 'PIECE_MANQUANTE' ? 'docs' : b.type === 'ADRESSE_AMBIGUE' ? 'addr' : null, cta: b.type === 'PIECE_MANQUANTE' ? 'Envoyer la pièce' : b.type === 'ADRESSE_AMBIGUE' ? 'Préciser mon adresse' : 'Choisir une date' }; }
  switch (o.state) {
    case 'DOSSIER_RECU': return { title: 'Rien à faire pour l’instant', text: 'Moov vérifie votre paiement Moov Money. Vous serez prévenu.' };
    case 'PAIEMENT_CONFIRME': case 'PREPARATION': return { title: 'Rien à faire pour l’instant', text: 'Moov vérifie votre adresse et le point de raccordement. Vérifiez que vos coordonnées sont justes.', go: 'file', sub: 'addr', cta: 'Vérifier mon adresse' };
    case 'PRET_A_PLANIFIER': return v.appt && v.appt.status === 'reserve' ? { title: 'Créneau réservé', text: 'Moov confirme l’équipe. En attendant, préparez la visite.', go: 'rdv', cta: 'Voir la préparation' } : { title: 'Choisissez votre créneau', text: 'Tout est vérifié. Réservez la visite du technicien.', go: 'rdv', cta: 'Choisir un créneau' };
    case 'RDV_CONFIRME': if (v.mission && ['en_route', 'sur_place'].includes(v.mission.status)) return { title: v.mission.status === 'en_route' ? 'Le technicien est en route' : 'Le technicien est arrivé', text: 'Votre code de réception, à lui donner à la fin : ' + v.mission.receptionCode + '.' };
      return { title: 'Préparez la visite du ' + fmtDate(v.appt.date), text: 'Cochez la liste de préparation pour éviter un second déplacement.', go: 'rdv', cta: 'Ma liste de préparation' };
    case 'INTERVENTION_EN_COURS': return { title: 'Le technicien est chez vous', text: 'À la fin, donnez-lui votre code de réception : ' + (v.mission ? v.mission.receptionCode : 'bientôt affiché') + '.' };
    case 'INSTALLATION_TERMINEE': case 'ACTIVATION_EN_ATTENTE': return { title: 'Activation en cours', text: 'Les travaux sont faits. Moov active la ligne à distance. Internet ne marche pas encore : c’est normal.' };
    case 'SERVICE_ACTIF': if (v.blockers.some(b => b.status === 'ouvert')) return { title: 'Nous traitons votre signalement', icon: Icon.clock, text: 'Une équipe Moov s’occupe du problème signalé. Vous êtes prévenu dès qu’il est réglé.' };
      return v.feedback ? { title: 'Tout est en ordre', text: 'Merci pour votre avis.', icon: Icon.check } : { title: 'Testez votre connexion', text: 'Dites-nous si Internet fonctionne, puis donnez votre avis.', go: 'me', cta: 'Tester et donner mon avis' };
    default: return { title: 'Dossier terminé', text: 'Merci pour votre confiance.', icon: Icon.check };
  }
}
const NEXT_ICON = { rdv: Icon.cal, file: Icon.doc, me: Icon.wifi };

function Home({ token, orderId, go, me, isRep }) {
  const r = useQ(token, 'client.order', { orderId });
  if (r.error) return <div className="alert alert-bad">{r.error.message}</div>;
  const v = r.data; const o = v.order;
  const na = nextAction(v, isRep);
  const open = v.blockers.filter(b => b.status === 'ouvert');
  const idx = ORDER_STATES.indexOf(o.state);
  const last = ORDER_STATES.length;
  const finished = ['SERVICE_ACTIF', 'CLOTURE'].includes(o.state);
  return <>
    <Stale at={v.stale} />
    <section className="card cl-hero" data-tour="client-state">
      <div className="cl-scene">
        <span className="cl-scene-tag"><StateTag state={o.state} cancelled={o.cancelled} /></span>
        <HouseScene progress={finished ? 1 : idx / (last - 1)} height={112} />
      </div>
      <div className="cl-hero-row">
        <div className="big">{o.cancelled ? 'Votre commande est annulée.' : STATE_INFO[o.state].client}</div>
        <span className="cl-ring" role="img" aria-label={'Étape ' + (idx + 1) + ' sur ' + last}>
          <Ring value={idx + 1} max={last} size={56} stroke={6} color={finished ? 'var(--ok)' : 'var(--accent)'}><span className="num">{idx + 1}<small>/{last}</small></span></Ring>
        </span>
      </div>
      <span className="tiny muted">Dossier {o.ref} · mis à jour {fmtAgo(Math.max(0, v.estimate.at - o.updatedAt))}{o.paidAt && <> · payé le {fmtDate(o.paidAt)}</>}</span>
      <Explain>{STATE_INFO[o.state].clear}</Explain>
    </section>
    <section className="next cl-next" data-tour="client-next">
      <div className="spread cl-next-top"><span className="eyebrow">Votre prochaine action</span><span className="cl-next-ic" aria-hidden="true">{na.icon || NEXT_ICON[na.go] || Icon.clock}</span></div>
      <b className="cl-next-t">{na.title}</b>
      {na.text && <span className="small cl-next-d">{na.text}</span>}
      {na.go && <Btn onClick={() => go(na.go, na.sub)}>{na.cta}{Icon.right}</Btn>}
    </section>
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
    {v.mission && ['affectee', 'en_route', 'sur_place', 'en_cours'].includes(v.mission.status) && v.appt && <MissionCard v={v} />}
    <Estimate v={v} />
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
    <div className="cl-when">{Icon.cal}<span>{fmtDate(v.appt.date)}, {slotLabel(v.appt.slot)}</span></div>
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
function Appointments({ token, orderId }) {
  const r = useQ(token, 'client.order', { orderId });
  const av = useQ(token, 'client.availability', { orderId });
  const [sel, setSel] = useState(null);
  const [changing, setChanging] = useState(false);
  const [alts, setAlts] = useState(null);
  const [cancelAsk, setCancelAsk] = useState(false);
  const [more, setMore] = useState(false);
  if (r.error) return <div className="alert alert-bad">{r.error.message}</div>;
  const v = r.data; const o = v.order;
  const appt = v.appt && ['reserve', 'confirme', 'en_cours'].includes(v.appt.status) ? v.appt : null;
  const underway = o.state === 'INTERVENTION_EN_COURS' || (!!v.mission && ['en_route', 'sur_place', 'en_cours'].includes(v.mission.status));
  const cancelling = !!v.refund && v.refund.status !== 'rejete';
  const canBook = ['PRET_A_PLANIFIER', 'RDV_CONFIRME'].includes(o.state) && !o.cancelled && !underway && !cancelling;
  const hold = v.hold;
  const isSel = s => !!sel && sel.date === s.date && sel.slot === s.slot;
  const doHold = async s => {
    setAlts(null);
    const res = await call(token, 'appt.hold', { orderId, date: s.date, slot: s.slot }, { silent: true });
    if (!res.ok) { setAlts({ msg: res.error.message, list: (res.error.extra || {}).alternatives || [] }); return; }
    setSel(null);
  };
  const slots = av.data ? av.data.slots : [];
  const days = [];
  for (const s of slots) { let d = days.find(x => x.date === s.date); if (!d) days.push(d = { date: s.date, list: [] }); d.list.push(s); }
  const shown = more ? days : days.slice(0, 4);
  return <>
    <div className="cl-h"><h2>Rendez-vous</h2></div>
    {appt && <section className="card cl-appt" data-tour="client-appt">
      <div className="cl-appt-main">
        <DateTile t={appt.date} tone="lime" />
        <div className="grow stack-s" style={{ gap: 2 }}>
          <span className="tiny muted">Votre visite</span>
          <b className="cl-appt-t">{appt.slot === 'm' ? 'Le matin' : 'L’après-midi'}, {slotLabel(appt.slot)}</b>
          <span><Tag tone={appt.status === 'confirme' ? 'ok' : 'warn'}>{APPT_STATES[appt.status]}</Tag></span>
        </div>
      </div>
      {!underway && <p className="small muted">{appt.status === 'reserve' ? 'Le créneau vous est réservé. Moov confirme l’équipe sous peu.' : 'Une équipe est affectée. Vous recevrez un rappel la veille.'}</p>}
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
        {days.length === 0 && av.data && <Empty>Aucun créneau libre pour le moment. Revenez plus tard ou demandez à être rappelé.</Empty>}
        <div className="cl-days" data-tour="client-slots">
          {shown.map(d => <div key={d.date} className="cl-day">
            <DateTile t={d.date} />
            <div className="cl-day-slots">{['m', 'a'].map(k => {
              const s = d.list.find(x => x.slot === k);
              if (!s) return <span key={k} className="cl-slot-none" />;
              return <button type="button" key={k} className="slot cl-slot" disabled={s.left <= 0} aria-pressed={isSel(s)} onClick={() => setSel(s)} aria-label={fmtDate(s.date) + ', ' + slotLabel(s.slot) + ', ' + (s.left > 0 ? s.left + ' place(s)' : 'complet')}>
                <b>{k === 'm' ? 'Matin' : 'Après-midi'}</b><span className="tiny">{slotLabel(k)}</span><span className="tiny muted">{s.left > 0 ? s.left + (s.left > 1 ? ' places' : ' place') : 'complet'}</span>
              </button>;
            })}</div>
          </div>)}
        </div>
        {days.length > 4 && <button type="button" className="link-btn cl-moredates" onClick={() => setMore(!more)}>{more ? 'Moins de dates' : 'Plus de dates (' + (days.length - 4) + ')'}</button>}
        <div className="cl-book-go">
          {sel && <span className="small">Choisi : <b>{fmtDate(sel.date)}, {slotLabel(sel.slot)}</b></span>}
          <AsyncBtn kind="primary" block disabled={!sel} onClick={() => doHold(sel)}>Réserver ce créneau</AsyncBtn>
        </div>
        <Explain>Quand vous choisissez un créneau, il est <b>gardé {minutes(av.data && av.data.holdMinutes)}</b> rien que pour vous : personne d’autre ne peut le prendre pendant que vous confirmez. Sans confirmation, il est relâché.</Explain>
      </section>}
    </>}
    {!canBook && !appt && <div className="card cl-empty"><Empty>{o.state === 'SERVICE_ACTIF' || o.state === 'CLOTURE' ? 'L’installation est faite.' : 'Les créneaux s’ouvrent quand la vérification technique est terminée. Vous serez prévenu.'}</Empty></div>}
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

function Prep({ token, v }) {
  const o = v.order;
  const items = PREP_CHECKLIST.filter(i => !i.when || i.when === o.address.building);
  const done = items.filter(i => o.prep[i.id]).length;
  const all = done === items.length;
  const locked = o.cancelled || ORDER_STATES.indexOf(o.state) >= ORDER_STATES.indexOf('INSTALLATION_TERMINEE');
  return <section className="card cl-prep" data-tour="client-prep">
    <div className="card-title">
      <div className="stack-s" style={{ gap: 0 }}><h3>Préparer la visite</h3><span className="tiny muted">{all ? 'Tout est prêt, merci !' : 'Pour éviter un second déplacement'}</span></div>
      <span role="img" aria-label={done + ' sur ' + items.length + ' cochés'}><Ring value={done} max={items.length} size={50} stroke={5} color="var(--ok)"><span className="cl-ring-s num">{done}/{items.length}</span></Ring></span>
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
function Messages({ token, orderId, go, me }) {
  const r = useQ(token, 'client.order', { orderId });
  const [mode, setMode] = useState('ai');
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
  const tabs = [['ai', 'Assistant'], ['human', 'Conseiller', staffN], ['cb', 'Être rappelé']];
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
    {mode === 'cb' && <Callback token={token} v={v} />}
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
      <div className="cl-hello"><span className="cl-ic">{Icon.phone}</span><div className="cl-hello-t"><b>Être rappelé</b><span>Un conseiller vous appelle au moment choisi.</span></div></div>
      <Field label="Motif" id="cb-r"><input id="cb-r" className="input" value={reason} onChange={e => setReason(e.target.value)} placeholder="Ex. : question sur l’installation" /></Field>
      <Field label="Quand êtes-vous joignable ?" id="cb-w"><select id="cb-w" className="input" value={when} onChange={e => setWhen(e.target.value)}>{['Dès que possible', 'Ce matin (8h-12h)', 'Cet après-midi (13h-17h)', 'Demain', 'Après 18h'].map(x => <option key={x}>{x}</option>)}</select></Field>
      <AsyncBtn kind="primary" block onClick={async () => { if ((await call(token, 'callback.request', { orderId: v.order.id, reason, availability: when })).ok) setReason(''); }}>Demander un rappel</AsyncBtn>
    </section>
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
export async function sendDoc(token, orderId, type, f) {
  if (!f) return false;
  const pic = await prepareImage(f);
  if (f.type && f.type.startsWith('image/') && !pic) { toast('Cette image ne peut pas être lue ici. Essayez une photo au format JPG ou PNG.', true); return false; }
  if (!pic && f.type !== 'application/pdf') { toast('Format refusé. Envoyez une photo (JPG, PNG) ou un PDF.', true); return false; }
  let img = null;
  if (pic) { try { img = await putImage(api.session(token).wsId, pic.full); } catch { img = null; } }
  const r = await call(token, 'doc.upload', { orderId, type, name: f.name, size: pic ? pic.bytes : f.size, mime: pic ? 'image/jpeg' : f.type, thumb: pic ? pic.thumb : null, img });
  if (r.ok) toast(DOC_TYPES[type].label + ' envoyée : votre conseiller la reçoit tout de suite.');
  return r.ok;
}

const CB_LAB = { demande: 'Demandé', fait: 'Fait', echec: 'Injoignable', planifie: 'Prévu' };
const REFUND_LAB = { demande: 'Demandée', instruite: 'En cours d’examen', valide: 'Acceptée', rembourse: 'Remboursée (simulé)', rejete: 'Non acceptée' };
const DOC_TONE = { analyse: 'info', a_valider: 'warn', valide: 'ok', refuse: 'bad', remplace: '' };
const DOC_LAB = { analyse: 'Contrôle automatique', a_valider: 'En attente de vérification', valide: 'Validée', refuse: 'Refusée', remplace: 'Remplacée' };
function DocPick({ id, onFile, busy, children, kind }) {
  return <label className={'btn btn-s ' + (kind ? 'btn-' + kind : '') + (busy ? ' is-busy' : '')} htmlFor={id} aria-disabled={busy ? 'true' : undefined}>
    {busy ? 'Envoi…' : children}
    <input id={id} type="file" accept="image/*,application/pdf" className="cl-file" disabled={busy} onChange={e => { const f = e.target.files[0]; e.target.value = ''; onFile(f); }} />
  </label>;
}
function Docs({ token, v, readOnly }) {
  const live = t => v.documents.filter(d => d.type === t && d.status !== 'remplace');
  const needed = (v.order.requiredDocs || []).filter(t => DOC_TYPES[t]);
  const missing = needed.find(t => !live(t).some(d => d.status !== 'refuse'));
  const [picked, setPicked] = useState(null);
  const type = picked || missing || needed[0] || 'justif_domicile';
  const [busy, setBusy] = useState(null);
  const send = async (t, f) => { if (!f) return; setBusy(t); try { await sendDoc(token, v.order.id, t, f); } finally { setBusy(null); } };
  return <div className="stack" data-tour="client-docs">
    {needed.length === 0 && v.documents.length === 0 && <div className="card cl-empty"><Empty>Aucune pièce n’est demandée pour votre dossier. Moov ne demande que les pièces vraiment nécessaires.</Empty></div>}
    {needed.map(t => { const last = live(t).slice(-1)[0]; const todo = !last || last.status === 'refuse'; return <section key={t} className="card cl-needdoc">
      <span className={'cl-ic ' + (todo ? 'cl-ic-warn' : '')}>{Icon.doc}</span>
      <div className="grow stack-s" style={{ gap: 1 }}><b className="small">{DOC_TYPES[t].label}</b><span className="tiny muted">{last && last.status === 'refuse' ? 'Refusée : ' + last.reason : (v.order.docNotes || {})[t] ? 'Précision du conseiller : ' + v.order.docNotes[t] : DOC_TYPES[t].why}</span></div>
      {todo && !readOnly ? <DocPick id={'doc-need-' + t} kind="primary" busy={busy === t} onFile={f => send(t, f)}>{last ? 'Renvoyer' : 'Envoyer'}</DocPick> : <Tag tone={todo ? 'warn' : DOC_TONE[last.status]}>{todo ? 'Demandée' : DOC_LAB[last.status]}</Tag>}
    </section>; })}
    {v.documents.length > 0 && <section className="card stack">
      <div className="card-title"><h3>Mes pièces</h3><span className="tiny muted">{v.documents.length}</span></div>
      {[...v.documents].reverse().map(d => <div key={d.id} className="cl-doc">
        <Picture token={token} img={d.img} thumb={d.thumb} label={DOC_TYPES[d.type].label} alt={DOC_TYPES[d.type].label} kind={d.mime === 'application/pdf' ? 'PDF' : null} />
        <div className="grow stack-s" style={{ gap: 2 }}>
          <b className="small">{DOC_TYPES[d.type].label}</b>
          <span className="tiny muted cl-ellipsis">{d.name} · {fmtDateTime(d.at)}</span>
          <span><Tag tone={DOC_TONE[d.status]}>{DOC_LAB[d.status]}</Tag></span>
          {d.reason && d.status === 'refuse' && <span className="small cl-bad">Motif : {d.reason}. Envoyez une nouvelle pièce pour la remplacer.</span>}
        </div>
      </div>)}
    </section>}
    {!readOnly && <section className="card stack cl-upload">
      <h3>Envoyer une pièce</h3>
      <Field label="Type de pièce" id="doc-type"><select id="doc-type" className="input" value={type} onChange={e => setPicked(e.target.value)}>{Object.entries(DOC_TYPES).map(([k, d]) => <option key={k} value={k}>{d.label}</option>)}</select></Field>
      <label className={'cl-drop' + (busy ? ' is-busy' : '')} htmlFor="doc-file"><span className="cl-ic">{Icon.camera}</span><b>{busy ? 'Envoi en cours…' : 'Prendre une photo ou choisir un fichier'}</b><span className="tiny muted">Photo ou PDF. Les grosses photos sont allégées automatiquement.</span></label>
      <input id="doc-file" type="file" accept="image/*,application/pdf" onChange={e => { const f = e.target.files[0]; e.target.value = ''; send(type, f); }} className="cl-file" disabled={!!busy} />
      <span className="tiny muted">Démo : n’envoyez pas votre vraie pièce d’identité, une photo de test suffit. La pièce n’est visible que par vous, votre conseiller et le technicien de votre visite.</span>
    </section>}
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
const NOTIF_ICON = { rdv: Icon.cal, message: Icon.chat, alerte: Icon.alert, tache: Icon.list };
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
      : <section className="card cl-notifs">{list.map(n => { const who = /^Réponse de (.+)$/.exec(n.title || '') || (n.title === 'Technicien en route' && /^(.+?) est en route/.exec(n.body || '')); return <div key={n.id} className={'cl-notif' + (n.read ? '' : ' unread') + (n.orderId ? ' cl-notif-go' : '')} role={n.orderId ? 'button' : undefined} tabIndex={n.orderId ? 0 : undefined} onClick={() => { if (!n.read) call(token, 'notif.read', { id: n.id }); if (n.orderId && onOpen) onOpen(n.orderId); }} onKeyDown={e => { if (e.key === 'Enter' && n.orderId && onOpen) { call(token, 'notif.read', { id: n.id }); onOpen(n.orderId); } }}>
        {who ? <span className={'cl-notif-av' + (n.read ? '' : ' cl-ic-dot')}><Avatar name={who[1]} size={40} /></span> : <span className={'cl-ic' + (n.read ? '' : ' cl-ic-dot')}>{NOTIF_ICON[n.kind] || Icon.bell}</span>}
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
