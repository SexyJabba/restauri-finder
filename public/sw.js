// Service worker minimo: rende l'app installabile e tiene in memoria solo l'interfaccia.
// I dati (schede, reazioni, profilo) NON vengono messi in cache: arrivano sempre dal server,
// così non si vede mai un archivio vecchio spacciato per attuale.
const SHELL = 'scout-shell-v1';
const FILES = ['/', '/style.css', '/app.js', '/icon.svg'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(SHELL).then((c) => c.addAll(FILES)).catch(() => {})); self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== SHELL).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/') || u.pathname === '/login') return;
  // Prima la rete (versione aggiornata); la copia salvata serve solo se il server non risponde.
  e.respondWith(fetch(e.request).then((r) => { if (r.ok) { const copy = r.clone(); caches.open(SHELL).then((c) => c.put(e.request, copy)); } return r; }).catch(() => caches.match(e.request).then((m) => m || caches.match('/'))));
});
