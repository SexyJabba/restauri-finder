// Logica dello scout: ricerca, deduplicazione, verifica, flusso con varietà, reazioni, approfondimenti.
'use strict';
const store = require('./store');
const sources = require('./sources');
const { trails, byId: trailById } = require('./trails');

const REACTIONS = {
  incuriosisce: { label: 'Mi incuriosisce', score: 1 },
  conserva: { label: 'Conserva l\'idea', score: 2 },
  sorprendimi: { label: 'Sorprendimi ancora', score: 1 },
  scarta: { label: 'Non fa per me', score: -1 },
  considera: { label: 'Questa la considero davvero', score: 2 },
};
const EFFORTS = { usare: 'Da usare e migliorare', fasi: 'Recupero per fasi', restauro: 'Restauro importante', capire: 'Ancora da capire' };

const db = () => store.load();
const now = () => new Date().toISOString();

/* ---------- stato derivato delle schede ---------- */
function lastReaction(cardId) {
  const d = db();
  for (let i = d.reactions.length - 1; i >= 0; i--) if (d.reactions[i].cardId === cardId) return d.reactions[i];
  return null;
}

function distanceKm(card) {
  const b = db().settings.base, f = card.facts || {};
  if (!b || f.lat == null || f.lon == null) return null;
  const R = 6371, rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(f.lat - b.lat), dLon = rad(f.lon - b.lon);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(b.lat)) * Math.cos(rad(f.lat)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

function view(card) {
  const r = lastReaction(card.id);
  const d = db();
  const t = trailById[card.trailId];
  return {
    ...card,
    reaction: r ? { type: r.type, label: REACTIONS[r.type].label, reason: r.reason || '', at: r.at } : null,
    reactionHistory: d.reactions.filter((x) => x.cardId === card.id).map((x) => ({ type: x.type, label: REACTIONS[x.type].label, reason: x.reason || '', at: x.at })),
    saved: !!r && (r.type === 'conserva' || r.type === 'considera'),
    hasDossier: !!d.dossiers[card.id],
    archived: card.status === 'non_disponibile',
    distanceKm: distanceKm(card),
    trail: t ? { id: t.id, label: t.label, why: t.why, kind: t.kind } : null,
    effortLabel: EFFORTS[card.effort || 'capire'],
  };
}

/* ---------- peso delle piste: le reazioni orientano, non comandano ---------- */
function trailWeights() {
  const d = db();
  const score = {};
  for (const r of d.reactions) {
    const c = d.cards[r.cardId];
    if (!c || !c.trailId) continue;
    score[c.trailId] = (score[c.trailId] || 0) + REACTIONS[r.type].score;
  }
  const w = {};
  // Limiti stretti di proposito: nessuna pista sparisce e nessuna monopolizza il flusso.
  for (const t of trails) w[t.id] = Math.max(0.5, Math.min(1.75, 1 + 0.2 * (score[t.id] || 0)));
  return w;
}

/* ---------- flusso "Scoperte" ---------- */
function feed(filters = {}) {
  const d = db();
  const w = trailWeights();
  let pool = Object.values(d.cards).filter((c) => c.status === 'attiva' && !c.duplicateOf && !lastReaction(c.id));
  const total = pool.length;
  if (filters.cat) pool = pool.filter((c) => c.category === filters.cat);
  if (filters.effort) pool = pool.filter((c) => (c.effort || 'capire') === filters.effort);
  if (filters.maxPrice) pool = pool.filter((c) => c.facts?.price != null && c.facts.price <= +filters.maxPrice);
  if (filters.maxKm) pool = pool.filter((c) => { const k = distanceKm(c); return k != null && k <= +filters.maxKm; });
  pool.sort((a, b) => (w[b.trailId] || 1) - (w[a.trailId] || 1) || (b.addedAt || '').localeCompare(a.addedAt || ''));
  // Composizione: una sorpresa almeno ogni 4 schede (ogni 3 se hai chiesto "Sorprendimi ancora"),
  // e mai due schede di fila della stessa pista o, se possibile, della stessa categoria.
  const every = (d.settings.surpriseBias || 0) > 0 ? 3 : 4;
  const out = [];
  while (pool.length) {
    const prev = out[out.length - 1];
    const wantSurprise = out.length % every === every - 1;
    // Tra le candidate valide vince la categoria finora meno rappresentata: auto, moto e gommoni si alternano.
    const seenCat = (c) => out.filter((o) => o.category === c.category).length;
    const pick = (test) => { let best = -1; pool.forEach((c, k) => { if (test(c) && (best < 0 || seenCat(c) < seenCat(pool[best]))) best = k; }); return best; };
    let i = -1;
    if (wantSurprise) i = pick((c) => c.kind === 'sorpresa' && (!prev || c.trailId !== prev.trailId));
    if (i < 0) i = pick((c) => !prev ? true : (c.category !== prev.category && c.trailId !== prev.trailId));
    if (i < 0) i = pick((c) => !prev || c.trailId !== prev.trailId);
    if (i < 0) i = 0;
    out.push(pool.splice(i, 1)[0]);
  }
  return { total, items: out.map(view) };
}

function collection(viewName) {
  const all = Object.values(db().cards).map(view).sort((a, b) => ((b.reaction?.at || b.addedAt) || '').localeCompare((a.reaction?.at || a.addedAt) || ''));
  const f = {
    conservate: (c) => c.reaction && (c.reaction.type === 'conserva' || c.reaction.type === 'considera') && !c.archived,
    incuriosito: (c) => c.reaction && (c.reaction.type === 'incuriosisce' || c.reaction.type === 'sorprendimi') && !c.archived,
    archiviate: (c) => c.archived && (!c.reaction || c.reaction.type !== 'scarta'),
    scartate: (c) => c.reaction?.type === 'scarta',
    nonverificate: (c) => !c.archived && c.status !== 'attiva' && (!c.reaction || c.reaction.type !== 'scarta'),
  }[viewName];
  return f ? all.filter(f) : all;
}

/* ---------- reazioni ---------- */
function react(cardId, type, reason) {
  const d = db();
  const card = d.cards[cardId];
  if (!card) throw httpErr(404, 'Scheda non trovata');
  if (!REACTIONS[type]) throw httpErr(400, 'Reazione non riconosciuta');
  const r = { id: store.id('r'), cardId, type, reason: String(reason || '').trim().slice(0, 1000), at: now() };
  d.reactions.push(r);
  if (type === 'sorprendimi') d.settings.surpriseBias = Math.min(3, (d.settings.surpriseBias || 0) + 1);
  if (type === 'scarta' && card.kind === 'sorpresa') d.settings.surpriseBias = Math.max(0, (d.settings.surpriseBias || 0) - 1);
  // Solo l'azione esplicita "Questa la considero davvero" apre un approfondimento.
  if (type === 'considera' && !d.dossiers[cardId]) d.dossiers[cardId] = newDossier(card);
  store.save();
  return view(card);
}

function setReason(cardId, reason) {
  const r = lastReaction(cardId);
  if (!r) throw httpErr(400, 'Nessuna reazione da annotare');
  r.reason = String(reason || '').trim().slice(0, 1000);
  store.save();
  return view(db().cards[cardId]);
}

function undoReaction(cardId) {
  const d = db();
  const r = lastReaction(cardId);
  if (!r) return view(d.cards[cardId]);
  d.reactions.splice(d.reactions.indexOf(r), 1);
  store.save();
  return view(d.cards[cardId]);
}

/* ---------- approfondimenti ---------- */
function newDossier(card) {
  const item = (text) => ({ id: store.id('k'), text, done: false, origin: 'promemoria generico dello scout' });
  const common = [
    'Riaprire l\'annuncio e controllare che sia ancora attivo (pulsante "Ricontrolla la fonte").',
    'Vedere il mezzo di persona prima di qualsiasi valutazione: le foto non bastano.',
    'Documenti: intestatario, libretto, eventuali fermi o gravami — da verificare, non dichiarati qui.',
  ];
  const byCat = {
    auto: ['Ruggine strutturale: fondi, longheroni, passaruota, attacchi sospensioni.', 'Quali lavori restano nelle tue mani (carrozzeria, interni, meccanica smontabile) e quali chiedono un professionista (interno motore, alimentazione, eventuale turbo).', 'Attrezzi da integrare: elencarli e metterli nel conto del progetto.', 'Disponibilità dei ricambi specifici del modello: da verificare presso ricambisti e club, qui non è stata controllata.'],
    moto: ['Stato di telaio, forcella e impianto elettrico; avviamento a freddo.', 'Quali lavori restano nelle tue mani e quali chiedono un professionista (interno motore, carburazione/iniezione).', 'Uso previsto: giri fuori porta o viaggi di più giorni con borse? Verificare attacchi e portata.', 'Disponibilità dei ricambi specifici del modello: da verificare, qui non è stata controllata.'],
    gommoni: ['Misure reali: lunghezza, larghezza, spazio a bordo. Sotto i 2,6 m circa per te è troppo piccolo.', 'Tenuta dei tubolari, incollaggi, specchio di poppa, pagliolo, valvole: prova di gonfiaggio prolungata.', 'Trasporto: NON è dato per scontato che stia sul tetto del Vito. Verificare peso, ingombro da smontato, portata delle barre e modalità di carico.', 'Motore: incluso o no? Potenza massima ammessa, documenti, eventuali obblighi (da verificare).', 'Ritiro: se l\'annuncio è all\'estero, distanza e costo del viaggio fanno parte del progetto.'],
    altro: ['Capire quali lavori restano nelle tue mani e quali chiedono un professionista.'],
  };
  return {
    cardId: card.id, openedAt: now(), notes: '',
    checklist: [...common, ...(byCat[card.category] || byCat.altro)].map(item),
    questions: [],
    // Nessun costo inventato: la tabella parte vuota e la riempi tu (o l'AI, come bozza da ipotesi dichiarate).
    costs: card.facts?.price != null ? [{ id: store.id('c'), label: 'Prezzo richiesto nell\'annuncio', min: card.facts.price, max: card.facts.price, note: 'Dato della fonte, non trattato', origin: 'fonte' }] : [],
    aiDraft: null,
  };
}

function dossierView(cardId) {
  const d = db();
  const ds = d.dossiers[cardId];
  if (!ds) return null;
  const card = d.cards[cardId];
  const own = ds.costs.filter((c) => c.origin !== 'fonte');
  const sum = (k) => ds.costs.reduce((s, c) => s + (Number(c[k]) || 0), 0);
  return {
    ...ds, card: card ? view(card) : null,
    // Un totale ha senso solo se hai inserito almeno una voce oltre al prezzo richiesto.
    total: own.length ? { min: sum('min'), max: sum('max'), entries: ds.costs.length } : null,
  };
}

function updateDossier(cardId, patch) {
  const ds = db().dossiers[cardId];
  if (!ds) throw httpErr(404, 'Approfondimento non trovato');
  if (typeof patch.notes === 'string') ds.notes = patch.notes.slice(0, 20000);
  if (Array.isArray(patch.checklist)) ds.checklist = patch.checklist.slice(0, 80).map((k) => ({ id: k.id || store.id('k'), text: String(k.text || '').slice(0, 500), done: !!k.done, origin: k.origin || 'aggiunta da te' })).filter((k) => k.text);
  if (Array.isArray(patch.questions)) ds.questions = patch.questions.slice(0, 60).map((q) => ({ id: q.id || store.id('q'), text: String(q.text || '').slice(0, 500), origin: q.origin || 'aggiunta da te' })).filter((q) => q.text);
  if (Array.isArray(patch.costs)) ds.costs = patch.costs.slice(0, 80).map((c) => ({ id: c.id || store.id('c'), label: String(c.label || '').slice(0, 200), min: numOrNull(c.min), max: numOrNull(c.max), note: String(c.note || '').slice(0, 400), origin: c.origin || 'tua stima' })).filter((c) => c.label);
  ds.updatedAt = now();
  store.save();
  return dossierView(cardId);
}
const numOrNull = (v) => (v === '' || v == null || !Number.isFinite(+v) ? null : Math.max(0, Math.round(+v)));

/* ---------- verifica della fonte ---------- */
function applyCheck(card, result) {
  card.status = result.status;
  card.check = result.check;
  card.checks = [...(card.checks || []), { at: result.check.at, status: result.status }].slice(-8);
  if (result.listing && result.status !== 'non_disponibile') {
    // Aggiorna i fatti della fonte (prezzo ecc.) ma non tocca note, idea di progetto e reazioni.
    if (result.listing.facts?.price != null && card.facts?.price != null && result.listing.facts.price !== card.facts.price) {
      card.priceHistory = [...(card.priceHistory || []), { at: result.check.at, from: card.facts.price, to: result.listing.facts.price }].slice(-10);
    }
    card.facts = { ...card.facts, ...Object.fromEntries(Object.entries(result.listing.facts).filter(([, v]) => v != null)) };
    if (result.listing.images.length) card.images = result.listing.images;
  }
  if (result.status === 'non_disponibile' && !card.archivedAt) card.archivedAt = result.check.at;
}

async function recheck(cardId) {
  const card = db().cards[cardId];
  if (!card) throw httpErr(404, 'Scheda non trovata');
  const res = await sources.verify(card.url);
  // Una fonte che il server non riesce a leggere non "retrocede" una scheda già verificata a mano da te.
  if (res.status === 'non_verificabile' && card.check?.by === 'utente') {
    card.lastServerAttempt = res.check;
  } else applyCheck(card, res);
  store.save();
  return view(card);
}

let recheckJob = null;
function recheckAll() {
  if (recheckJob && !recheckJob.done) return recheckJob;
  const ids = Object.values(db().cards).filter((c) => c.status !== 'non_disponibile').map((c) => c.id);
  const job = recheckJob = { startedAt: now(), total: ids.length, checked: 0, changed: [], done: false };
  (async () => {
    for (const id of ids) {
      const before = db().cards[id]?.status;
      try { const v = await recheck(id); if (v.status !== before) job.changed.push({ id, name: v.name, from: before, to: v.status }); } catch {}
      job.checked++;
    }
    job.done = true; job.finishedAt = now();
  })();
  return job;
}

/* ---------- deduplicazione ---------- */
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, ' ').trim();
function fingerprint(l) {
  if (l.facts?.price == null || !l.facts?.city) return null;
  return [norm(l.name), l.facts.price, norm(l.facts.city).split(' ')[0], l.facts.year || '', l.facts.km || ''].join('|');
}
function findDuplicate(listing) {
  const d = db();
  const byKey = Object.values(d.cards).find((c) => c.key === listing.key);
  if (byKey) return { card: byKey, how: 'stesso annuncio' };
  const fp = fingerprint(listing);
  if (fp) { const c = Object.values(d.cards).find((x) => x.fingerprint === fp); if (c) return { card: c, how: 'stesso mezzo su un altro annuncio (stesso modello, prezzo, luogo)' }; }
  return null;
}

function cardFromListing(listing, extra) {
  return {
    id: store.id('s'), key: listing.key, fingerprint: fingerprint(listing),
    source: listing.source, sourceLabel: sources.byId[listing.source]?.label || hostOf(listing.url), url: listing.url,
    category: listing.category || 'altro', name: listing.name, version: listing.version || '',
    facts: listing.facts || {}, sellerText: listing.sellerText || '', images: listing.images || [], imageKind: 'esemplare',
    effort: 'capire', scout: null, userNote: '', addedAt: now(), ...extra,
  };
}
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return 'link'; } };

/* ---------- ricerca assistita ---------- */
let job = null;
function searchStatus() { return job; }

function pickTrails(opts) {
  const d = db();
  if (opts.trailIds?.length) return opts.trailIds.map((i) => trailById[i]).filter(Boolean);
  const w = trailWeights();
  let pool = trails.filter((t) => !opts.category || t.category === opts.category);
  const age = (t) => (d.trailState[t.id]?.lastRunAt ? (Date.now() - Date.parse(d.trailState[t.id].lastRunAt)) / 3600e3 : 1e4);
  // Punteggio = preferenza (limitata) × "da quanto non la guardo" + un po' di caso.
  const scored = pool.map((t) => ({ t, s: w[t.id] * Math.min(3, 0.5 + age(t) / 24) * (0.6 + Math.random() * 0.8) })).sort((a, b) => b.s - a.s);
  const n = Math.min(opts.maxTrails || 4, scored.length);
  const chosen = [];
  for (const { t } of scored) {
    if (chosen.length >= n) break;
    if (chosen.filter((c) => c.category === t.category).length >= Math.ceil(n / 2) && !opts.category) continue;
    chosen.push(t);
  }
  if (!chosen.some((t) => t.kind === 'sorpresa')) { const s = scored.find((x) => x.t.kind === 'sorpresa'); if (s) chosen[chosen.length - 1] = s.t; }
  return chosen;
}

function startSearch(opts = {}) {
  if (job && !job.done) return job;
  const chosen = pickTrails(opts);
  job = { id: store.id('run'), startedAt: now(), trigger: opts.trigger || 'manuale', done: false, steps: [], added: [], stats: { trovati: 0, giaVisti: 0, esclusi: 0, nonVerificati: 0, pubblicati: 0 }, trails: chosen.map((t) => t.label) };
  runSearch(job, chosen, opts).catch((e) => { job.error = String(e.message || e); }).finally(() => {
    job.done = true; job.finishedAt = now();
    const d = db();
    d.runs.unshift({ id: job.id, startedAt: job.startedAt, finishedAt: job.finishedAt, trigger: job.trigger, trails: job.trails, stats: job.stats, steps: job.steps, error: job.error || null });
    d.runs = d.runs.slice(0, 30);
    store.save();
  });
  return job;
}

async function runSearch(job, chosen, opts) {
  const d = db();
  const perTrail = opts.perTrail || 2;
  for (const t of chosen) {
    const all = t.paths.map((x) => (typeof x === 'string' ? { source: t.source, path: x } : x));
    const tried = [];
    let res, adapter, step;
    // Se una fonte rifiuta la lettura si prova UNA volta un percorso di un'altra fonte della stessa pista: mai la stessa.
    for (let attempt = 0; attempt < 2; attempt++) {
      const options = all.filter((x) => !tried.includes(x.source));
      if (!options.length) break;
      const choice = options[Math.floor(Math.random() * options.length)];
      tried.push(choice.source);
      adapter = sources.byId[choice.source];
      step = { trail: t.label, source: adapter.label, path: choice.path, outcome: '' };
      job.steps.push(step);
      job.current = `Leggo ${adapter.label}: ${t.label}`;
      res = await adapter.search(choice.path);
      if (res.ok) break;
      step.outcome = 'Ricerca non riuscita: ' + (sources.REASONS[res.reason] || res.reason);
    }
    d.trailState[t.id] = { lastRunAt: now(), lastOutcome: res.ok ? 'ok' : res.reason };
    if (!res.ok) continue;
    job.stats.trovati += res.items.length;
    let fresh = [];
    for (const it of res.items) {
      if (d.seen[it.key]) { job.stats.giaVisti++; continue; }
      const text = `${it.name} ${it.version}`;
      const out = (t.yearMin && it.year && it.year < t.yearMin) || (t.yearMax && it.year && it.year > t.yearMax)
        || (t.must && !t.must.test(text)) || (t.not && t.not.test(text)) || (t.minPrice && it.price != null && it.price < t.minPrice)
        || it.offerType === 'N' || !it.hasImage || it.pro || (it.lengthCm && it.lengthCm < 260);
      if (out) { job.stats.esclusi++; d.seen[it.key] = { at: now(), outcome: 'escluso' }; continue; }
      fresh.push(it);
    }
    fresh = fresh.sort(() => Math.random() - 0.5).slice(0, perTrail);
    let published = 0;
    for (const it of fresh) {
      job.current = `Apro e verifico: ${it.name}`;
      const v = await sources.verify(it.url);
      if (v.status !== 'attiva') {
        // Requisito: senza pagina e fotografie verificate la scheda non entra nel flusso.
        job.stats.nonVerificati++;
        d.seen[it.key] = { at: now(), outcome: 'non verificato: ' + (v.check.page.ok ? v.check.image.detail : v.check.page.detail) };
        continue;
      }
      const dup = findDuplicate(v.listing);
      if (dup) { job.stats.giaVisti++; d.seen[it.key] = { at: now(), outcome: 'doppione' }; continue; }
      const card = cardFromListing(v.listing, { trailId: t.id, kind: t.kind, category: t.category, origin: 'ricerca', status: 'attiva', check: v.check, checks: [{ at: v.check.at, status: 'attiva' }] });
      d.cards[card.id] = card;
      d.seen[card.key] = { at: now(), outcome: 'scheda' };
      job.added.push({ id: card.id, name: card.name });
      job.stats.pubblicati++; published++;
      store.save();
    }
    step.outcome = `${res.items.length} annunci letti, ${published} nuove schede verificate`;
  }
  job.current = null;
  store.save();
}

/* ---------- aggiunta manuale ---------- */
async function extract(url) {
  let key; try { key = sources.keyFor(url); } catch { throw httpErr(400, 'Indirizzo non valido'); }
  const existing = Object.values(db().cards).find((c) => c.key === key);
  if (existing) return { duplicate: view(existing) };
  const v = await sources.verify(url);
  const draft = v.listing
    ? { url: v.listing.url, key: v.listing.key, source: v.listing.source, category: v.listing.category, name: v.listing.name, version: v.listing.version, facts: v.listing.facts, sellerText: v.listing.sellerText, images: v.listing.images }
    : { url: sources.normalizeUrl(url), key, source: 'link', category: null, name: '', version: '', facts: {}, sellerText: '', images: [] };
  const dup = v.listing ? findDuplicate(v.listing) : null;
  return { draft, status: v.status, check: v.check, possibleDuplicate: dup ? { how: dup.how, card: view(dup.card) } : null };
}

function createManual(body) {
  const d = db();
  const draft = body.draft || {};
  if (!draft.url || !String(body.name || draft.name || '').trim()) throw httpErr(400, 'Servono almeno il link e il nome del mezzo');
  const key = sources.keyFor(draft.url);
  if (Object.values(d.cards).some((c) => c.key === key)) throw httpErr(409, 'Questo annuncio è già in archivio');
  const serverOk = body.status === 'attiva' && body.check?.by === 'server';
  let status = serverOk ? 'attiva' : 'non_verificata';
  let check = body.check || null;
  // Se il server non ha potuto leggere la pagina puoi dichiarare di averla aperta tu: resta scritto chi ha verificato.
  if (!serverOk && body.userConfirms) {
    status = 'attiva';
    check = { at: now(), by: 'utente', page: { ok: true, http: 0, detail: 'aperta da te nel browser (dichiarazione tua, non verifica del server)' }, image: { ok: null, http: 0, detail: 'non controllata dal server' }, serverAttempt: body.check || null };
  }
  const facts = { ...(draft.facts || {}) };
  if (body.price !== undefined) facts.price = numOrNull(body.price);
  if (body.city !== undefined) facts.city = String(body.city || '').slice(0, 120) || null;
  if (body.year !== undefined) facts.year = numOrNull(body.year);
  const images = Array.isArray(body.images) ? body.images.filter((u) => /^https:\/\//.test(u)).slice(0, 12) : (draft.images || []);
  const card = cardFromListing({ key, source: draft.source || 'link', url: draft.url, category: body.category || draft.category || 'altro', name: String(body.name || draft.name).slice(0, 200), version: String(body.version ?? draft.version ?? '').slice(0, 200), facts, sellerText: draft.sellerText || '', images },
    { origin: 'manuale', status, check, checks: check ? [{ at: check.at, status }] : [], kind: 'affine', trailId: null, effort: EFFORTS[body.effort] ? body.effort : 'capire', userNote: String(body.userNote || '').slice(0, 4000), editedFields: body.editedFields || [] });
  d.cards[card.id] = card;
  d.seen[key] = { at: now(), outcome: 'scheda (manuale)' };
  // Un link aggiunto da te è già una scelta: entra tra le idee conservate, non tra le proposte dello scout.
  d.reactions.push({ id: store.id('r'), cardId: card.id, type: 'conserva', reason: String(body.reason || '').slice(0, 1000), at: now() });
  store.save();
  return view(card);
}

function patchCard(id, patch) {
  const card = db().cards[id];
  if (!card) throw httpErr(404, 'Scheda non trovata');
  if (patch.effort && EFFORTS[patch.effort]) { card.effort = patch.effort; card.effortBy = 'utente'; }
  if (typeof patch.userNote === 'string') card.userNote = patch.userNote.slice(0, 4000);
  if (patch.category && ['auto', 'moto', 'gommoni', 'altro'].includes(patch.category)) card.category = patch.category;
  if (patch.scout && typeof patch.scout === 'object') {
    // Testo riscritto da te: cambia l'autore, così non resta attribuito all'AI.
    card.scout = { ...(card.scout || {}), ...pick(patch.scout, ['title', 'why', 'project', 'doubt']), author: 'utente', writtenAt: now() };
  }
  store.save();
  return view(card);
}
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => typeof o[k] === 'string').map((k) => [k, o[k].slice(0, 3000)]));

function removeCard(id) {
  const d = db();
  if (!d.cards[id]) throw httpErr(404, 'Scheda non trovata');
  delete d.cards[id]; delete d.dossiers[id];
  d.reactions = d.reactions.filter((r) => r.cardId !== id);
  store.save();
}

/* ---------- profilo ---------- */
function signals() {
  // Conteggi veri delle tue reazioni, raggruppati per pista: osservazioni, non regole.
  const d = db();
  const by = {};
  for (const r of d.reactions) {
    const c = d.cards[r.cardId];
    if (!c) continue;
    const k = c.trailId || 'manuale';
    (by[k] = by[k] || { trail: trailById[k]?.label || 'Aggiunte da te', category: c.category, pos: 0, neg: 0, reasons: [] });
    if (REACTIONS[r.type].score > 0) by[k].pos++; else by[k].neg++;
    if (r.reason) by[k].reasons.push({ type: REACTIONS[r.type].label, text: r.reason, card: c.name, at: r.at });
  }
  return Object.values(by);
}

function httpErr(status, message) { const e = new Error(message); e.status = status; return e; }

/* ---------- ricerca periodica facoltativa (solo a server acceso) ---------- */
let autoTimer = null, nextAutoAt = null;
function scheduleAuto() {
  if (autoTimer) clearTimeout(autoTimer);
  autoTimer = null; nextAutoAt = null;
  const a = db().settings.autoSearch;
  if (!a?.enabled) return;
  const ms = Math.max(6, Number(a.hours) || 24) * 3600e3;
  nextAutoAt = new Date(Date.now() + ms).toISOString();
  autoTimer = setTimeout(() => { startSearch({ trigger: 'periodica' }); scheduleAuto(); }, ms);
  autoTimer.unref?.();
}
const autoInfo = () => ({ ...db().settings.autoSearch, nextAt: nextAutoAt });

module.exports = { REACTIONS, EFFORTS, view, feed, collection, react, setReason, undoReaction, dossierView, updateDossier, recheck, recheckAll, recheckStatus: () => recheckJob,
  startSearch, searchStatus, extract, createManual, patchCard, removeCard, signals, trailWeights, scheduleAuto, autoInfo, httpErr };
