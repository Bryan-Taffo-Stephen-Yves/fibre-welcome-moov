// Suivi des trajets et des visites : qui roule, qui est chez un client, combien de temps ça prend.
// Écran de l'administrateur général, monté aussi chez le superviseur, le planificateur et l'auditeur (lecture).
// Structure : rangée de chiffres, liste des visites à gauche, carte d'ensemble à droite, puis les techniciens.
import { useQ, useNow, liveClock } from './platform.js';
import { Tag, Sim, Explain, Panel, Empty, Avatar, Icon, firstName, trackInfo } from './kit.jsx';
import { TripsMap } from './charts.jsx';
import { BLOCKER_TYPES } from '../server/model.js';
const React = window.React;
const { useState } = React;

const STEPS = ['Mission transmise', 'En route', 'Arrivé', 'En cours', 'Terminé', 'Validé par le client'];
// Dernière étape : son nom dépend de la façon dont la visite a été validée.
const LAST = { verifie: 'Validé par le client', auto: 'Validé : le client l’a laissé partir', delai: 'Validé automatiquement', regle: 'Souci réglé, visite validée', annule: 'Sans suite (commande annulée)' };
const lastLabel = t => { const so = t.signoff; if (!so) return STEPS[5]; if (so.mode && LAST[so.mode]) return LAST[so.mode]; return so.state === 'auto' ? LAST.delai : STEPS[5]; };
// Motif d'une visite non réalisée, en mots simples.
const whyFailed = f => (f ? (BLOCKER_TYPES[f.type] ? BLOCKER_TYPES[f.type].label : 'Motif non précisé') : 'Motif non précisé');
const Err = ({ e }) => <div className="alert alert-bad small">{e.message}</div>;

// Durées en mots simples : « 7 min », « 1 h 05 ».
const NONE = 'Pas encore de mesure';
const dur = m => { if (m == null) return NONE; if (m < 1) return 'moins d’1 min'; const n = Math.round(m); return n >= 60 ? Math.floor(n / 60) + ' h ' + String(n % 60).padStart(2, '0') : n + ' min'; };
const dec = n => (n == null ? NONE : String(Math.round(n * 10) / 10).replace('.', ','));
const sinceMin = (now, t) => (t ? Math.max(0, Math.floor((now - t) / 6e4)) : 0);
// Décompte : « 12 min » ou « 4:05 » quand il reste peu de temps.
const countdown = ms => { if (ms <= 0) return 'dans un instant'; const s = Math.ceil(ms / 1000); return s >= 600 ? 'dans ' + Math.ceil(s / 60) + ' min' : 'dans ' + Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

// Où en est la visite, en mots simples.
function tripState(t) {
  const so = t.signoff;
  if (t.status === 'echec') return { label: 'Visite non réalisée', tone: 'bad', group: 'fin' };
  if (t.stage === 6) {
    const md = so && (so.mode || (so.state === 'auto' ? 'delai' : ''));
    return { label: md === 'delai' ? 'Validée automatiquement' : md === 'regle' ? 'Souci réglé, visite validée' : md === 'annule' ? 'Sans suite' : 'Visite validée', tone: md === 'annule' ? '' : 'ok', group: 'fin' };
  }
  if (t.status === 'terminee') {
    if (so && so.state === 'probleme') return { label: 'Le client signale un souci', tone: 'bad', group: 'valider' };
    return { label: so ? 'Attend la validation du client' : 'Travail terminé', tone: 'warn', group: 'valider' };
  }
  if (t.status === 'en_cours') return { label: 'Travaille chez le client', tone: 'ok', group: 'ici' };
  if (t.status === 'sur_place') return { label: 'Arrivé chez le client', tone: 'ok', group: 'ici' };
  if (t.status === 'en_route') return { label: 'En route vers le client', tone: 'info', group: 'route' };
  return { label: 'Mission transmise', tone: '', group: 'avant' };
}
const RANK = { route: 0, ici: 1, valider: 2, avant: 3, fin: 4 };
const FILTERS = [['all', 'Tous'], ['route', 'En route'], ['ici', 'Sur place'], ['valider', 'À valider'], ['fin', 'Terminés']];
const mapTone = t => (t.status === 'en_route' ? 'route' : t.status === 'sur_place' || t.status === 'en_cours' ? 'ici' : t.status === 'terminee' && t.stage < 6 ? 'attente' : 'fin');

// Six étapes, de « mission transmise » à « validé », avec le pourcentage. Une visite non réalisée n'a pas de pourcentage.
function Steps({ stage, bad, last, failure }) {
  const names = STEPS.slice(0, 5).concat(last || STEPS[5]);
  const pct = Math.round(stage / 6 * 100);
  const bar = names.map((s, i) => <i key={s} title={s} className={i < stage - 1 || (i === stage - 1 && stage === 6 && !bad) ? 'done' : i === stage - 1 ? (bad ? 'bad' : 'now') : ''} />);
  return <div className="tr-steps">
    {bad
      ? <div className="tr-steps-bar" role="img" aria-label={'Visite non réalisée. Arrêtée à l’étape ' + stage + ' sur 6 : ' + names[stage - 1]}>{bar}</div>
      : <div className="tr-steps-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-valuetext={'Étape ' + stage + ' sur 6 : ' + names[stage - 1]}>{bar}</div>}
    {bad
      ? <div className="tr-steps-t"><span className="small"><b>Visite non réalisée</b> : {whyFailed(failure)}</span></div>
      : <div className="tr-steps-t"><span className="small"><b>Étape {stage} sur 6</b> : {names[stage - 1]}</span><b className="num tr-pct">{pct} % terminé</b></div>}
    <ol className="tr-steps-l" aria-hidden="true">{names.map((s, i) => <li key={s} className={i < stage ? 'on' : ''}>{s}</li>)}</ol>
  </div>;
}

// Chiffre clé : petite pastille, grand nombre léger, une ligne d'explication.
function Tile({ label, value, unit, sub, ic, tone, none }) {
  return <div className="card ad-stat tr-tile">
    <div className="ad-stat-h"><span className="eyebrow">{label}</span><span className={'tr-ic' + (tone ? ' tr-ic-' + tone : '')} aria-hidden="true">{ic}</span></div>
    <div className="ad-stat-v">{none ? <span className="small muted">{NONE}</span> : <span className={'num' + (tone ? ' ad-t-' + tone : '')}>{value}</span>}{unit && !none && <span className="small muted">{unit}</span>}</div>
    {sub && <span className="tiny muted">{sub}</span>}
  </div>;
}

export function Trips({ token }) {
  const r = useQ(token, 'admin.trips');
  const me = useQ(token, 'me');
  useNow(1000); // les durées « en cours depuis… » et les décomptes avancent en direct
  const [f, setF] = useState('all');
  const [sel, setSel] = useState(undefined); // undefined : on choisit seul la première camionnette en route
  const [n, setN] = useState(8);
  if (r.error) return <Err e={r.error} />;
  const d = r.data, k = d.kpis;
  const ws = (me.data && me.data.ws) || { clock: d.now };
  const now = liveClock(ws);

  const rows = d.trips.map(t => ({ ...t, techName: t.techName || 'Technicien inconnu', ref: t.ref || 'Sans référence', st: tripState(t) })).sort((a, b) => RANK[a.st.group] - RANK[b.st.group] || (b.times.depart || 0) - (a.times.depart || 0));
  const total = d.total != null ? d.total : rows.length;
  const count = g => rows.filter(t => t.st.group === g).length;
  const list = f === 'all' ? rows : rows.filter(t => t.st.group === f);
  const first = rows.find(t => t.status === 'en_route');
  const selId = sel === undefined ? (first && first.woId) : sel;
  const cur = rows.find(t => t.woId === selId) || null;

  // Camionnettes de la carte : les visites en cours (et la visite choisie, même terminée).
  const items = rows.filter(t => t.track && (t.stage >= 2 && t.stage <= 5 && t.status !== 'echec' || t.woId === selId)).map(t => {
    const ti = trackInfo(t.track, ws);
    const here = t.status !== 'en_route';
    return { id: t.woId, from: t.track.from, to: t.track.to, p: here ? 1 : ti.p, arrived: here || ti.arrived, tone: mapTone(t), label: firstName(t.techName) + ' · ' + t.ref };
  });
  const curInfo = cur && cur.track ? trackInfo(cur.track, ws) : null;

  const techs = d.techs.slice().sort((a, b) => (a.status === 'libre' ? 0 : 1) - (b.status === 'libre' ? 0 : 1) || a.name.localeCompare(b.name));
  const libres = techs.filter(x => x.status === 'libre' && x.available).length;
  const techLine = x => {
    if (x.status === 'libre') return { t: x.freeSince ? 'Libre depuis ' + dur(sinceMin(now, x.freeSince)) : 'Libre', tone: 'ok' };
    const at = x.ref ? ' (' + x.ref + ')' : '';
    if (x.status === 'en_route') return { t: x.ref ? 'En route vers ' + x.ref : 'En route vers un client', tone: 'info' };
    if (x.status === 'attente_client') return { t: (x.problem ? 'Souci à régler avec le client' : 'Attend la validation du client') + at, tone: x.problem ? 'bad' : 'warn' };
    return { t: 'Chez un client' + at, tone: 'ok' };
  };

  // Durées d'une visite : trajet puis temps sur place, en direct tant que ce n'est pas fini.
  const durations = t => {
    const tm = t.times, out = [];
    // Visite non réalisée ou terminée sans mesure : on ne fait pas courir un compteur.
    if (t.status === 'echec') return [['Durées : visite non réalisée', false]];
    const over = t.status === 'terminee';
    if (t.travelMin != null) out.push(['Trajet ' + dur(t.travelMin), false]);
    else if (over) out.push(['Trajet : ' + NONE, false]);
    else if (tm.depart) out.push(['Trajet : en cours depuis ' + dur(sinceMin(now, tm.depart)), true]);
    else out.push(['Pas encore parti', false]);
    const arr = tm.arrive || tm.start;
    if (t.onSiteMin != null) out.push(['Sur place ' + dur(t.onSiteMin), false]);
    else if (over) out.push(['Sur place : ' + NONE, false]);
    else if (arr) out.push(['Sur place : en cours depuis ' + dur(sinceMin(now, arr)), true]);
    return out;
  };
  const signLine = t => {
    const so = t.signoff;
    if (!so) return null;
    if (so.state === 'attente') return { t: 'Le client n’a pas encore répondu. Validation automatique ' + countdown(so.autoAt - now) + '.', tone: 'warn' };
    if (so.state === 'probleme') return { t: 'Le client signale un souci : l’équipe Moov le rappelle.', tone: 'bad' };
    if (so.mode === 'annule') return { t: 'Sans suite : la commande a été annulée.', tone: '' };
    if (so.mode === 'regle') return { t: 'Le souci est réglé, la visite est validée.', tone: 'ok' };
    if (so.mode === 'delai' || (so.state === 'auto' && so.mode !== 'auto')) return { t: 'Validée automatiquement, sans réponse du client.', tone: 'info' };
    return { t: so.mode === 'auto' ? 'Le client a laissé partir le technicien.' : 'Validée par le client après vérification.', tone: 'ok' };
  };

  return <div className="tr">
    <div className="ad-head">
      <div className="ad-head-t"><h2>Trajets et visites</h2><p className="muted small">Où sont les techniciens, et combien de temps ils mettent pour arriver et pour finir.</p></div>
      <div className="ad-head-a"><Sim what="positions simulées" /></div>
    </div>
    <Explain>Chaque visite avance en 6 étapes : la mission est transmise, le technicien se met en route, arrive, travaille, termine, puis le client valide. S’il ne répond pas, la visite est validée toute seule au bout de {k.autoValidateMin} minutes. Un technicien « libre » peut recevoir une nouvelle mission. Toutes les positions sont simulées.</Explain>

    <div className="tr-kpis">
      <Tile label="En route" value={k.enRoute} ic={Icon.compass} sub="Techniciens sur la route" />
      <Tile label="Chez un client" value={k.surPlace} ic={Icon.home} sub="Arrivés, ils travaillent" />
      <Tile label="Attente du client" value={k.attenteClient} ic={Icon.clock} tone={k.attenteClient ? 'warn' : undefined} sub="Travail fini, à valider" />
      <Tile label="Visites validées" value={k.validees} ic={Icon.check} tone={k.validees ? 'ok' : undefined} sub="Par le client ou automatiquement" />
      <Tile label="Aides demandées" value={k.aideEnAttente} ic={Icon.alert} tone={k.aideEnAttente ? 'bad' : undefined} sub={k.aideEnAttente ? 'Un technicien attend une réponse' : 'Personne n’attend'} />
      <Tile label="Trajet moyen" value={dec(k.travelAvgMin)} unit="min" none={k.travelAvgMin == null} ic={Icon.arrow} sub="Du départ à l’arrivée" />
      <Tile label="Visite moyenne" value={dec(k.onSiteAvgMin)} unit="min" none={k.onSiteAvgMin == null} ic={Icon.tool} sub="Temps passé chez le client" />
      <Tile label="Validation automatique" value={k.autoValidateMin} unit="min" ic={Icon.settings} sub="Sans réponse du client" />
    </div>

    <div className="tr-main">
      <section className="card stack tr-list" aria-label="Visites">
        <div className="card-title"><div className="ad-title-n"><h2>Les visites</h2><span className="muted small">{total > rows.length ? 'Les ' + rows.length + ' plus récentes, sur ' + total + ' au total' : total + ' au total'}</span></div></div>
        <div className="pills pills-soft ad-fpills" role="tablist" aria-label="Filtrer les visites">
          {FILTERS.map(([key, l]) => <button key={key} type="button" role="tab" aria-selected={f === key} onClick={() => { setF(key); setN(8); }}>{l}<span className="count">{key === 'all' ? rows.length : count(key)}</span></button>)}
        </div>
        {list.length === 0 ? <Empty>{rows.length ? 'Aucune visite dans cette liste.' : 'Aucune visite pour l’instant. Dès qu’un technicien reçoit une mission, elle apparaît ici.'}</Empty> : <ul className="tr-cards">
          {list.slice(0, n).map(t => {
            const on = t.woId === selId, sg = signLine(t);
            return <li key={t.woId}>
              <button type="button" className={'tr-card' + (on ? ' on' : '')} aria-pressed={on} onClick={() => setSel(on ? null : t.woId)}>
                <div className="tr-card-h">
                  <Avatar name={t.techName} size={42} />
                  <div className="tr-card-id"><b>{t.techName}</b><span className="tiny muted">{t.contractor || t.teamName || 'Équipe Moov'}</span></div>
                  <div className="tr-card-end"><Tag tone={t.st.tone}>{t.st.label}</Tag>{t.helpOpen > 0 && <Tag tone="warn">Aide demandée</Tag>}</div>
                </div>
                <div className="tr-card-meta small"><b className="num">{t.ref}</b><span>{t.commune}</span><span>chez {firstName(t.client)}</span></div>
                <Steps stage={t.stage} bad={t.status === 'echec'} last={lastLabel(t)} failure={t.failure} />
                <div className="tr-dur">{durations(t).map(([txt, live]) => <span key={txt} className={'tr-chip' + (live ? ' live' : '')}>{live && <i aria-hidden="true" />}{txt}</span>)}</div>
                {sg && <div className={'tr-sign tr-sign-' + sg.tone + ' small'}>{sg.t}</div>}
              </button>
            </li>;
          })}
        </ul>}
        {list.length > n && <button type="button" className="ad-more-btn" onClick={() => setN(n + 10)}>Voir plus ({list.length - n} de plus)</button>}
      </section>

      <Panel className="tr-map" title="Vue d’ensemble" right={<Sim what="positions simulées" />}>
        <TripsMap items={items} selected={selId} onPick={id => setSel(id === selId ? null : id)} height={250} />
        {cur ? <div className="tr-sel" aria-live="polite">
          <Avatar name={cur.techName} size={40} />
          <div className="grow"><b className="small">{firstName(cur.techName)} · {cur.ref}</b>
            <div className="tiny muted">{cur.status === 'en_route' && curInfo ? (curInfo.arrived || curInfo.late ? 'Il est tout près de chez ' + firstName(cur.client) + '.' : 'Arrive chez ' + firstName(cur.client) + ' dans ' + Math.max(1, curInfo.leftMin) + ' min.') : cur.st.label + ' à ' + cur.commune + '.'}</div></div>
          <Tag tone={cur.st.tone}>{cur.stage}/6</Tag>
        </div> : <p className="tiny muted">Touchez une visite dans la liste pour la retrouver sur la carte.</p>}
      </Panel>

      <Panel className="tr-techs" title="Les techniciens" right={<span className="tag tag-ok">{libres} libre{libres > 1 ? 's' : ''}</span>}>
        {techs.length === 0 ? <Empty>Aucun technicien dans votre périmètre.</Empty> : <ul className="tr-tl">
          {techs.map(x => { const l = techLine(x); return <li key={x.id} className={'tr-tech' + (x.available ? '' : ' off')}>
            <Avatar name={x.name} size={40} dot={x.status === 'libre' ? 'ok' : 'warn'} />
            <div className="grow"><b className="small">{x.name}</b><div className="tiny muted">{x.teamName}{x.contractor ? ' · ' + x.contractor : ''}</div></div>
            <div className="tr-tech-end"><Tag tone={l.tone}>{l.t}</Tag><span className="tiny muted">{x.visits} visite{x.visits > 1 ? 's' : ''} faite{x.visits > 1 ? 's' : ''}{x.available ? '' : ' · équipe indisponible'}</span></div>
          </li>; })}
        </ul>}
        <p className="tiny muted">Pour donner une nouvelle mission, choisissez un technicien libre depuis la fiche du dossier.</p>
      </Panel>
    </div>
  </div>;
}
