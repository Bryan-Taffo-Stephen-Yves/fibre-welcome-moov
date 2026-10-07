// Site des offres « Moov Fibre » (démonstration) : offres, commande en 3 étapes, paiement Moov Money simulé,
// puis ouverture de l'application du client sur le dossier qui vient d'être créé.
import { useQ, call, useNow, liveClock } from './platform.js';
import { Btn, Tag, Sim, Icon, Avatar, HouseScene, money, firstName } from './kit.jsx';
import { OFFERS, SHOP_ZONES, ZONES } from '../server/model.js';
const React = window.React;
const { useState, useEffect, useRef } = React;

const STEPS = [['adresse', 'Votre adresse'], ['contact', 'Vos coordonnées'], ['paiement', 'Paiement']];
// Erreur du serveur → étape du formulaire à corriger.
const ERR_STEP = { zone: 'adresse', adresse: 'adresse', nom: 'contact', tel: 'contact' };
const newKey = () => 'shop-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
const newCode = () => String(1000 + Math.floor(Math.random() * 9000));
const pad = n => String(n).padStart(2, '0');
const digitsOf = p => String(p || '').replace(/\D/g, '');
const zoneName = id => (ZONES.find(z => z.id === id) || {}).name || id;
const HOW = [
  ['Awa Kouassi', 'Vous payez en ligne', 'Avec Moov Money, en une minute.'],
  ['Awa Kouassi', 'Vous envoyez votre dossier', 'Photos de la pièce d’identité, repère, créneau : 24 h pour le faire.'],
  ['Nadia Konan', 'Moov vérifie et planifie', 'Nadia regarde les photos, Hervé choisit le technicien et l’heure.'],
  ['Brice Yao', 'Le technicien arrive', 'Suivez son trajet en direct, puis notez la visite.'],
];

export function Shop({ owner, onDone, onBack, dark, onTheme }) {
  const me = useQ(owner, 'me');
  const myPhone = (me.data && me.data.user && me.data.user.phone) || '';
  const [offerId, setOfferId] = useState(null);
  const [step, setStep] = useState('adresse'); // adresse · contact · paiement · confirmer · ok
  const [f, setF] = useState(() => ({ zone: '', street: '', landmark: '', building: 'maison', name: 'Awa Kouassi', phone: myPhone }));
  const [miss, setMiss] = useState({});
  const [err, setErr] = useState(null);
  const [code, setCode] = useState('');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const key = useRef(null);
  useEffect(() => { if (!f.phone && myPhone) setF(x => ({ ...x, phone: myPhone })); }, [myPhone]);
  const set = (k, v) => { setF(x => ({ ...x, [k]: v })); setMiss(m => ({ ...m, [k]: null })); };
  const toTop = () => setTimeout(() => window.scrollTo(0, 0), 0);
  // Bouton Retour du téléphone : on revient à l'étape précédente du formulaire (rien n'est effacé) au lieu de quitter le site.
  const STEPS = ['adresse', 'contact', 'paiement', 'confirmer'];
  const cur = useRef(null); cur.current = { step, offerId };
  const push = () => { try { history.pushState({ fwShop: 1 }, ''); } catch {} };
  useEffect(() => {
    const onPop = () => { const c = cur.current; if (!c.offerId || c.step === 'ok') return; const i = STEPS.indexOf(c.step); if (i > 0) { setStep(STEPS[i - 1]); setErr(null); } else setOfferId(null); };
    window.addEventListener('popstate', onPop); return () => window.removeEventListener('popstate', onPop);
  }, []);
  const goStep = s => { if (STEPS.indexOf(s) > STEPS.indexOf(step)) push(); setStep(s); setErr(null); toTop(); };
  const choose = id => { if (!offerId) push(); setOfferId(id); setStep('adresse'); setErr(null); setResult(null); window.scrollTo(0, 0); };
  const offer = OFFERS.find(o => o.id === offerId);
  const scrollTo = id => { const el = document.getElementById(id); if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' }); };

  const checkAddress = () => { const m = {}; if (!f.zone) m.zone = 'Choisissez votre commune.'; if (f.street.trim().length < 3) m.street = 'Indiquez votre quartier et votre rue.'; setMiss(m); return !Object.keys(m).length; };
  const checkContact = () => { const m = {}; if (f.name.trim().length < 3) m.name = 'Indiquez votre prénom et votre nom.'; const d = digitsOf(f.phone).length; if (d < 8 || d > 15) m.phone = 'Numéro incomplet.'; setMiss(m); return !Object.keys(m).length; };
  // Une tentative de paiement = une clé : retoucher « Confirmer » ne paie jamais deux fois.
  const startPay = () => { key.current = newKey(); setCode(newCode()); setTyped(''); goStep('confirmer'); };
  const confirm = async () => {
    if (typed !== code || busy) return;
    setBusy(true); setErr(null);
    const r = await call(owner, 'shop.purchase', { offerId, zone: f.zone, name: f.name.trim(), phone: f.phone, street: f.street.trim(), landmark: f.landmark.trim(), building: f.building }, { idemKey: key.current, silent: true });
    setBusy(false);
    if (r.ok) { setResult(r.data); setStep('ok'); toTop(); } else { setErr(r.error); toTop(); }
  };

  return <div className="sh">
    <header className="sh-top">
      <div className="sh-wrap sh-top-in">
        <button type="button" className="sh-brand" onClick={() => { setOfferId(null); window.scrollTo(0, 0); }}><span className="sh-logo">{Icon.logo}</span><span>Moov <b>Fibre</b></span></button>
        {!offerId && <nav className="sh-nav" aria-label="Sections">
          <button type="button" onClick={() => scrollTo('sh-offres')}>Offres</button>
          <button type="button" onClick={() => scrollTo('sh-how')}>Comment ça marche</button>
        </nav>}
        <span className="sh-demo" title="Rien n’est vendu ici : c’est une démonstration">◇ Site de démonstration · paiement simulé</span>
        {onTheme && <button type="button" className="icon-btn sh-theme" onClick={onTheme} aria-label="Changer le thème">{dark ? Icon.sun : Icon.moon}</button>}
      </div>
      {onBack && <div className="sh-wrap sh-back-row"><button type="button" className="sh-back" onClick={onBack}>{Icon.left}Retour à Fibre Welcome</button></div>}
    </header>

    {!offer ? <main className="sh-wrap sh-main">
      <section className="sh-hero">
        <div className="sh-hero-text">
          <span className="sh-kicker"><i />Fibre disponible à Cocody, Yopougon, Marcory et Bingerville</span>
          <h1 className="sh-h1">La fibre Moov chez vous, <em>suivie pas à pas</em>.</h1>
          <p className="sh-lede">Payez en ligne, envoyez votre dossier depuis votre téléphone et suivez le technicien jusqu’à votre porte. Installation comprise.</p>
          <div className="sh-cta">
            <Btn kind="accent" onClick={() => scrollTo('sh-offres')}>Voir les offres{Icon.right}</Btn>
            <Btn onClick={() => scrollTo('sh-how')}>Comment ça marche</Btn>
          </div>
          <ul className="sh-trust">
            <li>{Icon.check}Paiement Moov Money</li>
            <li>{Icon.check}Technicien suivi en direct</li>
            <li>{Icon.check}Sans engagement de durée</li>
          </ul>
        </div>
        <div className="sh-art" aria-hidden="true">
          <span className="sh-art-sun" />
          <div className="sh-bub sh-bub1"><Avatar name="Awa Kouassi" size={38} /><span><b>Enfin la fibre à la maison !</b><small>Awa, Cocody</small></span></div>
          <div className="sh-bub sh-bub2"><Avatar name="Brice Yao" size={38} /><span><b>J’arrive dans 4 min</b><small>Brice, technicien</small></span></div>
          <div className="sh-speed"><b>300</b><small>Mb/s</small></div>
          <HouseScene progress={1} height={210} />
        </div>
      </section>

      <section id="sh-offres" className="sh-sec">
        <div className="sh-sec-head"><h2 className="sh-h2">Choisissez votre offre</h2><p className="muted">Prix en francs CFA. Le premier paiement comprend les frais d’accès et le premier mois.</p></div>
        <div className="sh-offers">{OFFERS.map(o => <article key={o.id} className={'sh-offer' + (o.best ? ' is-best' : '')}>
          {o.best && <span className="sh-ribbon">{Icon.star}La plus choisie</span>}
          <span className="sh-offer-name">{o.name}</span>
          <div className="sh-offer-speed"><b className="num">{o.speed.split(' ')[0]}</b><span>{o.speed.split(' ')[1]}</span></div>
          <div className="sh-offer-price"><b className="num">{money(o.monthly)}</b><span> / mois</span></div>
          <div className="sh-offer-today"><span>Aujourd’hui</span><b className="num">{money(o.pay)}</b><small>frais d’accès + 1er mois</small></div>
          <ul className="sh-perks">{o.perks.map(p => <li key={p}>{Icon.check}{p}</li>)}</ul>
          <Btn kind={o.best ? 'accent' : 'primary'} block onClick={() => choose(o.id)}>Choisir {o.name.replace('Fibre ', '')}</Btn>
        </article>)}</div>
      </section>

      <section id="sh-how" className="sh-sec">
        <div className="sh-sec-head"><h2 className="sh-h2">Comment ça marche</h2><p className="muted">Quatre étapes, toutes visibles dans votre application Moov Fibre.</p></div>
        <ol className="sh-how">{HOW.map(([n, t, d], i) => <li key={t}>
          <span className="sh-how-n">{i + 1}</span><Avatar name={n} size={52} />
          <b>{t}</b><span className="small muted">{d}</span>
        </li>)}</ol>
      </section>
      <Foot />
    </main>

      : <main className="sh-wrap sh-main">
        {step === 'ok' && result ? <Success owner={owner} me={me} result={result} offer={offer} onOpen={() => onDone(result)} />
          : <div className="sh-checkout">
            <div className="sh-flow">
              <button type="button" className="sh-back sh-back-in" onClick={() => setOfferId(null)}>{Icon.left}Changer d’offre</button>
              <Stepper step={step} />
              {err && <div className="alert alert-bad sh-err" role="alert"><b>Le paiement n’est pas passé.</b> {err.message}
                {ERR_STEP[err.code] && <div><Btn size="s" onClick={() => goStep(ERR_STEP[err.code])}>Corriger</Btn></div>}</div>}

              {step === 'adresse' && <section className="sh-card stack">
                <h2 className="sh-h3">Où installer la fibre ?</h2>
                <div className="field"><span className="sh-label">Commune</span>
                  <div className="sh-zones" role="radiogroup" aria-label="Commune">{ZONES.map(z => {
                    const open = SHOP_ZONES.includes(z.id);
                    return <button key={z.id} type="button" role="radio" aria-checked={f.zone === z.id} disabled={!open} className="sh-zone" onClick={() => set('zone', z.id)}>{Icon.pin}{z.name}{!open && <small>bientôt</small>}</button>;
                  })}</div>
                  {miss.zone && <span className="sh-miss">{miss.zone}</span>}
                </div>
                <div className="field"><label htmlFor="sh-street">Quartier et rue</label><input id="sh-street" className="input" value={f.street} onChange={e => set('street', e.target.value)} placeholder="Ex. Riviera 3, rue des Jardins" autoComplete="off" />{miss.street && <span className="sh-miss">{miss.street}</span>}</div>
                <div className="field"><label htmlFor="sh-land">Repère <span className="muted">(facultatif ici)</span></label><input id="sh-land" className="input" value={f.landmark} onChange={e => set('landmark', e.target.value)} placeholder="Ex. portail vert après la pharmacie" autoComplete="off" /><span className="tiny muted">Vous pourrez le compléter dans votre dossier : il aide le technicien à vous trouver.</span></div>
                <div className="field"><span className="sh-label">Type de logement</span>
                  <div className="sh-seg" role="radiogroup" aria-label="Type de logement">{[['maison', 'Maison'], ['immeuble', 'Immeuble']].map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={f.building === k} onClick={() => set('building', k)}>{l}</button>)}</div>
                </div>
                <div className="sh-actions"><Btn kind="primary" onClick={() => checkAddress() && goStep('contact')}>Continuer{Icon.right}</Btn></div>
              </section>}

              {step === 'contact' && <section className="sh-card stack">
                <h2 className="sh-h3">Vos coordonnées</h2>
                <div className="alert alert-warn sh-warn" role="note">{Icon.alert}<span><b>N’utilisez pas vos vraies données : démo.</b> Le nom et le numéro d’Awa, une cliente inventée, sont déjà remplis.</span></div>
                <div className="field"><label htmlFor="sh-name">Nom complet</label><input id="sh-name" className="input" value={f.name} onChange={e => set('name', e.target.value)} autoComplete="off" />{miss.name && <span className="sh-miss">{miss.name}</span>}<span className="tiny muted">Un autre nom crée un nouveau client dans l’espace de démonstration.</span></div>
                <div className="field"><label htmlFor="sh-phone">Numéro Moov Money</label><input id="sh-phone" className="input num" inputMode="tel" value={f.phone} onChange={e => set('phone', e.target.value)} autoComplete="off" />{miss.phone && <span className="sh-miss">{miss.phone}</span>}</div>
                <div className="sh-actions"><Btn kind="ghost" onClick={() => goStep('adresse')}>{Icon.left}Retour</Btn><Btn kind="primary" onClick={() => checkContact() && goStep('paiement')}>Continuer{Icon.right}</Btn></div>
              </section>}

              {step === 'paiement' && <section className="sh-card stack">
                <h2 className="sh-h3">Récapitulatif et paiement</h2>
                <dl className="sh-recap">
                  <div><dt>Offre</dt><dd>{offer.name} · {offer.speed}</dd></div>
                  <div><dt>Adresse</dt><dd>{f.street.trim()}, {zoneName(f.zone)} · {f.building === 'immeuble' ? 'immeuble' : 'maison'}{f.landmark.trim() ? ' · ' + f.landmark.trim() : ''}</dd></div>
                  <div><dt>Client</dt><dd>{f.name.trim()} · <span className="num">{f.phone}</span></dd></div>
                  <div><dt>Puis chaque mois</dt><dd className="num">{money(offer.monthly)}</dd></div>
                </dl>
                <div className="sh-mm" aria-label="Moyen de paiement">
                  <span className="sh-mm-logo">MM</span>
                  <span className="grow"><b>Moov Money</b><span className="tiny muted">Numéro se terminant par {digitsOf(f.phone).slice(-2)}</span></span>
                  <span className="sh-mm-on">{Icon.check}</span>
                </div>
                <p className="small muted">Aucun code secret ni carte bancaire ne vous sera demandé. <Sim what="paiement simulé : aucun argent ne circule" /></p>
                <div className="sh-actions"><Btn kind="ghost" onClick={() => goStep('contact')}>{Icon.left}Retour</Btn><Btn kind="accent" onClick={startPay}>Payer {money(offer.pay)}</Btn></div>
              </section>}

              {step === 'confirmer' && <section className="sh-card stack">
                <h2 className="sh-h3">Confirmez le paiement</h2>
                <div className="sh-sms" aria-live="polite">
                  <span className="sh-mm-logo">MM</span>
                  <div><span className="tiny muted">Moov Money · à l’instant</span><p>Paiement de <b>{money(offer.pay)}</b> à Moov Fibre. Votre code de confirmation : <b className="sh-code num">{code}</b></p></div>
                </div>
                <div className="field"><label htmlFor="sh-otp">Retapez le code à 4 chiffres affiché ci-dessus</label>
                  <input id="sh-otp" className="input sh-otp num" inputMode="numeric" autoComplete="one-time-code" maxLength={4} value={typed} onChange={e => { setTyped(e.target.value.replace(/\D/g, '').slice(0, 4)); setErr(null); }} onKeyDown={e => { if (e.key === 'Enter') confirm(); }} placeholder="• • • •" />
                  {typed.length === 4 && typed !== code && <span className="sh-miss">Ce n’est pas le bon code : regardez le message ci-dessus.</span>}
                </div>
                <p className="small"><Sim what="paiement simulé : aucun argent ne circule" /></p>
                <div className="sh-actions"><Btn kind="ghost" onClick={() => goStep('paiement')} disabled={busy}>{Icon.left}Annuler</Btn><Btn kind="accent" disabled={typed !== code || busy} onClick={confirm}>{busy ? 'Paiement en cours…' : 'Confirmer le paiement'}</Btn></div>
              </section>}
            </div>

            <aside className="sh-sum" aria-label="Votre commande">
              <span className="eyebrow">Votre commande</span>
              <div className="sh-sum-offer"><b>{offer.name}</b><span className="sh-sum-speed num">{offer.speed}</span></div>
              <div className="sh-sum-line"><span>Frais d’accès + 1er mois</span><b className="num">{money(offer.pay)}</b></div>
              <div className="sh-sum-line muted"><span>Ensuite, chaque mois</span><span className="num">{money(offer.monthly)}</span></div>
              <hr className="sep" />
              <div className="sh-sum-line sh-sum-total"><span>À payer aujourd’hui</span><b className="num">{money(offer.pay)}</b></div>
              <div className="sh-sum-who"><Avatar name="Nadia Konan" size={34} /><span className="small muted">Après le paiement, vous avez <b className="lb-ink">24 h</b> pour envoyer votre dossier depuis l’application.</span></div>
            </aside>
          </div>}
        <Foot />
      </main>}
  </div>;
}

function Stepper({ step }) {
  const i = step === 'confirmer' ? 2 : STEPS.findIndex(s => s[0] === step);
  return <ol className="sh-steps" aria-label="Étapes de la commande">{STEPS.map(([k, l], n) => <li key={k} className={n < i ? 'done' : n === i ? 'now' : ''} aria-current={n === i ? 'step' : undefined}>
    <span className="sh-step-n">{n < i ? Icon.check : n + 1}</span><span className="sh-step-l">{l}</span>
  </li>)}</ol>;
}

// Écran de réussite : référence, compte à rebours du dossier, puis ouverture de l'application (après ~4 s).
function Success({ me, result, offer, onOpen }) {
  useNow(1000);
  const [auto, setAuto] = useState(true);
  useEffect(() => { if (!auto) return; const t = setTimeout(onOpen, 4200); return () => clearTimeout(t); }, [auto]);
  const ws = me.data && me.data.ws;
  const left = Math.max(0, result.dueAt - liveClock(ws));
  const h = Math.floor(left / 36e5), m = Math.floor((left % 36e5) / 6e4), s = Math.floor((left % 6e4) / 1e3);
  const hours = (ws && ws.dossierDeadlineH) || 24;
  return <section className="sh-ok">
    <div className="sh-ok-head">
      <span className="sh-ok-check">{Icon.check}</span>
      <div className="stack-s">
        <h1 className="sh-h2">Paiement confirmé</h1>
        <p className="muted">Merci {firstName(result.userName)} ! Votre commande <b className="lb-ink">{result.offer}</b> est enregistrée.</p>
      </div>
    </div>
    <div className="sh-ok-grid">
      <div className="sh-ok-ref"><span className="tiny muted">Référence du dossier</span><b className="num">{result.ref}</b><span className="small muted">{money(result.amount)} payés avec Moov Money <Sim what="simulé" /></span></div>
      <div className="sh-ok-timer">
        <span className="sh-ok-tl">{Icon.clock}{hours} h pour envoyer votre dossier</span>
        <div className="sh-ok-clock num" role="timer" aria-label={'Temps restant : ' + h + ' heures ' + m + ' minutes'}><span>{pad(h)}<small>h</small></span><i>:</i><span>{pad(m)}<small>min</small></span><i>:</i><span>{pad(s)}<small>s</small></span></div>
        <span className="tiny muted">Photos de la pièce d’identité (recto, verso), un selfie, le repère de la maison et le créneau de visite.</span>
      </div>
    </div>
    <div className="sh-ok-go">
      <Avatar name={result.userName} size={44} />
      <div className="grow stack-s">
        <Btn kind="accent" onClick={onOpen}>{Icon.phone}Ouvrir mon application Moov Fibre</Btn>
        {auto ? <span className="tiny muted sh-ok-auto"><i className="sh-ok-bar" />Ouverture automatique dans un instant… <button type="button" className="link-btn tiny" onClick={() => setAuto(false)}>Rester ici</button></span>
          : <span className="tiny muted">L’application s’ouvrira quand vous toucherez le bouton.</span>}
      </div>
    </div>
    <Tag tone="sim">◇ Aucun argent n’a circulé : paiement de démonstration</Tag>
  </section>;
}

const Foot = () => <footer className="sh-foot">
  <span className="sh-brand sh-brand-s"><span className="sh-logo">{Icon.logo}</span><span>Moov <b>Fibre</b></span></span>
  <span className="tiny muted">Site de démonstration réalisé pour Fibre Welcome. Offres, clients et paiements sont inventés : aucun argent ne circule.</span>
</footer>;
