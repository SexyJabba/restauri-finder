// Fonti: cosa è davvero collegabile e come si legge. Ogni adattatore restituisce
// solo ciò che la pagina contiene (fatti strutturati e testo del venditore): nessuna interpretazione.
'use strict';
const { politeGet, checkImage } = require('./net');

const decode = (s) => String(s || '')
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&#x27;|&apos;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
const strip = (h) => decode(String(h || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ')).replace(/[ \t]+/g, ' ').replace(/\n\s+/g, '\n').trim();
// I recapiti del venditore non vengono conservati: restano solo sulla pagina originale.
const maskContacts = (s) => String(s || '')
  .replace(/(\+?\d[\d\s.\-\/]{7,}\d)/g, (m) => (m.replace(/\D/g, '').length >= 9 && !/^\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4}$/.test(m.trim()) ? '[recapito omesso]' : m))
  .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[recapito omesso]');
const num = (s) => { const n = parseInt(String(s ?? '').replace(/[^\d]/g, ''), 10); return Number.isFinite(n) ? n : null; };

function nextData(html) {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try { return JSON.parse(m[1]).props.pageProps; } catch { return null; }
}

/* ---------- AutoScout24 Italia ---------- */
const AS24 = 'https://www.autoscout24.it';
const as24 = {
  id: 'autoscout24', label: 'AutoScout24 Italia', host: 'www.autoscout24.it', country: 'IT',
  categories: ['auto', 'moto'],
  match: (u) => u.hostname.endsWith('autoscout24.it') && /\/annunci\//.test(u.pathname),
  keyFromUrl: (u) => { const m = u.pathname.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/); return m ? 'autoscout24:' + m[1] : null; },

  async search(pathAndQuery) {
    const r = await politeGet(AS24 + '/' + pathAndQuery);
    if (!r.ok) return { ok: false, http: r.status, reason: r.reason };
    const p = nextData(r.text);
    if (!p || !Array.isArray(p.listings)) return { ok: false, http: r.status, reason: 'formato_inatteso' };
    const items = p.listings.filter((l) => l && l.id && l.url).map((l) => {
      const v = l.vehicle || {}, t = l.tracking || {};
      const yr = (t.firstRegistration || '').match(/(\d{4})$/);
      return {
        key: 'autoscout24:' + l.id, url: AS24 + l.url,
        name: [v.make, v.model].filter(Boolean).join(' '), version: v.modelVersionInput || '',
        price: l.price?.priceRaw ?? null, year: yr ? +yr[1] : null, km: num(t.mileage),
        city: l.location?.city || '', hasImage: (l.images || []).length > 0, offerType: v.offerType,
      };
    });
    return { ok: true, http: r.status, total: p.numberOfResults ?? items.length, items };
  },

  async detail(url) {
    const r = await politeGet(url);
    if (!r.ok) return { ok: false, http: r.status, reason: r.reason };
    // Un annuncio rimosso non dà errore: AutoScout24 rimanda alla pagina di ricerca del modello.
    if (r.finalUrl && !/\/annunci\//.test(new URL(r.finalUrl).pathname)) return { ok: false, http: r.status, reason: 'non_trovato' };
    const p = nextData(r.text);
    const d = p && p.listingDetails;
    if (!d || !d.id) return { ok: false, http: r.status, reason: 'formato_inatteso' };
    const v = d.vehicle || {}, loc = d.location || {};
    const price = d.prices?.public?.priceRaw ?? null;
    const year = (v.firstRegistrationDateRaw || '').slice(0, 4);
    return {
      ok: true, http: r.status,
      listing: {
        key: 'autoscout24:' + d.id, source: 'autoscout24', url: (r.finalUrl || url).split('?')[0],
        category: /motor|bike/i.test(v.type || d.vehicleType || '') ? 'moto' : 'auto',
        name: [v.make, v.model].filter(Boolean).join(' '), version: v.modelVersionInput || v.modelVersionCustom || '',
        facts: {
          price, priceText: d.prices?.public?.price || null, negotiable: !!d.prices?.public?.negotiable,
          year: year ? +year : null, km: v.mileageInKmRaw ?? null,
          power: v.rawPowerInKw ? `${v.rawPowerInKw} kW` : (v.powerInKw || null), displacement: v.rawDisplacementInCCM ? `${v.rawDisplacementInCCM} cm³` : (v.displacementInCCM || null),
          fuel: v.fuelCategory?.formatted || null, gearbox: v.transmissionType || null, color: v.bodyColor || null,
          city: loc.city || null, zip: loc.zip || null, country: loc.countryCode || 'IT',
          lat: loc.latitude ?? null, lon: loc.longitude ?? null,
          sellerType: d.seller?.isDealer ? 'Concessionario' : 'Privato',
          listedAt: d.createdTimestampWithOffset || null,
        },
        sellerText: maskContacts(strip(d.description || '')),
        images: (d.images || []).slice(0, 12),
      },
    };
  },
};

/* ---------- Kleinanzeigen (Germania) ---------- */
const KA = 'https://www.kleinanzeigen.de';
const ka = {
  id: 'kleinanzeigen', label: 'Kleinanzeigen (Germania)', host: 'www.kleinanzeigen.de', country: 'DE',
  categories: ['gommoni'],
  match: (u) => u.hostname.endsWith('kleinanzeigen.de') && /\/s-anzeige\//.test(u.pathname),
  keyFromUrl: (u) => { const m = u.pathname.match(/\/(\d{6,})-\d+-\d+\/?$/); return m ? 'kleinanzeigen:' + m[1] : null; },

  async search(pathAndQuery) {
    const r = await politeGet(KA + '/' + pathAndQuery);
    if (!r.ok) return { ok: false, http: r.status, reason: r.reason };
    const items = [];
    const re = /<article[^>]*data-adid="(\d+)"[^>]*data-href="([^"]+)"[^>]*>([\s\S]*?)<\/article>/g;
    let m;
    while ((m = re.exec(r.text))) {
      const body = m[3];
      let title = '';
      const ld = body.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
      if (ld) { try { title = JSON.parse(ld[1]).title || ''; } catch {} }
      const text = strip(body.replace(/<script[\s\S]*?<\/script>/g, ''));
      const pm = text.match(/(\d{1,3}(?:\.\d{3})*)\s*€/);
      items.push({
        key: 'kleinanzeigen:' + m[1], url: KA + decode(m[2]), name: title, version: '',
        price: pm ? num(pm[1]) : null, year: null, km: null, city: (text.match(/\b\d{5}\s+[^\d|]{2,40}?(?=\s+\d{2}\.\d{2}\.\d{4}|\s+Heute|\s+Gestern|$)/) || [''])[0].trim(),
        hasImage: !!ld, pro: /\bPRO\b/.test(text),
      });
    }
    if (!items.length && !/data-adid/.test(r.text)) return { ok: /keine (Anzeigen|Ergebnisse)/i.test(r.text), http: r.status, reason: 'formato_inatteso', items: [], total: 0 };
    return { ok: true, http: r.status, total: items.length, items };
  },

  async detail(url) {
    const r = await politeGet(url);
    if (!r.ok) return { ok: false, http: r.status, reason: r.reason };
    const h = r.text;
    const og = (p) => { const m = h.match(new RegExp('<meta property="og:' + p + '" content="([^"]*)"')); return m ? decode(m[1]) : null; };
    const title = strip((h.match(/id="viewad-title"[^>]*>([\s\S]*?)<\/h1>/) || [])[1] || '') || og('title');
    const key = this.keyFromUrl(new URL(r.finalUrl || url));
    if (!title || !key || !/id="viewad-title"/.test(h)) return { ok: false, http: r.status, reason: 'formato_inatteso' };
    const priceText = strip((h.match(/id="viewad-price"[^>]*>([\s\S]*?)<\/h2>/) || [])[1] || '');
    const locality = strip((h.match(/id="viewad-locality"[^>]*>([\s\S]*?)<\/span>/) || [])[1] || '');
    const desc = strip((h.match(/id="viewad-description-text"[^>]*>([\s\S]*?)<\/p>/) || [])[1] || '');
    const images = [];
    const re = /<script type="application\/ld\+json">\s*(\{"creditText"[\s\S]*?\})\s*<\/script>/g;
    let m;
    while ((m = re.exec(h))) { try { const u = JSON.parse(m[1]).contentUrl; if (u && !images.includes(u)) images.push(u); } catch {} }
    if (!images.length && og('image')) images.push(og('image'));
    const zip = (locality.match(/\b\d{5}\b/) || [null])[0];
    return {
      ok: true, http: r.status,
      listing: {
        key, source: 'kleinanzeigen', url: (r.finalUrl || url).split('?')[0], category: 'gommoni',
        name: title, version: '',
        facts: {
          price: /€/.test(priceText) ? num(priceText) : null, priceText: priceText || null, negotiable: /VB/.test(priceText),
          city: locality.replace(/^\d{5}\s*/, '') || null, zip, country: 'DE',
          lat: og('latitude') ? +og('latitude') : null, lon: og('longitude') ? +og('longitude') : null,
          sellerType: /Gewerblicher/.test(h) ? 'Commerciante' : 'Privato', language: 'tedesco',
        },
        sellerText: maskContacts(desc),
        images: images.slice(0, 12),
      },
    };
  },
};

/* ---------- Subito.it ---------- */
const SUB = 'https://www.subito.it';
const subCat = (pathname) => (/^\/nautica\//.test(pathname) ? 'gommoni' : /^\/auto\//.test(pathname) ? 'auto' : /^\/moto-e-scooter\//.test(pathname) ? 'moto' : 'altro');
const subito = {
  id: 'subito', label: 'Subito.it', host: 'www.subito.it', country: 'IT',
  categories: ['auto', 'moto', 'gommoni'],
  match: (u) => u.hostname.endsWith('subito.it') && /-\d{6,}\.htm$/.test(u.pathname),
  keyFromUrl: (u) => { const m = u.pathname.match(/-(\d{6,})\.htm$/); return m ? 'subito:' + m[1] : null; },

  async search(pathAndQuery) {
    const r = await politeGet(SUB + '/' + pathAndQuery);
    if (!r.ok) return { ok: false, http: r.status, reason: r.reason };
    const p = nextData(r.text);
    const list = p?.initialState?.items?.originalList;
    if (!Array.isArray(list)) return { ok: false, http: r.status, reason: 'formato_inatteso' };
    const feat = (it, k) => it.features?.[k]?.values?.[0]?.key ?? null;
    const items = list.filter((it) => it?.urls?.default && it.kind === 'AdItem').map((it) => {
      const u = new URL(it.urls.default);
      return {
        key: this.keyFromUrl(u), url: it.urls.default, name: it.subject || '', version: '',
        price: num(feat(it, '/price')), year: num(feat(it, '/year')), km: num(feat(it, '/mileage_scalar')),
        city: it.geo?.town?.value || it.geo?.city?.value || '', hasImage: (it.images || []).length > 0,
        pro: !!it.advertiser?.company, offerType: it.type?.key === 's' ? 'U' : 'altro', lengthCm: num(feat(it, '/ship_length')),
      };
    }).filter((it) => it.key && it.offerType === 'U');
    return { ok: true, http: r.status, total: p.initialState.items.total ?? items.length, items };
  },

  async detail(url) {
    const r = await politeGet(url);
    if (!r.ok) return { ok: false, http: r.status, reason: r.reason };
    const h = r.text;
    const u = new URL(r.finalUrl || url);
    const key = this.keyFromUrl(u);
    const nodes = [];
    const re = /<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g;
    let m;
    while ((m = re.exec(h))) { try { const j = JSON.parse(m[1]); (j['@graph'] || [j]).forEach((n) => nodes.push(n)); } catch {} }
    const prod = nodes.find((n) => n['@type'] === 'Product');
    if (!key || !prod || !prod.name) return { ok: false, http: r.status, reason: 'formato_inatteso' };
    const img = nodes.find((n) => n['@type'] === 'ImageObject' && n.description);
    const text = strip(h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' '));
    const title = strip((h.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '');
    const offer = [].concat(prod.offers || [])[0];
    let price = offer?.price != null ? num(String(offer.price).split(/[.,]\d{2}$/)[0]) : null;
    if (price == null) { const pm = text.match(new RegExp(prod.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*(\\d{1,3}(?:\\.\\d{3})*)\\s*€')); if (pm) price = num(pm[1]); }
    const len = text.match(/Lunghezza barca\s*(\d{3})\s*m\b/); // il sito scrive i centimetri con l'etichetta "m"
    return {
      ok: true, http: r.status,
      listing: {
        key, source: 'subito', url: u.origin + u.pathname, category: subCat(u.pathname), name: decode(prod.name), version: len ? `lunghezza indicata ${(len[1] / 100).toFixed(2).replace('.', ',')} m` : '',
        facts: { price, priceText: null, city: (title.match(/In vendita a (.+)$/) || [])[1] || null, country: 'IT', lat: null, lon: null, sellerType: null },
        sellerText: maskContacts(strip(img?.description || prod.description || '')),
        images: [].concat(prod.image || []).filter((x) => typeof x === 'string').slice(0, 12),
      },
    };
  },
};

/* ---------- Ruote Classiche – Vendo e compro (Quattroruote) ---------- */
const RC = 'https://ruoteclassiche.quattroruote.it';
const RC_ADS = RC + '/vendo-e-compro';
const titleCase = (s) => String(s || '').toLowerCase().replace(/(^|[\s\-/])([a-zà-ù])/g, (m, a, b) => a + b.toUpperCase());
const slugOf = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const rcPick = (h, cls) => { const m = h.match(new RegExp('class="' + cls + '"[^>]*>([\\s\\S]*?)</(?:div|a)>')); return m ? strip(m[1]) : ''; };
const rcSeller = (name) => (/rivenditor|concession|commerc/i.test(name) ? 'Concessionario' : name ? 'Privato' : null);

// Pagina di elenco per marca/modello (es. "f/alfa-romeo/alfetta/"). Se il modello non esiste il sito
// mostra in silenzio l'elenco completo: lo si riconosce perché le marche non corrispondono.
function rcParseSearch(html, path) {
  const want = (String(path).match(/^f\/([a-z0-9-]+)/) || [])[1] || null;
  const total = num(rcPick(html, 'sab-total-count-value'));
  const blocks = html.split(/<div class="sab-listing-block\s*">/).slice(1);
  const items = blocks.map((b) => {
    const href = (b.match(/href="([^"]*\/vendo-e-compro\/annuncio\/[^"]*-(\d+)\/?)"/) || []);
    if (!href[1]) return null;
    const brand = rcPick(b, 'sab-listing-block-brand'), model = rcPick(b, 'sab-listing-block-model');
    const info = {};
    const re = /sab-listing-block-more-info-box-label">([^<]*)<\/div>\s*<div class="sab-listing-block-more-info-box-value">([^<]*)</g;
    let m; while ((m = re.exec(b))) info[m[1].trim().toLowerCase()] = decode(m[2]).trim();
    const addr = rcPick(b, 'sab-listing-block-reseller-block-address').replace(/^\|\s*/, '');
    return {
      key: 'ruoteclassiche:' + href[2], url: decode(href[1]), brandSlug: slugOf(brand),
      name: [titleCase(brand), model].filter(Boolean).join(' '), version: '',
      price: num(rcPick(b, 'sab-listing-block-price')), year: num(info.anno), km: num(info.km),
      city: addr.replace(/\s*\(.*$/, ''), hasImage: /sab-listing-block-image-img-listing"\s+src="https?:/.test(b),
    };
  }).filter(Boolean);
  if (!blocks.length) return { ok: /sab-total-count/.test(html), reason: 'formato_inatteso', items: [], total: 0 };
  if (want && items.some((it) => it.brandSlug !== want && !want.startsWith(it.brandSlug) && !it.brandSlug.startsWith(want))) return { ok: false, reason: 'nessun_annuncio', items: [], total: 0 };
  return { ok: true, total: total ?? items.length, items };
}

function rcParseDetail(html, url) {
  const id = (String(url).match(/-(\d+)\/?$/) || [])[1];
  const brand = rcPick(html, 'sab-detail-header-info-brand'), model = rcPick(html, 'sab-detail-header-info-model');
  if (!id || !brand) return null;
  const tech = {};
  const re = /sab-detail-technical-information-label">([^<]*)<\/div>\s*<div class="sab-detail-technical-information-value">([^<]*)</g;
  let m; while ((m = re.exec(html))) tech[m[1].trim().toLowerCase()] = decode(m[2]).trim();
  const addr = rcPick(html, 'sab-detail-header-info-reseller-block-address').split('|').map((x) => x.trim()).filter(Boolean);
  const place = addr.find((x) => /\(/.test(x) || /\d{5}/.test(x)) || '';
  const year = addr.map((x) => (/^(19|20)\d{2}$/.test(x) ? +x : null)).find(Boolean) || null;
  const priceText = rcPick(html, 'sab-detail-header-info-price');
  const images = [];
  const ri = /class="sab-detail-header-image"[^>]*>\s*<img[^>]*?\ssrc="([^"]+)"/g;
  while ((m = ri.exec(html))) if (!images.includes(m[1])) images.push(decode(m[1]));
  const cc = num(tech.cilindrata), cv = num(tech.cavalli);
  return {
    key: 'ruoteclassiche:' + id, source: 'ruoteclassiche', url: RC_ADS + '/annuncio/' + String(url).replace(/^.*\/annuncio\//, '').replace(/\/?$/, '/'),
    category: /moto/i.test(tech['tipologia di mercato'] || '') ? 'moto' : 'auto',
    name: [titleCase(brand), model].filter(Boolean).join(' '), version: '',
    facts: {
      price: /€/.test(priceText) ? num(priceText) : null, priceText: priceText || null, negotiable: false,
      year, km: tech.chilometraggio ? num(tech.chilometraggio) : null,
      power: cv ? `${cv} CV` : null, displacement: cc ? `${cc} cm³` : null,
      fuel: tech.alimentazione || null, color: tech['colore est.'] || null,
      city: place.replace(/\s*\(.*$/, '') || null, zip: (place.match(/\b\d{5}\b/) || [null])[0], country: 'IT', lat: null, lon: null,
      sellerType: rcSeller(rcPick(html, 'sab-detail-header-info-reseller-block-name')),
    },
    sellerText: maskContacts(rcPick(html, 'sab-detail-description-container-text')),
    images: images.slice(0, 12),
  };
}

const ruoteclassiche = {
  id: 'ruoteclassiche', label: 'Ruote Classiche – Vendo e compro', host: 'ruoteclassiche.quattroruote.it', country: 'IT',
  categories: ['auto'],
  match: (u) => /(^|\.)ruoteclassiche\.(quattroruote\.)?it$/.test(u.hostname) && /\/vendo-e-compro\/annuncio\//.test(u.pathname),
  keyFromUrl: (u) => { const m = u.pathname.match(/-(\d{6,})\/?$/); return m ? 'ruoteclassiche:' + m[1] : null; },

  async search(path) {
    const r = await politeGet(RC_ADS + '/' + path);
    if (!r.ok) return { ok: false, http: r.status, reason: r.reason };
    return { http: r.status, ...rcParseSearch(r.text, path) };
  },

  async detail(url) {
    const r = await politeGet(url);
    if (!r.ok) return { ok: false, http: r.status, reason: r.reason };
    // Un annuncio rimosso non dà errore: il sito rimanda all'elenco generale.
    if (r.finalUrl && !/\/annuncio\//.test(new URL(r.finalUrl).pathname)) return { ok: false, http: r.status, reason: 'non_trovato' };
    const listing = rcParseDetail(r.text, r.finalUrl || url);
    if (!listing) return { ok: false, http: r.status, reason: 'formato_inatteso' };
    return { ok: true, http: r.status, listing };
  },
};

/* ---------- Automobile.it ---------- */
const AM = 'https://www.automobile.it';
const amCity = (loc) => String(loc || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
const amYear = (reg) => { const m = String(reg || '').match(/\b(19|20)\d{2}\b/); return m ? +m[0] : null; };
const amSeller = (t) => (t === 'DEALER' ? 'Concessionario' : t === 'PRIVATE' ? 'Privato' : null);

// Pagina di elenco per marca-modello (es. "alfa_romeo-alfetta", "fiat-panda-auto_d_epoca").
function amParseSearch(html) {
  const p = nextData(html);
  const r = p && p.apiResults && p.apiResults.result;
  if (!r || !Array.isArray(r.resultList)) return { ok: false, reason: 'formato_inatteso', items: [], total: 0 };
  const items = r.resultList.filter((it) => it && it.id && it.url).map((it) => {
    const d = it.details || {};
    return {
      key: 'automobile:' + it.id, url: AM + it.url, name: it.title || '', version: '',
      price: num(it.formattedPrice), year: amYear(d.registration), km: num(d.formattedKm), city: amCity(it.location),
      hasImage: (it.totalNumberOfPictures || 0) > 0,
      offerType: it.rental || /nuov|km\s?0/i.test(d.channelOrChannelUsed || it.channel || '') ? 'N' : 'U',
    };
  });
  return { ok: true, total: r.page?.totalResults ?? items.length, items };
}

function amParseDetail(html, url) {
  const p = nextData(html);
  const r = p && p.result;
  if (!r || !r.id || !r.title) return null;
  const info = {};
  for (const group of Object.values(p.vehicleInformation || {})) for (const row of [].concat(group || [])) if (row && row.title) info[row.title.toLowerCase()] = [].concat(row.values || [])[0];
  const d = r.details || {};
  const cv = (String(info.potenza || d.formattedPower || '').match(/(\d+)\s*CV/i) || [])[1];
  const cc = num(info.cilindrata || d.formattedEngineCapacity);
  return {
    key: 'automobile:' + r.id, source: 'automobile', url: AM + (r.url || new URL(url).pathname),
    category: /moto|bike|scooter/i.test(d.category || '') ? 'moto' : 'auto',
    name: r.title, version: info.versione && info.versione !== '-' ? info.versione : '',
    facts: {
      price: num(r.formattedPrice), priceText: r.formattedPrice || null, negotiable: false,
      year: amYear(info.immatricolazione || d.registration), km: num(info.chilometri || d.formattedKm),
      power: cv ? `${cv} CV` : null, displacement: cc ? `${cc} cm³` : null,
      fuel: info.carburante || null, gearbox: info.cambio || d.shift || null, color: info['colore esterno'] || null,
      city: amCity(r.location) || null, country: 'IT', lat: null, lon: null, sellerType: amSeller(r.sellerType),
    },
    sellerText: maskContacts(strip(r.description || '')),
    images: (r.vipPictures || []).map((x) => x && x.imgBig).filter(Boolean).slice(0, 12),
  };
}

const automobile = {
  id: 'automobile', label: 'Automobile.it', host: 'www.automobile.it', country: 'IT',
  categories: ['auto'],
  match: (u) => /(^|\.)automobile\.it$/.test(u.hostname) && /^\/[^/]+\/\d{6,}\/?$/.test(u.pathname),
  keyFromUrl: (u) => { const m = u.pathname.match(/\/(\d{6,})\/?$/); return m ? 'automobile:' + m[1] : null; },

  async search(path) {
    const r = await politeGet(AM + '/' + path);
    // Un modello che il sito non conosce risponde 404: non è un errore, semplicemente non ci sono annunci.
    if (!r.ok) return { ok: false, http: r.status, reason: r.reason === 'non_trovato' ? 'nessun_annuncio' : r.reason };
    return { http: r.status, ...amParseSearch(r.text) };
  },

  async detail(url) {
    const r = await politeGet(url);
    if (!r.ok) return { ok: false, http: r.status, reason: r.reason };
    const listing = amParseDetail(r.text, r.finalUrl || url);
    if (!listing) return { ok: false, http: r.status, reason: 'formato_inatteso' };
    return { ok: true, http: r.status, listing };
  },
};

/* ---------- Estrazione generica (link incollato a mano) ---------- */
function genericExtract(html, url) {
  const meta = (attr, name) => {
    const m = html.match(new RegExp(`<meta[^>]+${attr}=["']${name}["'][^>]*content=["']([^"']*)["']`, 'i'))
      || html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*${attr}=["']${name}["']`, 'i'));
    return m ? decode(m[1]).trim() : null;
  };
  const out = { name: null, sellerText: null, images: [], price: null, city: null, found: [] };
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  const nodes = [];
  while ((m = re.exec(html))) {
    try { const j = JSON.parse(m[1]); (Array.isArray(j) ? j : (j['@graph'] || [j])).forEach((n) => nodes.push(n)); } catch {}
  }
  const prod = nodes.find((n) => /Product|Vehicle|Car|Motorcycle|Boat|Offer/i.test([].concat(n['@type'] || []).join(' ')));
  if (prod) {
    out.found.push('dati strutturati (JSON-LD)');
    out.name = prod.name || null;
    out.sellerText = prod.description || null;
    const img = [].concat(prod.image || []).map((i) => (typeof i === 'string' ? i : i?.url || i?.contentUrl)).filter(Boolean);
    out.images.push(...img);
    const offer = [].concat(prod.offers || [])[0] || (/Offer/.test(prod['@type']) ? prod : null);
    if (offer?.price != null) out.price = num(String(offer.price).split(/[.,]\d{2}$/)[0]);
    out.city = offer?.availableAtOrFrom?.address?.addressLocality || prod.address?.addressLocality || null;
  }
  const ogt = meta('property', 'og:title'), ogd = meta('property', 'og:description'), ogi = meta('property', 'og:image');
  if (ogt || ogi) out.found.push('anteprima della pagina (Open Graph)');
  out.name = out.name || ogt || strip((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '') || null;
  out.sellerText = maskContacts(strip(out.sellerText || ogd || meta('name', 'description') || ''));
  if (ogi && !out.images.includes(ogi)) out.images.push(ogi);
  if (out.price == null) { const p = meta('property', 'product:price:amount') || meta('property', 'og:price:amount'); if (p) out.price = num(p.split(/[.,]\d{2}$/)[0]); }
  out.images = out.images.map((i) => { try { return new URL(i, url).href; } catch { return null; } }).filter(Boolean).slice(0, 12);
  return out;
}

const adapters = [as24, ka, subito, ruoteclassiche, automobile];
const byId = Object.fromEntries(adapters.map((a) => [a.id, a]));

function adapterFor(url) {
  let u; try { u = new URL(url); } catch { return null; }
  return adapters.find((a) => a.match(u)) || null;
}

function normalizeUrl(url) {
  const u = new URL(url);
  u.hash = '';
  for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid|ref|source|mkcid|campid)/i.test(k)) u.searchParams.delete(k);
  return u.href.replace(/\/$/, '');
}

function keyFor(url) {
  const a = adapterFor(url);
  const u = new URL(url);
  return (a && a.keyFromUrl(u)) || 'link:' + normalizeUrl(url).replace(/^https?:\/\/(www\.)?/, '');
}

// Lettura di un annuncio qualsiasi: adattatore dedicato se esiste, altrimenti estrazione generica.
async function readListing(url) {
  const a = adapterFor(url);
  if (a) { const r = await a.detail(url); return { ...r, via: a.label }; }
  const r = await politeGet(url);
  if (!r.ok) return { ok: false, http: r.status, reason: r.reason, via: 'lettura generica' };
  const g = genericExtract(r.text, r.finalUrl || url);
  if (!g.name) return { ok: false, http: r.status, reason: 'formato_inatteso', via: 'lettura generica' };
  return {
    ok: true, http: r.status, via: 'lettura generica: ' + (g.found.join(', ') || 'titolo della pagina'),
    listing: {
      key: keyFor(url), source: 'link', url: normalizeUrl(r.finalUrl || url), category: null, name: g.name, version: '',
      facts: { price: g.price, priceText: null, city: g.city, country: null, lat: null, lon: null },
      sellerText: g.sellerText, images: g.images,
    },
  };
}

const REASONS = {
  non_trovato: 'la pagina non esiste più (annuncio rimosso o scaduto)',
  accesso_rifiutato: 'il sito rifiuta la lettura automatica',
  vietato_da_robots: 'il sito chiede di non leggere automaticamente questa pagina (robots.txt)',
  rete: 'sito non raggiungibile da questo server',
  errore_http: 'il sito ha risposto con un errore',
  formato_inatteso: 'pagina raggiunta ma senza i dati di un annuncio riconoscibile',
  nessun_annuncio: 'nessun annuncio per questo modello sulla fonte, in questo momento',
  url_non_valido: 'indirizzo non valido',
  host_non_ammesso: 'indirizzo non ammesso',
};

// Verifica completa di un esemplare: pagina di destinazione + prima fotografia.
async function verify(url) {
  const at = new Date().toISOString();
  const r = await readListing(url);
  const page = { ok: !!r.ok, http: r.http || 0, detail: r.ok ? 'pagina aperta e dati dell\'annuncio letti' : (REASONS[r.reason] || r.reason || 'esito sconosciuto') };
  let image = { ok: false, http: 0, detail: 'non controllata' };
  if (r.ok) {
    const first = r.listing.images[0];
    image = first ? await checkImage(first) : { ok: false, http: 0, detail: 'l\'annuncio non ha fotografie' };
  }
  let status;
  if (r.ok && image.ok) status = 'attiva';
  else if (r.reason === 'non_trovato') status = 'non_disponibile';
  else if (r.ok) status = 'senza_foto';
  else status = 'non_verificabile';
  return { status, check: { at, by: 'server', page, image, via: r.via || null }, listing: r.ok ? r.listing : null };
}

/* ---------- Registro delle fonti mostrato nella pagina "Fonti" ---------- */
// "allestimento" = cosa è risultato dalle prove fatte il 14/11/2026 dal server di sviluppo.
const registry = [
  { id: 'autoscout24', label: 'AutoScout24 Italia', url: AS24, covers: 'Auto e moto', mode: 'ricerca',
    setup: 'Collegata. Ricerca per modello e lettura di ogni annuncio (dati strutturati della pagina).',
    note: 'Lettura consentita dal robots.txt per le pagine usate; le condizioni d\'uso del sito restano da valutare da parte tua. Uso personale, poche richieste, solo quando avvii una ricerca.',
    probe: AS24 + '/lst/volvo/480' },
  { id: 'kleinanzeigen', label: 'Kleinanzeigen (Germania)', url: KA, covers: 'Gommoni e tender', mode: 'ricerca',
    setup: 'Collegata. Fonte stabile per i gommoni, ma gli annunci sono in Germania e in tedesco.',
    note: 'Distanza e ritiro vanno messi nel conto: la scheda lo segnala sempre.',
    probe: KA + '/s-boote-bootszubehoer/honwave/k0c211' },
  { id: 'subito', label: 'Subito.it', url: SUB, covers: 'Auto, moto, gommoni e tender (ricerca); altro con link manuale', mode: 'ricerca',
    setup: 'Collegata con prudenza. Il robots.txt consente le pagine usate, ma il sito a volte rifiuta le letture automatiche (risposta 403): quando succede la ricerca lo dichiara, non insiste e non pubblica nulla che non abbia potuto aprire.',
    note: 'Una richiesta ogni 6 secondi, solo quando avvii una ricerca. Subito non fornisce coordinate: la distanza non è calcolabile per questi annunci.',
    alt: 'Se la lettura viene rifiutata: ricerca salvata con avvisi email su Subito, poi "Aggiungi un link" per gli annunci che ti colpiscono.',
    probe: SUB + '/annunci-italia/vendita/nautica/?q=honwave' },
  { id: 'ruoteclassiche', label: 'Ruote Classiche – Vendo e compro', url: RC_ADS + '/', covers: 'Auto d\'epoca e youngtimer', mode: 'ricerca',
    setup: 'Collegata (15/11/2026). Ricerca per marca e modello e lettura di ogni annuncio. Il robots.txt consente la sezione annunci. Quasi tutti gli annunci sono di rivenditori; la sezione moto è quasi vuota, quindi la uso solo per le auto.',
    note: 'Il sito non fornisce coordinate: la distanza non è calcolabile. Se un modello non ha annunci, il sito mostra l\'elenco generale: lo Scout se ne accorge e prova un\'altra fonte.',
    probe: RC_ADS + '/f/alfa-romeo/alfetta/' },
  { id: 'automobile', label: 'Automobile.it', url: AM, covers: 'Auto (anche d\'epoca)', mode: 'ricerca',
    setup: 'Collegata (15/11/2026). Ricerca per marca e modello (per i modelli ancora in produzione, solo la sezione d\'epoca) e lettura di ogni annuncio dai dati strutturati della pagina. Il robots.txt consente le pagine usate.',
    note: 'Le moto ci sono solo per marca, mescolate a scooter nuovi e ricambi: non le uso. Il sito non fornisce coordinate, quindi la distanza non è calcolabile.',
    probe: AM + '/alfa_romeo-alfetta' },
  { id: 'motoclassiche', label: 'Motoclassiche.it', url: 'https://www.motoclassiche.it', covers: 'Ricambi per moto inglesi', mode: 'manuale',
    setup: 'Non è una fonte di annunci: è un negozio di ricambi per BSA, Triumph e Norton. La "vetrina" mostra moto di clienti come esempi, non in vendita (verificato il 15/11/2026).',
    alt: 'Nessuna: utile semmai per i ricambi di un progetto già avviato.', probe: 'https://www.motoclassiche.it/' },
  { id: 'ebay', label: 'eBay.it', url: 'https://www.ebay.it', covers: 'Auto, moto, nautica', mode: 'manuale',
    setup: 'Pagine di ricerca non leggibili (403, e robots.txt le esclude). Esiste un\'API ufficiale (Browse API) che richiede credenziali da sviluppatore: adattatore non ancora scritto.',
    alt: 'Link incollato a mano; oppure, come sviluppo successivo, registrare un\'app su developer.ebay.com e aggiungere l\'adattatore API.',
    probe: 'https://www.ebay.it/robots.txt' },
  { id: 'motoit', label: 'Moto.it', url: 'https://www.moto.it', covers: 'Moto', mode: 'manuale',
    setup: 'Sito raggiungibile, ma robots.txt esclude le pagine di ricerca: nessuna ricerca automatica. I singoli annunci si possono provare con "Aggiungi un link" (lettura generica, non garantita).',
    alt: 'Ricerche salvate sul sito + link incollato a mano.', probe: 'https://www.moto.it/robots.txt' },
  { id: 'classictrader', label: 'Classic Trader', url: 'https://www.classic-trader.com', covers: 'Auto e moto d\'epoca', mode: 'manuale',
    setup: 'Sito raggiungibile; adattatore di ricerca non ancora scritto. Singoli annunci tramite "Aggiungi un link" (lettura generica).',
    alt: 'Link incollato a mano.', probe: 'https://www.classic-trader.com/robots.txt' },
  { id: 'carandclassic', label: 'Car & Classic', url: 'https://www.carandclassic.com', covers: 'Auto e moto d\'epoca', mode: 'manuale',
    setup: 'Non collegabile: il sito rifiuta la lettura automatica (403).', alt: 'Link incollato a mano, dati compilati da te.', probe: 'https://www.carandclassic.com/robots.txt' },
  { id: 'catawiki', label: 'Catawiki', url: 'https://www.catawiki.com', covers: 'Aste', mode: 'manuale',
    setup: 'Non collegabile: la pagina iniziale risponde ma la ricerca rifiuta la lettura automatica (403).', alt: 'Link incollato a mano, dati compilati da te.', probe: 'https://www.catawiki.com/it/s?q=alfetta' },
  { id: 'leboncoin', label: 'Leboncoin (Francia)', url: 'https://www.leboncoin.fr', covers: 'Tutto', mode: 'manuale',
    setup: 'Non collegabile: il sito rifiuta la lettura automatica (403).', alt: 'Link incollato a mano, dati compilati da te.', probe: 'https://www.leboncoin.fr/' },
  { id: 'facebook', label: 'Facebook Marketplace', url: 'https://www.facebook.com/marketplace', covers: 'Tutto', mode: 'manuale',
    setup: 'Non collegabile: il robots.txt di Facebook esclude sia la ricerca sia le pagine dei singoli annunci (verificato il 15/11/2026), e la consultazione richiede un account. Lo Scout non aggira questi limiti, quindi nemmeno l\'aggiunta di un link riesce a leggere la pagina.',
    alt: 'Link incollato a mano: la scheda resta "non verificata" e i dati (nome, prezzo, luogo) li compili tu.', probe: null },
];

module.exports = { amParseSearch, amParseDetail, rcParseSearch, rcParseDetail, adapters, byId, adapterFor, readListing, verify, keyFor, normalizeUrl, registry, REASONS, maskContacts };
