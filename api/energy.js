// api/energy.js
// Energy market data for ChemPulse
// Live sources: Carbon Intensity API, National Grid ESO, Elexon BMRS
// Commodity prices: OilPriceAPI (add OILPRICE_API_KEY env var) or EIA fallback

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300'); // cache 5 min
  if (req.method === 'OPTIONS') return res.status(200).end();

  const results = {};
  const oilKey = process.env.OILPRICE_API_KEY;
  const eiaKey = process.env.EIA_API_KEY;

  // ── 1. OilPriceAPI — Brent, UK NBP, TTF, EU ETS (requires key) ────────────
  if (oilKey) {
    // Fetch all needed prices in parallel
    const codes = ['BRENT_CRUDE_USD', 'NATURAL_GAS_GBP', 'DUTCH_TTF_EUR', 'EU_CARBON_EUR'];
    const fetches = codes.map(code =>
      fetch(`https://api.oilpriceapi.com/v1/prices/latest?by_code=${code}`, {
        headers: { 'Authorization': `Token ${oilKey}`, 'Content-Type': 'application/json' }
      })
      .then(r => r.json())
      .then(d => ({ code, data: d.data }))
      .catch(() => ({ code, data: null }))
    );
    const priceResults = await Promise.allSettled(fetches);
    priceResults.forEach(r => {
      if (r.status !== 'fulfilled' || !r.value.data) return;
      const { code, data } = r.value;
      if (code === 'BRENT_CRUDE_USD') results.brent_crude = { price: data.price, currency: 'USD', unit: 'barrel', date: data.created_at?.slice(0,10), source: 'OilPriceAPI' };
      if (code === 'NATURAL_GAS_GBP') results.nbp_gas = { price: data.price, currency: 'GBp', unit: 'therm', date: data.created_at?.slice(0,10), source: 'OilPriceAPI' };
      if (code === 'DUTCH_TTF_EUR')   results.ttf_gas = { price: data.price, currency: 'EUR', unit: 'MWh', date: data.created_at?.slice(0,10), source: 'OilPriceAPI' };
      if (code === 'EU_CARBON_EUR')   results.eu_carbon = { price: data.price, currency: 'EUR', unit: 'tCO2', date: data.created_at?.slice(0,10), source: 'OilPriceAPI' };
    });
  } else if (eiaKey) {
    // EIA fallback for Brent only
    try {
      const r = await fetch(`https://api.eia.gov/v2/petroleum/pri/spt/data/?api_key=${eiaKey}&frequency=daily&data[0]=value&facets[series][]=RBRTE&sort[0][column]=period&sort[0][direction]=desc&offset=0&length=1`);
      const d = await r.json();
      const latest = d.response?.data?.[0];
      if (latest) results.brent_crude = { price: latest.value, currency: 'USD', unit: 'barrel', date: latest.period, source: 'EIA' };
    } catch(e) {}
  }

  // ── 2. UK Grid Carbon Intensity (free, no key) ────────────────────────────
  try {
    const r = await fetch('https://api.carbonintensity.org.uk/intensity', { headers: { 'Accept': 'application/json' } });
    const d = await r.json();
    const data = d.data?.[0];
    if (data) results.carbon_intensity = {
      actual: data.intensity?.actual, forecast: data.intensity?.forecast,
      index: data.intensity?.index, from: data.from, to: data.to
    };
  } catch(e) { results.carbon_intensity_error = e.message; }

  // ── 3. UK Grid Regional Carbon Intensity ─────────────────────────────────
  try {
    const r = await fetch('https://api.carbonintensity.org.uk/regional', { headers: { 'Accept': 'application/json' } });
    const d = await r.json();
    const regions = d.data?.[0]?.regions || [];
    const yorkshire = regions.find(r => r.shortname === 'Yorkshire');
    const eastMid   = regions.find(r => r.shortname === 'East Midlands');
    if (yorkshire) results.yorkshire_intensity = { intensity: yorkshire.intensity?.forecast, index: yorkshire.intensity?.index };
    if (eastMid)   results.east_midlands_intensity = { intensity: eastMid.intensity?.forecast, index: eastMid.intensity?.index };
  } catch(e) {}

  // ── 4. National Grid ESO — demand & wind forecast ─────────────────────────
  try {
    const url = 'https://api.nationalgrideso.com/api/3/action/datastore_search?resource_id=7c0411cd-2714-4bb5-a408-adb065edf34d&limit=1&sort=settlement_date desc,settlement_period desc';
    const r = await fetch(url);
    const d = await r.json();
    const rec = d.result?.records?.[0];
    if (rec) results.grid = {
      demand_mw: rec.transmission_system_demand || rec.nd,
      wind_forecast_mw: rec.wind_forecast || rec.wind,
      settlement_date: rec.settlement_date,
      settlement_period: rec.settlement_period
    };
  } catch(e) { results.grid_error = e.message; }

  // ── 5. Elexon BMRS — wind & solar day-ahead forecast ─────────────────────
  try {
    const today = new Date().toISOString().split('T')[0];
    const r = await fetch(`https://data.elexon.co.uk/bmrs/api/v1/forecast/generation/wind-and-solar/day-ahead?from=${today}&to=${today}&processType=Day%20Ahead`);
    if (r.ok) {
      const d = await r.json();
      const latest = d.data?.[0];
      if (latest) results.wind_solar_forecast = { wind_mw: latest.wind, solar_mw: latest.solar, publishTime: latest.publishTime };
    }
  } catch(e) {}

  res.status(200).json(results);
}
