// api/grid.js — ChemPulse grid intelligence
// Elexon BMRS: fuel mix + wind forecast + REMIT outages

const BASE = 'https://data.elexon.co.uk/bmrs/api/v1';

function ft(url, ms) {
  ms = ms || 8000;
  var ctrl = new AbortController();
  var t = setTimeout(function() { ctrl.abort(); }, ms);
  return fetch(url, { headers: { Accept: 'application/json' }, signal: ctrl.signal })
    .finally(function() { clearTimeout(t); });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300');
  if (req.method === 'OPTIONS') return res.status(200).end();

  var now = new Date();
  var today = now.toISOString().split('T')[0];
  var tomorrow = new Date(now.getTime() + 86400000).toISOString().split('T')[0];

  var results = await Promise.allSettled([
    fetchFuelMix(now),
    fetchWindSolarForecast(today, tomorrow),
    fetchREMIT(now),
  ]);

  res.status(200).json({
    asOf: now.toISOString(),
    source: 'Elexon BMRS — free, no key',
    fuel_mix: results[0].status === 'fulfilled' ? results[0].value : null,
    fuel_error: results[0].status === 'rejected' ? String(results[0].reason) : undefined,
    wind_forecast: results[1].status === 'fulfilled' ? results[1].value : null,
    wind_error: results[1].status === 'rejected' ? String(results[1].reason) : undefined,
    remit: results[2].status === 'fulfilled' ? results[2].value : null,
    remit_error: results[2].status === 'rejected' ? String(results[2].reason) : undefined,
  });
};

// ── FUELHH ────────────────────────────────────────────────────────────────────

async function fetchFuelMix(now) {
  var from = new Date(now.getTime() - 25 * 60 * 60 * 1000).toISOString();
  var r = await ft(BASE + '/datasets/FUELHH?from=' + from + '&to=' + now.toISOString());
  if (!r.ok) throw new Error('FUELHH ' + r.status);
  var d = await r.json();
  var items = d.data || d.items || [];

  var byPeriod = {};
  items.forEach(function(i) {
    var key = i.settlementDate + '_' + String(i.settlementPeriod).padStart(3, '0');
    if (!byPeriod[key]) byPeriod[key] = { date: i.settlementDate, period: i.settlementPeriod, fuels: {} };
    var fuel = (i.fuelType || '').toUpperCase();
    byPeriod[key].fuels[fuel] = (byPeriod[key].fuels[fuel] || 0) + (i.generation || i.quantity || 0);
  });

  var periods = Object.values(byPeriod).sort(function(a, b) {
    return (b.date + '_' + String(b.period).padStart(3, '0')).localeCompare(a.date + '_' + String(a.period).padStart(3, '0'));
  });
  if (!periods.length) throw new Error('No FUELHH data');

  var f = periods[0].fuels;
  var total = Object.values(f).reduce(function(s, v) { return s + v; }, 0) || 1;

  var gas = (f.CCGT || 0) + (f.OCGT || 0) + (f.GAS || 0);
  var wind = (f.WIND || 0) + (f['OFFSHORE WIND'] || 0);
  var nuclear = f.NUCLEAR || f.NUC || 0;
  var solar = f.SOLAR || 0;
  var coal = (f.COAL || 0) + (f.OIL || 0);
  var biomass = f.BIOMASS || 0;
  var hydro = f.NPSHYD || 0;
  var pumped = f.PS || 0;
  var intFR = f.INTFR || 0;
  var intIRL = f.INTIRL || 0;
  var intNED = f.INTNED || 0;
  var intEW = f.INTEW || 0;
  var intNEM = f.INTNEM || 0;
  var intVKL = f.INTVKL || 0;
  var imports = intFR + intIRL + intNED + intEW + intNEM + intVKL;
  var other = Math.max(0, total - gas - wind - nuclear - solar - coal - biomass - hydro - pumped - imports);

  function pct(v) { return total > 0 ? Math.round((v / total) * 100) : 0; }
  var gasPct = pct(gas);

  var history = periods.slice(0, 48).reverse().map(function(p) {
    var pt = Object.values(p.fuels).reduce(function(s, v) { return s + v; }, 0) || 1;
    var pg = (p.fuels.CCGT || 0) + (p.fuels.OCGT || 0) + (p.fuels.GAS || 0);
    var pw = (p.fuels.WIND || 0) + (p.fuels['OFFSHORE WIND'] || 0);
    return {
      date: p.date,
      period: p.period,
      gas_pct: Math.round((pg / pt) * 100),
      wind_pct: Math.round((pw / pt) * 100),
    };
  });

  return {
    settlement_date: periods[0].date,
    settlement_period: periods[0].period,
    total_mw: Math.round(total),
    gas_mw: Math.round(gas), gas_pct: gasPct,
    wind_mw: Math.round(wind), wind_pct: pct(wind),
    nuclear_mw: Math.round(nuclear), nuclear_pct: pct(nuclear),
    solar_mw: Math.round(solar), solar_pct: pct(solar),
    coal_mw: Math.round(coal), coal_pct: pct(coal),
    biomass_mw: Math.round(biomass), biomass_pct: pct(biomass),
    hydro_mw: Math.round(hydro + pumped), hydro_pct: pct(hydro + pumped),
    imports_mw: Math.round(imports), imports_pct: pct(imports),
    other_mw: Math.round(other), other_pct: pct(other),
    interconnectors: {
      france_mw: Math.round(intFR),
      ireland_mw: Math.round(intIRL + intEW),
      netherlands_mw: Math.round(intNED),
      belgium_mw: Math.round(intNEM),
      denmark_mw: Math.round(intVKL),
    },
    cost_pressure: gasPct > 45 ? 'high' : gasPct > 25 ? 'medium' : 'low',
    history: history,
  };
}

// ── WIND/SOLAR FORECAST ───────────────────────────────────────────────────────

async function fetchWindSolarForecast(today, tomorrow) {
  var url = BASE + '/forecast/generation/wind-and-solar/day-ahead?from=' + today + '&to=' + tomorrow + '&processType=Day%20Ahead';
  var r = await ft(url);
  if (!r.ok) throw new Error('Wind/Solar ' + r.status);
  var d = await r.json();
  var items = (d.data || []).sort(function(a, b) {
    return new Date(a.startTime || a.publishTime || 0) - new Date(b.startTime || b.publishTime || 0);
  });
  if (!items.length) throw new Error('No forecast data');

  var records = items.map(function(i) {
    return {
      time: i.startTime || i.publishTime || '',
      wind_mw: Math.round(i.wind || i.windGeneration || 0),
      solar_mw: Math.round(i.solar || i.solarGeneration || 0),
    };
  });

  var windVals = records.map(function(r) { return r.wind_mw; }).filter(function(v) { return v > 0; });
  var avgWind = windVals.length ? Math.round(windVals.reduce(function(s, v) { return s + v; }, 0) / windVals.length) : 0;
  var peakWind = windVals.length ? Math.max.apply(null, windVals) : 0;

  return {
    records: records,
    avg_wind_mw: avgWind,
    peak_wind_mw: peakWind,
    outlook: peakWind > 12000 ? 'HIGH — strong wind expected, lower power costs'
           : peakWind > 6000 ? 'MODERATE — mixed wind generation'
           : 'LOW — limited wind, gas likely dominant',
  };
}

// ── REMIT ─────────────────────────────────────────────────────────────────────
// /remit/list/by-publish with 7-day max window — hard API limit
// Followed by bulk fetch /remit?messageId=...

async function fetchREMIT(now) {
  var WEEKS_BACK = 12;
  var WEEKS_FORWARD = 13;

  var ASSETS = [
    { id: 'T_SCCL-1', name: 'Saltend Unit 1', site: 'Saltend Chemicals Park' },
    { id: 'T_SCCL-2', name: 'Saltend Unit 2', site: 'Saltend Chemicals Park' },
    { id: 'T_SCCL-3', name: 'Saltend Unit 3', site: 'Saltend Chemicals Park' },
    { id: 'T_KILNO-1', name: 'Killingholme A', site: 'South Humber Bank' },
    { id: 'T_KILNS-1', name: 'Killingholme B', site: 'South Humber Bank' },
    { id: 'T_KEAD-1', name: 'Keadby 1', site: 'Scunthorpe / Humber' },
    { id: 'T_KEAD-2', name: 'Keadby 2', site: 'Scunthorpe / Humber' },
    { id: 'T_SOHU-1', name: 'South Humber Bank', site: 'South Humber Bank' },
    { id: 'T_TEAB-1', name: 'Teesside Power', site: 'Teesside' },
  ];
  var assetMeta = {};
  ASSETS.forEach(function(a) { assetMeta[a.id] = a; });

  // Build weekly windows
  var windows = [];
  for (var w = -WEEKS_BACK; w < WEEKS_FORWARD; w++) {
    var f = new Date(now.getTime() + w * 7 * 86400000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    var t = new Date(now.getTime() + (w + 1) * 7 * 86400000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    windows.push({ from: f, to: t });
  }

  var msgIds = {};
  var step1 = { requests: 0, ok: 0, errors: 0, sample_error: null };
  var firstSampleUrl = null;

  // Build all asset×window pairs, process in batches
  var pairs = [];
  for (var a = 0; a < ASSETS.length; a++) {
    for (var wi = 0; wi < windows.length; wi++) {
      pairs.push({ asset: ASSETS[a], win: windows[wi] });
    }
  }

  var CHUNK = 15;
  for (var p = 0; p < pairs.length; p += CHUNK) {
    var batch = pairs.slice(p, p + CHUNK);
    await Promise.allSettled(batch.map(async function(pair) {
      step1.requests++;
      var url = BASE + '/remit/list/by-publish?from=' + pair.win.from + '&to=' + pair.win.to + '&assetId=' + pair.asset.id + '&latestRevisionOnly=true';
      if (!firstSampleUrl) firstSampleUrl = url;
      try {
        var r = await ft(url, 6000);
        if (!r.ok) {
          step1.errors++;
          if (!step1.sample_error) {
            var errText = await r.text();
            step1.sample_error = { status: r.status, body: errText.slice(0, 300), url: url };
          }
          return;
        }
        var d = await r.json();
        step1.ok++;
        (d.data || []).forEach(function(m) { if (m.id) msgIds[m.id] = true; });
      } catch (e) {
        step1.errors++;
        if (!step1.sample_error) step1.sample_error = { fetch_err: String(e.message), url: url };
      }
    }));
  }

  var idList = Object.keys(msgIds);

  if (!idList.length) {
    return {
      total_found: 0,
      notices: [],
      monitored_count: ASSETS.length,
      debug: {
        step1: step1,
        windows_count: windows.length,
        assets_count: ASSETS.length,
        sample_url: firstSampleUrl,
        note: 'No message IDs returned',
      },
    };
  }

  // Step 2: bulk fetch
  var allDetails = [];
  var step2 = { requests: 0, ok: 0, items: 0 };
  var BULK = 40;
  for (var i = 0; i < idList.length; i += BULK) {
    var batchIds = idList.slice(i, i + BULK);
    var qs = batchIds.map(function(id) { return 'messageId=' + id; }).join('&');
    step2.requests++;
    try {
      var r2 = await ft(BASE + '/remit?' + qs, 12000);
      if (!r2.ok) continue;
      var d2 = await r2.json();
      step2.ok++;
      (d2.data || []).forEach(function(m) { allDetails.push(m); });
      step2.items = allDetails.length;
    } catch (e) {}
  }

  var nowMs = now.getTime();
  var notices = allDetails.map(function(m) {
    var bmu = m.assetId || m.affectedUnit || '';
    var meta = assetMeta[bmu] || { name: bmu, site: 'Humber / Teesside' };
    var start = m.eventStartTime || '';
    var end = m.eventEndTime || '';
    var sMs = start ? new Date(start).getTime() : 0;
    var eMs = end ? new Date(end).getTime() : 0;
    return {
      bmu: bmu,
      plant_name: meta.name,
      chemical_site: meta.site,
      type: m.unavailabilityType || m.messageType || '',
      reason: m.cause || m.messageHeading || m.relatedInformation || '',
      event_type: m.eventType || '',
      fuel_type: m.fuelType || '',
      unavailable_mw: m.unavailableCapacity != null ? m.unavailableCapacity : null,
      normal_mw: m.normalCapacity != null ? m.normalCapacity : null,
      available_mw: m.availableCapacity != null ? m.availableCapacity : null,
      event_status: m.eventStatus || '',
      publish_time: m.publishTime || m.createdTime || '',
      start: start,
      end: end,
      active: sMs > 0 && eMs > 0 && sMs <= nowMs && eMs >= nowMs,
      upcoming: sMs > nowMs,
      ended: eMs > 0 && eMs < nowMs,
    };
  }).filter(function(n) { return n.bmu && assetMeta[n.bmu]; });

  notices.sort(function(a, b) {
    if (a.active && !b.active) return -1;
    if (!a.active && b.active) return 1;
    if (a.upcoming && !b.upcoming) return -1;
    if (!a.upcoming && b.upcoming) return 1;
    if (a.upcoming && b.upcoming) return new Date(a.start) - new Date(b.start);
    return new Date(b.start) - new Date(a.start);
  });

  return {
    total_found: notices.length,
    notices: notices.slice(0, 50),
    monitored_count: ASSETS.length,
    debug: {
      step1: step1,
      step2: step2,
      unique_ids: idList.length,
      raw_details: allDetails.length,
    },
  };
}
