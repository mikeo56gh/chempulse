// api/ccgt.js
// Triton Power Saltend CCGT — live status + historical generation
// Elexon BMRS API — completely free, no API key required
// BMU IDs: T_SCCL-1, T_SCCL-2, T_SCCL-3 (Saltend Cogeneration Company Ltd)

const BASE = 'https://data.elexon.co.uk/bmrs/api/v1';
const SALTEND_BMUS = ['T_SCCL-1', 'T_SCCL-2', 'T_SCCL-3'];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const mode = req.query.mode || 'live';

  if (mode === 'history') {
    return handleHistory(req, res);
  } else {
    return handleLive(req, res);
  }
}

// ── LIVE MODE: Physical Notifications + REMIT ─────────────────────────────────

async function handleLive(req, res) {
  const now    = new Date();
  const from24 = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const from7d = new Date(now - 7  * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const today  = now.toISOString().split('T')[0];

  const result = {
    plant: 'Saltend Power Station',
    operator: 'Triton Power (Saltend Cogeneration Company Ltd)',
    location: 'Humber Estuary, Hull, HU12 8GA',
    capacity_mw: 1197,
    units: [],
    remit_outages: [],
    summary: {},
    asOf: now.toISOString(),
    data_source: 'Elexon BMRS — data.elexon.co.uk/bmrs/api/v1'
  };

  // Physical Notifications — one call per unit
  for (const bmu of SALTEND_BMUS) {
    const unit = { bmu, pn: [], current_mw: null, status: 'unknown', b1610: [] };
    try {
      const r = await fetch(
        `${BASE}/balancing/physical?bmUnit=${encodeURIComponent(bmu)}&from=${from24}&to=${now.toISOString()}&dataset=PN`,
        { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(7000) }
      );
      if (r.ok) {
        const d = await r.json();
        const pnData = (d.data || d.items || []).filter(x => !x.dataset || x.dataset === 'PN');
        if (pnData.length > 0) {
          const sorted = pnData.sort((a, b) => new Date(b.timeFrom || b.startTime) - new Date(a.timeFrom || a.startTime));
          const latestMW = sorted[0].levelFrom ?? sorted[0].level ?? sorted[0].quantity ?? null;
          unit.current_mw = typeof latestMW === 'number' ? Math.round(latestMW) : null;
          unit.pn = sorted.slice(0, 48).map(p => ({
            time: p.timeFrom || p.startTime,
            mw: Math.round(p.levelFrom ?? p.level ?? p.quantity ?? 0)
          }));
          const mw = unit.current_mw;
          unit.status = mw === null ? 'unknown' : mw < 10 ? 'offline' : mw < 150 ? 'low' : mw < 300 ? 'partial' : 'running';
        }
      }
    } catch (e) { unit.pn_error = e.message; }
    result.units.push(unit);
  }

  // REMIT outage notices
  try {
    const r = await fetch(
      `${BASE}/datasets/REMIT?from=${from7d}&to=${today}&bmUnit=T_SCCL`,
      { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(6000) }
    );
    if (r.ok) {
      const d = await r.json();
      result.remit_outages = (d.data || d.items || []).slice(0, 10).map(i => ({
        bmu: i.bmUnit || i.assetId,
        type: i.outageType || i.messageType || 'Outage',
        reason: i.reasonForUnavailability || i.eventType || i.messageHeadline || '',
        unavailableMW: i.unavailableCapacity ?? i.affectedCapacity ?? null,
        startTime: i.eventStart || i.effectiveFrom,
        endTime: i.eventEnd || i.effectiveTo
      }));
    }
  } catch (e) { result.remit_error = e.message; }

  // Summary
  const running = result.units.filter(u => u.status === 'running').length;
  const partial = result.units.filter(u => u.status === 'partial' || u.status === 'low').length;
  const offline = result.units.filter(u => u.status === 'offline').length;
  const unknown = result.units.filter(u => u.status === 'unknown').length;
  const totalMW = result.units.reduce((s, u) => s + (u.current_mw || 0), 0);

  result.summary = {
    running_units: running, partial_units: partial,
    offline_units: offline, unknown_units: unknown,
    total_mw_output: totalMW,
    plant_status: unknown === 3 ? 'data_unavailable'
                : offline === 3 ? 'offline'
                : running === 3 ? 'full_output'
                : running >= 1 || partial >= 1 ? 'partial_output' : 'offline',
    active_remit: result.remit_outages.length,
    note: totalMW > 0
      ? `${totalMW} MW total across ${running + partial} active units`
      : unknown === 3 ? 'PN data unavailable — verify BMU IDs on bmrs.elexon.co.uk'
      : 'All units at low/zero output'
  };

  res.status(200).json(result);
}

// ── HISTORY MODE: B1610 Actual Generation Output ──────────────────────────────

async function handleHistory(req, res) {
  const fromDate = req.query.from; // YYYY-MM-DD
  const toDate   = req.query.to;   // YYYY-MM-DD

  if (!fromDate || !toDate) {
    return res.status(400).json({ error: 'from and to query params required (YYYY-MM-DD)' });
  }

  const from = new Date(fromDate);
  const to   = new Date(toDate);
  const diffDays = Math.round((to - from) / 86400000);

  if (diffDays < 0) return res.status(400).json({ error: 'from must be before to' });
  if (diffDays > 180) return res.status(400).json({ error: 'Maximum range is 180 days' });

  const result = {
    from: fromDate, to: toDate, diffDays,
    history: [],
    asOf: new Date().toISOString(),
    data_source: 'Elexon BMRS B1610 — Actual Generation Output Per Generation Unit'
  };

  // B1610 — fetch per unit, iterate day by day for ranges > 1 day
  // Elexon B1610 accepts a settlementDate param for single days
  // For ranges we use publishDateTimeFrom/To or loop by date

  for (const bmu of SALTEND_BMUS) {
    const unitData = { bmu, readings: [], avgMW: 0, peakMW: 0, loadFactor: 0, periodsRunning: 0 };

    try {
      // Try the date-range endpoint first
      const r = await fetch(
        `${BASE}/datasets/B1610?from=${fromDate}T00:00:00Z&to=${toDate}T23:59:59Z&bmUnit=${encodeURIComponent(bmu)}`,
        { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) }
      );

      if (r.ok) {
        const d = await r.json();
        const items = d.data || d.items || [];

        unitData.readings = items.map(i => ({
          time: i.startTime || i.timeFrom || `${i.settlementDate}T${String(Math.floor((i.settlementPeriod - 1) * 0.5)).padStart(2,'0')}:${(i.settlementPeriod % 2 === 0 ? '30' : '00')}:00Z`,
          period: i.settlementPeriod,
          mw: Math.round(Math.max(0, i.quantity ?? i.output ?? i.levelFrom ?? 0))
        })).sort((a, b) => a.time.localeCompare(b.time));

      } else if (r.status === 400 || r.status === 404) {
        // Fallback: loop settlement dates individually (slower but more compatible)
        const readings = [];
        let cursor = new Date(from);
        while (cursor <= to && readings.length < 10000) {
          const dateStr = cursor.toISOString().split('T')[0];
          try {
            const dr = await fetch(
              `${BASE}/datasets/B1610?settlementDate=${dateStr}&bmUnit=${encodeURIComponent(bmu)}`,
              { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) }
            );
            if (dr.ok) {
              const dd = await dr.json();
              const items = dd.data || dd.items || [];
              items.forEach(i => readings.push({
                time: `${dateStr}T${String(Math.floor((i.settlementPeriod - 1) * 0.5)).padStart(2,'0')}:${i.settlementPeriod % 2 === 0 ? '30' : '00'}:00Z`,
                period: i.settlementPeriod,
                mw: Math.round(Math.max(0, i.quantity ?? i.output ?? 0))
              }));
            }
          } catch (e) { /* skip day */ }
          cursor.setDate(cursor.getDate() + 1);
        }
        unitData.readings = readings.sort((a, b) => a.time.localeCompare(b.time));
      }
    } catch (e) {
      unitData.error = e.message;
    }

    // Stats
    const mwVals = unitData.readings.map(r => r.mw).filter(v => v > 0);
    if (mwVals.length > 0) {
      unitData.avgMW        = Math.round(mwVals.reduce((a, b) => a + b, 0) / mwVals.length);
      unitData.peakMW       = Math.max(...mwVals);
      unitData.loadFactor   = Math.round((unitData.avgMW / 400) * 100); // ~400MW per unit
      unitData.periodsRunning = unitData.readings.filter(r => r.mw > 50).length;
    }

    result.history.push(unitData);
  }

  // Plant-level stats
  const allMW = result.history.flatMap(u => u.readings.map(r => r.mw));
  if (allMW.length > 0) {
    result.plant_avg_mw  = Math.round(allMW.reduce((a, b) => a + b, 0) / allMW.length);
    result.plant_peak_mw = Math.max(...allMW);
    result.plant_load_factor = Math.round((result.plant_avg_mw / 1197) * 100);
  }

  res.status(200).json(result);
}
