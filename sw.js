/* Service worker : l'application s'installe et se relance sans réseau. Changer CACHE quand les fichiers changent. */
const CACHE = 'fibre-welcome-v14';
const ASSETS = ['./', 'index.html', 'app.js', 'styles.css', 'manifest.webmanifest', 'icon.svg', 'vendor/react.production.min.js', 'vendor/react-dom.production.min.js', 'vendor/fonts.css', 'vendor/fonts/jakarta-latin.woff2', 'vendor/fonts/jakarta-latin-ext.woff2'];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  const cached = () => caches.match(e.request, { ignoreSearch: true });
  // Réseau d'abord, mais seulement 6 s (réseau très lent) ; une réponse d'erreur ne remplace jamais la bonne copie.
  const net = fetch(e.request).then(r => { if (r.ok && r.status === 200) { const c = r.clone(); caches.open(CACHE).then(k => k.put(e.request, c)); return r; } return cached().then(m => m || r); });
  const slow = new Promise(ok => setTimeout(() => cached().then(m => m && ok(m), () => {}), 6000));
  e.respondWith(Promise.race([net, slow]).catch(() => cached().then(m => m || net)));
});
