// api/grid.js — Grid Intelligence for ChemPulse
// Sources: Elexon BMRS (fuel mix, REMIT, temp) + NESO (wind/demand forecast)
// All free, no API key required

const BASE      = 'https://data.elexon.co.uk/bmrs/api/v1';
const NESO_BASE = 'https://api.neso.energy/api/3/action/datastore_search';

const HUMBER_BMUS = [
  { id: 'T_SCCL-1',  name: 'Saltend (Triton Power)',   site: 'Saltend Chemicals Park' },
  { id: 'T_SCCL-2',  name: 'Saltend (Triton Power)',   site: 'Saltend Chemicals Park' },
  { id: 'T_SCCL-3',  name: 'Saltend (Triton Power)',   site: 'Saltend Chemicals Park' },
  { id: 'T_KILNO-1', name: 'Killingholme A',           site: 'South Humber Bank' },
  { id: 'T_KILNS-1', name: 'Killingholme B',           site: 'South Humber Bank' },
  { id: 'T_KEAD-1',  name: 'Keadby 1',                site: 'Scunthorpe / Humber' },
  { id: 'T_KEAD-2',  name: 'Keadby 2 (CCGT)',         site: 'Scunthorpe / Humber' },
  { id: 'T_SOHU-1',  name: 'South Humber Bank',        site: 'South Humber Bank' },
];
const TEESSIDE_BMUS = [
  { id: 'T_TEAB-1',  name: 'Teesside Power',           site: 'Teesside chemical cluster' },
  { id: 'T_CARR-1',  name: 'Hartlepool (EDF)',          site: 'Teesside' },
];
const ALL_MONITORED = [...HUMBER_BMUS, ...TEESSIDE_BMUS];

function ft(url, ms = 8000) {
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

  const [fuelR, tempR, remitR, windFcR, demandFcR] = await Promise.allSettled([
    fetchFuelMix(now),
    fetchTemp(now),
    fetchREMIT(now),
    fetchWindForecast(),
    fetchDemandForecast(),
  ]);

  res.status(200).json({
    asOf: now.toISOString(),
    source: 'Elexon BMRS + NESO Data Portal — free, no key',
    fuel_mix:        fuelR.status  === 'fulfilled' ? fuelR.value  : null,
    fuel_error:      fuelR.status  === 'rejected'  ? fuelR.reason?.message : undefined,
    temperature:     tempR.status  === 'fulfilled' ? tempR.value  : null,
    temp_error:      tempR.status  === 'rejected'  ? tempR.reason?.message : undefined,
    remit:           remitR.status === 'fulfilled' ? remitR.value : null,
    remit_error:     remitR.status === 'rejected'  ? remitR.reason?.message : undefined,
    wind_forecast:   windFcR.status  === 'fulfilled' ? windFcR.value  : null,
    demand_forecast: demandFcR.status === 'fulfilled' ? demandFcR.value : null,
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
  const solar   = f['SOLAR']||0;
  const coal    = (f['COAL']||0) + (f['OIL']||0);
  const biomass = f['BIOMASS']||0;
  const hydro   = f['NPSHYD']||0;
  const pumped  = f['PS']||0;
  // Individual interconnectors
  const intFR   = f['INTFR']||0;    // France (IFA1 + IFA2 + ElecLink)
  const intIRL  = f['INTIRL']||0;   // Ireland (Moyle)
  const intNED  = f['INTNED']||0;   // Netherlands (BritNed)
  const intEW   = f['INTEW']||0;    // East-West (Ireland)
  const intNEM  = f['INTNEM']||0;   // NEMO (Belgium)
  const intVKL  = f['INTVKL']||0;   // Viking (Denmark)
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
    gas_mw: Math.round(gas),       gas_pct: gasPct,
    wind_mw: Math.round(wind),     wind_pct: pct(wind),
    nuclear_mw: Math.round(nuclear), nuclear_pct: pct(nuclear),
    solar_mw: Math.round(solar),   solar_pct: pct(solar),
    coal_mw: Math.round(coal),     coal_pct: pct(coal),
    biomass_mw: Math.round(biomass), biomass_pct: pct(biomass),
    hydro_mw: Math.round(hydro+pumped), hydro_pct: pct(hydro+pumped),
    imports_mw: Math.round(imports), imports_pct: pct(imports),
    other_mw: Math.round(other),   other_pct: pct(other),
    // Interconnector breakdown
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

// ── TEMPERATURE ───────────────────────────────────────────────────────────────

async function fetchTemp(now) {
  const from = new Date(now - 8 * 24 * 60 * 60 * 1000).toISOString();
  const r = await ft(`${BASE}/datasets/TEMP?from=${from}&to=${now.toISOString()}`);
  if (!r.ok) throw new Error(`TEMP ${r.status}`);
  const d = await r.json();
  const items = (d.data || d.items || []).sort((a, b) =>
    new Date(b.settlementDate || b.publishTime || 0) - new Date(a.settlementDate || a.publishTime || 0)
  );
  if (!items.length) throw new Error('No TEMP data');
  const latest = items[0];
  const actual  = latest.temperature ?? latest.temperatureValue ?? latest.actualTemperature ?? null;
  const normal  = latest.normalDayTemperature ?? latest.normalTemperature ?? null;
  const deviation = (actual !== null && normal !== null) ? +(actual - normal).toFixed(1) : null;
  return {
    date: latest.settlementDate || '',
    actual_c: actual !== null ? +Number(actual).toFixed(1) : null,
    normal_c: normal !== null ? +Number(normal).toFixed(1) : null,
    deviation_c: deviation,
    demand_signal: !deviation ? 'unknown' : deviation < -3 ? 'very_cold' : deviation < -1 ? 'cold' : deviation > 3 ? 'very_hot' : deviation > 1 ? 'warm' : 'normal',
    chemical_impact: !deviation ? 'Temperature data unavailable.'
      : deviation < -2 ? 'Cold snap — elevated heating gas demand competing with industrial users. Monitor interruptible contract status.'
      : deviation > 2  ? 'Warm spell — increased cooling water demand. Check river temperatures and abstraction licence headroom.'
      : 'Temperature near seasonal normal — no unusual demand pressure.',
    history: items.slice(0, 7).reverse().map(i => ({
      date: i.settlementDate || '',
      actual: i.temperature ?? i.temperatureValue ?? null,
      normal: i.normalDayTemperature ?? i.normalTemperature ?? null,
    })),
  };
}

// ── WIND FORECAST (NESO) ──────────────────────────────────────────────────────

async function fetchWindForecast() {
  // NESO Day Ahead Wind Forecast — resource b2f03146-f05d-4824-a663-3a4f36090c71
  // Also fetch 2-day ahead demand forecast for context
  const windUrl    = `${NESO_BASE}?resource_id=b2f03146-f05d-4824-a663-3a4f36090c71&limit=96&sort=_id%20desc`;
  const r = await ft(windUrl, 8000);
  if (!r.ok) throw new Error(`Wind forecast ${r.status}`);
  const d = await r.json();
  const records = d.result?.records || [];
  if (!records.length) throw new Error('No wind forecast data');

  // Sort by date/time ascending for charting
  const sorted = records
    .map(r => ({
      date: r.DATE || r.date || r.Datetime || '',
      wind_mw: parseFloat(r.WIND || r.Wind || r.wind_generation || 0),
      period: r.SETTLEMENT_PERIOD || r.settlementPeriod || '',
    }))
    .filter(r => r.date && r.wind_mw >= 0)
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .slice(0, 48); // next 24h at HH resolution

  const maxWind = Math.max(...sorted.map(r => r.wind_mw), 1);
  const avgWind = sorted.length ? sorted.reduce((s, r) => s + r.wind_mw, 0) / sorted.length : 0;
  const peakWind = sorted.reduce((best, r) => r.wind_mw > (best?.wind_mw || 0) ? r : best, null);

  return {
    records: sorted,
    avg_mw: Math.round(avgWind),
    peak_mw: Math.round(maxWind),
    peak_time: peakWind?.date || '',
    outlook: avgWind > 8000 ? 'HIGH — strong wind generation expected, lower cost pressure'
           : avgWind > 4000 ? 'MODERATE — mixed generation outlook'
           : 'LOW — limited wind generation, gas likely to dominate',
  };
}

// ── DEMAND FORECAST (NESO) ────────────────────────────────────────────────────

async function fetchDemandForecast() {
  // NESO 2-Day Ahead Demand Forecast — resource cda26f27-4bb6-4632-9fb5-2d029ca605e1
  const url = `${NESO_BASE}?resource_id=cda26f27-4bb6-4632-9fb5-2d029ca605e1&limit=96&sort=_id%20desc`;
  const r = await ft(url, 8000);
  if (!r.ok) throw new Error(`Demand forecast ${r.status}`);
  const d = await r.json();
  const records = d.result?.records || [];
  if (!records.length) throw new Error('No demand forecast data');

  const sorted = records
    .map(r => ({
      date: r.DATE || r.date || r.GDATETIME || '',
      demand_mw: parseFloat(r.NATIONAL_DEMAND || r.DEMAND || r.transmission_system_demand || 0),
      period: r.SETTLEMENT_PERIOD || '',
    }))
    .filter(r => r.date && r.demand_mw > 0)
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .slice(0, 48);

  const avgDemand = sorted.length ? sorted.reduce((s,r) => s + r.demand_mw, 0) / sorted.length : 0;
  const peakDemand = sorted.reduce((best, r) => r.demand_mw > (best?.demand_mw || 0) ? r : best, null);

  return {
    records: sorted,
    avg_mw: Math.round(avgDemand),
    peak_mw: Math.round(peakDemand?.demand_mw || 0),
    peak_time: peakDemand?.date || '',
  };
}

// ── REMIT ─────────────────────────────────────────────────────────────────────

async function fetchREMIT(now) {
  const from14 = new Date(now - 14 * 24 * 60 * 60 * 1000).toISOString();
  const to14   = new Date(now + 14 * 24 * 60 * 60 * 1000).toISOString();
  const from14d = from14.split('T')[0], to14d = to14.split('T')[0];

  const endpoints = [
    `${BASE}/datasets/REMIT?publishDateTimeFrom=${from14}&publishDateTimeTo=${to14}`,
    `${BASE}/datasets/REMIT?from=${from14d}&to=${to14d}`,
    `${BASE}/remit/list/by-publish?publishDateTimeFrom=${from14}&publishDateTimeTo=${to14}`,
    `${BASE}/datasets/REMIT?eventStartFrom=${from14d}&eventEndTo=${to14d}`,
  ];

  let items = [], lastError = '', successUrl = '';
  for (const url of endpoints) {
    try {
      const r = await ft(url, 7000);
      if (r.ok) { const d = await r.json(); items = d.data||d.items||d.remitList||[]; successUrl = url; break; }
      else lastError = `HTTP ${r.status}`;
    } catch(e) { lastError = e.message; }
  }

  const bmuSet  = new Set(ALL_MONITORED.map(b => b.id));
  const bmuMeta = ALL_MONITORED.reduce((m, b) => { m[b.id] = b; return m; }, {});
  const nowMs   = now.getTime();

  const relevant = items.filter(i => {
    const bmu = i.bmUnit || i.assetId || i.bmuName || '';
    return bmuSet.has(bmu) || [...bmuSet].some(id => bmu.startsWith(id.replace(/-\d+$/, '')));
  });

  const notices = relevant.slice(0, 20).map(i => {
    const bmu  = i.bmUnit || i.assetId || i.bmuName || '';
    const meta = bmuMeta[bmu] || { name: bmu, site: 'Humber / Teesside' };
    const start = i.eventStart || i.effectiveFrom || i.startTime || '';
    const end   = i.eventEnd   || i.effectiveTo   || i.endTime   || '';
    const active = start && end
      ? new Date(start).getTime() <= nowMs && new Date(end).getTime() >= nowMs
      : start ? new Date(start).getTime() <= nowMs : false;
    return {
      bmu, plant_name: meta.name, chemical_site: meta.site,
      type: i.outageType || i.messageType || 'Outage',
      reason: i.reasonForUnavailability || i.eventType || i.messageHeadline || '',
      unavailable_mw: i.unavailableCapacity ?? i.affectedCapacity ?? null,
      start, end, active,
    };
  }).sort((a, b) => a.active === b.active ? 0 : a.active ? -1 : 1);

  return {
    total_found: relevant.length, total_in_response: items.length,
    notices, monitored_count: ALL_MONITORED.length,
    success_url: successUrl || null, last_error: lastError || null,
  };
}
