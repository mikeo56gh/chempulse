// api/tec.js
// NESO Transmission Entry Capacity (TEC) Register
// Free CKAN API — api.neso.energy — no key required
// Resource ID: 17becbab-e3e8-473f-b303-3806f43a6a10
// Updated twice weekly (Tue/Fri)
// Returns all records with GSP coordinates geocoded from known substation locations

export const config = { maxDuration: 30 };

const NESO_API = 'https://api.neso.energy/api/3/action/datastore_search';
const TEC_RESOURCE_ID = '17becbab-e3e8-473f-b303-3806f43a6a10';

// GSP → coordinates lookup
// Covering all substations relevant to UK chemical clusters + major generation hubs
// Coordinates are the substation/grid connection point location
const GSP_COORDS = {
  // ── Humber cluster ────────────────────────────────────────────────────────
  'SALTEND':            { lat: 53.7296, lng: -0.2413, cluster: 'Humber', site: 'Saltend Chemicals Park' },
  'SOUTH HUMBER BANK':  { lat: 53.6215, lng: -0.1956, cluster: 'Humber', site: 'South Humber Bank industrial' },
  'KILLINGHOLME':       { lat: 53.6380, lng: -0.2340, cluster: 'Humber', site: 'South Humber Bank' },
  'KEADBY':             { lat: 53.5890, lng: -0.7420, cluster: 'Humber', site: 'Keadby / Scunthorpe' },
  'GRIMSBY WEST':       { lat: 53.5630, lng: -0.0960, cluster: 'Humber', site: 'Grimsby / South Humber' },
  'BICKER FEN':         { lat: 52.9770, lng: -0.2070, cluster: 'Humber', site: 'Lincolnshire coast' },
  'DRAX':               { lat: 53.7367, lng: -1.0261, cluster: 'Humber', site: 'Drax Power Station' },
  'EGGBOROUGH':         { lat: 53.7163, lng: -1.1189, cluster: 'Humber', site: 'Yorkshire / Humber' },
  'FERRYBRIDGE':        { lat: 53.7080, lng: -1.2880, cluster: 'Humber', site: 'Yorkshire' },
  'WEST BURTON':        { lat: 53.3760, lng: -0.7930, cluster: 'Humber', site: 'Nottinghamshire / Humber' },

  // ── Teesside cluster ──────────────────────────────────────────────────────
  'SEAL SANDS':         { lat: 54.6000, lng: -1.1750, cluster: 'Teesside', site: 'Seal Sands / Teesside industrial' },
  'TEESSIDE':           { lat: 54.5990, lng: -1.1720, cluster: 'Teesside', site: 'Teesside' },
  'LACKENBY':           { lat: 54.5880, lng: -1.1490, cluster: 'Teesside', site: 'Teesside / British Steel' },
  'HARTLEPOOL':         { lat: 54.7000, lng: -1.2550, cluster: 'Teesside', site: 'Hartlepool' },
  'WILTON':             { lat: 54.5640, lng: -1.0960, cluster: 'Teesside', site: 'Wilton / NEPIC cluster' },

  // ── Grangemouth / Scotland ────────────────────────────────────────────────
  'GRANGEMOUTH':        { lat: 56.0020, lng: -3.7150, cluster: 'Grangemouth', site: 'Grangemouth chemicals' },
  'LONGANNET':          { lat: 56.0530, lng: -3.7130, cluster: 'Grangemouth', site: 'Firth of Forth' },
  'MOSSMORRAN':         { lat: 56.0990, lng: -3.3250, cluster: 'Grangemouth', site: 'Shell Mossmorran' },

  // ── Runcorn / Merseyside ──────────────────────────────────────────────────
  'FRODSHAM':           { lat: 53.2960, lng: -2.7280, cluster: 'Runcorn', site: 'Runcorn / Merseyside chemicals' },
  'STANLOW':            { lat: 53.2790, lng: -2.8590, cluster: 'Runcorn', site: 'Stanlow refinery' },
  'DEESIDE':            { lat: 53.2060, lng: -3.0380, cluster: 'Runcorn', site: 'Deeside industrial' },
  'BREDBURY':           { lat: 53.4270, lng: -2.0880, cluster: 'Runcorn', site: 'Greater Manchester' },

  // ── Major offshore wind connection points ─────────────────────────────────
  'HORNSEA':            { lat: 53.9180, lng: 0.1620,  cluster: 'Offshore', site: 'Hornsea offshore wind' },
  'DOGGER BANK':        { lat: 53.7200, lng: -0.2400, cluster: 'Offshore', site: 'Dogger Bank offshore wind' },
  'HUMBER GATEWAY':     { lat: 53.7296, lng: -0.2413, cluster: 'Humber', site: 'Humber Gateway offshore wind' },
  'TRITON KNOLL':       { lat: 53.1740, lng: 0.8000,  cluster: 'Offshore', site: 'Triton Knoll offshore wind' },
  'RACE BANK':          { lat: 53.2500, lng: 0.9500,  cluster: 'Offshore', site: 'Race Bank offshore wind' },

  // ── Thames Estuary / Medway ───────────────────────────────────────────────
  'GRAIN':              { lat: 51.4430, lng: 0.7200,  cluster: 'Thames', site: 'Isle of Grain' },
  'KINGSNORTH':         { lat: 51.3860, lng: 0.6280,  cluster: 'Thames', site: 'Medway' },

  // ── Nuclear ───────────────────────────────────────────────────────────────
  'HEYSHAM':            { lat: 54.0280, lng: -2.9160, cluster: 'Nuclear', site: 'Heysham nuclear' },
  'SIZEWELL':           { lat: 52.2140, lng: 1.6200,  cluster: 'Nuclear', site: 'Sizewell nuclear' },
  'HINKLEY POINT':      { lat: 51.2090, lng: -3.1310, cluster: 'Nuclear', site: 'Hinkley Point nuclear' },
  'HINKLEY':            { lat: 51.2090, lng: -3.1310, cluster: 'Nuclear', site: 'Hinkley Point nuclear' },
  'BRADWELL':           { lat: 51.7400, lng: 0.9030,  cluster: 'Nuclear', site: 'Bradwell' },
  'DUNGENESS':          { lat: 50.9150, lng: 0.9590,  cluster: 'Nuclear', site: 'Dungeness nuclear' },
};

// Fuzzy match a GSP name to our lookup
function matchGSP(rawGsp) {
  if (!rawGsp) return null;
  const gsp = rawGsp.toUpperCase().trim();
  // Exact match first
  if (GSP_COORDS[gsp]) return { key: gsp, ...GSP_COORDS[gsp] };
  // Partial match — find longest key that is contained in the GSP name
  let best = null, bestLen = 0;
  for (const [key, val] of Object.entries(GSP_COORDS)) {
    if (gsp.includes(key) || key.includes(gsp.split(' ')[0])) {
      if (key.length > bestLen) { best = { key, ...val }; bestLen = key.length; }
    }
  }
  return best;
}

// Technology normalisation — TEC register uses varied naming
function normaliseTech(raw) {
  const t = (raw || '').toLowerCase();
  if (t.includes('offshore wind') || t.includes('offshore')) return 'Offshore Wind';
  if (t.includes('onshore wind') || t.includes('wind'))      return 'Wind Onshore';
  if (t.includes('solar') || t.includes('photovoltaic'))     return 'Solar';
  if (t.includes('battery') || t.includes('storage'))        return 'Battery Storage';
  if (t.includes('hydrogen'))                                 return 'Hydrogen';
  if (t.includes('nuclear'))                                  return 'Nuclear';
  if (t.includes('gas') || t.includes('ccgt') || t.includes('ocgt')) return 'Gas (CCGT/OCGT)';
  if (t.includes('biomass'))                                  return 'Biomass';
  if (t.includes('interconnect'))                             return 'Interconnector';
  if (t.includes('hydro'))                                    return 'Hydro';
  if (t.includes('tidal') || t.includes('wave') || t.includes('marine')) return 'Marine';
  if (t.includes('carbon capture') || t.includes('ccus'))    return 'CCS/CCUS';
  return raw || 'Other';
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=21600'); // cache 6 hours — updated twice weekly
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // Fetch all TEC records — CKAN supports up to 32000 rows per request
    // TEC register is ~5,000–8,000 rows so one request covers it
    const url = `${NESO_API}?resource_id=${TEC_RESOURCE_ID}&limit=10000`;
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 20000);
    const r = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal
    });
    clearTimeout(tid);

    if (!r.ok) throw new Error(`NESO API ${r.status}: ${r.statusText}`);
    const json = await r.json();
    if (!json.success) throw new Error('NESO API returned success=false');

    const records = json.result?.records || [];
    const total   = json.result?.total   || records.length;

    // Discover field names from first record (they change occasionally)
    const sample = records[0] || {};
    const keys = Object.keys(sample);
    // Field name detection — case-insensitive partial match
    const findField = (...candidates) => {
      for (const c of candidates) {
        const k = keys.find(k => k.toLowerCase().replace(/[^a-z]/g,'').includes(c.toLowerCase().replace(/[^a-z]/g,'')));
        if (k) return k;
      }
      return null;
    };
    const F = {
      projectId:    findField('Project ID', 'projectid', 'ProjectID') || 'Project ID',
      projectNo:    findField('Project No', 'projectno') || 'Project No',
      company:      findField('Company Name', 'company') || 'Company Name',
      technology:   findField('Technology', 'tech') || 'Technology',
      tec:          findField('TEC', 'Installed Capacity', 'capacity') || 'TEC',
      gsp:          findField('GSP', 'Grid Supply Point', 'substation') || 'GSP',
      gspGroup:     findField('GSP Group', 'gspgroup') || 'GSP Group',
      stage:        findField('Stage', 'stage') || 'Stage',
      gate:         findField('Gate', 'gate') || 'Gate',
      energisation: findField('Energisation', 'Date', 'year') || 'Energisation Date',
      status:       findField('Status', 'status') || 'Status',
    };

    const features = [];
    const unmapped = {};

    for (const rec of records) {
      const gspRaw = rec[F.gsp] || rec[F.gspGroup] || '';
      const matched = matchGSP(gspRaw);
      const mwRaw = rec[F.tec];
      const mw = parseFloat(mwRaw) || 0;

      if (!matched) {
        // Track unmapped GSPs for debugging
        const key = gspRaw || 'UNKNOWN';
        unmapped[key] = (unmapped[key] || 0) + 1;
      }

      features.push({
        type: 'Feature',
        geometry: matched
          ? { type: 'Point', coordinates: [matched.lng, matched.lat] }
          : null,
        properties: {
          project_id:   (rec[F.projectId] || rec[F.projectNo] || '').trim(),
          company:      (rec[F.company] || '').trim(),
          technology:   normaliseTech(rec[F.technology] || ''),
          technology_raw: (rec[F.technology] || '').trim(),
          tec_mw:       mw,
          gsp:          gspRaw.trim(),
          gsp_matched:  matched ? matched.key : null,
          cluster:      matched?.cluster || null,
          site_context: matched?.site || null,
          stage:        (rec[F.stage] || '').trim(),
          gate:         (rec[F.gate] || '').trim(),
          energisation: (rec[F.energisation] || '').trim(),
          status:       (rec[F.status] || '').trim(),
          has_coords:   !!matched,
        }
      });
    }

    // Summary stats
    const techCounts = {}, clusterCounts = {}, gspTotals = {};
    let mappedMW = 0, unmappedMW = 0;
    features.forEach(f => {
      const p = f.properties;
      techCounts[p.technology] = (techCounts[p.technology] || 0) + 1;
      if (p.cluster) clusterCounts[p.cluster] = (clusterCounts[p.cluster] || 0) + (p.tec_mw || 0);
      if (p.gsp) gspTotals[p.gsp] = (gspTotals[p.gsp] || 0) + (p.tec_mw || 0);
      if (p.has_coords) mappedMW += p.tec_mw;
      else unmappedMW += p.tec_mw;
    });

    // Sort unmapped by count for debugging
    const topUnmapped = Object.entries(unmapped)
      .sort((a,b) => b[1]-a[1]).slice(0,20)
      .map(([gsp, count]) => ({ gsp, count }));

    res.status(200).json({
      type: 'FeatureCollection',
      features,
      meta: {
        total_records: total,
        total_features: features.length,
        mapped_to_coords: features.filter(f => f.properties.has_coords).length,
        mapped_mw: Math.round(mappedMW),
        unmapped_mw: Math.round(unmappedMW),
        tech_counts: techCounts,
        cluster_mw: clusterCounts,
        top_unmapped_gsps: topUnmapped,
        fields_detected: F,
        source: 'NESO TEC Register — api.neso.energy — Open Data Licence',
        resource_id: TEC_RESOURCE_ID,
        asOf: new Date().toISOString(),
      }
    });

  } catch(e) {
    res.status(500).json({ error: e.message, resource_id: TEC_RESOURCE_ID });
  }
}
