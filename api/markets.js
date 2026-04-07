// api/markets.js — Live commodity prices for ChemPulse
// OilPriceAPI key: set OILPRICE_API_KEY in Vercel env vars
// metals.dev key:  set METALS_DEV_API_KEY in Vercel env vars (free)

export const config = { maxDuration: 25 };

const OIL_KEY    = process.env.OILPRICE_API_KEY;
const METALS_KEY = process.env.METALS_DEV_API_KEY;

const INDICATIVE = {
  caustic_soda:   { price: 248,  unit: '£/mt',  label: 'Caustic Soda (NWE)',      updated: 'Q1 2026', source: 'ICIS' },
  sulphuric_acid: { price: 103,  unit: '£/mt',  label: 'Sulphuric Acid (Europe)', updated: 'Q1 2026', source: 'ICIS' },
  ethanol_uk:     { price: 650,  unit: '£/mt',  label: 'Ethanol Denatured (UK)',  updated: 'Q1 2026', source: 'ICIS' },
  methanol_nwe:   { price: 300,  unit: '£/mt',  label: 'Methanol (NWE)',          updated: 'Q1 2026', source: 'ICIS' },
  ethylene_nwe:   { price: 615,  unit: '£/mt',  label: 'Ethylene (NWE)',          updated: 'Q1 2026', source: 'ICIS' },
  propylene_nwe:  { price: 560,  unit: '£/mt',  label: 'Propylene (NWE)',         updated: 'Q1 2026', source: 'ICIS' },
  benzene_ara:    { price: 645,  unit: '£/mt',  label: 'Benzene (ARA)',           updated: 'Q1 2026', source: 'ICIS' },
  ammonia_nwe:    { price: 245,  unit: '£/mt',  label: 'Ammonia (NW Europe)',     updated: 'Q1 2026', source: 'ICIS' },
  naphtha_nwe:    { price: 490,  unit: '£/mt',  label: 'Naphtha (NWE)',           updated: 'Q1 2026', source: 'ICIS' },
  hydrogen_uk:    { price: 6.50, unit: '£/kg',  label: 'Hydrogen (UK grey)',      updated: 'Q1 2026', source: 'ICIS' },
  saf_nwe:        { price: 1420, unit: '£/mt',  label: 'SAF (NW Europe)',         updated: 'Q1 2026', source: 'Argus' },
  co2_food:       { price: 197,  unit: '£/mt',  label: 'CO2 Food Grade',          updated: 'Q1 2026', source: 'Market' },
  chlorine_nwe:   { price: 229,  unit: '£/mt',  label: 'Chlorine (W. Europe)',    updated: 'Q1 2026', source: 'ICIS' },
};

async function oilFetch(code) {
  const r = await fetch('https://api.oilpriceapi.com/v1/prices/latest?by_code=' + code, {
    headers: { 'Authorization': 'Token ' + OIL_KEY, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(8000)
  });
  const d = await r.json();
  return d.data || null;
}

async function fetchOilPrices() {
  if (!OIL_KEY) return {};
  const codes = ['BRENT_CRUDE_USD','NATURAL_GAS_GBP','DUTCH_TTF_EUR','EU_CARBON_EUR','ETHANOL_USD','JET_FUEL_USD','DIESEL_USD','GBP_USD'];
  const fetches = codes.map(code => oilFetch(code).then(data => ({ code, data })).catch(() => ({ code, data: null })));
  const settled = await Promise.allSettled(fetches);
  const raw = {};
  settled.forEach(s => { if (s.status === 'fulfilled' && s.value.data) raw[s.value.code] = s.value.data; });

  const gbpUsd = raw.GBP_USD?.price || 0.79;
  const results = {};

  if (raw.NATURAL_GAS_GBP) results.NBP = {
    price: raw.NATURAL_GAS_GBP.price,
    display: Number(raw.NATURAL_GAS_GBP.price).toFixed(1) + 'p',
    unit: 'GBp/therm', currency: 'GBP',
    date: raw.NATURAL_GAS_GBP.created_at?.slice(0,10), source: 'OilPriceAPI'
  };

  if (raw.DUTCH_TTF_EUR) results.TTF = {
    price: raw.DUTCH_TTF_EUR.price,
    display: 'EUR ' + Number(raw.DUTCH_TTF_EUR.price).toFixed(2),
    unit: 'EUR/MWh', currency: 'EUR',
    date: raw.DUTCH_TTF_EUR.created_at?.slice(0,10), source: 'OilPriceAPI'
  };

  if (raw.BRENT_CRUDE_USD) {
    const gbp = (raw.BRENT_CRUDE_USD.price * gbpUsd).toFixed(2);
    results.BRENT = {
      price: gbp, priceUsd: raw.BRENT_CRUDE_USD.price,
      display: 'GBP ' + gbp,
      unit: 'GBP/bbl', currency: 'GBP',
      date: raw.BRENT_CRUDE_USD.created_at?.slice(0,10), source: 'OilPriceAPI'
    };
  }

  if (raw.EU_CARBON_EUR) results.ETS = {
    price: raw.EU_CARBON_EUR.price,
    display: 'EUR ' + Number(raw.EU_CARBON_EUR.price).toFixed(2),
    unit: 'EUR/tCO2', currency: 'EUR',
    date: raw.EU_CARBON_EUR.created_at?.slice(0,10), source: 'OilPriceAPI'
  };

  if (raw.ETHANOL_USD) {
    const gbpL = (raw.ETHANOL_USD.price * gbpUsd / 3.785).toFixed(3);
    results.ETHANOL = { price: gbpL, display: 'GBP ' + gbpL + '/L', unit: 'GBP/litre', currency: 'GBP', source: 'OilPriceAPI' };
  }

  if (raw.JET_FUEL_USD) {
    const gbpL = (raw.JET_FUEL_USD.price * gbpUsd / 3.785).toFixed(3);
    results.JET_FUEL = { price: gbpL, display: 'GBP ' + gbpL + '/L', unit: 'GBP/litre', currency: 'GBP', source: 'OilPriceAPI' };
  }

  if (raw.DIESEL_USD) {
    const gbpL = (raw.DIESEL_USD.price * gbpUsd / 3.785).toFixed(3);
    results.DIESEL = { price: gbpL, display: 'GBP ' + gbpL + '/L', unit: 'GBP/litre', currency: 'GBP', source: 'OilPriceAPI' };
  }

  results._gbp_usd = gbpUsd;
  return results;
}

async function fetchMetals() {
  if (!METALS_KEY) return {};
  try {
    const r = await fetch('https://metals.dev/api/latest?api_key=' + METALS_KEY + '&currency=GBP&unit=toz', { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return {};
    const d = await r.json();
    const m = d.metals || {};
    const results = {};
    const map = { palladium:'XPD', platinum:'XPT', rhodium:'XRH', gold:'XAU', silver:'XAG' };
    const labels = { XPD:'Palladium', XPT:'Platinum', XRH:'Rhodium', XAU:'Gold', XAG:'Silver' };
    const notes = {
      XPD: 'Hydrogenation & reforming catalyst',
      XPT: 'Hydrogen fuel cells, catalytic converters',
      XRH: 'Nitric acid production, automotive catalysis',
      XAU: 'Reference precious metal benchmark',
      XAG: 'Industrial catalyst'
    };
    Object.entries(map).forEach(([metal, code]) => {
      if (m[metal]) results[code] = {
        price: Number(m[metal]).toFixed(0),
        display: 'GBP ' + Number(m[metal]).toLocaleString('en-GB', {maximumFractionDigits:0}),
        unit: 'GBP/troy oz', currency: 'GBP', label: labels[code], note: notes[code], source: 'metals.dev'
      };
    });
    return results;
  } catch(e) { return {}; }
}

async function fetchIcisHeadlines() {
  const FEEDS = ['https://www.icis.com/explore/resources/news/feed/', 'https://www.icis.com/explore/resources/news/feed/?sector=chemicals'];
  const KEYWORDS = ['caustic','sulphuric','sulfuric','methanol','ethanol','ammonia','naphtha','hydrogen','saf','sustainable aviation','co2','carbon dioxide','ethylene','propylene','benzene','chlorine','feedstock','chemical price','palladium','platinum','natural gas','lng'];

  for (const url of FEEDS) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'ChemPulse/1.0', 'Accept': 'application/rss+xml,text/xml' }, signal: AbortSignal.timeout(8000) });
      if (!r.ok) continue;
      const xml = await r.text();
      const items = [];
      const itemRx = /<item>([\s\S]*?)<\/item>/g;
      let match;
      while ((match = itemRx.exec(xml)) !== null && items.length < 20) {
        const b = match[1];
        const title = (b.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/) || [])[1]?.trim();
        const link  = (b.match(/<link[^>]*>([\s\S]*?)<\/link>/) || [])[1]?.trim();
        const date  = (b.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/) || [])[1]?.trim();
        if (!title) continue;
        const t = title.toLowerCase();
        if (!KEYWORDS.some(k => t.includes(k))) continue;
        const commodity =
          t.includes('caustic') ? 'Caustic Soda' : t.includes('sulphuric') || t.includes('sulfuric') ? 'Sulphuric Acid' :
          t.includes('methanol') ? 'Methanol' : t.includes('ethanol') ? 'Ethanol' : t.includes('ammonia') ? 'Ammonia' :
          t.includes('naphtha') ? 'Naphtha' : t.includes('hydrogen') ? 'Hydrogen' :
          t.includes('saf') || t.includes('sustainable aviation') ? 'SAF' :
          t.includes('co2') || t.includes('carbon dioxide') ? 'CO2' :
          t.includes('ethylene') ? 'Ethylene' : t.includes('propylene') ? 'Propylene' :
          t.includes('benzene') ? 'Benzene' : t.includes('chlorine') ? 'Chlorine' :
          t.includes('palladium') ? 'Palladium' : t.includes('platinum') ? 'Platinum' :
          t.includes('natural gas') || t.includes('lng') ? 'Natural Gas' : 'Chemical Market';
        const signal = /increas|ris(e|ing)|higher|up\b|gain|firm|strong/.test(t) ? 'up' :
                       /declin|fall|lower|down\b|weak|soft|drop/.test(t) ? 'down' : 'neutral';
        items.push({ title, link, date, commodity, signal });
      }
      if (items.length > 0) return items;
    } catch(e) { continue; }
  }
  return [];
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const [energy, metals, headlines] = await Promise.all([fetchOilPrices(), fetchMetals(), fetchIcisHeadlines()]);

  res.status(200).json({
    energy, metals, indicative: INDICATIVE, headlines,
    meta: { has_oil_key: !!OIL_KEY, has_metals_key: !!METALS_KEY, gbp_usd: energy._gbp_usd || 0.79, asOf: new Date().toISOString() }
  });
}
