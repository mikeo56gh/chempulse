// api/grid.js — Grid Intelligence for ChemPulse
// Elexon BMRS: fuel mix, wind/solar forecast, REMIT outages
// All free, no API key required

export const config = { maxDuration: 60 };  // REMIT does ~225 sequential API calls

const BASE = 'https://data.elexon.co.uk/bmrs/api/v1';

const HUMBER_BMUS = [
  { id: 'T_SCCL-1',  name: 'Saltend (Triton Power)',  site: 'Saltend Chemicals Park' },
  { id: 'T_SCCL-2',  name: 'Saltend (Triton Power)',  site: 'Saltend Chemicals Park' },
  { id: 'T_SCCL-3',  name: 'Saltend (Triton Power)',  site: 'Saltend Chemicals Park' },
  { id: 'T_KILNO-1', name: 'Killingholme A',          site: 'South Humber Bank' },
  { id: 'T_KILNS-1', name: 'Killingholme B',          site: 'South Humber Bank' },
  { id: 'T_KEAD-1',  name: 'Keadby 1',               site: 'Scunthorpe / Humber' },
  { id: 'T_KEAD-2',  name: 'Keadby 2 (CCGT)',        site: 'Scunthorpe / Humber' },
  { id: 'T_SOHU-1',  name: 'South Humber Bank',       site: 'South Humber Bank' },
];
const TEESSIDE_BMUS = [
  { id: 'T_TEAB-1',  name: 'Teesside Power',          site: 'Teesside chemical cluster' },
  { id: 'T_CARR-1',  name: 'Hartlepool (EDF)',         site: 'Teesside' },
];
const ALL_MONITORED = [...HUMBER_BMUS, ...TEESSIDE_BMUS];

function ft(url, ms = 9000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { headers: { Accept: 'application/json' }, signal: ctrl.signal })
    .finally(() => clearTimeout(t));
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const tomorrow = new Date(now.getTime() + 86400000).toISOString().split('T')[0];

  const [fuelR, windR, remitR] = await Promise.allSettled([
    fetchFuelMix(now),
    fetchWindSolarForecast(today, tomorrow),
    fetchREMIT(now),
  ]);

  res.status(200).json({
    asOf: now.toISOString(),
    source: 'Elexon BMRS — free, no key',
    fuel_mix:       fuelR.status  === 'fulfilled' ? fuelR.value  : null,
    fuel_error:     fuelR.status  === 'rejected'  ? fuelR.reason?.message : undefined,
    wind_forecast:  windR.status  === 'fulfilled' ? windR.value  : null,
    wind_error:     windR.status  === 'rejected'  ? windR.reason?.message : undefined,
    remit:          remitR.status === 'fulfilled' ? remitR.value : null,
    remit_error:    remitR.status === 'rejected'  ? remitR.reason?.message : undefined,
  });
}

// ── FUELHH ────────────────────────────────────────────────────────────────────

async function fetchFuelMix(now) {
  const from = new Date(now - 25 * 60 * 60 * 1000).toISOString();
  const r = await ft(`${BASE}/datasets/FUELHH?from=${from}&to=${now.toISOString()}`);
  if (!r.ok) throw new Error(`FUELHH ${r.status}`);
  const d = await r.json();
  const items = d.data || d.items || [];

  const byPeriod = {};
  items.forEach(i => {
    const key = `${i.settlementDate}_${String(i.settlementPeriod).padStart(3,'0')}`;
    if (!byPeriod[key]) byPeriod[key] = { date: i.settlementDate, period: i.settlementPeriod, fuels: {} };
    const fuel = (i.fuelType || '').toUpperCase();
    byPeriod[key].fuels[fuel] = (byPeriod[key].fuels[fuel] || 0) + (i.generation || i.quantity || 0);
  });

  const periods = Object.values(byPeriod).sort((a, b) =>
    `${b.date}_${String(b.period).padStart(3,'0')}`.localeCompare(`${a.date}_${String(a.period).padStart(3,'0')}`)
  );
  if (!periods.length) throw new Error('No FUELHH data');

  const f     = periods[0].fuels;
  const total = Object.values(f).reduce((s, v) => s + v, 0) || 1;

  const gas     = (f['CCGT']||0) + (f['OCGT']||0) + (f['GAS']||0);
  const wind    = (f['WIND']||0) + (f['OFFSHORE WIND']||0);
  const nuclear = f['NUCLEAR'] || f['NUC'] || 0;
  const solar   = f['SOLAR'] || 0;
  const coal    = (f['COAL']||0) + (f['OIL']||0);
  const biomass = f['BIOMASS'] || 0;
  const hydro   = f['NPSHYD'] || 0;
  const pumped  = f['PS'] || 0;
  const intFR   = f['INTFR']  || 0;
  const intIRL  = f['INTIRL'] || 0;
  const intNED  = f['INTNED'] || 0;
  const intEW   = f['INTEW']  || 0;
  const intNEM  = f['INTNEM'] || 0;
  const intVKL  = f['INTVKL'] || 0;
  const imports  = intFR + intIRL + intNED + intEW + intNEM + intVKL;
  const other    = Math.max(0, total - gas - wind - nuclear - solar - coal - biomass - hydro - pumped - imports);

  const pct = v => total > 0 ? Math.round((v / total) * 100) : 0;
  const gasPct = pct(gas);

  const history = periods.slice(0, 48).reverse().map(p => {
    const pt = Object.values(p.fuels).reduce((s,v) => s+v, 0) || 1;
    const pg = (p.fuels['CCGT']||0) + (p.fuels['OCGT']||0) + (p.fuels['GAS']||0);
    const pw = (p.fuels['WIND']||0) + (p.fuels['OFFSHORE WIND']||0);
    return { date: p.date, period: p.period, gas_pct: Math.round((pg/pt)*100), wind_pct: Math.round((pw/pt)*100) };
  });

  return {
    settlement_date: periods[0].date,
    settlement_period: periods[0].period,
    total_mw: Math.round(total),
    gas_mw: Math.round(gas),         gas_pct: gasPct,
    wind_mw: Math.round(wind),       wind_pct: pct(wind),
    nuclear_mw: Math.round(nuclear), nuclear_pct: pct(nuclear),
    solar_mw: Math.round(solar),     solar_pct: pct(solar),
    coal_mw: Math.round(coal),       coal_pct: pct(coal),
    biomass_mw: Math.round(biomass), biomass_pct: pct(biomass),
    hydro_mw: Math.round(hydro+pumped), hydro_pct: pct(hydro+pumped),
    imports_mw: Math.round(imports), imports_pct: pct(imports),
    other_mw: Math.round(other),     other_pct: pct(other),
    interconnectors: {
      france_mw:      Math.round(intFR),
      ireland_mw:     Math.round(intIRL + intEW),
      netherlands_mw: Math.round(intNED),
      belgium_mw:     Math.round(intNEM),
      denmark_mw:     Math.round(intVKL),
    },
    cost_pressure: gasPct > 45 ? 'high' : gasPct > 25 ? 'medium' : 'low',
    history,
  };
}

// ── WIND/SOLAR FORECAST (Elexon BMRS — same source as Weather tab) ────────────

async function fetchWindSolarForecast(today, tomorrow) {
  const url = `${BASE}/forecast/generation/wind-and-solar/day-ahead` +
    `?from=${today}&to=${tomorrow}&processType=Day%20Ahead`;
  const r = await ft(url);
  if (!r.ok) throw new Error(`Wind/Solar forecast ${r.status}`);
  const d = await r.json();
  const items = (d.data || []).sort((a, b) => new Date(a.startTime||a.publishTime||0) - new Date(b.startTime||b.publishTime||0));
  if (!items.length) throw new Error('No wind/solar forecast data');

  const records = items.map(i => ({
    time: i.startTime || i.publishTime || '',
    wind_mw: Math.round(i.wind || i.windGeneration || 0),
    solar_mw: Math.round(i.solar || i.solarGeneration || 0),
  }));

  const windVals = records.map(r => r.wind_mw).filter(v => v > 0);
  const avgWind = windVals.length ? Math.round(windVals.reduce((s,v) => s+v, 0) / windVals.length) : 0;
  const peakWind = Math.max(...windVals, 0);

  return {
    records,
    avg_wind_mw: avgWind,
    peak_wind_mw: peakWind,
    outlook: peakWind > 12000 ? 'HIGH — strong wind expected, lower power costs'
           : peakWind > 6000  ? 'MODERATE — mixed wind generation'
           : 'LOW — limited wind, gas likely dominant',
  };
}

// ── REMIT ─────────────────────────────────────────────────────────────────────
// Two-step flow with 7-day windows (Elexon enforces 7-day max per request)
// Step 1: /remit/list/by-publish?assetId=X&from=Y&to=Z → message IDs
// Step 2: /remit?messageId=A&messageId=B&... → full message details

async function fetchREMIT(now) {
  const WEEKS_BACK    = 12;  // 3 months of history
  const WEEKS_FORWARD = 13;  // ~3 months ahead (upcoming planned outages)

  // All 9 assets queried individually — API requires exact assetId, not prefix
  const ASSETS = [
    { id: "T_SCCL-1",  name: "Saltend Unit 1",    site: "Saltend Chemicals Park" },
    { id: "T_SCCL-2",  name: "Saltend Unit 2",    site: "Saltend Chemicals Park" },
    { id: "T_SCCL-3",  name: "Saltend Unit 3",    site: "Saltend Chemicals Park" },
    { id: "T_KILNO-1", name: "Killingholme A",     site: "South Humber Bank" },
    { id: "T_KILNS-1", name: "Killingholme B",     site: "South Humber Bank" },
    { id: "T_KEAD-1",  name: "Keadby 1",          site: "Scunthorpe / Humber" },
    { id: "T_KEAD-2",  name: "Keadby 2",          site: "Scunthorpe / Humber" },
    { id: "T_SOHU-1",  name: "South Humber Bank",  site: "South Humber Bank" },
    { id: "T_TEAB-1",  name: "Teesside Power",     site: "Teesside" },
  ];
  const assetMeta = Object.fromEntries(ASSETS.map(a => [a.id, a]));

  // Build weekly windows — API enforces 7-day max per request
  const windows = [];
  for (let w = -WEEKS_BACK; w < WEEKS_FORWARD; w++) {
    const from = new Date(now.getTime() + w * 7 * 86400000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const to   = new Date(now.getTime() + (w + 1) * 7 * 86400000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    windows.push({ from, to });
  }

  // Step 1: Collect message IDs in parallel
  // 9 assets × ~25 windows = 225 requests — run in chunks to avoid overwhelming the API
  const msgIds = new Set();
  const step1Stats = { requests: 0, ok: 0, errors: 0 };

  // Flatten asset×window pairs, then process in chunks of 20 concurrent
  const pairs = [];
  for (const asset of ASSETS) {
    for (const win of windows) {
      pairs.push({ asset, win });
    }
  }

  const CHUNK = 20;
  for (let i = 0; i < pairs.length; i += CHUNK) {
    const batch = pairs.slice(i, i + CHUNK);
    await Promise.allSettled(batch.map(async ({ asset, win }) => {
      step1Stats.requests++;
      try {
        const url = `${BASE}/remit/list/by-publish?from=${win.from}&to=${win.to}&assetId=${asset.id}&latestRevisionOnly=true&format=json`;
        const r = await ft(url, 7000);
        if (!r.ok) { step1Stats.errors++; return; }
        const d = await r.json();
        step1Stats.ok++;
        (d.data || []).forEach(m => { if (m.id) msgIds.add(m.id); });
      } catch(e) {
        step1Stats.errors++;
      }
    }));
  }

  if (!msgIds.size) {
    return {
      total_found: 0,
      notices: [],
      monitored_count: ASSETS.length,
      diagnostics: { step1: step1Stats, windows_tried: windows.length, assets_tried: ASSETS.length, note: 'No message IDs found across all windows' },
    };
  }

  // Step 2: Bulk fetch details in chunks of 50 IDs per request
  const idArr = [...msgIds];
  const allDetails = [];
  const BULK = 50;
  const step2Stats = { requests: 0, ok: 0, items: 0 };

  for (let i = 0; i < idArr.length; i += BULK) {
    const batch = idArr.slice(i, i + BULK);
    step2Stats.requests++;
    try {
      const qs = batch.map(id => `messageId=${id}`).join('&');
      const r = await ft(`${BASE}/remit?${qs}&format=json`, 15000);
      if (!r.ok) continue;
      const d = await r.json();
      step2Stats.ok++;
      (d.data || []).forEach(m => allDetails.push(m));
      step2Stats.items += (d.data || []).length;
    } catch(e) {}
  }

  // Normalise using exact field names from API schema
  const nowMs = now.getTime();
  const notices = allDetails.map(m => {
    const bmu   = m.assetId || m.affectedUnit || '';
    const meta  = assetMeta[bmu] || { name: bmu, site: 'Humber / Teesside' };
    const start = m.eventStartTime || '';
    const end   = m.eventEndTime   || '';
    const sMs   = start ? new Date(start).getTime() : 0;
    const eMs   = end   ? new Date(end).getTime()   : 0;
    return {
      bmu,
      plant_name:     meta.name,
      chemical_site:  meta.site,
      type:           m.unavailabilityType || m.messageType || '',
      reason:         m.cause || m.messageHeading || m.relatedInformation || '',
      event_type:     m.eventType || '',
      fuel_type:      m.fuelType || '',
      unavailable_mw: m.unavailableCapacity ?? null,
      normal_mw:      m.normalCapacity ?? null,
      available_mw:   m.availableCapacity ?? null,
      event_status:   m.eventStatus || '',
      publish_time:   m.publishTime || m.createdTime || '',
      start, end,
      active:   sMs > 0 && eMs > 0 && sMs <= nowMs && eMs >= nowMs,
      upcoming: sMs > nowMs,
      ended:    eMs > 0 && eMs < nowMs,
    };
  }).filter(n => n.bmu && assetMeta[n.bmu]); // only keep our monitored assets

  // Sort: active → upcoming (by start asc) → ended (by end desc)
  notices.sort((a, b) => {
    if (a.active   && !b.active)   return -1;
    if (!a.active  && b.active)    return 1;
    if (a.upcoming && !b.upcoming) return -1;
    if (!a.upcoming && b.upcoming) return 1;
    if (a.upcoming && b.upcoming) return new Date(a.start) - new Date(b.start);
    return new Date(b.start) - new Date(a.start);
  });

  return {
    total_found:     notices.length,
    notices:         notices.slice(0, 50),
    monitored_count: ASSETS.length,
    diagnostics: {
      step1: step1Stats,
      step2: step2Stats,
      unique_ids: msgIds.size,
      raw_details: allDetails.length,
      after_filter: notices.length,
    },
  };
}
