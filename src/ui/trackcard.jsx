// Suivi du trajet du technicien, partagé par l'espace client et l'espace technicien : même carte, même fiche de trajet.
// Inspiré d'un tableau de bord de livraison : carte, distance faite, étapes horodatées, fiche de la personne, petite jauge de vitesse.
// Tout est calculé à partir du trajet simulé (track) : distance et vitesse sont donc simulées aussi.
import { Avatar, Sim, Tag, Icon, TrackMap, communeCenter, trackInfo } from './kit.jsx';
import { useNow, liveClock } from './platform.js';
const React = window.React;

// ---------- Petits calculs ----------
// Distance simulée par paire de communes, déduite de leur écart sur la carte (la route n'est jamais droite).
const KM_PAR_UNITE = 0.09;
export function tripKm(from, to) {
  const A = communeCenter(from), B = communeCenter(to);
  const km = Math.hypot(B[0] - A[0], B[1] - A[1]) * KM_PAR_UNITE;
  return Math.max(1.4, Math.min(24, Math.round(km * 10) / 10));
}
const fr1 = n => (Math.round(n * 10) / 10).toFixed(1).replace('.', ',');
// Vitesse du moment : la moyenne du trajet (distance / durée) qui varie doucement, entre 8 et 60 km/h.
export function tripSpeed(km, durMs, now) {
  const avg = km / Math.max(durMs, 60e3) * 3.6e6;
  const v = avg * (1 + 0.16 * Math.sin(now / 6500) + 0.06 * Math.sin(now / 1900));
  return Math.max(8, Math.min(60, Math.round(v)));
}
const HM = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Africa/Abidjan', hour: 'numeric', minute: '2-digit' });
const DAY = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Africa/Abidjan', weekday: 'short', day: 'numeric', month: 'short' });
const hm = t => HM.format(t).replace(/^0?(\d+):(\d+)/, '$1 h $2'); // « 9 h 04 »
// L'heure seule le jour même, sinon « jeu. 9 oct., 9 h 04 ».
const stamp = (t, now) => (DAY.format(t) === DAY.format(now) ? hm(t) : DAY.format(t) + ', ' + hm(t));

// ---------- Jauge de vitesse (cadran simple) ----------
function Gauge({ kmh }) {
  const max = 60, f = Math.max(0, Math.min(1, kmh / max));
  return <div className="tc-gauge" role="img" aria-label={'Vitesse simulée : ' + kmh + ' kilomètres par heure'}>
    <svg viewBox="0 0 120 68" aria-hidden="true">
      <path d="M14 60A46 46 0 0 1 106 60" pathLength="100" className="tc-g-track" />
      <path d="M14 60A46 46 0 0 1 106 60" pathLength="100" className="tc-g-fill" strokeDasharray={Math.round(f * 100) + ' 100'} />
      <text x="14" y="67" className="tc-g-end" textAnchor="middle">0</text>
      <text x="106" y="67" className="tc-g-end" textAnchor="middle">{max}</text>
    </svg>
    <span className="tc-g-v"><b className="num">{kmh}</b><i>km/h</i></span>
  </div>;
}

// ---------- La carte de trajet ----------
// track : le trajet { from, to, departAt, durMs, arrivedAt }. status : statut de la mission. times : { depart, arrive, start, end }.
// received : heure de la transmission si elle est connue ; receivedHint : phrase de repli (ex. le rendez-vous).
// person : { name, avatar, role, tag, call: { label, onClick, disabled, note } } ; sans call, pas de bouton d'appel.
// title, sub : phrases du haut (facultatives). notice : message mis en avant (ex. « Vous devriez être arrivé »).
// liveTitle : le titre est annoncé par le lecteur d'écran quand il change (une fois par minute au plus).
// fallback : ce qu'on montre à la place de la carte quand le trajet n'est pas connu (ex. la camionnette).
export function TrackCard({ track, ws, status, times = {}, received, receivedHint, person, title, sub, notice, fromLabel = 'Agence', toLabel = 'Chez vous', mapHeight = 186, dark, fallback, liveTitle, children }) {
  useNow(1000);
  const now = liveClock(ws);
  const ti = track ? trackInfo(track, ws) : null;
  const here = ['sur_place', 'en_cours', 'terminee'].includes(status);
  const p = here ? 1 : ti ? ti.p : 0;
  const pct = Math.round(p * 100);
  const km = track ? tripKm(track.from, track.to) : 0;
  const onRoad = status === 'en_route' && !!ti && !ti.arrived && p < 1;

  // Les étapes : faites (cochées, avec l'heure), en cours (qui pulse), à venir.
  const hasDep = !!times.depart || ['en_route', 'sur_place', 'en_cours', 'terminee'].includes(status);
  const arrived = !!times.arrive || here;
  const started = !!times.start || ['en_cours', 'terminee'].includes(status);
  const arriveAt = times.arrive || (track && track.arrivedAt) || null;
  const travel = times.depart && arriveAt ? Math.max(1, Math.round((arriveAt - times.depart) / 60e3)) : 0;
  const left = ti ? Math.max(1, ti.leftMin) : 0;
  const steps = [
    { k: 'recu', t: 'Mission reçue', at: received, sub: received ? '' : receivedHint, done: true },
    { k: 'depart', t: 'Départ', at: times.depart, sub: hasDep ? 'Départ : ' + fromLabel : 'Pas encore parti', done: hasDep },
    { k: 'route', t: 'En route', sub: arrived ? (travel ? 'Trajet de ' + travel + ' min' : 'Trajet terminé') : onRoad ? 'Encore ' + left + ' min' : p >= 1 && hasDep ? 'Presque arrivé' : '', done: arrived },
    { k: 'arrivee', t: 'Arrivée', at: arriveAt, sub: arrived ? 'Sur place' : '', done: arrived },
    { k: 'debut', t: 'Début de l’installation', at: times.start, done: started },
  ];
  const cur = steps.findIndex(s => !s.done);

  return <div className={'tc' + (dark ? ' tc-dark' : '')}>
    {track ? <div className="tc-map">
      <TrackMap from={track.from} to={track.to} p={p} arrived={here || !!track.arrivedAt} height={mapHeight} fromLabel={fromLabel} toLabel={toLabel} />
      <span className="tc-badge"><i />{here ? 'Arrivé' : 'En direct'}</span>
    </div> : fallback}

    {(title || sub) && <div className="tc-head">
      {title && <b className="tc-title" aria-live={liveTitle ? 'polite' : undefined}>{title}</b>}
      {sub && <span className="tc-sub">{sub}</span>}
    </div>}

    {notice && <p className="tc-notice" role="status">{Icon.pin}<span>{notice}</span></p>}

    {track && <div className="tc-dist">
      <div className="tc-dist-main">
        <span className="tc-lab">Distance</span>
        <span className="tc-km"><b className="num">{fr1(km * p)} km</b><span> sur {fr1(km)} km</span></span>
        <div className="tc-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Trajet parcouru"><i style={{ width: pct + '%' }} /></div>
        <span className="tc-pct"><b className="num">{pct} %</b> du trajet{onRoad ? ' · ' + left + ' min restantes' : ''}</span>
        <span className="tc-simline"><Sim what="distance simulée" /></span>
      </div>
      {onRoad && <div className="tc-speed"><span className="tc-lab">Vitesse</span><Gauge kmh={tripSpeed(km, track.durMs, now)} /><Sim what="vitesse simulée" /></div>}
    </div>}

    <section className="tc-trip" aria-label="Fiche du trajet">
      <b className="tc-lab">Fiche du trajet</b>
      <ol className="tc-steps">
        {steps.map((s, i) => {
          const state = s.done ? 'done' : i === cur ? 'now' : 'next';
          return <li key={s.k} className={'tc-step ' + state} aria-current={state === 'now' ? 'step' : undefined}>
            <span className="tc-dot" aria-hidden="true">{s.done ? Icon.check : null}</span>
            <span className="tc-step-t"><b>{s.t}</b><span className="sr-only">{s.done ? ' (fait)' : state === 'now' ? ' (en cours)' : ' (à venir)'}</span>{s.sub ? <span className="tc-step-s">{s.sub}</span> : null}</span>
            <span className="tc-step-h num">{s.done && s.at ? stamp(s.at, now) : state === 'now' && s.k === 'route' && onRoad ? left + ' min' : ''}</span>
          </li>;
        })}
      </ol>
    </section>

    {person && <section className="tc-who" aria-label={person.name}>
      <Avatar name={person.avatar || person.name} size={52} dot="ok" />
      <div className="tc-who-t"><b>{person.name}</b><span>{person.role}</span></div>
      {person.tag && <Tag tone="info">{person.tag}</Tag>}
      {person.call && <button type="button" className="tc-call" onClick={person.call.onClick} disabled={person.call.disabled} title={person.call.disabled ? person.call.note : undefined}>{Icon.handset}{person.call.label}</button>}
      {person.call && person.call.note && <span className="tc-who-n">{person.call.note}</span>}
    </section>}
    {children}
  </div>;
}
