// api/ccgt.js
// Triton Power Saltend CCGT — live status + historical generation
// Elexon BMRS Insights API — completely free, no API key required
// BMU IDs: T_SCCL-1, T_SCCL-2, T_SCCL-3 (Saltend Cogeneration Company Ltd)

export const config = { maxDuration: 60 };  // REMIT does ~75 sequential API calls

const BASE = 'https://data.elexon.co.uk/bmrs/api/v1';
const SALTEND_BMUS = ['T_SCCL-1', 'T_SCCL-2', 'T_SCCL-3'];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const mode = req.query.mode || 'live';
  if (mode === 'history') return handleHistory(req, res);
  return handleLive(req, res);
}

// ── LIVE MODE ─────────────────────────────────────────────────────────────────

async function handleLive(req, res) {
  const now    = new Date();
  const from24 = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const from7d = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
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

  // Physical Notifications per unit
  for (const bmu of SALTEND_BMUS) {
    const unit = { bmu, pn: [], current_mw: null, status: 'unknown' };
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

  // REMIT notices — proper 2-step flow with 7-day windows (Elexon hard limit)
  // Step 1: /remit/list/by-publish per Saltend unit per weekly window
  // Step 2: /remit?messageId=... bulk fetch details
  try {
    const WEEKS_BACK = 12;      // 3 months history
    const WEEKS_FORWARD = 13;   // ~3 months ahead for planned shutdowns

    // Build weekly windows
    const windows = [];
    for (let w = -WEEKS_BACK; w < WEEKS_FORWARD; w++) {
      const f = new Date(now.getTime() + w * 7 * 86400000).toISOString().replace(/\.\d{3}Z$/, 'Z');
      const t = new Date(now.getTime() + (w + 1) * 7 * 86400000).toISOString().replace(/\.\d{3}Z$/, 'Z');
      windows.push({ from: f, to: t });
    }

    // Step 1: collect message IDs for all 3 Saltend units across all windows
    const msgIds = new Set();
    const pairs = [];
    for (const bmu of SALTEND_BMUS) {
      for (const win of windows) {
        pairs.push({ bmu, win });
      }
    }

    const CHUNK = 15;
    for (let p = 0; p < pairs.length; p += CHUNK) {
      const batch = pairs.slice(p, p + CHUNK);
      await Promise.allSettled(batch.map(async ({ bmu, win }) => {
        try {
          const url = `${BASE}/remit/list/by-publish?from=${win.from}&to=${win.to}&assetId=${bmu}&latestRevisionOnly=true`;
          const r = await fetch(url, {
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(6000)
          });
          if (!r.ok) return;
          const d = await r.json();
          (d.data || []).forEach(m => { if (m.id) msgIds.add(m.id); });
        } catch (e) {}
      }));
    }

    // Step 2: bulk fetch full message details
    if (msgIds.size) {
      const idList = [...msgIds];
      const details = [];
      const BULK = 40;
      for (let i = 0; i < idList.length; i += BULK) {
        const batch = idList.slice(i, i + BULK);
        const qs = batch.map(id => `messageId=${id}`).join('&');
        try {
          const r = await fetch(`${BASE}/remit?${qs}`, {
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(12000)
          });
          if (!r.ok) continue;
          const d = await r.json();
          (d.data || []).forEach(m => details.push(m));
        } catch (e) {}
      }

      // Normalise using exact API field names, add active/upcoming/ended flags
      const nowMs = now.getTime();
      result.remit_outages = details.map(m => {
        const start = m.eventStartTime || '';
        const end   = m.eventEndTime   || '';
        const sMs   = start ? new Date(start).getTime() : 0;
        const eMs   = end   ? new Date(end).getTime()   : 0;
        return {
          bmu:           m.assetId || m.affectedUnit || '',
          type:          m.unavailabilityType || m.messageType || 'Outage',
          reason:        m.cause || m.messageHeading || m.relatedInformation || '',
          eventType:     m.eventType || '',
          unavailableMW: m.unavailableCapacity ?? null,
          normalMW:      m.normalCapacity ?? null,
          availableMW:   m.availableCapacity ?? null,
          eventStatus:   m.eventStatus || '',
          publishTime:   m.publishTime || m.createdTime || '',
          startTime:     start,
          endTime:       end,
          active:   sMs > 0 && eMs > 0 && sMs <= nowMs && eMs >= nowMs,
          upcoming: sMs > nowMs,
          ended:    eMs > 0 && eMs < nowMs,
        };
      }).filter(m => m.bmu && m.bmu.startsWith('T_SCCL'));

      // Sort: active → upcoming → ended (most recent first within each)
      result.remit_outages.sort((a, b) => {
        if (a.active   && !b.active)   return -1;
        if (!a.active  && b.active)    return 1;
        if (a.upcoming && !b.upcoming) return -1;
        if (!a.upcoming && b.upcoming) return 1;
        if (a.upcoming && b.upcoming) return new Date(a.startTime) - new Date(b.startTime);
        return new Date(b.startTime) - new Date(a.startTime);
      });
    }
  } catch (e) {}

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
                : (running + partial) > 0 ? 'partial_output' : 'offline',
    active_remit: result.remit_outages.length,
    note: totalMW > 0
      ? `${totalMW} MW total across ${running + partial} active units`
      : unknown === 3 ? 'PN data unavailable — verify BMU IDs on bmrs.elexon.co.uk'
      : 'All units at low/zero output'
  };

  res.status(200).json(result);
}

// ── HISTORY MODE: B1610 stream endpoint (handles date ranges natively) ────────

async function handleHistory(req, res) {
  const fromDate = req.query.from;
  const toDate   = req.query.to;

  if (!fromDate || !toDate) {
    return res.status(400).json({ error: 'from and to params required (YYYY-MM-DD)' });
  }

  const diffDays = Math.round((new Date(toDate) - new Date(fromDate)) / 86400000);
  if (diffDays < 0)   return res.status(400).json({ error: 'from must be before to' });
  if (diffDays > 180) return res.status(400).json({ error: 'Maximum range is 180 days' });

  // B1610/stream uses ISO datetime params and handles ranges natively
  // This is the correct new endpoint per Elexon BSC Insight article
  const fromISO = `${fromDate}T00:00:00Z`;
  const toISO   = `${toDate}T23:59:59Z`;

  const result = {
    from: fromDate, to: toDate, diffDays,
    history: [],
    bmu_ids_tried: SALTEND_BMUS,
    asOf: new Date().toISOString(),
    data_source: 'Elexon BMRS B1610/stream — Actual Generation Output Per Generation Unit'
  };

  for (const bmu of SALTEND_BMUS) {
    const unitData = { bmu, readings: [], avgMW: 0, peakMW: 0, loadFactor: 0, periodsRunning: 0, endpoint_tried: '' };

    // Try 1: /datasets/B1610/stream — the correct range endpoint
    let fetched = false;
    try {
      const url = `${BASE}/datasets/B1610/stream?from=${fromISO}&to=${toISO}&bmUnit=${encodeURIComponent(bmu)}`;
      unitData.endpoint_tried = url;
      const r = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(20000) // larger timeout for stream endpoint
      });

      if (r.ok) {
        const text = await r.text();
        // Stream endpoint returns newline-delimited JSON or a JSON array
        let items = [];
        try {
          items = JSON.parse(text); // try as array first
          if (!Array.isArray(items)) items = items.data || items.items || [];
        } catch {
          // Try newline-delimited JSON
          items = text.split('\n')
            .filter(l => l.trim())
            .map(l => { try { return JSON.parse(l); } catch { return null; } })
            .filter(Boolean);
        }
        if (items.length > 0) {
          unitData.readings = items.map(i => ({
            time: i.startTime || i.timeFrom ||
              (i.settlementDate && i.settlementPeriod
                ? settlementToISO(i.settlementDate, i.settlementPeriod)
                : null),
            period: i.settlementPeriod,
            mw: Math.round(Math.max(0, i.quantity ?? i.output ?? i.levelFrom ?? 0))
          })).filter(r => r.time).sort((a, b) => a.time.localeCompare(b.time));
          fetched = true;
        }
      }
    } catch (e) { unitData.stream_error = e.message; }

    // Try 2: /datasets/B1610 with settlementDate (day by day for short ranges)
    if (!fetched && diffDays <= 14) {
      const readings = [];
      let cursor = new Date(fromDate);
      const toD = new Date(toDate);
      while (cursor <= toD) {
        const dateStr = cursor.toISOString().split('T')[0];
        try {
          const r = await fetch(
            `${BASE}/datasets/B1610?settlementDate=${dateStr}&bmUnit=${encodeURIComponent(bmu)}`,
            { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) }
          );
          if (r.ok) {
            const d = await r.json();
            (d.data || d.items || []).forEach(i => readings.push({
              time: settlementToISO(i.settlementDate || dateStr, i.settlementPeriod || 1),
              period: i.settlementPeriod,
              mw: Math.round(Math.max(0, i.quantity ?? i.output ?? 0))
            }));
          }
        } catch (e) {}
        cursor.setDate(cursor.getDate() + 1);
      }
      if (readings.length > 0) {
        unitData.readings = readings.sort((a, b) => a.time.localeCompare(b.time));
        fetched = true;
      }
    }

    // Stats
    const mwVals = unitData.readings.map(r => r.mw).filter(v => v > 0);
    if (mwVals.length > 0) {
      unitData.avgMW         = Math.round(mwVals.reduce((a, b) => a + b, 0) / mwVals.length);
      unitData.peakMW        = Math.max(...mwVals);
      unitData.loadFactor    = Math.round((unitData.avgMW / 400) * 100);
      unitData.periodsRunning = unitData.readings.filter(r => r.mw > 50).length;
    }
    unitData.total_readings = unitData.readings.length;
    result.history.push(unitData);
  }

  // Plant totals
  const allMW = result.history.flatMap(u => u.readings.map(r => r.mw));
  if (allMW.length > 0) {
    result.plant_avg_mw      = Math.round(allMW.reduce((a, b) => a + b, 0) / allMW.length);
    result.plant_peak_mw     = Math.max(...allMW);
    result.plant_load_factor = Math.round((result.plant_avg_mw / 1197) * 100);
    result.total_readings    = allMW.length;
  }

  res.status(200).json(result);
}

// Convert Elexon settlementDate + settlementPeriod to ISO datetime
// Settlement period 1 = 00:00-00:30, period 2 = 00:30-01:00, etc.
function settlementToISO(settlementDate, period) {
  const totalMins = (period - 1) * 30;
  const hh = String(Math.floor(totalMins / 60)).padStart(2, '0');
  const mm = String(totalMins % 60).padStart(2, '0');
  return `${settlementDate}T${hh}:${mm}:00Z`;
}
