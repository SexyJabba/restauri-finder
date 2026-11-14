// Collegamento al modello AI (Claude, tramite SDK ufficiale Anthropic). Solo lato server:
// la chiave vive nella variabile d'ambiente ANTHROPIC_API_KEY e non raggiunge mai il browser.
// Senza chiave tutto il resto funziona e l'interfaccia dichiara che le note AI non sono disponibili.
'use strict';

const MODEL = process.env.SCOUT_AI_MODEL || 'claude-opus-5-5';
let clientPromise = null;
let lastError = null;

function configured() { return !!process.env.ANTHROPIC_API_KEY; }

async function client() {
  if (!configured()) throw Object.assign(new Error('Chiave AI non configurata (ANTHROPIC_API_KEY)'), { status: 503 });
  if (!clientPromise) {
    clientPromise = import('@anthropic-ai/sdk').then((m) => new m.default()).catch((e) => {
      clientPromise = null;
      throw Object.assign(new Error('Libreria @anthropic-ai/sdk non installata: esegui "npm install"'), { status: 503, cause: e });
    });
  }
  return clientPromise;
}

async function sdkInstalled() { try { require.resolve('@anthropic-ai/sdk'); return true; } catch { return false; } }

async function status() {
  return {
    configured: configured(), sdkInstalled: await sdkInstalled(), model: MODEL, lastError,
    missing: configured() ? ((await sdkInstalled()) ? null : 'Eseguire "npm install" per installare la libreria Anthropic.') : 'Impostare la variabile d\'ambiente ANTHROPIC_API_KEY prima di avviare il server.',
  };
}

const RULES = `Sei lo scout personale di una persona che esplora auto, moto e gommoni per piacere, senza intenzione di comprare adesso.
Scrivi in italiano, in seconda persona, con tono da amico competente: concreto, breve, mai da venditore.
Regole che non puoi infrangere:
- Usa SOLO i dati forniti (fatti dell'annuncio, testo del venditore, profilo). Ciò che dice il venditore è una dichiarazione, non un fatto: quando lo citi, attribuiscilo ("il venditore dichiara…").
- Non inventare costi, condizioni, disponibilità dei ricambi, affidabilità, compatibilità o trasportabilità. Se un'informazione manca, dillo.
- Nessuna urgenza, nessun invito a contattare il venditore, nessun punteggio di affinità.
- Le cifre del profilo sono esempi orientativi: non trattarle come budget disponibile né come obiettivo.
- Le capacità manuali dipendono dal mezzo: interno motore, alimentazione, turbo e lavori specialistici vanno indicati come possibili lavori da professionista.
- Un gommone non è mai dato per trasportabile sul tetto del furgone: pesi, misure e barre sono da verificare.`;

const NARRATE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['title', 'why', 'project', 'doubt', 'effort'],
  properties: {
    title: { type: 'string', description: 'Titolo che racconta un\'idea di progetto, massimo 70 caratteri' },
    why: { type: 'string', description: 'Perché te lo mostro: 2-3 frasi, motivazione personale e concreta legata al profilo' },
    project: { type: 'string', description: 'Il progetto che ci vedo: 2-4 frasi su cosa potrebbe diventare e come goderselo' },
    doubt: { type: 'string', description: 'Il dubbio dello scout: un limite concreto, 1-2 frasi' },
    effort: { type: 'string', enum: ['usare', 'fasi', 'restauro', 'capire'], description: 'usare=da usare e migliorare; fasi=recupero per fasi; restauro=restauro importante; capire=ancora da capire (usalo se i dati non bastano)' },
  },
};

const DOSSIER_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['summary', 'checks', 'questions', 'costItems', 'costVerdict'],
  properties: {
    summary: { type: 'string', description: 'Lettura dell\'esemplare in 4-6 frasi, distinguendo fatti, dichiarazioni del venditore e tue ipotesi' },
    checks: { type: 'array', items: { type: 'string' }, description: 'Verifiche specifiche per questo esemplare, da fare di persona' },
    questions: { type: 'array', items: { type: 'string' }, description: 'Domande che avrebbe senso porre, se e quando la persona deciderà di farlo' },
    costItems: { type: 'array', description: 'Solo voci la cui esistenza è sostenuta dai dati; importi null se non stimabili', items: { type: 'object', additionalProperties: false, required: ['label', 'assumption', 'min', 'max'], properties: { label: { type: 'string' }, assumption: { type: 'string', description: 'Ipotesi su cui si regge la voce' }, min: { type: ['number', 'null'] }, max: { type: ['number', 'null'] } } } },
    costVerdict: { type: 'string', description: 'Se una stima complessiva non è sostenibile dillo esplicitamente ("costo complessivo da approfondire") e spiega cosa manca' },
  },
};

function context(card, tastes) {
  const f = card.facts || {};
  return [
    'PROFILO DEI GUSTI (esplicita = detta dalla persona; ipotesi = supposizione tua da verificare; incerta = non ancora chiarita):',
    ...tastes.map((t) => `- [${t.kind}] (${t.category}) ${t.text}`),
    '', 'ANNUNCIO — FATTI LETTI DALLA FONTE:',
    JSON.stringify({ nome: card.name, versione: card.version, categoria: card.category, fonte: card.sourceLabel, prezzoRichiesto: f.price, anno: f.year, km: f.km, potenza: f.power, cilindrata: f.displacement, alimentazione: f.fuel, cambio: f.gearbox, luogo: [f.zip, f.city, f.country].filter(Boolean).join(' '), venditore: f.sellerType }),
    '', 'ANNUNCIO — TESTO DEL VENDITORE (dichiarazioni non verificate' + (f.language ? ', in ' + f.language : '') + '):',
    card.sellerText || '(nessuna descrizione)',
    card.trail ? '\nPISTA DI RICERCA: ' + card.trail.label + ' — ' + card.trail.why : '',
  ].join('\n');
}

async function ask(system, user, schema) {
  const c = await client();
  try {
    const res = await c.beta.messages.create({
      model: MODEL, max_tokens: 8000,
      betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
      system, messages: [{ role: 'user', content: user }],
      output_config: { effort: 'medium', format: { type: 'json_schema', schema } },
    });
    if (res.stop_reason === 'refusal') throw Object.assign(new Error('Il modello ha rifiutato la richiesta'), { status: 502 });
    const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    lastError = null;
    return { data: JSON.parse(text), model: res.model };
  } catch (e) {
    lastError = { at: new Date().toISOString(), message: String(e.message || e).slice(0, 300) };
    throw Object.assign(new Error('Richiesta AI non riuscita: ' + lastError.message), { status: e.status && e.status >= 400 ? 502 : 500 });
  }
}

async function narrate(card, tastes) {
  const { data, model } = await ask(RULES, context(card, tastes) + '\n\nScrivi la nota dello scout per questa scheda.', NARRATE_SCHEMA);
  return { ...data, model };
}

async function dossierDraft(card, tastes) {
  const { data, model } = await ask(RULES, context(card, tastes) + '\n\nLa persona ha scelto "Questa la considero davvero". Prepara una bozza di approfondimento su questo specifico esemplare.', DOSSIER_SCHEMA);
  return { ...data, model, at: new Date().toISOString() };
}

module.exports = { status, narrate, dossierDraft, configured };
