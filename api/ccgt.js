// api/ccgt.js
// Triton Power Saltend CCGT status from Elexon BMRS
// Completely free — no API key required
// Data: Physical Notifications (near real-time), B1610 actual generation, REMIT outages

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300'); // cache 5 mins
  if (req.method === 'OPTIONS') return res.status(200).end();

  const BASE = 'https://data.elexon.co.uk/bmrs/api/v1';
  const now = new Date();
  const from24h = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const from7d  = new Date(now - 7  * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const today   = now.toISOString().split('T')[0];

  // Saltend BMU IDs — 3 units (Triton Power / formerly SSE Thermal)
  // T_SALTB-1/2/3 are the standard Elexon transmission-connected generator IDs
  const SALTEND_BMUS = ['T_SALTB-1', 'T_SALTB-2', 'T_SALTB-3'];

  const result = {
    plant: 'Saltend Power Station',
    operator: 'Triton Power',
    location: 'Humber Estuary, Hull (HU12 8GA)',
    capacity_mw: 1197,
    units: [],
    remit_outages: [],
    summary: {},
    asOf: now.toISOString(),
    data_source: 'Elexon BMRS API — data.elexon.co.uk/bmrs/api/v1'
  };

  // ── 1. Physical Notifications — last 24h per unit ──────────────────────────
  for (const bmu of SALTEND_BMUS) {
    const unitResult = { bmu, pn: [], current_mw: null, status: 'unknown', b1610: [] };

    try {
      const r = await fetch(
        `${BASE}/balancing/physical?bmUnit=${encodeURIComponent(bmu)}&from=${from24h}&to=${now.toISOString()}&dataset=PN`,
        {
          headers: { 'Accept': 'application/json' },
          signal: AbortSignal.timeout(6000)
        }
      );

      if (r.ok) {
        const d = await r.json();
        const pnData = (d.data || d.items || []).filter(x => x.dataset === 'PN' || !x.dataset);

        if (pnData.length > 0) {
          // Get the most recent PN value
          const sorted = pnData.sort((a, b) => new Date(b.timeFrom || b.startTime) - new Date(a.timeFrom || a.startTime));
          const latest = sorted[0];
          const latestMW = latest.levelFrom ?? latest.level ?? latest.quantity ?? null;

          unitResult.current_mw = typeof latestMW === 'number' ? Math.round(latestMW) : null;
          unitResult.pn = sorted.slice(0, 48).map(p => ({
            time: p.timeFrom || p.startTime,
            mw: Math.round(p.levelFrom ?? p.level ?? p.quantity ?? 0)
          }));

          // Determine status from most recent MW level
          if (unitResult.current_mw === null)       unitResult.status = 'unknown';
          else if (unitResult.current_mw < 10)       unitResult.status = 'offline';
          else if (unitResult.current_mw < 150)      unitResult.status = 'low';
          else if (unitResult.current_mw < 300)      unitResult.status = 'partial';
          else                                        unitResult.status = 'running';
        }
      }
    } catch (e) {
      unitResult.pn_error = e.message;
    }

    // ── 2. B1610 Actual Generation — last 5 days (reconciled) ──────────────
    try {
      const r = await fetch(
        `${BASE}/datasets/B1610?settlementDate=${today}&bmUnit=${encodeURIComponent(bmu)}`,
        {
          headers: { 'Accept': 'application/json' },
          signal: AbortSignal.timeout(6000)
        }
      );
      if (r.ok) {
        const d = await r.json();
        const items = d.data || d.items || [];
        unitResult.b1610 = items.slice(-48).map(i => ({
          period: i.settlementPeriod,
          mw: Math.round(i.quantity ?? i.output ?? 0),
          time: i.startTime || i.timeFrom
        }));
      }
    } catch (e) {
      unitResult.b1610_error = e.message;
    }

    result.units.push(unitResult);
  }

  // ── 3. REMIT Outage Notices — planned & unplanned ─────────────────────────
  try {
    const r = await fetch(
      `${BASE}/datasets/REMIT?from=${from7d}&to=${today}&bmUnit=T_SALTB`,
      {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(6000)
      }
    );
    if (r.ok) {
      const d = await r.json();
      const items = (d.data || d.items || []).slice(0, 10);
      result.remit_outages = items.map(i => ({
        bmu: i.bmUnit || i.assetId,
        type: i.outageType || i.messageType || 'Outage',
        reason: i.reasonForUnavailability || i.eventType || i.messageHeadline || '',
        unavailableMW: i.unavailableCapacity ?? i.affectedCapacity ?? null,
        startTime: i.eventStart || i.effectiveFrom,
        endTime: i.eventEnd || i.effectiveTo,
        published: i.publishTime || i.createdDateTime
      }));
    }
  } catch (e) {
    result.remit_error = e.message;
  }

  // ── 4. Build summary ───────────────────────────────────────────────────────
  const runningUnits  = result.units.filter(u => u.status === 'running').length;
  const partialUnits  = result.units.filter(u => u.status === 'partial' || u.status === 'low').length;
  const offlineUnits  = result.units.filter(u => u.status === 'offline').length;
  const unknownUnits  = result.units.filter(u => u.status === 'unknown').length;
  const totalMW       = result.units.reduce((s, u) => s + (u.current_mw || 0), 0);

  result.summary = {
    running_units: runningUnits,
    partial_units: partialUnits,
    offline_units: offlineUnits,
    unknown_units: unknownUnits,
    total_mw_output: totalMW,
    plant_status: offlineUnits === 3 ? 'offline'
                : unknownUnits === 3 ? 'data_unavailable'
                : runningUnits === 3 ? 'full_output'
                : runningUnits >= 1  ? 'partial_output'
                : partialUnits >= 1  ? 'low_output'
                : 'offline',
    active_remit: result.remit_outages.length,
    note: totalMW > 0
      ? `${totalMW} MW total output across ${runningUnits + partialUnits} active units`
      : unknownUnits === 3
      ? 'PN data unavailable — check bmrs.elexon.co.uk for BMU status'
      : 'All units at low/zero output'
  };

  res.status(200).json(result);
}
