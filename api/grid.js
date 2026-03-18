// api/grid.js
// Elexon BMRS — Grid intelligence for chemical industry
// Covers: FUELHH (fuel mix), TEMP (temperature), REMIT (regional outages)
// All free, no API key required
// data.elexon.co.uk/bmrs/api/v1

const BASE = 'https://data.elexon.co.uk/bmrs/api/v1';

// Humber-area power plants relevant to chemical cluster operations
// These CCGTs supply steam/CHP to adjacent chemical sites
const HUMBER_BMUS = [
  { id: 'T_SCCL-1',  name: 'Saltend (Triton Power)',      site: 'Saltend Chemicals Park' },
  { id: 'T_SCCL-2',  name: 'Saltend (Triton Power)',      site: 'Saltend Chemicals Park' },
  { id: 'T_SCCL-3',  name: 'Saltend (Triton Power)',      site: 'Saltend Chemicals Park' },
  { id: 'T_KILNO-1', name: 'Killingholme A',              site: 'South Humber Bank' },
  { id: 'T_KILNS-1', name: 'Killingholme B',              site: 'South Humber Bank' },
  { id: 'T_KEAD-1',  name: 'Keadby 1',                   site: 'Scunthorpe / Humber' },
  { id: 'T_KEAD-2',  name: 'Keadby 2',                   site: 'Scunthorpe / Humber' },
  { id: 'T_SOHU-1',  name: 'South Humber Bank',          site: 'South Humber Bank industrial' },
  { id: 'T_GRIFW-1', name: 'Grimsby (Centrica)',          site: 'Humber South' },
];

// Also monitor Teesside-area plants (SABIC, Dow, CF Fertilisers, Huntsman)
const TEESSIDE_BMUS = [
  { id: 'T_TEAB-1',  name: 'Teesside A',                 site: 'Teesside cluster' },
  { id: 'T_CGAS-1',  name: 'Connah\'s Quay (Runcorn)',   site: 'Runcorn cluster' },
];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const type = req.query.type || 'all';

  const results = { asOf: new Date().toISOString(), source: 'Elexon BMRS API — free, no key' };

  // ── FUELHH — Half-hourly fuel mix ──────────────────────────────────────────
  if (type === 'all' || type === 'fuel') {
    try {
      // Get last 48 settlement periods (24 hours)
      const now = new Date();
      const from = new Date(now - 25 * 60 * 60 * 1000).toISOString();
      const r = await fetch(
        `${BASE}/datasets/FUELHH?from=${from}&to=${now.toISOString()}`,
        { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) }
      );
      if (r.ok) {
        const d = await r.json();
        const items = d.data || d.items || [];

        // Group by settlement period, sum fuel types
        // Latest period's generation mix
        const byPeriod = {};
        items.forEach(i => {
          const key = `${i.settlementDate}_${i.settlementPeriod}`;
          if (!byPeriod[key]) byPeriod[key] = { date: i.settlementDate, period: i.settlementPeriod, fuels: {} };
          byPeriod[key].fuels[i.fuelType] = (byPeriod[key].fuels[i.fuelType] || 0) + (i.generation || i.quantity || 0);
        });

        const periods = Object.values(byPeriod).sort((a, b) =>
          `${b.date}_${String(b.period).padStart(2,'0')}`.localeCompare(`${a.date}_${String(a.period).padStart(2,'0')}`)
        );

        const latest = periods[0];
        if (latest) {
          const fuels = latest.fuels;
          const total = Object.values(fuels).reduce((s, v) => s + v, 0);
          const gas   = fuels['CCGT'] || fuels['GAS'] || fuels['OCGT'] || 0;
          const wind  = (fuels['WIND'] || 0) + (fuels['OFFSHORE WIND'] || 0) + (fuels['INTEW'] || 0);
          const nuclear = fuels['NUCLEAR'] || fuels['NUC'] || 0;
          const solar = fuels['PS'] || fuels['SOLAR'] || fuels['NPSHYD'] || 0;
          const hydro = fuels['NPSHYD'] || fuels['HYDRO'] || 0;
          const coal  = fuels['COAL'] || fuels['OIL'] || 0;
          const imports = (fuels['INTFR'] || 0) + (fuels['INTIRL'] || 0) + (fuels['INTNED'] || 0) + (fuels['INTEW'] || 0);
          const other = Math.max(0, total - gas - wind - nuclear - solar - coal - Math.max(imports, 0));

          results.fuel_mix = {
            settlement_date: latest.date,
            settlement_period: latest.period,
            total_mw: Math.round(total),
            gas_mw: Math.round(gas),
            wind_mw: Math.round(wind),
            nuclear_mw: Math.round(nuclear),
            solar_mw: Math.round(solar),
            coal_mw: Math.round(coal),
            imports_mw: Math.round(imports),
            other_mw: Math.round(other),
            gas_pct: total > 0 ? Math.round((gas / total) * 100) : 0,
            wind_pct: total > 0 ? Math.round((wind / total) * 100) : 0,
            nuclear_pct: total > 0 ? Math.round((nuclear / total) * 100) : 0,
            solar_pct: total > 0 ? Math.round((solar / total) * 100) : 0,
            coal_pct: total > 0 ? Math.round((coal / total) * 100) : 0,
            // Cost pressure: high gas% = high cost for electro-intensive chemical processes
            cost_pressure: gas / (total || 1) > 0.45 ? 'high'
                         : gas / (total || 1) > 0.25 ? 'medium' : 'low',
            // 24hr history for sparklines
            history: periods.slice(0, 48).reverse().map(p => ({
              date: p.date, period: p.period,
              gas_pct: Object.values(p.fuels).reduce((s,v)=>s+v,0) > 0
                ? Math.round(((p.fuels['CCGT']||p.fuels['GAS']||0) /
                    Object.values(p.fuels).reduce((s,v)=>s+v,0)) * 100) : 0
            }))
          };
        }
      }
    } catch (e) { results.fuel_error = e.message; }
  }

  // ── TEMP — Temperature data ────────────────────────────────────────────────
  if (type === 'all' || type === 'temp') {
    try {
      const now = new Date();
      const from7 = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const today = now.toISOString().split('T')[0];
      const r = await fetch(
        `${BASE}/datasets/TEMP?from=${from7}T00:00:00Z&to=${today}T23:59:59Z`,
        { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(7000) }
      );
      if (r.ok) {
        const d = await r.json();
        const items = (d.data || d.items || []).sort((a, b) =>
          new Date(b.settlementDate || b.date) - new Date(a.settlementDate || a.date)
        );
        const latest = items[0];
        if (latest) {
          const actual = latest.temperature ?? latest.temperatureValue ?? null;
          const normal = latest.normalDayTemperature ?? latest.normalTemperature ?? null;
          const low    = latest.lowTemperature ?? null;
          const high   = latest.highTemperature ?? null;
          const deviation = (actual !== null && normal !== null) ? +(actual - normal).toFixed(1) : null;

          results.temperature = {
            date: latest.settlementDate || latest.date,
            actual_c: actual !== null ? +actual.toFixed(1) : null,
            normal_c: normal !== null ? +normal.toFixed(1) : null,
            deviation_c: deviation,
            low_c: low !== null ? +low.toFixed(1) : null,
            high_c: high !== null ? +high.toFixed(1) : null,
            // Context: cold = high gas demand for heating, hot = high cooling water demand
            demand_signal: deviation !== null
              ? deviation < -3 ? 'very_cold'
              : deviation < -1 ? 'cold'
              : deviation > 3  ? 'very_hot'
              : deviation > 1  ? 'warm' : 'normal'
              : 'unknown',
            chemical_impact: deviation !== null
              ? deviation < -2
                ? 'Cold snap: elevated gas demand for heating competing with industrial use. Monitor gas supply pressure.'
                : deviation > 2
                ? 'Warm spell: increased cooling water demand at chemical sites. Monitor river temperatures.'
                : 'Temperature near seasonal normal — no unusual demand pressure.'
              : 'Temperature data unavailable.',
            // 7-day history
            history: items.slice(0, 7).reverse().map(i => ({
              date: i.settlementDate || i.date,
              actual: i.temperature ?? i.temperatureValue ?? null,
              normal: i.normalDayTemperature ?? i.normalTemperature ?? null
            }))
          };
        }
      }
    } catch (e) { results.temp_error = e.message; }
  }

  // ── REMIT — Regional outage notices ────────────────────────────────────────
  if (type === 'all' || type === 'remit') {
    try {
      const now = new Date();
      const from14 = new Date(now - 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const to14   = new Date(now + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      // Get all recent/upcoming REMIT notices (no BMU filter — then filter client-side)
      const r = await fetch(
        `${BASE}/datasets/REMIT?from=${from14}&to=${to14}`,
        { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10000) }
      );

      const allBmuIds = new Set([
        ...HUMBER_BMUS.map(b => b.id),
        ...TEESSIDE_BMUS.map(b => b.id)
      ]);
      const bmuMeta = [...HUMBER_BMUS, ...TEESSIDE_BMUS].reduce((m, b) => {
        m[b.id] = b; return m;
      }, {});

      if (r.ok) {
        const d = await r.json();
        const items = d.data || d.items || [];

        // Filter to our monitored BMUs
        const relevant = items.filter(i => {
          const bmu = i.bmUnit || i.assetId || '';
          return allBmuIds.has(bmu) || [...allBmuIds].some(id => bmu.startsWith(id.slice(0, 6)));
        });

        results.remit = {
          total_found: relevant.length,
          notices: relevant.slice(0, 20).map(i => {
            const bmu = i.bmUnit || i.assetId || '';
            const meta = bmuMeta[bmu] || { name: bmu, site: 'Humber / Teesside area' };
            const unavailMW = i.unavailableCapacity ?? i.affectedCapacity ?? null;
            const startTime = i.eventStart || i.effectiveFrom;
            const endTime   = i.eventEnd   || i.effectiveTo;
            // Is this currently active?
            const now2 = new Date();
            const active = startTime && endTime
              ? new Date(startTime) <= now2 && new Date(endTime) >= now2
              : startTime ? new Date(startTime) <= now2 : false;
            return {
              bmu,
              plant_name: meta.name,
              chemical_site: meta.site,
              type: i.outageType || i.messageType || 'Outage',
              reason: i.reasonForUnavailability || i.eventType || i.messageHeadline || '',
              unavailable_mw: unavailMW,
              start: startTime,
              end: endTime,
              active,
              published: i.publishTime || i.createdDateTime
            };
          }).sort((a, b) => {
            // Active first, then by start date
            if (a.active !== b.active) return a.active ? -1 : 1;
            return new Date(a.start) - new Date(b.start);
          }),
          monitored_plants: [...HUMBER_BMUS, ...TEESSIDE_BMUS].map(b => b.name),
          clusters: { humber: HUMBER_BMUS.length, teesside: TEESSIDE_BMUS.length }
        };
      }
    } catch (e) { results.remit_error = e.message; }
  }

  res.status(200).json(results);
}
