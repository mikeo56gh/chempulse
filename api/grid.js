// api/grid.js — Grid Intelligence for ChemPulse
// Elexon BMRS: fuel mix, wind/solar forecast, REMIT outages
// All free, no API key required

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
// Uses datasets/REMIT with from/to/bmUnit — same pattern as ccgt.js which works

async function fetchREMIT(now) {
  const from30d = new Date(now - 30 * 86400000).toISOString().split("T")[0];
  const to30d   = new Date(now + 30 * 86400000).toISOString().split("T")[0];

  // Use prefix queries (T_SCCL not T_SCCL-1) — matches all units, same as ccgt.js
  const PREFIXES = [
    { bmu: "T_SCCL",  name: "Saltend (Triton Power)", site: "Saltend Chemicals Park" },
    { bmu: "T_KILNO", name: "Killingholme A",          site: "South Humber Bank" },
    { bmu: "T_KILNS", name: "Killingholme B",          site: "South Humber Bank" },
    { bmu: "T_KEAD",  name: "Keadby",                  site: "Scunthorpe / Humber" },
    { bmu: "T_SOHU",  name: "South Humber Bank",        site: "South Humber Bank" },
    { bmu: "T_TEAB",  name: "Teesside Power",           site: "Teesside" },
  ];

  // Individual asset lookup for display names
  const ASSETS = [
    { bmu: "T_SCCL-1",  name: "Saltend Unit 1",    site: "Saltend Chemicals Park" },
    { bmu: "T_SCCL-2",  name: "Saltend Unit 2",    site: "Saltend Chemicals Park" },
    { bmu: "T_SCCL-3",  name: "Saltend Unit 3",    site: "Saltend Chemicals Park" },
    { bmu: "T_KILNO-1", name: "Killingholme A",     site: "South Humber Bank" },
    { bmu: "T_KILNS-1", name: "Killingholme B",     site: "South Humber Bank" },
    { bmu: "T_KEAD-1",  name: "Keadby 1",          site: "Scunthorpe / Humber" },
    { bmu: "T_KEAD-2",  name: "Keadby 2",          site: "Scunthorpe / Humber" },
    { bmu: "T_SOHU-1",  name: "South Humber Bank",  site: "South Humber Bank" },
    { bmu: "T_TEAB-1",  name: "Teesside Power",     site: "Teesside" },
  ];
  const metaMap = Object.fromEntries(ASSETS.map(a => [a.bmu, a]));
  // Prefix fallback
  PREFIXES.forEach(p => { metaMap[p.bmu] = p; });

  const allItems = [];
  await Promise.allSettled(PREFIXES.map(async pfx => {
    try {
      const url = `${BASE}/datasets/REMIT?from=${from30d}&to=${to30d}&bmUnit=${pfx.bmu}`;
      const r = await ft(url, 8000);
      if (!r.ok) return;
      const d = await r.json();
      (d.data || d.items || []).forEach(i => allItems.push({ ...i, _meta: pfx }));
    } catch(e) {}
  }));

  const nowMs = now.getTime();
  const notices = allItems.map(i => {
    const meta  = i._meta;
    const start = i.eventStartTime || i.eventStart || i.effectiveFrom || "";
    const end   = i.eventEndTime   || i.eventEnd   || i.effectiveTo   || "";
    const sMs   = start ? new Date(start).getTime() : 0;
    const eMs   = end   ? new Date(end).getTime()   : 0;
    return {
      bmu:            i.bmUnit || i.assetId || meta.bmu,
      plant_name:     meta.name,
      chemical_site:  meta.site,
      type:           i.unavailabilityType || i.outageType || i.messageType || "",
      reason:         i.cause || i.reasonForUnavailability || i.messageHeading || "",
      unavailable_mw: i.unavailableCapacity ?? i.unavailableCapacityMW ?? null,
      normal_mw:      i.normalCapacity ?? null,
      available_mw:   i.availableCapacity ?? null,
      event_status:   i.eventStatus || "",
      start, end,
      active:   sMs > 0 && eMs > 0 && sMs <= nowMs && eMs >= nowMs,
      upcoming: sMs > nowMs,
      ended:    eMs > 0 && eMs < nowMs,
    };
  }).filter(n => n.bmu);

  notices.sort((a, b) => {
    if (a.active   && !b.active)   return -1;
    if (!a.active  && b.active)    return 1;
    if (a.upcoming && !b.upcoming) return -1;
    if (!a.upcoming && b.upcoming) return 1;
    return new Date(b.start) - new Date(a.start);
  });

  return {
    total_found:      notices.length,
    notices:          notices.slice(0, 40),
    monitored_count:  ASSETS.length,
    debug: {
      total_raw:      allItems.length,
      from:           from30d,
      to:             to30d,
      assets_queried: ASSETS.map(a => a.bmu),
    },
  };
}
