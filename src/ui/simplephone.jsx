// Suivi sans smartphone (SMS et USSD, simulés) : un téléphone à touches pour le client qui n'a pas d'application.
import { useQ, call } from './platform.js';
import { Btn, Icon, fmtDateTime } from './kit.jsx';
const React = window.React;
const { useState, useRef, useEffect } = React;

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];
const WORDS = ['SUIVI', 'RDV', 'DELAI', 'RAPPEL', 'AIDE'];

export function SimplePhone({ token }) {
  const [mode, setMode] = useState('ussd');
  return <section className="card stack sp-card" data-tour="client-simple">
    <div className="sp-intro"><b>Sans smartphone ?</b><span>Un client avec un téléphone à touches suit son dossier par SMS ou par code USSD, sans internet. Ici, vous l'essayez.</span></div>
    <div className="pills pills-soft" role="tablist" aria-label="Canal">
      <button type="button" role="tab" aria-selected={mode === 'ussd'} onClick={() => setMode('ussd')}>Code USSD</button>
      <button type="button" role="tab" aria-selected={mode === 'sms'} onClick={() => setMode('sms')}>SMS</button>
    </div>
    {mode === 'ussd' ? <Ussd token={token} /> : <Sms token={token} />}
    <span className="tiny muted">Simulation : aucun vrai SMS ni appel. Numéro court {'1234'}, code {'*123#'}. Seul le client voit son dossier ; Moov ne promet jamais de date par ce canal.</span>
  </section>;
}

function Ussd({ token }) {
  const [typed, setTyped] = useState('');
  const [scr, setScr] = useState(null);      // { text, end }
  const [path, setPath] = useState([]);
  const [busy, setBusy] = useState(false);
  const live = scr && !scr.end;
  const key = k => { if (!busy) setTyped(t => (t + k).slice(0, 14)); };
  const reset = () => { setTyped(''); setScr(null); setPath([]); };
  const run = async (body, nextPath) => {
    setBusy(true);
    const r = await call(token, 'ussd.step', body, { silent: true });
    setBusy(false);
    if (!r.ok) { setScr({ text: r.error.message, end: true }); return; }
    setScr(r.data); setPath(nextPath); setTyped('');
  };
  const send = () => {
    if (busy) return;
    if (live) { if (!typed) return; const np = [...path, typed]; run({ code: '*123#', path: np }, np); }
    else if (typed) run({ code: typed, path: [] }, []);
  };
  return <div className="sp-phone">
    <div className="sp-screen" role="status" aria-live="polite">
      {scr ? <pre className="sp-text">{scr.text}</pre> : <span className="sp-hint">Composez {'*123#'} puis appuyez sur la touche verte.</span>}
      <div className="sp-input">{live ? 'Réponse : ' : scr ? '' : 'Numéro : '}<b>{typed}</b><i className="sp-caret" /></div>
    </div>
    <div className="sp-pad" role="group" aria-label="Clavier">
      {KEYS.map(k => <button type="button" key={k} className="sp-key" onClick={() => key(k)} aria-label={'Touche ' + k}>{k}</button>)}
    </div>
    <div className="sp-act">
      <button type="button" className="sp-btn sp-red" onClick={() => (typed ? setTyped(t => t.slice(0, -1)) : reset())} aria-label={typed ? 'Effacer' : 'Raccrocher'}>{typed ? '⌫' : Icon.x}</button>
      <button type="button" className="sp-btn sp-green" onClick={send} disabled={busy || !typed} aria-label={live ? 'Envoyer la réponse' : 'Appeler'}>{Icon.handset}<span>{live ? 'Envoyer' : 'Appeler'}</span></button>
    </div>
    <div className="sp-quick"><button type="button" className="sp-chip" onClick={() => setTyped('*123#')}>Taper *123#</button>{scr && scr.end && <button type="button" className="sp-chip" onClick={reset}>Nouvel appel</button>}</div>
  </div>;
}

function Sms({ token }) {
  const r = useQ(token, 'outbox');
  const [text, setText] = useState('');
  const end = useRef(null);
  const thread = ((r.data || []).filter(o => o.channel === 'sms' && o.direction)).slice().reverse();
  useEffect(() => { if (end.current) end.current.scrollIntoView({ block: 'nearest' }); }, [thread.length]);
  const send = async t => { const v = (t ?? text).trim(); if (!v) return; if ((await call(token, 'sms.inbound', { text: v })).ok) setText(''); };
  return <div className="sp-phone">
    <div className="sp-screen sp-sms" aria-live="polite">
      {thread.length === 0 && <span className="sp-hint">Envoyez un mot au 1234 : SUIVI, RDV, DELAI ou RAPPEL.</span>}
      {thread.map(o => <div key={o.id} className={'sp-bub ' + (o.direction === 'entrant' ? 'sp-out' : 'sp-in')}>{o.text}<span>{fmtDateTime(o.at)}</span></div>)}
      <i ref={end} />
    </div>
    <div className="sp-quick">{WORDS.map(w => <button type="button" key={w} className="sp-chip" onClick={() => send(w)}>{w}</button>)}</div>
    <form className="sp-form" onSubmit={e => { e.preventDefault(); send(); }}>
      <input id="sp-sms" className="input" value={text} maxLength={160} onChange={e => setText(e.target.value)} placeholder="Votre SMS au 1234" aria-label="Votre SMS au 1234" autoComplete="off" />
      <Btn kind="primary" type="submit" disabled={!text.trim()}>Envoyer</Btn>
    </form>
  </div>;
}
