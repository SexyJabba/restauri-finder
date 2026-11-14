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
