// api/energy.js
// Fetches real energy data from free APIs:
// - Carbon Intensity API (NESO) - no key needed
// - National Grid ESO - no key needed  
// - EIA (Brent crude) - free key via env var EIA_API_KEY (optional)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const results = {};

  // 1. UK Grid Carbon Intensity (completely free, no key)
  try {
    const r = await fetch('https://api.carbonintensity.org.uk/intensity', {
      headers: { 'Accept': 'application/json' }
    });
    const d = await r.json();
    const data = d.data?.[0];
    if (data) {
      results.carbon_intensity = {
        actual: data.intensity?.actual,
        forecast: data.intensity?.forecast,
        index: data.intensity?.index, // 'low','moderate','high','very high'
        from: data.from,
        to: data.to
      };
    }
  } catch (e) {
    results.carbon_intensity_error = e.message;
  }

  // 2. UK Grid Regional Carbon Intensity
  try {
    const r = await fetch('https://api.carbonintensity.org.uk/regional', {
      headers: { 'Accept': 'application/json' }
    });
    const d = await r.json();
    // Find Yorkshire & East Midlands (relevant for Humber cluster)
    const regions = d.data?.[0]?.regions || [];
    const yorkshire = regions.find(r => r.shortname === 'Yorkshire');
    const eastMid = regions.find(r => r.shortname === 'East Midlands');
    if (yorkshire) results.yorkshire_intensity = { intensity: yorkshire.intensity?.forecast, index: yorkshire.intensity?.index };
    if (eastMid) results.east_midlands_intensity = { intensity: eastMid.intensity?.forecast, index: eastMid.intensity?.index };
  } catch (e) {}

  // 3. National Grid ESO - generation mix & demand
  try {
    const url = 'https://api.nationalgrideso.com/api/3/action/datastore_search?resource_id=7c0411cd-2714-4bb5-a408-adb065edf34d&limit=1&sort=settlement_date desc,settlement_period desc';
    const r = await fetch(url);
    const d = await r.json();
    const rec = d.result?.records?.[0];
    if (rec) {
      results.grid = {
        demand_mw: rec.transmission_system_demand || rec.nd,
        wind_forecast_mw: rec.wind_forecast || rec.wind,
        settlement_date: rec.settlement_date,
        settlement_period: rec.settlement_period
      };
    }
  } catch (e) {
    results.grid_error = e.message;
  }

  // 4. Elexon BMRS - wind & solar day-ahead forecast (no key needed for this endpoint)
  try {
    const today = new Date().toISOString().split('T')[0];
    const r = await fetch(`https://data.elexon.co.uk/bmrs/api/v1/forecast/generation/wind-and-solar/day-ahead?from=${today}&to=${today}&processType=Day%20Ahead`);
    if (r.ok) {
      const d = await r.json();
      const latest = d.data?.[0];
      if (latest) results.wind_solar_forecast = { wind_mw: latest.wind, solar_mw: latest.solar, publishTime: latest.publishTime };
    }
  } catch (e) {}

  // 5. EIA Brent Crude (free API key - use env var or return cached value)
  const eiaKey = process.env.EIA_API_KEY;
  if (eiaKey) {
    try {
      const r = await fetch(`https://api.eia.gov/v2/petroleum/pri/spt/data/?api_key=${eiaKey}&frequency=daily&data[0]=value&facets[series][]=RBRTE&sort[0][column]=period&sort[0][direction]=desc&offset=0&length=1`);
      const d = await r.json();
      const latest = d.response?.data?.[0];
      if (latest) results.brent_crude = { price: latest.value, currency: 'USD', unit: 'barrel', date: latest.period };
    } catch (e) {}
  } else {
    // Return indicative value when no key
    results.brent_crude = { price: 82.40, currency: 'USD', unit: 'barrel', note: 'indicative — add EIA_API_KEY env var for live data' };
  }

  res.status(200).json(results);
}
