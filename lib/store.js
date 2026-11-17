// Archivio persistente su file JSON (scrittura atomica). Un solo utente, pochi dati:
// niente database da installare, e il file si può copiare come backup.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DATA_DIR = process.env.SCOUT_DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'scout.json');
const SEED_DIR = path.join(__dirname, '..', 'seed');

let db = null;
let timer = null;

function id(prefix) {
  return prefix + '_' + crypto.randomBytes(6).toString('hex');
}

function empty() {
  return {
    meta: { version: 1, createdAt: new Date().toISOString() },
    settings: { base: null, autoSearch: { enabled: false, hours: 24 }, surpriseBias: 0 },
    cards: {},
    reactions: [],
    tastes: [],
    dossiers: {},
    runs: [],
    seen: {},
    trailState: {},
    probes: {},
  };
}

function load() {
  if (db) return db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(FILE)) {
    db = Object.assign(empty(), JSON.parse(fs.readFileSync(FILE, 'utf8')));
    return db;
  }
  db = empty();
  // Primo avvio: profilo iniziale (dal tuo brief) e schede reali verificate in fase di allestimento.
  const tastes = readSeed('tastes.json') || [];
  const now = new Date().toISOString();
  db.tastes = tastes.map((t) => ({ id: id('t'), createdAt: now, updatedAt: now, ...t }));
  const cards = readSeed('cards.json') || [];
  for (const c of cards) {
    db.cards[c.id] = c;
    db.seen[c.key] = { at: c.addedAt, outcome: 'scheda' };
  }
  saveNow();
  return db;
}

function readSeed(name) {
  const f = path.join(SEED_DIR, name);
  if (!fs.existsSync(f)) return null;
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}

function saveNow() {
  if (timer) { clearTimeout(timer); timer = null; }
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 1));
  fs.renameSync(tmp, FILE);
}

// Le modifiche dell'utente vengono scritte subito: sono poche e non devono andare perse.
function save() { saveNow(); }

module.exports = { load, save, id, FILE, DATA_DIR };
