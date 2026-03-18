// api/tec.js
// NESO Transmission Entry Capacity (TEC) Register
// Tries multiple access methods — CSV download first, then CKAN JSON API
// Free, no key required — api.neso.energy

export const config = { maxDuration: 30 };

const NESO_BASE = 'https://api.neso.energy';
const DATASET_ID = 'cbd45e54-e6e2-4a38-99f1-8de6fd96d7c1';
const RESOURCE_ID = '17becbab-e3e8-473f-b303-3806f43a6a10';

// Attempt order:
// 1. CKAN datastore_search JSON API (fastest, structured)
// 2. CKAN resource_show → follow actual download URL → CSV
// 3. Known CSV URL pattern fallback

const GSP_COORDS = {
  'SALTEND':            { lat: 53.7296, lng: -0.2413, cluster: 'Humber',      site: 'Saltend Chemicals Park' },
  'SOUTH HUMBER BANK':  { lat: 53.6215, lng: -0.1956, cluster: 'Humber',      site: 'South Humber Bank industrial' },
  'SOUTH HUMBER':       { lat: 53.6215, lng: -0.1956, cluster: 'Humber',      site: 'South Humber Bank' },
  'KILLINGHOLME':       { lat: 53.6380, lng: -0.2340, cluster: 'Humber',      site: 'South Humber Bank' },
  'KEADBY':             { lat: 53.5890, lng: -0.7420, cluster: 'Humber',      site: 'Keadby / Scunthorpe' },
  'GRIMSBY WEST':       { lat: 53.5630, lng: -0.0960, cluster: 'Humber',      site: 'Grimsby / South Humber' },
  'GRIMSBY':            { lat: 53.5630, lng: -0.0960, cluster: 'Humber',      site: 'Grimsby' },
  'BICKER FEN':         { lat: 52.9770, lng: -0.2070, cluster: 'Humber',      site: 'Lincolnshire coast' },
  'DRAX':               { lat: 53.7367, lng: -1.0261, cluster: 'Humber',      site: 'Drax Power Station' },
  'EGGBOROUGH':         { lat: 53.7163, lng: -1.1189, cluster: 'Humber',      site: 'Yorkshire / Humber' },
  'FERRYBRIDGE':        { lat: 53.7080, lng: -1.2880, cluster: 'Humber',      site: 'Yorkshire' },
  'WEST BURTON':        { lat: 53.3760, lng: -0.7930, cluster: 'Humber',      site: 'Nottinghamshire' },
  'SEAL SANDS':         { lat: 54.6000, lng: -1.1750, cluster: 'Teesside',    site: 'Seal Sands industrial' },
  'TEESSIDE':           { lat: 54.5990, lng: -1.1720, cluster: 'Teesside',    site: 'Teesside' },
  'LACKENBY':           { lat: 54.5880, lng: -1.1490, cluster: 'Teesside',    site: 'Teesside / British Steel' },
  'HARTLEPOOL':         { lat: 54.7000, lng: -1.2550, cluster: 'Teesside',    site: 'Hartlepool' },
  'WILTON':             { lat: 54.5640, lng: -1.0960, cluster: 'Teesside',    site: 'Wilton / NEPIC cluster' },
  'GRANGEMOUTH':        { lat: 56.0020, lng: -3.7150, cluster: 'Grangemouth', site: 'Grangemouth chemicals' },
  'LONGANNET':          { lat: 56.0530, lng: -3.7130, cluster: 'Grangemouth', site: 'Firth of Forth' },
  'MOSSMORRAN':         { lat: 56.0990, lng: -3.3250, cluster: 'Grangemouth', site: 'Shell Mossmorran' },
  'FRODSHAM':           { lat: 53.2960, lng: -2.7280, cluster: 'Runcorn',     site: 'Runcorn / Merseyside' },
  'STANLOW':            { lat: 53.2790, lng: -2.8590, cluster: 'Runcorn',     site: 'Stanlow refinery' },
  'DEESIDE':            { lat: 53.2060, lng: -3.0380, cluster: 'Runcorn',     site: 'Deeside industrial' },
  'HORNSEA':            { lat: 53.9180, lng:  0.1620, cluster: 'Offshore',    site: 'Hornsea offshore wind' },
  'CREYKE BECK':        { lat: 53.8500, lng: -0.4800, cluster: 'Humber',      site: 'Humber coast offshore' },
  'BURBO BANK':         { lat: 53.4850, lng: -3.1750, cluster: 'Offshore',    site: 'Burbo Bank offshore wind' },
  'DUNGENESS':          { lat: 50.9150, lng:  0.9590, cluster: 'Nuclear',     site: 'Dungeness nuclear' },
  'SIZEWELL':           { lat: 52.2140, lng:  1.6200, cluster: 'Nuclear',     site: 'Sizewell nuclear' },
  'HINKLEY':            { lat: 51.2090, lng: -3.1310, cluster: 'Nuclear',     site: 'Hinkley Point nuclear' },
  'HEYSHAM':            { lat: 54.0280, lng: -2.9160, cluster: 'Nuclear',     site: 'Heysham nuclear' },
  'GRAIN':              { lat: 51.4430, lng:  0.7200, cluster: 'Thames',      site: 'Isle of Grain' },
  'KINGSNORTH':         { lat: 51.3860, lng:  0.6280, cluster: 'Thames',      site: 'Medway' },
};

function matchGSP(raw) {
  if (!raw) return null;
  const s = raw.toUpperCase().trim();
  if (GSP_COORDS[s]) return { key: s, ...GSP_COORDS[s] };
  let best = null, bestLen = 0;
  for (const [key, val] of Object.entries(GSP_COORDS)) {
    if (s.includes(key) || key.includes(s.split(' ')[0])) {
      if (key.length > bestLen) { best = { key, ...val }; bestLen = key.length; }
    }
  }
  return best;
}

function normaliseTech(raw) {
  const t = (raw || '').toLowerCase();
  if (t.includes('offshore wind') || t.includes('offshore')) return 'Offshore Wind';
  if (t.includes('onshore wind') || (t.includes('wind') && !t.includes('offshore'))) return 'Wind Onshore';
  if (t.includes('solar') || t.includes('photovoltaic')) return 'Solar';
  if (t.includes('battery') || t.includes('storage')) return 'Battery Storage';
  if (t.includes('hydrogen')) return 'Hydrogen';
  if (t.includes('nuclear')) return 'Nuclear';
  if (t.includes('gas') || t.includes('ccgt') || t.includes('ocgt')) return 'Gas (CCGT/OCGT)';
  if (t.includes('biomass')) return 'Biomass';
  if (t.includes('interconnect')) return 'Interconnector';
  if (t.includes('hydro')) return 'Hydro';
  if (t.includes('tidal') || t.includes('wave') || t.includes('marine')) return 'Marine';
  if (t.includes('carbon capture') || t.includes('ccus') || t.includes('ccs')) return 'CCS/CCUS';
  return raw || 'Other';
}

function parseCSV(text) {
  const rows = [];
  let field = '', row = [], inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (inQ && text[i+1] === '"') { field += '"'; i++; }
      else inQ = !inQ;
    } else if (c === ',' && !inQ) {
      row.push(field.trim()); field = '';
    } else if ((c === '\n' || c === '\r') && !inQ) {
      if (c === '\r' && text[i+1] === '\n') i++;
      row.push(field.trim()); field = '';
      if (row.some(f => f)) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field || row.length) { row.push(field.trim()); rows.push(row); }
  return rows;
}

function buildFeatures(records) {
  if (!records || !records.length) return [];
  
  // Detect header row vs record object
  const isObj = typeof records[0] === 'object' && !Array.isArray(records[0]);
  
  let getField;
  if (isObj) {
    // JSON API records — find fields case-insensitively
    const keys = Object.keys(records[0]);
    const find = (...candidates) => {
      for (const c of candidates) {
        const k = keys.find(k => k.toLowerCase().includes(c.toLowerCase()));
        if (k) return k;
      }
      return null;
    };
    const F = {
      id:       find('Project No', 'Project ID', 'projectno', 'projectid') || keys[0],
      company:  find('Company Name', 'Company', 'company') || keys[1],
      tech:     find('Technology', 'tech') || keys[2],
      tec:      find('TEC', 'Capacity', 'MW', 'tec') || keys[3],
      gsp:      find('GSP', 'Grid Supply Point', 'Substation') || keys[4],
      stage:    find('Stage') || '',
      gate:     find('Gate') || '',
      energy:   find('Energisation', 'Date', 'Year') || '',
      status:   find('Status') || '',
    };
    getField = (rec, key) => String(rec[F[key]] ?? '').trim();
  } else {
    // CSV — first row is headers
    const headers = records[0].map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ''));
    const find = (...candidates) => {
      for (const c of candidates) {
        const idx = headers.findIndex(h => h.includes(c.toLowerCase().replace(/[^a-z0-9]/g, '')));
        if (idx >= 0) return idx;
      }
      return -1;
    };
    const F = {
      id:      find('projectno', 'projectid'),
      company: find('companyname', 'company'),
      tech:    find('technology', 'tech'),
      tec:     find('tec', 'capacity', 'mw'),
      gsp:     find('gsp', 'gridsupply', 'substation'),
      stage:   find('stage'),
      gate:    find('gate'),
      energy:  find('energisation', 'date', 'year'),
      status:  find('status'),
    };
    const dataRows = records.slice(1);
    getField = (rec, key) => F[key] >= 0 ? String(rec[F[key]] ?? '').trim() : '';
    records = dataRows;
  }

  const features = [];
  const unmapped = {};
  for (const rec of records) {
    const gspRaw = getField(rec, 'gsp');
    const matched = matchGSP(gspRaw);
    if (!matched) { unmapped[gspRaw || 'BLANK'] = (unmapped[gspRaw || 'BLANK'] || 0) + 1; }
    const mw = parseFloat(getField(rec, 'tec')) || 0;
    features.push({
      type: 'Feature',
      geometry: matched ? { type: 'Point', coordinates: [matched.lng, matched.lat] } : null,
      properties: {
        project_id:    getField(rec, 'id'),
        company:       getField(rec, 'company'),
        technology:    normaliseTech(getField(rec, 'tech')),
        technology_raw: getField(rec, 'tech'),
        tec_mw:        mw,
        gsp:           gspRaw,
        gsp_matched:   matched?.key || null,
        cluster:       matched?.cluster || null,
        site_context:  matched?.site || null,
        stage:         getField(rec, 'stage'),
        gate:          getField(rec, 'gate'),
        energisation:  getField(rec, 'energy'),
        status:        getField(rec, 'status'),
        has_coords:    !!matched,
      }
    });
  }
  return { features, unmapped };
}

async function tryFetch(url, timeout = 18000) {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(url, {
      headers: { Accept: 'application/json, text/csv, text/plain, */*' },
      signal: ctrl.signal
    });
    clearTimeout(tid);
    return r;
  } catch (e) {
    clearTimeout(tid);
    throw e;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=21600');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const errors = [];
  let records = null;
  let method = '';

  // ── Method 1: CKAN datastore_search JSON ─────────────────────────────────
  try {
    const url = `${NESO_BASE}/api/3/action/datastore_search?resource_id=${RESOURCE_ID}&limit=10000`;
    const r = await tryFetch(url, 15000);
    if (r.ok) {
      const json = await r.json();
      if (json.success && json.result?.records?.length) {
        records = json.result.records;
        method = 'ckan_json';
      } else {
        errors.push(`CKAN JSON: success=${json.success}, records=${json.result?.records?.length ?? 'none'}`);
      }
    } else {
      const body = await r.text().catch(() => '');
      errors.push(`CKAN JSON: HTTP ${r.status} — ${body.slice(0, 200)}`);
    }
  } catch (e) {
    errors.push(`CKAN JSON: ${e.message}`);
  }

  // ── Method 2: resource_show → follow actual download URL ──────────────────
  if (!records) {
    try {
      const r = await tryFetch(
        `${NESO_BASE}/api/3/action/resource_show?id=${RESOURCE_ID}`, 8000
      );
      if (r.ok) {
        const json = await r.json();
        const downloadUrl = json.result?.url;
        if (downloadUrl) {
          const csvR = await tryFetch(downloadUrl, 15000);
          if (csvR.ok) {
            const text = await csvR.text();
            const rows = parseCSV(text);
            if (rows.length > 2) { records = rows; method = 'csv_via_resource_show'; }
            else errors.push(`CSV via resource_show: only ${rows.length} rows`);
          } else {
            errors.push(`CSV download: HTTP ${csvR.status}`);
          }
        } else {
          errors.push('resource_show: no URL in response');
        }
      } else {
        errors.push(`resource_show: HTTP ${r.status}`);
      }
    } catch (e) {
      errors.push(`resource_show: ${e.message}`);
    }
  }

  // ── Method 3: Direct CSV URL (known pattern from similar NESO datasets) ───
  if (!records) {
    const candidates = [
      `${NESO_BASE}/dataset/${DATASET_ID}/resource/${RESOURCE_ID}/download/tec_register.csv`,
      `${NESO_BASE}/dataset/${DATASET_ID}/resource/${RESOURCE_ID}/download/tec-register.csv`,
    ];
    for (const url of candidates) {
      try {
        const r = await tryFetch(url, 12000);
        if (r.ok) {
          const text = await r.text();
          const rows = parseCSV(text);
          if (rows.length > 2) { records = rows; method = `csv_direct:${url.split('/').pop()}`; break; }
        } else {
          errors.push(`CSV direct ${url.split('/').pop()}: HTTP ${r.status}`);
        }
      } catch (e) {
        errors.push(`CSV direct: ${e.message}`);
      }
    }
  }

  if (!records) {
    return res.status(500).json({
      error: 'All NESO fetch methods failed',
      methods_tried: errors,
      resource_id: RESOURCE_ID,
      dataset_id: DATASET_ID,
      hint: 'NESO may be blocking server-side requests. Try accessing https://api.neso.energy/api/3/action/datastore_search?resource_id=17becbab-e3e8-473f-b303-3806f43a6a10&limit=5 directly in your browser to confirm the API is accessible.'
    });
  }

  const { features, unmapped } = buildFeatures(records);

  const techCounts = {}, clusterMW = {};
  let mappedMW = 0, unmappedMW = 0;
  features.forEach(f => {
    const p = f.properties;
    techCounts[p.technology] = (techCounts[p.technology] || 0) + 1;
    if (p.cluster) clusterMW[p.cluster] = (clusterMW[p.cluster] || 0) + (p.tec_mw || 0);
    if (p.has_coords) mappedMW += p.tec_mw;
    else unmappedMW += p.tec_mw;
  });

  res.status(200).json({
    type: 'FeatureCollection',
    features,
    meta: {
      total_features: features.length,
      mapped_to_coords: features.filter(f => f.properties.has_coords).length,
      mapped_mw: Math.round(mappedMW),
      unmapped_mw: Math.round(unmappedMW),
      tech_counts: techCounts,
      cluster_mw: clusterMW,
      top_unmapped_gsps: Object.entries(unmapped).sort((a,b)=>b[1]-a[1]).slice(0,15).map(([gsp,n])=>({gsp,n})),
      fetch_method: method,
      source: 'NESO TEC Register — api.neso.energy — Open Data Licence',
      asOf: new Date().toISOString(),
    }
  });
}
