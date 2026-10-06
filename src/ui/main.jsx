// Point d'entrée : monte l'application dans #root.
import { App } from './app.jsx';
const React = window.React, ReactDOM = window.ReactDOM;
ReactDOM.createRoot(document.getElementById('root')).render(<App />);
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && !window.FW_NO_SW) navigator.serviceWorker.register('sw.js').catch(() => {});
