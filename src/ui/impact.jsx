// Impact : ce que le test mesure vraiment, puis une estimation du gain avec des hypothèses que l'on change soi-même.
// Le cahier des charges interdit d'annoncer un gain réel sur des scénarios simulés : tout ce qui est estimé est marqué comme tel.
import { useQ } from './platform.js';
import { Panel, Sim, Explain, Icon } from './kit.jsx';
import { Tile } from './trips.jsx';
const React = window.React;
const { useState } = React;

const nf = n => Math.round(n).toLocaleString('fr-FR').replace(/ /g, ' ');
const hm = min => { const m = Math.round(min); return m >= 60 ? Math.floor(m / 60) + ' h' + (m % 60 ? ' ' + String(m % 60).padStart(2, '0') : '') : m + ' min'; };

function Num({ id, label, hint, value, set, min, max, step = 1, unit }) {
  return <label className="im-field" htmlFor={id}>
    <span className="small"><b>{label}</b></span>
    <span className="im-in"><input id={id} className="input" type="number" inputMode="decimal" min={min} max={max} step={step} value={value} onChange={e => { const n = Number(e.target.value); set(Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min); }} />{unit && <span className="small muted">{unit}</span>}</span>
    {hint && <span className="tiny muted">{hint}</span>}
  </label>;
}

export function Impact({ token }) {
  const r = useQ(token, 'admin.impact');
  const [orders, setOrders] = useState(1000);    // commandes par mois
  const [per, setPer] = useState(1.5);           // contacts de suivi par commande aujourd'hui
  const [avoid, setAvoid] = useState(30);        // part évitée grâce au suivi
  const [mins, setMins] = useState(6);           // minutes par contact
  if (r.error) return <div className="alert alert-bad">{r.error.message}</div>;
  if (!r.data) return <p className="muted">Chargement…</p>;
  const d = r.data;
  const all = d.self.total + d.human.total;
  const share = all ? Math.round((d.self.total / all) * 100) : null;
  const before = orders * per, saved = before * (avoid / 100), after = before - saved;
  const bar = v => ({ width: (before ? Math.max(2, (v / before) * 100) : 0) + '%' });
  return <div className="im stack">
    <Panel title="Mesuré dans cet espace de test" right={<Sim what="données de test" />}>
      <div className="im-tiles">
        <Tile label="Réponses sans conseiller" value={d.self.total} sub={d.self.assistant + ' assistant · ' + d.self.sms + ' SMS · ' + d.self.ussd + ' USSD'} ic={Icon.chat} tone="ok" />
        <Tile label="Contacts avec un conseiller" value={d.human.total} sub={d.human.messages + ' messages · ' + d.human.calls + ' appels · ' + d.human.callbacks + ' rappels'} ic={Icon.handset} />
        <Tile label="Part sans conseiller" value={share} unit={share == null ? '' : '%'} none={share == null} sub="des demandes de suivi de ce test" ic={Icon.grid} tone="ok" />
        <Tile label="Messages envoyés sans qu'on les demande" value={d.proactive} sub="notifications de suivi aux clients" ic={Icon.bell} />
      </div>
      <Explain>Ces chiffres viennent des actions faites dans cet espace : ce n’est pas la clientèle de Moov. Ils montrent que chaque canal est bien compté, pas un résultat réel.</Explain>
    </Panel>
    <Panel title="Estimation du gain pour Moov" right={<Sim what="hypothèses" />}>
      <p className="small muted">Changez les quatre hypothèses : le calcul suit. Pour un vrai résultat, il faudra remplacer ces chiffres par la mesure de référence du service client de Moov, avant le pilote.</p>
      <div className="im-form">
        <Num id="im-o" label="Commandes par mois" value={orders} set={setOrders} min={0} max={100000} step={50} />
        <Num id="im-p" label="Contacts de suivi par commande, aujourd’hui" value={per} set={setPer} min={0} max={20} step={0.1} hint="À mesurer au service client" />
        <Num id="im-a" label="Part évitée grâce à Fibre Welcome" value={avoid} set={setAvoid} min={0} max={100} unit="%" hint="Hypothèse prudente : 30 %" />
        <Num id="im-m" label="Durée moyenne d’un contact" value={mins} set={setMins} min={1} max={60} unit="min" />
      </div>
      <div className="im-bars" role="img" aria-label={'Contacts par mois : ' + nf(before) + ' avant, ' + nf(after) + ' après'}>
        <div className="im-row"><span className="small">Avant</span><div className="im-track"><i className="im-bar im-bar-a" style={bar(before)} /></div><b className="num2">{nf(before)}</b></div>
        <div className="im-row"><span className="small">Avec</span><div className="im-track"><i className="im-bar im-bar-b" style={bar(after)} /></div><b className="num2">{nf(after)}</b></div>
      </div>
      <div className="im-tiles">
        <Tile label="Contacts évités par mois" value={nf(saved)} sub="estimation" ic={Icon.chat} tone="ok" />
        <Tile label="Temps libéré par mois" value={hm(saved * mins)} sub="pour les conseillers" ic={Icon.clock} tone="ok" />
      </div>
    </Panel>
  </div>;
}
