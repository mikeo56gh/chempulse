// api/grid.js
// Elexon BMRS — Grid intelligence for chemical industry
// FUELHH (fuel mix) + TEMP (temperature) + REMIT (regional outages)
// All free, no API key — data.elexon.co.uk/bmrs/api/v1
// Runs all three fetches in parallel to stay within Vercel timeout

const BASE = 'https://data.elexon.co.uk/bmrs/api/v1';

// Humber-area CCGTs — supply steam/power to chemical cluster
const HUMBER_BMUS = [
  { id: 'T_SCCL-1',  name: 'Saltend (Triton Power)',    site: 'Saltend Chemicals Park' },
  { id: 'T_SCCL-2',  name: 'Saltend (Triton Power)',    site: 'Saltend Chemicals Park' },
  { id: 'T_SCCL-3',  name: 'Saltend (Triton Power)',    site: 'Saltend Chemicals Park' },
  { id: 'T_KILNO-1', name: 'Killingholme A',            site: 'South Humber Bank' },
  { id: 'T_KILNS-1', name: 'Killingholme B',            site: 'South Humber Bank' },
  { id: 'T_KEAD-1',  name: 'Keadby 1',                 site: 'Scunthorpe / Humber' },
  { id: 'T_KEAD-2',  name: 'Keadby 2 (CCGT)',          site: 'Scunthorpe / Humber' },
  { id: 'T_SOHU-1',  name: 'South Humber Bank',         site: 'South Humber Bank industrial' },
];

const TEESSIDE_BMUS = [
  { id: 'T_TEAB-1',  name: 'Teesside Power',            site: 'Teesside chemical cluster' },
  { id: 'T_CARR-1',  name: 'Hartlepool (EDF)',           site: 'Teesside' },
];

const ALL_MONITORED = [...HUMBER_BMUS, ...TEESSIDE_BMUS];

function fetchWithTimeout(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { headers: { Accept: 'application/json' }, signal: controller.signal })
    .finally(() => clearTimeout(tid));
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const now = new Date();

  // Run all three in parallel — critical to avoid sequential timeout
  const [fuelResult, tempResult, remitResult] = await Promise.allSettled([
    fetchFuelMix(now),
    fetchTemp(now),
    fetchREMIT(now),
  ]);

  res.status(200).json({
    asOf: now.toISOString(),
    source: 'Elexon BMRS API — free, no key',
    fuel_mix: fuelResult.status === 'fulfilled' ? fuelResult.value : null,
    fuel_error: fuelResult.status === 'rejected' ? fuelResult.reason?.message : undefined,
    temperature: tempResult.status === 'fulfilled' ? tempResult.value : null,
    temp_error: tempResult.status === 'rejected' ? tempResult.reason?.message : undefined,
    remit: remitResult.status === 'fulfilled' ? remitResult.value : null,
    remit_error: remitResult.status === 'rejected' ? remitResult.reason?.message : undefined,
  });
}

// ── FUELHH ────────────────────────────────────────────────────────────────────

async function fetchFuelMix(now) {
  const from = new Date(now - 25 * 60 * 60 * 1000).toISOString();
  const r = await fetchWithTimeout(
    `${BASE}/datasets/FUELHH?from=${from}&to=${now.toISOString()}`,
    8000
  );
  if (!r.ok) throw new Error(`FUELHH ${r.status}`);
  const d = await r.json();
  const items = d.data || d.items || [];

  // Group by settlement period
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

  if (!periods.length) throw new Error('No FUELHH data returned');

  const latest = periods[0];
  const f = latest.fuels;
  const total = Object.values(f).reduce((s, v) => s + v, 0) || 1;

  const gas     = (f['CCGT'] || 0) + (f['OCGT'] || 0) + (f['GAS'] || 0);
  const wind    = (f['WIND'] || 0) + (f['OFFSHORE WIND'] || 0);
  const nuclear = f['NUCLEAR'] || f['NUC'] || 0;
  const solar   = f['PS'] || f['SOLAR'] || 0;
  const coal    = (f['COAL'] || 0) + (f['OIL'] || 0);
  const imports = (f['INTFR'] || 0) + (f['INTIRL'] || 0) + (f['INTNED'] || 0) + (f['INTEW'] || 0) + (f['INTNEM'] || 0);

  const pct = v => total > 0 ? Math.round((v / total) * 100) : 0;

  // 24h gas % history for sparkline
  const history = periods.slice(0, 48).reverse().map(p => {
    const pt = Object.values(p.fuels).reduce((s,v) => s+v, 0) || 1;
    const pg = (p.fuels['CCGT'] || 0) + (p.fuels['OCGT'] || 0) + (p.fuels['GAS'] || 0);
    return { date: p.date, period: p.period, gas_pct: Math.round((pg / pt) * 100) };
  });

  const gasPct = pct(gas);
  return {
    settlement_date: latest.date,
    settlement_period: latest.period,
    total_mw: Math.round(total),
    gas_mw: Math.round(gas), gas_pct: gasPct,
    wind_mw: Math.round(wind), wind_pct: pct(wind),
    nuclear_mw: Math.round(nuclear), nuclear_pct: pct(nuclear),
    solar_mw: Math.round(solar), solar_pct: pct(solar),
    coal_mw: Math.round(coal), coal_pct: pct(coal),
    imports_mw: Math.round(imports),
    cost_pressure: gasPct > 45 ? 'high' : gasPct > 25 ? 'medium' : 'low',
    history,
  };
}

// ── TEMP ──────────────────────────────────────────────────────────────────────

async function fetchTemp(now) {
  const from = new Date(now - 8 * 24 * 60 * 60 * 1000).toISOString();
  const r = await fetchWithTimeout(
    `${BASE}/datasets/TEMP?from=${from}&to=${now.toISOString()}`,
    8000
  );
  if (!r.ok) throw new Error(`TEMP ${r.status}`);
  const d = await r.json();
  const items = (d.data || d.items || []).sort((a, b) =>
    new Date(b.settlementDate || b.publishTime || 0) - new Date(a.settlementDate || a.publishTime || 0)
  );
  if (!items.length) throw new Error('No TEMP data returned');

  const latest = items[0];
  // Field names vary across API versions — try all known variants
  const actual  = latest.temperature ?? latest.temperatureValue ?? latest.actualTemperature ?? null;
  const normal  = latest.normalDayTemperature ?? latest.normalTemperature ?? latest.seasonalNormal ?? null;
  const deviation = (actual !== null && normal !== null) ? +(actual - normal).toFixed(1) : null;

  return {
    date: latest.settlementDate || latest.date || '',
    actual_c: actual !== null ? +Number(actual).toFixed(1) : null,
    normal_c: normal !== null ? +Number(normal).toFixed(1) : null,
    deviation_c: deviation,
    demand_signal: deviation === null ? 'unknown'
      : deviation < -3 ? 'very_cold' : deviation < -1 ? 'cold'
      : deviation > 3  ? 'very_hot'  : deviation > 1  ? 'warm' : 'normal',
    chemical_impact: deviation === null ? 'Temperature data unavailable.'
      : deviation < -2
        ? 'Cold snap: elevated heating gas demand competing with industrial users. Monitor gas supply pressure and interruptible contract status.'
        : deviation > 2
        ? 'Warm spell: increased cooling water demand at chemical sites. Check river temperatures and abstraction licence headroom.'
        : 'Temperature near seasonal normal — no unusual demand pressure on gas or cooling water.',
    history: items.slice(0, 7).reverse().map(i => ({
      date: i.settlementDate || i.date || '',
      actual: i.temperature ?? i.temperatureValue ?? i.actualTemperature ?? null,
      normal: i.normalDayTemperature ?? i.normalTemperature ?? null,
    })),
  };
}

// ── REMIT ─────────────────────────────────────────────────────────────────────

async function fetchREMIT(now) {
  // Try multiple REMIT endpoint variants — Elexon API docs are inconsistent
  const from14 = new Date(now - 14 * 24 * 60 * 60 * 1000).toISOString();
  const to14   = new Date(now + 14 * 24 * 60 * 60 * 1000).toISOString();
  const from14d = from14.split('T')[0];
  const to14d   = to14.split('T')[0];

  const endpoints = [
    // Variant 1: publishDateTime params (new Insights API)
    `${BASE}/datasets/REMIT?publishDateTimeFrom=${from14}&publishDateTimeTo=${to14}`,
    // Variant 2: from/to date-only (sometimes accepted)
    `${BASE}/datasets/REMIT?from=${from14d}&to=${to14d}`,
    // Variant 3: opinionated REMIT list endpoint
    `${BASE}/remit/list/by-publish?publishDateTimeFrom=${from14}&publishDateTimeTo=${to14}`,
    // Variant 4: event-based params
    `${BASE}/datasets/REMIT?eventStartFrom=${from14d}&eventEndTo=${to14d}`,
  ];

  let items = [];
  let lastError = '';
  let successUrl = '';

  for (const url of endpoints) {
    try {
      const r = await fetchWithTimeout(url, 7000);
      if (r.ok) {
        const d = await r.json();
        items = d.data || d.items || d.remitList || [];
        successUrl = url;
        if (items.length >= 0) break; // even 0 items = successful response
      } else {
        lastError = `HTTP ${r.status} from ${url.split('?')[0]}`;
      }
    } catch (e) {
      lastError = e.name === 'AbortError' ? `Timeout on ${url.split('?')[0]}` : e.message;
    }
  }

  // Filter to our monitored BMUs
  const bmuSet = new Set(ALL_MONITORED.map(b => b.id));
  const bmuMeta = ALL_MONITORED.reduce((m, b) => { m[b.id] = b; return m; }, {});

  const relevant = items.filter(i => {
    const bmu = i.bmUnit || i.assetId || i.bmuName || '';
    return bmuSet.has(bmu) || [...bmuSet].some(id => bmu.startsWith(id.replace(/-\d+$/, '')));
  });

  const nowMs = now.getTime();
  const notices = relevant.slice(0, 20).map(i => {
    const bmu = i.bmUnit || i.assetId || i.bmuName || '';
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
  }).sort((a, b) => (a.active === b.active ? 0 : a.active ? -1 : 1));

  return {
    total_found: relevant.length,
    total_in_response: items.length,
    notices,
    monitored_count: ALL_MONITORED.length,
    success_url: successUrl || null,
    last_error: lastError || null,
  };
}
