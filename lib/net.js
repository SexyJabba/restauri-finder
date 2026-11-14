// Accesso "educato" alle fonti: user agent dichiarato, rispetto di robots.txt,
// una richiesta alla volta per sito con pausa, nessun tentativo di aggirare blocchi.
'use strict';

const UA = 'ScoutPersonale/0.1 (strumento privato a uso personale; richieste manuali a bassa frequenza)';
const MIN_GAP_MS = Number(process.env.SCOUT_MIN_GAP_MS || 1500);
const TIMEOUT_MS = 20000;
// Siti che tollerano poco le letture ravvicinate: una richiesta ogni 6 secondi, senza ritentare se rifiutano.
const SLOW_HOSTS = { 'www.subito.it': 6000 };

const lastHit = new Map(); // host -> promise chain
const robotsCache = new Map(); // host -> {at, rules|null}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function throttle(host, fn) {
  const prev = lastHit.get(host) || Promise.resolve();
  const next = prev.catch(() => {}).then(async () => {
    try { return await fn(); } finally { await sleep(process.env.SCOUT_MIN_GAP_MS ? MIN_GAP_MS : Math.max(MIN_GAP_MS, SLOW_HOSTS[host] || 0)); }
  });
  lastHit.set(host, next);
  return next;
}

async function rawFetch(url, opts = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, {
      method: opts.method || 'GET',
      redirect: 'follow',
      signal: ctl.signal,
      headers: { 'user-agent': UA, 'accept-language': 'it-IT,it;q=0.9', accept: opts.accept || 'text/html,*/*;q=0.8', ...(opts.headers || {}) },
    });
  } finally { clearTimeout(t); }
}

function parseRobots(txt) {
  // Regole del gruppo "User-agent: *" (lo strumento non si presenta come un crawler noto).
  const groups = [];
  let cur = null, lastWasAgent = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === 'user-agent') {
      if (!lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(v.toLowerCase());
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (cur && (k === 'allow' || k === 'disallow') && v) cur.rules.push({ allow: k === 'allow', pattern: v });
    }
  }
  const star = groups.filter((g) => g.agents.includes('*'));
  return star.flatMap((g) => g.rules);
}

function ruleMatches(pattern, pathAndQuery) {
  const anchored = pattern.endsWith('$');
  const p = anchored ? pattern.slice(0, -1) : pattern;
  const re = new RegExp('^' + p.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + (anchored ? '$' : ''));
  return re.test(pathAndQuery);
}

function allowedBy(rules, pathAndQuery) {
  let best = null;
  for (const r of rules) {
    if (!ruleMatches(r.pattern, pathAndQuery)) continue;
    if (!best || r.pattern.length > best.pattern.length || (r.pattern.length === best.pattern.length && r.allow)) best = r;
  }
  return best ? best.allow : true;
}

async function robotsAllows(u) {
  const host = u.host;
  let c = robotsCache.get(host);
  if (!c || Date.now() - c.at > 3600e3) {
    c = { at: Date.now(), rules: null, status: 0 };
    try {
      const r = await throttle(host, () => rawFetch(u.origin + '/robots.txt', { accept: 'text/plain' }));
      c.status = r.status;
      if (r.ok) c.rules = parseRobots(await r.text());
    } catch (e) { c.status = 0; }
    robotsCache.set(host, c);
  }
  if (!c.rules) return { allowed: true, robotsStatus: c.status }; // robots non leggibile: si prova, e si accetta l'eventuale rifiuto
  return { allowed: allowedBy(c.rules, u.pathname + u.search), robotsStatus: c.status };
}

// Risultato sempre "raccontabile": mai eccezioni, sempre un esito con il motivo.
async function politeGet(url, opts = {}) {
  let u;
  try { u = new URL(url); } catch { return { ok: false, status: 0, reason: 'url_non_valido' }; }
  if (!/^https?:$/.test(u.protocol)) return { ok: false, status: 0, reason: 'url_non_valido' };
  if (isPrivateHost(u.hostname)) return { ok: false, status: 0, reason: 'host_non_ammesso' };
  const rb = await robotsAllows(u);
  if (!rb.allowed) return { ok: false, status: 0, reason: 'vietato_da_robots' };
  try {
    const r = await throttle(u.host, () => rawFetch(url, opts));
    const out = { ok: r.ok, status: r.status, finalUrl: r.url, contentType: r.headers.get('content-type') || '' };
    if (!r.ok) out.reason = r.status === 404 || r.status === 410 ? 'non_trovato' : (r.status === 403 || r.status === 429 ? 'accesso_rifiutato' : 'errore_http');
    if (opts.method === 'HEAD' || opts.noBody) { try { await r.body?.cancel(); } catch {} return out; }
    out.text = await r.text();
    return out;
  } catch (e) {
    return { ok: false, status: 0, reason: 'rete', detail: String(e.cause?.code || e.cause?.message || e.message).slice(0, 120) };
  }
}

// Controllo che un'immagine risponda davvero come immagine (senza scaricarla tutta né conservarla).
async function checkImage(url) {
  const r = await politeGet(url, { noBody: true, accept: 'image/*', headers: { range: 'bytes=0-1023' } });
  const ok = (r.status === 200 || r.status === 206) && /^image\//.test(r.contentType || '');
  return { ok, http: r.status, detail: ok ? 'immagine raggiungibile' : (r.reason || ('risposta ' + r.status + ' ' + (r.contentType || ''))) };
}

function isPrivateHost(h) {
  return /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$|0\.0\.0\.0)/.test(h) || !h.includes('.');
}

module.exports = { politeGet, checkImage, UA };
