// Point d'entrée : monte l'application dans #root.
import { App } from './app.jsx';
import { api, tokenFor, tabGet } from './platform.js';
const React = window.React, ReactDOM = window.ReactDOM;
// Outils de recette automatique : exposés seulement si la page de test le demande (jamais en usage normal).
if (window.FW_DEBUG) window.__fw = { api, tokenFor, owner: () => tabGet('fw:owner', null) };
ReactDOM.createRoot(document.getElementById('root')).render(<App />);
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && !window.FW_NO_SW) navigator.serviceWorker.register('sw.js').catch(() => {});
