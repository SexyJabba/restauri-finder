// Costo di partenza di un mezzo: prezzo richiesto + passaggio di proprietà + voci dei primi giorni.
// È una STIMA a forbice (minimo–massimo) costruita solo con tariffe pubbliche; ciò che non si può
// calcolare con onestà (assicurazione, bollo sotto i 30 anni, IPT delle moto più giovani) resta
// dichiarato come "non stimato" e non viene sommato.
//
// Tariffe usate (verificate a novembre 2026 su fonti pubbliche; vanno ricontrollate periodicamente):
// - IPT (D.M. 435/1998): 150,81 € fino a 53 kW; oltre 53 kW 3,5119 € per ogni kW dell'intera potenza.
//   Le province possono aumentarla fino al 30% (ACI, "Agevolazioni IPT: informazioni generali").
// - Veicoli ultratrentennali: IPT ridotta a 51,65 € (autoveicoli) e 25,82 € (motoveicoli), su richiesta
//   espressa, uso non professionale (art. 63 L. 342/2000); esenti dalla tassa automobilistica.
//   Dal 2015 gli ultraventennali non hanno più agevolazioni (ACI).
// - Voci fisse PRA/Motorizzazione: emolumenti ACI 27 €, imposta di bollo istanza unificata 32 €,
//   diritti Motorizzazione 10,20 €. Alcune fonti aggiungono 16 € per il documento unico e/o
//   per l'autentica della firma: per questo il massimo è più alto.
// - Revisione, se scaduta: 79,02 € (tariffa ministeriale).
'use strict';

const T = {
  iptBase: 150.81, iptPerKw: 3.5119, iptKwLimit: 53, iptMaxPct: 30,
  iptStoricaAuto: 51.65, iptStoricaMoto: 25.82,
  fissiMin: 27 + 32 + 10.2, fissiMax: 27 + 32 + 10.2 + 16 + 16,
  revisione: 79.02,
};
const round = (n) => Math.round(n);

function kwOf(power) {
  if (power == null) return null;
  if (typeof power === 'number') return power;
  const s = String(power);
  const kw = s.match(/(\d+(?:[.,]\d+)?)\s*kw/i);
  if (kw) return parseFloat(kw[1].replace(',', '.'));
  const cv = s.match(/(\d+(?:[.,]\d+)?)\s*(cv|ps|hp)\b/i);
  if (cv) return Math.round(parseFloat(cv[1].replace(',', '.')) * 0.7355);
  return null;
}

function iptFull(kw) { return kw <= T.iptKwLimit ? T.iptBase : T.iptPerKw * kw; }

// opts: { iptPct: 0–30 o null (sconosciuta → forbice 0–30%), year: anno corrente per i test }
function startCost(card, opts = {}) {
  const f = card.facts || {};
  if (!['auto', 'moto'].includes(card.category) || f.price == null) return null;
  const nowYear = opts.year || new Date().getFullYear();
  const year = f.year || null;
  const storica = year ? year <= nowYear - 30 : null; // null = anno non indicato
  const pct = Number.isFinite(opts.iptPct) ? Math.max(0, Math.min(T.iptMaxPct, opts.iptPct)) : null;
  const pMin = pct == null ? 1 : 1 + pct / 100, pMax = pct == null ? 1 + T.iptMaxPct / 100 : 1 + pct / 100;
  const kw = kwOf(f.power);
  const lines = [], missing = [];
  const add = (label, min, max, note) => lines.push({ label, min: round(min), max: round(max), note });

  add('Prezzo richiesto nell\'annuncio', f.price, f.price, 'Dato della fonte, prima di ogni trattativa');
  add('Passaggio: voci fisse PRA e Motorizzazione', T.fissiMin, T.fissiMax, 'Emolumenti ACI, imposta di bollo, diritti; senza agenzia');

  // IPT
  const storicaIpt = card.category === 'moto' ? T.iptStoricaMoto : T.iptStoricaAuto;
  const pctNote = pct == null ? 'maggiorazione della tua provincia non indicata: forbice 0–30%' : `maggiorazione provinciale ${pct}%`;
  if (card.category === 'auto') {
    if (storica === true) {
      add('Passaggio: IPT', storicaIpt, kw ? iptFull(kw) * pMax : T.iptBase * pMax,
        `Ultratrentennale: IPT ridotta a ${storicaIpt.toString().replace('.', ',')} € se richiesta e se ne ha i requisiti; altrimenti piena (${pctNote})`);
      if (!kw) missing.push('Potenza non indicata: il massimo dell\'IPT piena è calcolato come fino a 53 kW.');
    } else if (kw) {
      add('Passaggio: IPT', storica === null ? storicaIpt : iptFull(kw) * pMin, iptFull(kw) * pMax,
        `${Math.round(kw)} kW, ${pctNote}` + (storica === null ? '; anno non indicato: se ultratrentennale può scendere a 51,65 €' : ''));
    } else {
      add('Passaggio: IPT', storica === null ? storicaIpt : T.iptBase * pMin, T.iptBase * pMax, `Potenza non indicata: calcolata come fino a 53 kW, ${pctNote}`);
      missing.push('Potenza non indicata: se supera 53 kW l\'IPT sale (3,51 € per kW).');
    }
  } else if (storica === true) {
    add('Passaggio: IPT', storicaIpt, storicaIpt, 'Moto ultratrentennale: IPT ridotta, se richiesta e se ne ha i requisiti');
  } else {
    missing.push('IPT della moto non calcolata: per le moto sotto i 30 anni le fonti consultate non concordano. Verificala con il calcolatore ACI.');
  }

  add('Revisione, se scaduta', 0, T.revisione, 'Da controllare sul libretto: conta solo se è scaduta');

  if (storica === true) missing.push('Bollo: un mezzo ultratrentennale ne è esente; se circola, alcune regioni chiedono una piccola tassa di circolazione (da verificare).');
  else missing.push(year ? 'Bollo annuale non calcolato: dipende da regione, kW e classe ambientale.' : 'Bollo non calcolato: anno non indicato (sopra i 30 anni il mezzo ne è esente).');
  missing.push('Assicurazione non stimata: dipende da te e dalla compagnia.');
  missing.push('Commissione dell\'agenzia, se non fai la pratica da te: non inclusa.');

  const min = lines.reduce((s, l) => s + l.min, 0), max = lines.reduce((s, l) => s + l.max, 0);
  return { min, max, lines, missing, storica, kw, complete: !(card.category === 'moto' && storica !== true) };
}

module.exports = { startCost, kwOf, TARIFFE: T };
