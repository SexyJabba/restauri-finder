// Le "piste" dello scout: direzioni di ricerca derivate dal tuo profilo.
// Il testo "why" è un'ipotesi redazionale a livello di MODELLO (non di esemplare) e nell'interfaccia
// è sempre etichettato così. Nessuna affermazione su affidabilità, ricambi o costi.
'use strict';

const A = 'autoscout24', K = 'kleinanzeigen', S = 'subito', R = 'ruoteclassiche';
// Ruote Classiche: elenco per marca/modello, con i nomi usati dal sito negli indirizzi.
const rc = (brandModel) => ({ source: R, path: `f/${brandModel}/` });
// Automobile.it: "marca-modello"; il suffisso -auto_d_epoca limita alla sezione d'epoca i modelli ancora in produzione.
const am = (makeModel) => ({ source: 'automobile', path: makeModel });
// Un percorso può indicare una fonte diversa da quella della pista: { source, path }.
const subQ = (cat, q, extra) => ({ source: S, path: `annunci-italia/vendita/${cat}/?q=` + encodeURIComponent(q).replace(/%20/g, '+'), ...extra });
const sub = (q) => subQ('nautica', q);
// Su Subito la ricerca per parola è larga: ogni percorso porta il suo filtro sul titolo (must) e, se serve, sull'anno.
const subAuto = (q, must, extra) => subQ('auto', q, { must, ...extra });
const subMoto = (q, must, extra) => subQ('moto-e-scooter', q, { must, ...extra });
const kaBoat = (kw) => `s-boote-bootszubehoer/${kw}/k0c211`;
const BOAT_OK = /gommone|tender|smontabile|schlauchboot|honwave|zodiac|bombard|festrumpf|\brib\b|zar\b|quicksilver|aluboden|luftboden/i;
const BOAT_NO = /\bcerco\b|\bsolo motore\b|\bcarrello\b(?!.*gommon)|suzumar 2[0-5]0|\bsuche\b|persenning|pumpe|nur motor|ersatzteil|trailer ohne|slipräder$|\bsup\b|kajak|kanu|\b[5-9][.,]\d{1,2}\s?m\b|\b(2[.,][0-5]0?\s?m|230|240|250|t-?2[0-5])\b/i;

const trails = [
  /* ---------------- AUTO ---------------- */
  { id: 'alfetta', category: 'auto', kind: 'affine', source: A, label: 'Alfetta, GT e GTV',
    why: 'È il punto fermo del tuo profilo: l\'Alfetta GT/GTV è tra le auto che hai detto di sentire di più. Ti mostro anche qualche berlina, che condivide lo schema transaxle (cambio al retrotreno).',
    paths: ['lst/alfa-romeo/alfetta', 'lst/alfa-romeo/gtv?fregto=1987', subAuto('alfetta', /alfetta/i), rc('alfa-romeo/alfetta'), rc('alfa-romeo/alfetta-gt-gtv'), am('alfa_romeo-alfetta'), am('alfa_romeo-gtv')], yearMax: 1987 },
  { id: 'volvo480', category: 'auto', kind: 'affine', source: A, label: 'Volvo 480',
    why: 'Hai indicato la 480 come forte affinità per la sua particolarità: coda da shooting brake, fari a scomparsa, un carattere fuori dal comune.',
    paths: ['lst/volvo/480', subAuto('volvo 480', /\b480\b/), am('volvo-480')] },
  { id: 'transaxle-alfa', category: 'auto', kind: 'affine', source: A, label: 'Le sorelle transaxle: Giulietta (116) e 75',
    why: 'Stessa famiglia meccanica dell\'Alfetta che ti piace, in carrozzerie meno ovvie. Ipotesi dello scout: ciò che ti attrae dell\'Alfetta potrebbe essere anche lo schema, non solo la linea.',
    paths: ['lst/alfa-romeo/75', 'lst/alfa-romeo/giulietta?fregto=1990', subAuto('alfa romeo 75', /\b75\b/), subAuto('alfa romeo giulietta', /giulietta/i), rc('alfa-romeo/75'), rc('alfa-romeo/giulietta'), am('alfa_romeo-75'), am('alfa_romeo-giulietta-auto_d_epoca')], yearMin: 1977, yearMax: 1993 },
  { id: 'bmw-cabrio', category: 'auto', kind: 'affine', source: A, label: 'BMW Serie 3 cabrio anni \'80–\'90',
    why: 'Hai citato una BMW cabrio anni Novanta con problemi meccanici come esempio di occasione da interpretare. Non è un modello obbligato: la tengo come pista aperta.',
    paths: ['lst/bmw/serie-3?fregfrom=1986&fregto=1999&body=2', subAuto('bmw cabrio', /\bbmw\b.*cabrio|cabrio.*\bbmw\b|\b3[12]\d\s?i?\b.*cabrio/i), am('bmw-serie_3-cabrio')], yearMin: 1986, yearMax: 1999 },
  { id: 'saab', category: 'auto', kind: 'sorpresa', source: A, label: 'Saab 99 e 900 classica',
    why: 'Sorpresa ragionata: se della Volvo 480 ti piace l\'essere fuori dal coro, le Saab classiche sono un altro modo scandinavo di esserlo. Ipotesi da confermare con le tue reazioni.',
    paths: ['lst/saab/900?fregto=1994', 'lst/saab/99', subAuto('saab 900', /saab/i), subAuto('saab 99', /saab/i), rc('saab/900'), am('saab-900')], yearMax: 1994 },
  { id: 'citroen', category: 'auto', kind: 'sorpresa', source: A, label: 'Citroën CX e BX',
    why: 'Sorpresa: progetti ingegneristici molto personali (sospensioni idropneumatiche) pensati per viaggiare comodi, anche su strade secondarie. Attenzione: l\'idraulica è un mondo a sé rispetto ai lavori che fai di solito.',
    paths: ['lst/citroen/cx', 'lst/citroen/bx', subAuto('citroen cx', /\bcx\b/i), subAuto('citroen bx', /\bbx\b/i), rc('citroen/cx'), rc('citroen/bx'), am('citroen-cx'), am('citroen-bx')], yearMax: 1994 },
  { id: 'lancia', category: 'auto', kind: 'sorpresa', source: A, label: 'Lancia Beta, Fulvia e Gamma',
    why: 'Sorpresa italiana: coupé e berline con soluzioni tecniche proprie e abitacoli curati. Ti cito il gusto per motore e abitacolo piacevoli; qui lo metto alla prova lontano dall\'Alfa.',
    paths: ['lst/lancia/beta', 'lst/lancia/fulvia', 'lst/lancia/gamma', subAuto('lancia fulvia', /fulvia/i), subAuto('lancia beta', /\bbeta\b/i), subAuto('lancia gamma', /gamma/i), rc('lancia/beta-berlina'), rc('lancia/betacoupespiderhpe'), rc('lancia/beta-montecarlo'), rc('lancia/gamma'), am('lancia-fulvia'), am('lancia-beta'), am('lancia-gamma')], yearMax: 1990 },
  { id: 'transaxle-porsche', category: 'auto', kind: 'sorpresa', source: A, label: 'Porsche 924 e 944',
    why: 'Sorpresa: stesso principio transaxle dell\'Alfetta, interpretato in Germania. Te le mostro per capire se ti interessa l\'architettura o proprio il mondo Alfa.',
    paths: ['lst/porsche/924', 'lst/porsche/944', subAuto('porsche 944', /\b944\b/), subAuto('porsche 924', /\b924\b/), rc('porsche/924-944'), am('porsche-924'), am('porsche-944')] },
  { id: 'coupe-fuori-coro', category: 'auto', kind: 'sorpresa', source: A, label: 'Coupé anni \'70–\'90 fuori dal coro',
    why: 'Sorpresa: coupé compatte con un\'idea forte dietro (motore centrale, linee a cuneo, portelloni insoliti). Parenti alla lontana della 480 per spirito, non per marca.',
    paths: ['lst/fiat/x-1-9', 'lst/honda/crx', 'lst/renault/fuego', 'lst/volkswagen/scirocco?fregto=1992', 'lst/triumph/tr7', 'lst/alfa-romeo/sprint', 'lst/fiat/coupe', subAuto('fiat x1/9', /x\s?1\s?\/?\s?9/i), subAuto('honda crx', /\bcr-?x\b/i), subAuto('renault fuego', /fuego/i), subAuto('vw scirocco', /scirocco/i), rc('fiat/x1-9'), rc('volkswagen/scirocco'), rc('alfa-romeo/sprint'), rc('fiat/coupe'), am('fiat-x1_9'), am('volkswagen-scirocco-auto_d_epoca')], yearMax: 2000 },
  { id: 'spider', category: 'auto', kind: 'sorpresa', source: A, label: 'Spider con un altro carattere',
    why: 'La MG B ti ha coinvolto meno, ma hai detto che questo non esclude le spider. Provo con caratteri diversi (bialbero italiano, leggerezza giapponese) per capire dove sta il confine.',
    paths: ['lst/alfa-romeo/spider?fregto=1995', 'lst/fiat/124-spider?fregto=1990', 'lst/mazda/mx-5?fregto=1998', 'lst/triumph/spitfire', subAuto('alfa romeo spider duetto', /spider|duetto/i), subAuto('fiat 124 spider', /\b124\b.*spider|spider.*\b124\b/i), subAuto('mazda mx5', /mx-?\s?5/i), rc('alfa-romeo/spider'), rc('fiat/124-spider'), am('alfa_romeo-spider'), am('fiat-124_spider'), am('mazda-mx_5')], yearMax: 1998 },
  { id: 'piccole-semplici', category: 'auto', kind: 'sorpresa', source: A, label: 'Piccole e semplici, da fare tutto in casa',
    why: 'Hai detto che su mezzi semplici e vecchi puoi fare quasi tutto, fino alla distribuzione di una Panda 45. Queste sono palestre dove il lavoro resterebbe quasi tutto nelle tue mani.',
    paths: ['lst/fiat/panda?fregto=1990', 'lst/autobianchi/a-112', 'lst/innocenti/mini', 'lst/alfa-romeo/alfasud', subAuto('fiat panda 45', /panda/i), subAuto('autobianchi a112', /a\s?112/i), subAuto('alfasud', /alfasud/i), rc('fiat/panda'), rc('autobianchi/a112'), rc('innocenti/mini'), rc('alfa-romeo/alfasud'), am('fiat-panda-auto_d_epoca'), am('autobianchi-a112'), am('innocenti-mini'), am('alfa_romeo-alfasud')], yearMax: 1993 },

  /* ---------------- MOTO ---------------- */
  { id: 'africa-twin', category: 'moto', kind: 'affine', source: A, label: 'Honda Africa Twin (XRV 650/750)',
    why: 'L\'Africa Twin è il tuo riferimento di immaginario e d\'uso per la moto da viaggio. Te ne mostro di reali per affinare la categoria, non perché sia già una scelta.',
    paths: ['lst-moto/honda/xrv-750', 'lst-moto/honda/xrv-650', subMoto('africa twin xrv', /\bxrv\b|africa twin (650|750)|\brd0[3-7]\b/i, { yearMax: 2003 })] },
  { id: 'viaggiatrici', category: 'moto', kind: 'affine', source: A, label: 'Viaggiatrici con le borse, anni \'80–2000',
    why: 'Moto pensate per uscite di più giorni con bagaglio, nello stesso spirito dell\'Africa Twin ma con altre taglie e altri motori. Servono a capire quanto conta per te il modello e quanto l\'uso.',
    paths: ['lst-moto/honda/transalp', 'lst-moto/honda/nx-650', 'lst-moto/yamaha/xtz-750', 'lst-moto/yamaha/tdm-850', 'lst-moto/yamaha/xt-600', 'lst-moto/aprilia/pegaso-650', 'lst-moto/suzuki/dr-650', 'lst-moto/honda/xl-600', subMoto('honda transalp', /transalp/i), subMoto('yamaha super tenere', /t[eé]n[eé]r[eé]|\bxtz\b/i), subMoto('yamaha tdm 850', /\btdm\b/i), subMoto('yamaha xt 600', /\bxt\s?600\b/i), subMoto('aprilia pegaso 650', /pegaso/i)], yearMax: 2004 },
  { id: 'boxer', category: 'moto', kind: 'affine', source: A, label: 'BMW boxer due valvole (R 65, R 80, R 100)',
    why: 'Stanno a cavallo dei tuoi due desideri: base classica per una café racer tranquilla, oppure moto da viaggio con le borse. Meccanica a vista, cardano.',
    paths: ['lst-moto/bmw/r-80', 'lst-moto/bmw/r-65', 'lst-moto/bmw/r-100', subMoto('bmw r80', /\br\s?80\b/i), subMoto('bmw r100', /\br\s?100\b/i), subMoto('bmw r65', /\br\s?65\b/i)], yearMax: 1996 },
  { id: 'cafe-basi', category: 'moto', kind: 'affine', source: A, label: 'Basi per una café racer tranquilla',
    why: 'Per i giri fuori porta hai parlato di una café racer tranquilla: qui cerco naked classiche che potrebbero diventarlo o che lo sono già. Categoria ancora tutta da affinare.',
    paths: ['lst-moto/honda/cb-750', 'lst-moto/honda/cb-500?fregto=1985', 'lst-moto/honda/cx-500', 'lst-moto/yamaha/sr-500', 'lst-moto/yamaha/xj-600', 'lst-moto/suzuki/gs-550', 'lst-moto/kawasaki/w-650', subMoto('honda cb 750', /\bcb\s?750\b/i), subMoto('yamaha sr 500', /\bsr\s?500\b/i), subMoto('honda cx 500', /\bcx\s?500\b/i), subMoto('kawasaki w650', /\bw\s?650\b/i)], yearMax: 2006 },
  { id: 'guzzi', category: 'moto', kind: 'sorpresa', source: A, label: 'Moto Guzzi: V 35, V 65, 850 T e V7',
    why: 'Sorpresa italiana: bicilindrico a V trasversale e cardano, un progetto riconoscibile al primo sguardo. Può andare sia verso la café racer sia verso il turismo lento.',
    paths: ['lst-moto/moto-guzzi/v-35', 'lst-moto/moto-guzzi/v-65', 'lst-moto/moto-guzzi/850-t', 'lst-moto/moto-guzzi/v-7', subMoto('moto guzzi v35', /\bv\s?35\b/i), subMoto('moto guzzi v65', /\bv\s?65\b/i), subMoto('moto guzzi 850 t', /\b850\s?t/i), subMoto('moto guzzi v7', /\bv\s?7\b/i)] },
  { id: 'moto-insolite', category: 'moto', kind: 'sorpresa', source: A, label: 'Moto insolite',
    why: 'Sorpresa pura: moto con una soluzione tecnica particolare, fuori dai nomi che hai citato. Se non fa per te, dimmelo: serve a tracciare il confine.',
    paths: ['lst-moto/moto-morini/3-1-2', 'lst-moto/bmw/r-1100-gs', 'lst-moto/yamaha/xj-900', subMoto('moto morini 3 1/2', /morini/i), subMoto('bmw r 1100 gs', /\b1100\s?gs\b/i)] },

  /* ---------------- GOMMONI ---------------- */
  { id: 'honwave', category: 'gommoni', kind: 'affine', source: K, label: 'Honda Honwave e simili',
    why: 'L\'Honwave T32 IE3 è il riferimento che hai apprezzato. Cerco la stessa famiglia, guardando soprattutto le misure compatte ma con spazio a bordo. Cerco su Subito e, in alternativa, su Kleinanzeigen (Germania, dove la logistica va messa nel conto).',
    paths: [sub('honwave'), sub('gommone honwave'), kaBoat('honwave')], must: BOAT_OK, not: BOAT_NO, minPrice: 250 },
  { id: 'compatti-pagliolo', category: 'gommoni', kind: 'affine', source: K, label: 'Smontabili compatti con pagliolo',
    why: 'La tua direzione principale: un compatto smontabile con spazio sufficiente a bordo, per i weekend al mare con il furgone. Sotto i 2,6 m circa per te è troppo piccolo: la misura va sempre verificata sull\'annuncio.',
    paths: [sub('gommone smontabile'), sub('tender pagliolo alluminio'), sub('gommone pagliolo'), kaBoat('schlauchboot-aluboden'), kaBoat('schlauchboot-luftboden')], must: BOAT_OK, not: BOAT_NO, minPrice: 250 },
  { id: 'smontabili-grandi', category: 'gommoni', kind: 'sorpresa', source: K, label: 'Smontabili più grandi e marchi storici',
    why: 'Hai lasciato aperta la porta a smontabili intorno ai 4–4,75 m, sapendo che li useresti meno per la logistica. Ogni tanto te ne mostro uno, insieme a marchi storici del settore.',
    paths: [sub('zodiac smontabile'), sub('gommone smontabile 4 metri'), sub('bombard smontabile'), kaBoat('zodiac-schlauchboot'), kaBoat('bombard-schlauchboot')], must: BOAT_OK, not: BOAT_NO, minPrice: 300 },
];

const byId = Object.fromEntries(trails.map((t) => [t.id, t]));
const publicView = (t) => ({ id: t.id, category: t.category, kind: t.kind, label: t.label, why: t.why, source: t.source });

module.exports = { trails, byId, publicView };
