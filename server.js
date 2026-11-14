#!/usr/bin/env node
// Scout personale — server unico (pagine + API + archivio). Avvio: node server.js
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const store = require('./lib/store');
const scout = require('./lib/scout');
const sources = require('./lib/sources');
const ai = require('./lib/ai');
const { trails, publicView } = require('./lib/trails');
const { politeGet } = require('./lib/net');

const PORT = Number(process.env.PORT || 4173);
const PASSWORD = process.env.SCOUT_PASSWORD || '';
// Senza password il sito risponde solo a questo computer. Per aprirlo dal telefono serve una password.
const HOST = process.env.HOST || (PASSWORD ? '0.0.0.0' : '127.0.0.1');
const PUBLIC = path.join(__dirname, 'public');
const SECRET = crypto.createHash('sha256').update('scout|' + PASSWORD).digest();
const token = () => crypto.createHmac('sha256', SECRET).update('sessione').digest('hex');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };

const send = (res, status, body, headers = {}) => {
  const isObj = typeof body === 'object' && !Buffer.isBuffer(body);
  res.writeHead(status, { 'content-type': isObj ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', ...headers });
  res.end(isObj ? JSON.stringify(body) : body);
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > 1e6) { reject(scout.httpErr(413, 'Richiesta troppo grande')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { const s = Buffer.concat(chunks).toString('utf8'); if (!s) return resolve({}); try { resolve(JSON.parse(s)); } catch { resolve(Object.fromEntries(new URLSearchParams(s))); } });
    req.on('error', reject);
  });
}

function authed(req) {
  if (!PASSWORD) return true;
  const m = (req.headers.cookie || '').match(/(?:^|;\s*)scout=([a-f0-9]+)/);
  if (!m) return false;
  const a = Buffer.from(m[1]), b = Buffer.from(token());
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const loginPage = (err) => `<!doctype html><html lang="it"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Lo Scout</title>
<link rel="stylesheet" href="/style.css"><body class="login"><form method="post" action="/login"><h1>Lo Scout</h1><p>Quaderno privato di scoperte.</p>
<label>Parola d'accesso<input type="password" name="password" autofocus autocomplete="current-password"></label>${err ? '<p class="err">Parola d\'accesso non corretta.</p>' : ''}<button>Entra</button></form></body></html>`;

async function sourcesState() {
  const d = store.load();
  const list = sources.registry.map((s) => ({ ...s, lastProbe: d.probes[s.id] || null }));
  return { sources: list, ai: await ai.status(), auto: scout.autoInfo(), runs: d.runs.slice(0, 8), network: { host: HOST, passwordSet: !!PASSWORD }, counts: { seen: Object.keys(d.seen).length, cards: Object.keys(d.cards).length } };
}

async function api(req, res, url) {
  const d = store.load();
  const seg = url.pathname.split('/').filter(Boolean).slice(1);
  const m = req.method;
  const body = m === 'GET' || m === 'DELETE' ? {} : await readBody(req);
  const q = Object.fromEntries(url.searchParams);

  if (seg[0] === 'state' && m === 'GET') {
    const col = (v) => scout.collection(v).length;
    return send(res, 200, { settings: d.settings, efforts: scout.EFFORTS, reactions: Object.fromEntries(Object.entries(scout.REACTIONS).map(([k, v]) => [k, v.label])), trails: trails.map(publicView), ai: await ai.status(),
      counts: { feed: scout.feed({}).total, conservate: col('conservate'), incuriosito: col('incuriosito'), archiviate: col('archiviate'), nonverificate: col('nonverificate'), scartate: col('scartate'), dossiers: Object.keys(d.dossiers).length } });
  }
  if (seg[0] === 'feed' && m === 'GET') return send(res, 200, scout.feed(q));
  if (seg[0] === 'cards') {
    if (!seg[1] && m === 'GET') return send(res, 200, { items: scout.collection(q.view) });
    if (!seg[1] && m === 'POST') return send(res, 201, scout.createManual(body));
    const id = seg[1];
    if (!d.cards[id]) throw scout.httpErr(404, 'Scheda non trovata');
    if (!seg[2] && m === 'GET') return send(res, 200, scout.view(d.cards[id]));
    if (!seg[2] && m === 'PATCH') return send(res, 200, scout.patchCard(id, body));
    if (!seg[2] && m === 'DELETE') { scout.removeCard(id); return send(res, 200, { ok: true }); }
    if (seg[2] === 'react' && m === 'POST') return send(res, 200, scout.react(id, body.type, body.reason));
    if (seg[2] === 'reason' && m === 'POST') return send(res, 200, scout.setReason(id, body.reason));
    if (seg[2] === 'undo' && m === 'POST') return send(res, 200, scout.undoReaction(id));
    if (seg[2] === 'check' && m === 'POST') return send(res, 200, await scout.recheck(id));
    if (seg[2] === 'narrate' && m === 'POST') {
      const n = await ai.narrate(scout.view(d.cards[id]), d.tastes);
      const c = d.cards[id];
      c.scout = { title: n.title, why: n.why, project: n.project, doubt: n.doubt, author: 'ai-api', model: n.model, writtenAt: new Date().toISOString() };
      if (c.effortBy !== 'utente') { c.effort = n.effort; c.effortBy = 'ai'; }
      store.save();
      return send(res, 200, scout.view(c));
    }
  }
  if (seg[0] === 'check-all') {
    if (m === 'POST') return send(res, 202, scout.recheckAll());
    return send(res, 200, scout.recheckStatus() || { done: true, total: 0, checked: 0, changed: [] });
  }
  if (seg[0] === 'extract' && m === 'POST') return send(res, 200, await scout.extract(String(body.url || '').trim()));
  if (seg[0] === 'search') {
    if (seg[1] === 'run' && m === 'POST') return send(res, 202, scout.startSearch({ category: body.category || null, trailIds: body.trailIds, trigger: 'manuale' }));
    if (seg[1] === 'status') return send(res, 200, scout.searchStatus() || { done: true, idle: true });
  }
  if (seg[0] === 'tastes') {
    const clean = (b) => ({ text: String(b.text || '').trim().slice(0, 1000), kind: ['esplicita', 'ipotesi', 'incerta'].includes(b.kind) ? b.kind : 'esplicita', category: ['auto', 'moto', 'gommoni', 'generale', 'capacita'].includes(b.category) ? b.category : 'generale' });
    if (!seg[1] && m === 'POST') {
      const t = clean(body);
      if (!t.text) throw scout.httpErr(400, 'Testo mancante');
      const now = new Date().toISOString();
      const row = { id: store.id('t'), ...t, origin: body.origin || 'scritta da te', createdAt: now, updatedAt: now };
      d.tastes.push(row); store.save();
      return send(res, 201, row);
    }
    const t = d.tastes.find((x) => x.id === seg[1]);
    if (seg[1] && !t) throw scout.httpErr(404, 'Voce non trovata');
    if (t && m === 'PATCH') { const c = clean({ ...t, ...body }); Object.assign(t, c, { updatedAt: new Date().toISOString(), edited: true }); store.save(); return send(res, 200, t); }
    if (t && m === 'DELETE') { d.tastes.splice(d.tastes.indexOf(t), 1); store.save(); return send(res, 200, { ok: true }); }
  }
  if (seg[0] === 'profile' && m === 'GET') {
    const diary = d.reactions.slice().reverse().slice(0, 200).map((r) => ({ ...r, label: scout.REACTIONS[r.type].label, card: d.cards[r.cardId] ? { id: r.cardId, name: d.cards[r.cardId].name, category: d.cards[r.cardId].category } : null }));
    return send(res, 200, { tastes: d.tastes, signals: scout.signals(), diary, surpriseBias: d.settings.surpriseBias || 0 });
  }
  if (seg[0] === 'dossiers') {
    if (!seg[1] && m === 'GET') return send(res, 200, { items: Object.keys(d.dossiers).map((id) => scout.dossierView(id)).filter((x) => x.card).sort((a, b) => b.openedAt.localeCompare(a.openedAt)) });
    const ds = scout.dossierView(seg[1]);
    if (!ds) throw scout.httpErr(404, 'Approfondimento non trovato');
    if (!seg[2] && m === 'GET') return send(res, 200, ds);
    if (!seg[2] && m === 'PATCH') return send(res, 200, scout.updateDossier(seg[1], body));
    if (seg[2] === 'ai' && m === 'POST') {
      d.dossiers[seg[1]].aiDraft = await ai.dossierDraft(scout.view(d.cards[seg[1]]), d.tastes);
      store.save();
      return send(res, 200, scout.dossierView(seg[1]));
    }
  }
  if (seg[0] === 'sources') {
    if (!seg[1] && m === 'GET') return send(res, 200, await sourcesState());
    if (seg[2] === 'probe' && m === 'POST') {
      const s = sources.registry.find((x) => x.id === seg[1]);
      if (!s || !s.probe) throw scout.httpErr(400, 'Nessuna prova disponibile per questa fonte');
      const r = await politeGet(s.probe, { noBody: true });
      d.probes[s.id] = { at: new Date().toISOString(), http: r.status, ok: !!r.ok, detail: r.ok ? 'risponde' : (sources.REASONS[r.reason] || r.reason || 'nessuna risposta'), url: s.probe };
      store.save();
      return send(res, 200, d.probes[s.id]);
    }
  }
  if (seg[0] === 'settings' && m === 'PATCH') {
    if (body.base === null) d.settings.base = null;
    else if (body.base && Number.isFinite(+body.base.lat) && Number.isFinite(+body.base.lon)) d.settings.base = { label: String(body.base.label || 'Punto di partenza').slice(0, 80), lat: +body.base.lat, lon: +body.base.lon };
    if (body.autoSearch) { d.settings.autoSearch = { enabled: !!body.autoSearch.enabled, hours: Math.max(6, Math.min(168, Number(body.autoSearch.hours) || 24)) }; scout.scheduleAuto(); }
    if (body.surpriseBias != null) d.settings.surpriseBias = Math.max(0, Math.min(3, +body.surpriseBias || 0));
    store.save();
    return send(res, 200, { settings: d.settings, auto: scout.autoInfo() });
  }
  if (seg[0] === 'export' && m === 'GET') return send(res, 200, d, { 'content-disposition': 'attachment; filename="scout-backup.json"' });
  throw scout.httpErr(404, 'Percorso non trovato');
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/login' && req.method === 'POST') {
      const b = await readBody(req);
      const a = Buffer.from(String(b.password || '')), p = Buffer.from(PASSWORD);
      if (PASSWORD && a.length === p.length && crypto.timingSafeEqual(a, p)) return send(res, 303, '', { location: '/', 'set-cookie': `scout=${token()}; HttpOnly; SameSite=Lax; Path=/; Max-Age=7776000${req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : ''}` });
      await new Promise((r) => setTimeout(r, 800));
      return send(res, 401, loginPage(true));
    }
    if (['/style.css', '/icon.svg', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/icon-512-maskable.png'].includes(url.pathname)) { /* servono anche alla pagina d'accesso */ }
    else if (!authed(req)) return url.pathname.startsWith('/api/') ? send(res, 401, { error: 'Accesso richiesto' }) : send(res, 401, loginPage(false));
    if (url.pathname.startsWith('/api/')) {
      // Le modifiche arrivano solo dalla stessa origine (difesa semplice contro richieste da altri siti).
      if (req.method !== 'GET' && req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return send(res, 403, { error: 'Origine non ammessa' });
      return await api(req, res, url);
    }
    let file = path.normalize(path.join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname));
    if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(PUBLIC, 'index.html');
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
      'content-security-policy': "default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'" });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500 && status !== 503) console.error(e);
    send(res, status, { error: e.message || 'Errore interno' });
  }
});

store.load();
scout.scheduleAuto();
server.listen(PORT, HOST, () => {
  console.log(`Lo Scout è aperto su http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(PASSWORD ? 'Accesso protetto da parola d\'accesso; raggiungibile dalla rete locale.' : 'Nessuna parola d\'accesso: risponde solo a questo computer. Per il telefono: SCOUT_PASSWORD=... node server.js');
  console.log('Archivio: ' + store.FILE);
});
