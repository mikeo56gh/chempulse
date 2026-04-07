// api/markets.js — Live commodity prices for ChemPulse
// Sources:
//   OilPriceAPI  — energy & gas prices (OILPRICE_API_KEY env var)
//   metals.dev   — palladium, platinum, rhodium (METALS_DEV_API_KEY env var)
//   ICIS RSS     — chemical market headlines (free, no key)

export const config = { maxDuration: 25 };

const OIL_KEY    = process.env.OILPRICE_API_KEY;
const METALS_KEY = process.env.METALS_DEV_API_KEY;

// Current indicative prices for chemicals with no live API
// Update quarterly from ICIS/Argus free previews
const INDICATIVE = {
  caustic_soda:   { price: 310,  unit: '€/mt',  label: 'Caustic Soda (NWE)',       updated: 'Q1 2026', source: 'ICIS' },
  sulphuric_acid: { price: 130,  unit: '€/mt',  label: 'Sulphuric Acid (Europe)',   updated: 'Q1 2026', source: 'ICIS' },
  ethanol_uk:     { price: 650,  unit: '£/mt',  label: 'Ethanol Denatured (UK)',    updated: 'Q1 2026', source: 'ICIS' },
  methanol_nwe:   { price: 380,  unit: '€/mt',  label: 'Methanol (NWE)',            updated: 'Q1 2026', source: 'ICIS' },
  ethylene_nwe:   { price: 780,  unit: '$/mt',  label: 'Ethylene (NWE)',            updated: 'Q1 2026', source: 'ICIS' },
  propylene_nwe:  { price: 710,  unit: '$/mt',  label: 'Propylene (NWE)',           updated: 'Q1 2026', source: 'ICIS' },
  benzene_ara:    { price: 820,  unit: '$/mt',  label: 'Benzene (ARA)',             updated: 'Q1 2026', source: 'ICIS' },
  ammonia_bs:     { price: 310,  unit: '$/mt',  label: 'Ammonia (Black Sea FOB)',   updated: 'Q1 2026', source: 'ICIS' },
  naphtha_nwe:    { price: 620,  unit: '$/mt',  label: 'Naphtha (NWE)',             updated: 'Q1 2026', source: 'ICIS' },
  hydrogen_uk:    { price: 6.50, unit: '£/kg',  label: 'Hydrogen (UK grey)',        updated: 'Q1 2026', source: 'ICIS' },
  saf_nwe:        { price: 1800, unit: '$/mt',  label: 'SAF (NW Europe)',           updated: 'Q1 2026', source: 'Argus' },
  co2_food:       { price: 250,  unit: '€/mt',  label: 'CO₂ Food Grade (Europe)',  updated: 'Q1 2026', source: 'Market' },
  chlorine_nwe:   { price: 290,  unit: '€/mt',  label: 'Chlorine (W. Europe)',      updated: 'Q1 2026', source: 'ICIS' },
};

async function fetchOilPrices() {
  if (!OIL_KEY) return {};
  const codes = [
    'BRENT_CRUDE_USD', 'NATURAL_GAS_GBP', 'DUTCH_TTF_EUR',
    'EU_CARBON_EUR', 'ETHANOL_USD', 'JET_FUEL_USD', 'DIESEL_USD'
  ];
  const results = {};
  const fetches = codes.map(code =>
    fetch(`https://api.oilpriceapi.com/v1/prices/latest?by_code=${code}`, {
      headers: { 'Authorization': `Token ${OIL_KEY}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(8000)
    })
    .then(r => r.json())
    .then(d => d.data ? { code, data: d.data } : null)
    .catch(() => null)
  );
  const settled = await Promise.allSettled(fetches);
  settled.forEach(s => {
    if (s.status === 'fulfilled' && s.value) {
      const { code, data } = s.value;
      results[code] = {
        price: data.price,
        currency: data.currency,
        unit: data.unit,
        date: data.created_at?.slice(0, 10),
        source: 'OilPriceAPI'
      };
    }
  });
  return results;
}

async function fetchMetals() {
  if (!METALS_KEY) return {};
  try {
    const r = await fetch(
      `https://metals.dev/api/latest?api_key=${METALS_KEY}&currency=USD&unit=toz`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!r.ok) return {};
    const d = await r.json();
    const m = d.metals || {};
    const results = {};
    if (m.palladium) results.XPD = { price: m.palladium, currency: 'USD', unit: 'troy oz', label: 'Palladium', source: 'metals.dev' };
    if (m.platinum)  results.XPT = { price: m.platinum,  currency: 'USD', unit: 'troy oz', label: 'Platinum',  source: 'metals.dev' };
    if (m.rhodium)   results.XRH = { price: m.rhodium,   currency: 'USD', unit: 'troy oz', label: 'Rhodium',   source: 'metals.dev' };
    if (m.gold)      results.XAU = { price: m.gold,      currency: 'USD', unit: 'troy oz', label: 'Gold',      source: 'metals.dev' };
    return results;
  } catch(e) { return {}; }
}

async function fetchIcisHeadlines() {
  // Try ICIS news RSS — free, no key needed
  const FEEDS = [
    'https://www.icis.com/explore/resources/news/feed/',
    'https://www.icis.com/explore/resources/news/feed/?sector=chemicals',
  ];
  const KEYWORDS = ['caustic','sulphuric','sulfuric','methanol','ethanol','ammonia',
    'naphtha','hydrogen','saf','sustainable aviation','co2','carbon dioxide',
    'ethylene','propylene','benzene','chlorine','feedstock','chemical price'];

  for (const url of FEEDS) {
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': 'ChemPulse/1.0 (intelligence platform)', 'Accept': 'application/rss+xml,text/xml' },
        signal: AbortSignal.timeout(8000)
      });
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
          t.includes('caustic') || t.includes('sodium hydroxide') ? 'Caustic Soda' :
          t.includes('sulphuric') || t.includes('sulfuric')       ? 'Sulphuric Acid' :
          t.includes('methanol')  ? 'Methanol'  :
          t.includes('ethanol')   ? 'Ethanol'   :
          t.includes('ammonia')   ? 'Ammonia'   :
          t.includes('naphtha')   ? 'Naphtha'   :
          t.includes('hydrogen')  ? 'Hydrogen'  :
          t.includes('saf') || t.includes('sustainable aviation') ? 'SAF' :
          t.includes('co2') || t.includes('carbon dioxide')       ? 'CO₂' :
          t.includes('ethylene')  ? 'Ethylene'  :
          t.includes('propylene') ? 'Propylene' :
          t.includes('benzene')   ? 'Benzene'   :
          t.includes('chlorine')  ? 'Chlorine'  :
          'Chemical Market';
        const signal =
          /increas|ris(e|ing)|higher|up\b|gain|firm|strong/.test(t) ? 'up'   :
          /declin|fall|lower|down\b|weak|soft|drop/.test(t)         ? 'down' : 'neutral';
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

  const [energy, metals, headlines] = await Promise.all([
    fetchOilPrices(),
    fetchMetals(),
    fetchIcisHeadlines()
  ]);

  res.status(200).json({
    energy,
    metals,
    indicative: INDICATIVE,
    headlines,
    meta: {
      has_oil_key:    !!OIL_KEY,
      has_metals_key: !!METALS_KEY,
      asOf: new Date().toISOString()
    }
  });
}
