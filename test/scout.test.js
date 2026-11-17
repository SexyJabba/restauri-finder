// Prove automatiche senza rete: usano un archivio temporaneo e un finto "sito di annunci" locale.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-test-'));
const PORT = 4300 + Math.floor(Math.random() * 500);
const base = `http://127.0.0.1:${PORT}`;
let proc;
const start = () => new Promise((resolve, reject) => {
  proc = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT, SCOUT_DATA_DIR: dir, SCOUT_PASSWORD: '', HOST: '127.0.0.1', ANTHROPIC_API_KEY: '', SCOUT_MIN_GAP_MS: '10' }, stdio: ['ignore', 'pipe', 'inherit'] });
  proc.stdout.on('data', (d) => /aperto/.test(String(d)) && resolve());
  proc.on('error', reject);
});
const stop = () => new Promise((r) => { proc.once('exit', r); proc.kill(); });
const api = async (p, method = 'GET', body) => {
  const r = await fetch(base + '/api/' + p, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json() };
};

test.before(start);
test.after(async () => { await stop(); fs.rmSync(dir, { recursive: true, force: true }); });

test('primo avvio: profilo iniziale e schede reali verificate, nessun dato dimostrativo', async () => {
  const feed = (await api('feed')).json;
  assert.ok(feed.items.length >= 15);
  for (const c of feed.items) {
    assert.equal(c.status, 'attiva');
    assert.equal(c.check.by, 'server');
    assert.ok(c.check.page.ok && c.check.image.ok, 'ogni scheda del flusso ha pagina e foto verificate');
    assert.ok(c.images.length > 0 && /^https:\/\//.test(c.url));
    assert.equal(c.imageKind, 'esemplare');
    assert.ok(['ai-sessione'].includes(c.scout.author), 'le note sono attribuite');
    assert.ok(!/\b3\d{2}[ .]?\d{6,7}\b/.test(c.sellerText), 'nessun recapito del venditore conservato');
  }
  const profile = (await api('profile')).json;
  const kinds = new Set(profile.tastes.map((t) => t.kind));
  assert.deepEqual([...kinds].sort(), ['esplicita', 'incerta', 'ipotesi']);
});

test('il flusso mantiene varietà: sorprese regolari e mai due schede di fila della stessa pista', async () => {
  const items = (await api('feed')).json.items;
  const first8 = items.slice(0, 8);
  assert.ok(first8.filter((c) => c.kind === 'sorpresa').length >= 2);
  assert.ok(new Set(first8.map((c) => c.category)).size >= 3);
  for (let i = 1; i < items.length; i++) assert.notEqual(items[i].trailId, items[i - 1].trailId);
});

test('apprezzare non apre un percorso d\'acquisto; solo "considero davvero" apre un approfondimento', async () => {
  const items = (await api('feed')).json.items;
  const [a, b, c] = items;
  for (const [card, type] of [[a, 'incuriosisce'], [b, 'conserva'], [c, 'sorprendimi']]) {
    const r = await api(`cards/${card.id}/react`, 'POST', { type, reason: 'prova ' + type });
    assert.equal(r.json.hasDossier, false);
  }
  assert.equal((await api('dossiers')).json.items.length, 0);
  assert.equal((await api('dossiers/' + b.id)).status, 404);
  const d = items[3];
  await api(`cards/${d.id}/react`, 'POST', { type: 'considera' });
  const ds = (await api('dossiers')).json.items;
  assert.equal(ds.length, 1);
  assert.equal(ds[0].cardId, d.id);
  assert.equal(ds[0].total, null, 'nessun costo complessivo inventato');
  assert.ok(ds[0].costs.every((k) => k.origin === 'fonte'));
  const after = (await api('feed')).json.items.map((x) => x.id);
  for (const x of [a, b, c, d]) assert.ok(!after.includes(x.id), 'le schede con reazione escono dal flusso');
});

test('un singolo "non fa per me" non cancella una pista', async () => {
  const items = (await api('feed')).json.items;
  const victim = items.find((c) => items.filter((x) => x.trailId === c.trailId).length === 1) || items[0];
  await api(`cards/${victim.id}/react`, 'POST', { type: 'scarta', reason: 'troppo grande' });
  const scout = require('../lib/trails');
  assert.ok(scout.byId[victim.trailId]);
  const state = (await api('state')).json;
  assert.ok(state.trails.some((t) => t.id === victim.trailId));
});

test('reazioni, motivi, profilo e approfondimento sopravvivono al riavvio', async () => {
  const t = await api('tastes', 'POST', { text: 'Mi piacciono gli abitacoli luminosi', kind: 'incerta', category: 'auto' });
  assert.equal(t.status, 201);
  const ds0 = (await api('dossiers')).json.items[0];
  await api('dossiers/' + ds0.cardId, 'PATCH', { notes: 'vista di persona: da rivedere i fondi', costs: [...ds0.costs, { label: 'Gomme', min: 300, max: 500, note: 'ipotesi mia' }] });
  await stop(); await start();
  const p = (await api('profile')).json;
  assert.ok(p.tastes.some((x) => x.text === 'Mi piacciono gli abitacoli luminosi' && x.kind === 'incerta'));
  assert.ok(p.diary.some((r) => r.reason === 'prova conserva'));
  assert.ok(p.diary.some((r) => r.reason === 'troppo grande'));
  const ds = (await api('dossiers/' + ds0.cardId)).json;
  assert.equal(ds.notes, 'vista di persona: da rivedere i fondi');
  assert.equal(ds.total.entries, ds0.costs.length + 1);
  assert.equal((await api('cards?view=conservate')).json.items.length, 2);
});

test('link scaduto: la scheda esce dalle occasioni attuali ma idea e note restano in archivio', async () => {
  // Si simula un link che non risponde più puntando due schede a un dominio riservato inesistente.
  await stop();
  const file = path.join(dir, 'scout.json');
  const db = JSON.parse(fs.readFileSync(file, 'utf8'));
  const saved = db.reactions.find((r) => r.type === 'conserva').cardId;
  const inFeed = Object.values(db.cards).find((c) => !db.reactions.some((r) => r.cardId === c.id));
  db.cards[saved].url = 'https://annuncio-scaduto.invalid/x';
  db.cards[inFeed.id].url = 'https://annuncio-scaduto.invalid/y';
  fs.writeFileSync(file, JSON.stringify(db));
  await start();
  const r = (await api(`cards/${saved}/check`, 'POST')).json;
  assert.notEqual(r.status, 'attiva');
  assert.equal(r.check.page.ok, false);
  assert.ok(r.scout.title && r.reaction.reason === 'prova conserva', 'idea e motivo conservati');
  const r2 = (await api(`cards/${inFeed.id}/check`, 'POST')).json;
  assert.notEqual(r2.status, 'attiva');
  const feedIds = (await api('feed')).json.items.map((c) => c.id);
  assert.ok(!feedIds.includes(inFeed.id), 'una fonte non confermata non viene riproposta come occasione attuale');
});

test('una scheda segnata "non disponibile" passa nell\'archivio, distinta dalle idee attuali', async () => {
  await stop();
  const file = path.join(dir, 'scout.json');
  const db = JSON.parse(fs.readFileSync(file, 'utf8'));
  const id = db.reactions.find((r) => r.type === 'conserva').cardId;
  Object.assign(db.cards[id], { status: 'non_disponibile', archivedAt: new Date().toISOString() });
  fs.writeFileSync(file, JSON.stringify(db));
  await start();
  const arch = (await api('cards?view=archiviate')).json.items;
  assert.ok(arch.some((c) => c.id === id && c.archived && c.scout.title));
  assert.ok(!(await api('cards?view=conservate')).json.items.some((c) => c.id === id));
});

test('aggiunta manuale: link non leggibile resta non verificato e fuori dalle Scoperte; doppioni riconosciuti', async () => {
  const ex = (await api('extract', 'POST', { url: 'https://sito-inesistente.invalid/annuncio/123?utm_source=x' })).json;
  assert.notEqual(ex.status, 'attiva');
  assert.equal(ex.check.page.ok, false);
  const made = await api('cards', 'POST', { draft: ex.draft, status: ex.status, check: ex.check, name: 'Gommone visto su un altro sito', price: 1200, category: 'gommoni' });
  assert.equal(made.status, 201);
  assert.equal(made.json.status, 'non_verificata');
  assert.ok(!(await api('feed')).json.items.some((c) => c.id === made.json.id));
  assert.ok((await api('cards?view=nonverificate')).json.items.some((c) => c.id === made.json.id));
  const again = (await api('extract', 'POST', { url: 'https://sito-inesistente.invalid/annuncio/123' })).json;
  assert.ok(again.duplicate, 'stesso link (senza parametri di tracciamento) riconosciuto come già presente');
});

test('AI non configurata: dichiarata, e nessun testo viene generato al suo posto', async () => {
  const st = (await api('state')).json;
  assert.equal(st.ai.configured, false);
  assert.match(st.ai.missing, /ANTHROPIC_API_KEY/);
  const id = (await api('feed')).json.items[0].id;
  const r = await api(`cards/${id}/narrate`, 'POST');
  assert.equal(r.status, 503);
  const src = (await api('sources')).json;
  assert.equal(src.auto.enabled, false);
  assert.ok(src.sources.some((s) => s.id === 'ebay' && s.mode === 'manuale' && s.alt));
});

test('Subito per auto e moto: ogni percorso ha la sua categoria e un filtro sul titolo', () => {
  const { trails, byId } = require('../lib/trails');
  for (const t of trails.filter((x) => x.category !== 'gommoni')) {
    const subs = t.paths.filter((p) => typeof p === 'object' && p.source === 'subito');
    assert.ok(subs.length > 0, `la pista ${t.id} non ha percorsi Subito`);
    const cat = t.category === 'auto' ? 'auto' : 'moto-e-scooter';
    for (const p of subs) {
      assert.ok(p.path.startsWith(`annunci-italia/vendita/${cat}/?q=`), `${t.id}: categoria sbagliata in ${p.path}`);
      assert.ok(p.must instanceof RegExp, `${t.id}: manca il filtro sul titolo in ${p.path}`);
    }
  }
  const at = byId['africa-twin'].paths.find((p) => p.source === 'subito');
  assert.ok(at.must.test('Honda XRV 750 Africa Twin RD07'));
  assert.ok(!at.must.test('Honda Africa Twin CRF1100L Adventure Sports'));
  assert.equal(at.yearMax, 2003);
  const v480 = byId.volvo480.paths.find((p) => p.source === 'subito');
  assert.ok(v480.must.test('Volvo 480 ES turbo') && !v480.must.test('Volvo 240 GL'));
});

test('Ruote Classiche: elenco, ripiego sull\'elenco generale riconosciuto, annuncio letto senza recapiti', () => {
  const { rcParseSearch, rcParseDetail, keyFor } = require('../lib/sources');
  const card = (id, brand, model, price, anno, km, city) => `<div class="sab-listing-block ">
    <a href="https://ruoteclassiche.quattroruote.it/vendo-e-compro/annuncio/x-${id}/" class="sab-listing-block-image"><img class="sab-listing-block-image-img-listing" src="https://img.example/${id}/0.jpg" /></a>
    <div class="sab-listing-block-brand">${brand}</div><a href="#" class="sab-listing-block-model"> ${model}</a>
    <a href="#" class="sab-listing-block-price">€ ${price}</a>
    <div class="sab-listing-block-reseller-block-address"> | ${city} (XX) 00100</div>
    <div class="sab-listing-block-more-info-box-label">anno</div> <div class="sab-listing-block-more-info-box-value">${anno}</div>
    <div class="sab-listing-block-more-info-box-label">km</div> <div class="sab-listing-block-more-info-box-value">${km}</div></div>`;
  const page = (cards) => `<span class="sab-total-count-value">${cards.length}</span>` + cards.join('');
  const ok = rcParseSearch(page([card(110000001, 'ALFA ROMEO', 'Alfetta', '9.800', 1979, '120.000', 'Torino')]), 'f/alfa-romeo/alfetta/');
  assert.equal(ok.ok, true);
  assert.deepEqual([ok.items[0].key, ok.items[0].name, ok.items[0].price, ok.items[0].year, ok.items[0].km, ok.items[0].city],
    ['ruoteclassiche:110000001', 'Alfa Romeo Alfetta', 9800, 1979, 120000, 'Torino']);
  // Modello senza annunci: il sito mostra l'elenco generale con altre marche → nessun annuncio, non risultati sbagliati.
  const fb = rcParseSearch(page([card(110000002, 'FIAT', 'Panda', '2.000', 1990, '1', 'Roma'), card(110000003, 'PEUGEOT', '307', '3.000', 2004, '1', 'Bari')]), 'f/volvo/480/');
  assert.equal(fb.ok, false);
  assert.equal(fb.reason, 'nessun_annuncio');
  const detail = `<div class="sab-detail-header-image"><img src="https://img.example/1/0.jpg" alt="" /></div>
    <div class="sab-detail-header-info-brand">ALFA ROMEO</div><div class="sab-detail-header-info-model">Spider</div>
    <div class="sab-detail-header-info-price">€ 21.500</div>
    <div class="sab-detail-header-info-reseller-block-name">Rivenditore</div>
    <div class="sab-detail-header-info-reseller-block-address"> | Roma (RM) 00144 | 1978 </div>
    <div class="sab-detail-description-container-text">Ottima meccanica. Chiamare 340 1234567</div>
    <div class="sab-detail-technical-information-label">Chilometraggio</div> <div class="sab-detail-technical-information-value">49.000 Km</div>`;
  const l = rcParseDetail(detail, 'https://ruoteclassiche.quattroruote.it/vendo-e-compro/annuncio/alfa-romeo-spider-110490628/');
  assert.equal(l.key, 'ruoteclassiche:110490628');
  assert.deepEqual([l.facts.price, l.facts.year, l.facts.km, l.facts.city, l.facts.sellerType, l.images.length], [21500, 1978, 49000, 'Roma', 'Concessionario', 1]);
  assert.ok(!/1234567/.test(l.sellerText) && /recapito omesso/.test(l.sellerText));
  assert.equal(keyFor('https://ruoteclassiche.quattroruote.it/vendo-e-compro/annuncio/alfa-romeo-spider-110490628/'), 'ruoteclassiche:110490628');
});

test('Automobile.it: elenco con anno e km, nuovi/noleggio esclusi, annuncio letto senza recapiti', () => {
  const { amParseSearch, amParseDetail, keyFor } = require('../lib/sources');
  const wrap = (pageProps) => `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps } })}</script>`;
  const item = (id, extra = {}) => ({ id, url: `/torino-alfa-romeo-alfetta/${id}`, title: 'Alfa Romeo Alfetta 2.0', formattedPrice: '€ 9.800', location: 'Torino (TO)', totalNumberOfPictures: 5,
    details: { registration: 'Maggio 1979', formattedKm: '120.000 km', channelOrChannelUsed: 'Epoca' }, ...extra });
  const r = amParseSearch(wrap({ apiResults: { result: { resultList: [item(170000001), item(170000002, { details: { channelOrChannelUsed: 'Nuovo' } }), item(170000003, { rental: true })] } } }));
  assert.equal(r.ok, true);
  assert.deepEqual([r.items[0].key, r.items[0].price, r.items[0].year, r.items[0].km, r.items[0].city, r.items[0].offerType],
    ['automobile:170000001', 9800, 1979, 120000, 'Torino', 'U']);
  assert.deepEqual(r.items.slice(1).map((x) => x.offerType), ['N', 'N']);
  assert.equal(amParseSearch('<html>nessun dato</html>').ok, false);
  const l = amParseDetail(wrap({
    result: { id: 180590920, title: 'Alfa Romeo Alfetta GT', url: '/udine-alfa-romeo-alfetta-gt/180590920', formattedPrice: '€ 17.500', location: 'Udine (UD)', sellerType: 'PRIVATE',
      description: 'Restauro conservativo. Tel. 333 1234567', details: { category: 'cars' }, vipPictures: [{ imgBig: 'https://img.example/1.jpeg' }] },
    vehicleInformation: { basicInfo: [{ title: 'Immatricolazione', values: ['Giugno 1975'] }, { title: 'Chilometri', values: ['24.922'] }, { title: 'Potenza', values: ['90 kW (122 CV)'] }] },
  }), 'https://www.automobile.it/udine-alfa-romeo-alfetta-gt/180590920');
  assert.deepEqual([l.key, l.facts.price, l.facts.year, l.facts.km, l.facts.power, l.facts.city, l.facts.sellerType, l.images.length],
    ['automobile:180590920', 17500, 1975, 24922, '122 CV', 'Udine', 'Privato', 1]);
  assert.ok(!/1234567/.test(l.sellerText));
  assert.equal(keyFor('https://www.automobile.it/udine-alfa-romeo-alfetta-gt/180590920'), 'automobile:180590920');
});

test('stesso mezzo pubblicato su due siti con titoli diversi: riconosciuto come doppione', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-dup-'));
  process.env.SCOUT_DATA_DIR = dir;
  const store = require('../lib/store');
  const scout = require('../lib/scout');
  const d = store.load();
  const facts = { price: 40000, city: 'Lurate Caccivio', year: 1976, km: 50737 };
  d.cards.s1 = { id: 's1', key: 'ruoteclassiche:1', fingerprint: null, name: 'Alfa Romeo Alfetta GT/GTV', facts };
  const twin = { key: 'automobile:2', name: 'Alfa Romeo Alfetta GT/GTV 2.0 - Targa CO 48', facts: { ...facts } };
  assert.equal(scout.findDuplicate(twin)?.card.id, 's1');
  // Basta un dato diverso (km) perché non sia considerato lo stesso mezzo; senza km il controllo largo non scatta.
  assert.equal(scout.findDuplicate({ ...twin, facts: { ...facts, km: 50738 } }), null);
  assert.equal(scout.findDuplicate({ ...twin, facts: { ...facts, km: null } }), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('costo di partenza: IPT per kW, ultratrentennali ridotti, moto giovani dichiarate incomplete', () => {
  const { startCost, kwOf } = require('../lib/costs');
  assert.deepEqual([kwOf('90 kW (122 CV)'), kwOf('45 CV'), kwOf(null)], [90, 33, null]);
  const y = { year: 2026 };
  // Auto del 2000 da 90 kW, maggiorazione nota 20%: IPT 3,5119 × 90 × 1,2 = 379 €.
  const a = startCost({ category: 'auto', facts: { price: 1500, year: 2000, power: '90 kW' } }, { ...y, iptPct: 20 });
  const ipt = a.lines.find((l) => l.label === 'Passaggio: IPT');
  assert.deepEqual([ipt.min, ipt.max], [379, 379]);
  assert.equal(a.complete, true);
  assert.equal(a.min, 1500 + 69 + 379);
  // Panda del 1986 (ultratrentennale): minimo con IPT ridotta a 51,65 €, massimo con IPT piena +30%.
  const p = startCost({ category: 'auto', facts: { price: 1200, year: 1986, power: '25 kW' } }, y);
  const pi = p.lines.find((l) => l.label === 'Passaggio: IPT');
  assert.deepEqual([pi.min, pi.max], [52, 196]);
  assert.ok(p.missing.some((m) => /esente/.test(m)));
  // Moto del 2005: IPT non calcolata, stima incompleta; moto del 1990: IPT ridotta 25,82 €.
  assert.equal(startCost({ category: 'moto', facts: { price: 900, year: 2005 } }, y).complete, false);
  const m = startCost({ category: 'moto', facts: { price: 900, year: 1990 } }, y);
  assert.equal(m.complete, true);
  assert.equal(m.lines.find((l) => l.label === 'Passaggio: IPT').max, 26);
  // Senza prezzo o per i gommoni nessuna stima.
  assert.equal(startCost({ category: 'auto', facts: { year: 1990 } }, y), null);
  assert.equal(startCost({ category: 'gommoni', facts: { price: 500 } }, y), null);
});

test('ricerca economica: tetto di prezzo su AutoScout24 e sezione ordinata per costo di partenza', () => {
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-budget-'));
  process.env.SCOUT_DATA_DIR = dir2;
  for (const k of Object.keys(require.cache)) if (/lib[\\/](store|scout)\.js$/.test(k)) delete require.cache[k];
  const store = require('../lib/store');
  const scout = require('../lib/scout');
  assert.equal(scout.withPriceCap('lst/fiat/panda?fregto=1990', 2431), 'lst/fiat/panda?fregto=1990&priceto=2431&sort=price&desc=0');
  assert.equal(scout.withPriceCap('lst/honda/transalp', 1000), 'lst/honda/transalp?priceto=1000&sort=price&desc=0');
  assert.equal(scout.withPriceCap('lst/x?priceto=5&sort=age', 900), 'lst/x?priceto=900&sort=price&desc=0');
  const d = store.load();
  const card = (id, category, price, year, extra = {}) => ({ id, key: 'k:' + id, category, status: 'attiva', name: id, facts: { price, year, power: '40 kW' }, ...extra });
  d.cards.a = card('a', 'auto', 2000, 1985);
  d.cards.b = card('b', 'auto', 800, 1995);
  d.cards.c = card('c', 'auto', 2400, 2005);        // oltre soglia col passaggio
  d.cards.g = card('g', 'gommoni', 300, 2000);      // i gommoni non hanno passaggio PRA
  d.cards.z = card('z', 'moto', 500, 2010);         // moto giovane: stima incompleta, decide il minimo
  d.cards.r = card('r', 'auto', 700, 1980);         // già valutata: esce dalla lista
  d.reactions.push({ id: 'x', cardId: 'r', type: 'conserva', at: new Date().toISOString() });
  const r = scout.budgetFeed({ maxStart: 2500 });
  assert.deepEqual(r.items.map((x) => x.id), ['z', 'b', 'a']);
  assert.equal(r.reacted, 1);
  assert.ok(r.items[0].startCost);
  fs.rmSync(dir2, { recursive: true, force: true });
});
