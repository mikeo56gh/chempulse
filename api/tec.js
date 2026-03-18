// api/tec.js — NESO TEC Register via CSV download (no CORS issues)
// The CKAN datapackage_show endpoint reveals the current CSV filename
// CSV is then fetched, parsed, and returned as structured JSON
// Free, no key, Open Data Licence — api.neso.energy
// Updated by NESO twice weekly (Tue/Fri)

export const config = { maxDuration: 30 };

const DATASET_ID   = 'cbd45e54-e6e2-4a38-99f1-8de6fd96d7c1';
const RESOURCE_ID  = '17becbab-e3e8-473f-b303-3806f43a6a10';
const BASE         = 'https://api.neso.energy';

// Cluster assignment by GSP keyword
const GSP_CLUSTER = {
  // Humber
  SALTEND:'Humber', 'SOUTH HUMBER':'Humber', KILLINGHOLME:'Humber',
  KEADBY:'Humber', GRIMSBY:'Humber', 'BICKER FEN':'Humber',
  DRAX:'Humber', EGGBOROUGH:'Humber', FERRYBRIDGE:'Humber',
  'WEST BURTON':'Humber', 'CREYKE BECK':'Humber',
  // Teesside
  'SEAL SANDS':'Teesside', TEESSIDE:'Teesside', LACKENBY:'Teesside',
  HARTLEPOOL:'Teesside', WILTON:'Teesside', NUNTHORPE:'Teesside',
  BLYTH:'Teesside', CAMBOIS:'Teesside',
  // Grangemouth / Scotland central
  GRANGEMOUTH:'Grangemouth', LONGANNET:'Grangemouth', MOSSMORRAN:'Grangemouth',
  DENNY:'Grangemouth', 'BONNYBRIDGE':'Grangemouth',
  // Runcorn / North West
  FRODSHAM:'Runcorn', STANLOW:'Runcorn', DEESIDE:'Runcorn',
  BREDBURY:'Runcorn', PENWORTHAM:'Runcorn', KEARSLEY:'Runcorn',
  'RAIN HILL':'Runcorn', 'LISTER DRIVE':'Runcorn',
  // Nuclear
  HEYSHAM:'Nuclear', SIZEWELL:'Nuclear', HINKLEY:'Nuclear',
  DUNGENESS:'Nuclear', TORNESS:'Nuclear', HUNTERSTON:'Nuclear',
  WYLFA:'Nuclear', DOUNREAY:'Nuclear',
  // Scotland
  PETERHEAD:'Scotland', BLACKHILLOCK:'Scotland', NAIRN:'Scotland',
  INVERNESS:'Scotland', BEAUTY:'Scotland', HARKER:'Scotland',
  CHAPELCROSS:'Scotland', COALBURN:'Scotland', KAIMES:'Scotland',
  GORGIE:'Scotland', ANDERSON:'Scotland', TEALING:'Scotland',
  DUNDEE:'Scotland', PERTH:'Scotland', DUNBAR:'Scotland',
};

function getCluster(gsp) {
  if (!gsp) return 'Other';
  const u = gsp.toUpperCase();
  for (const [key, cluster] of Object.entries(GSP_CLUSTER)) {
    if (u.includes(key)) return cluster;
  }
  // Regional fallbacks
  if (/YORK|LEEDS|BRADFORD|HULL|LINCOLN|NOTTING|DERBY|SHEFFIELD|BARNSLEY/.test(u)) return 'Yorkshire';
  if (/EDINBURGH|GLASGOW|STIRLING|FIFE|ANGUS|ABERDEEN|HIGHLAND|ARGYLL/.test(u)) return 'Scotland';
  if (/WALES|CARDIFF|SWANSEA|NEWPORT|PEMBROKE|ABERYSTWYTH/.test(u)) return 'Wales';
  if (/LONDON|KENT|SURREY|ESSEX|SUFFOLK|NORFOLK|CAMBS|BEDS|HERTS/.test(u)) return 'South East';
  if (/DEVON|CORNWALL|DORSET|SOMERSET|WILTS|HANTS|BRISTOL/.test(u)) return 'South West';
  if (/MIDLAND|BIRMINGHAM|COVENTRY|STAFFORD|WORCESTER|LEICS|NORTHANTS/.test(u)) return 'Midlands';
  if (/MANCHESTER|LIVERPOOL|LANCASHIRE|CHESHIRE|CUMBRIA/.test(u)) return 'North West';
  return 'Other';
}

function normTech(raw) {
  const t = (raw || '').toLowerCase();
  if (t.includes('offshore')) return 'Offshore Wind';
  if (t.includes('wind'))     return 'Onshore Wind';
  if (t.includes('solar'))    return 'Solar';
  if (t.includes('battery') || t.includes('storage')) return 'Battery Storage';
  if (t.includes('hydrogen')) return 'Hydrogen';
  if (t.includes('nuclear'))  return 'Nuclear';
  if (t.includes('gas') || t.includes('ccgt') || t.includes('ocgt')) return 'Gas';
  if (t.includes('biomass'))  return 'Biomass';
  if (t.includes('interconnect')) return 'Interconnector';
  if (t.includes('hydro'))    return 'Hydro';
  if (t.includes('tidal') || t.includes('wave')) return 'Marine';
  if (t.includes('ccs') || t.includes('ccus') || t.includes('carbon capture')) return 'CCS/CCUS';
  return raw || 'Other';
}

function parseCSV(text) {
  const rows = [];
  let field = '', row = [], inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (inQ && text[i+1] === '"') { field += '"'; i++; } else inQ = !inQ; }
    else if (c === ',' && !inQ) { row.push(field.trim()); field = ''; }
    else if ((c === '\n' || c === '\r') && !inQ) {
      if (c === '\r' && text[i+1] === '\n') i++;
      row.push(field.trim()); field = '';
      if (row.some(f => f)) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field || row.length) { row.push(field.trim()); rows.push(row); }
  return rows;
}

async function get(url, timeout = 15000) {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), timeout);
  const r = await fetch(url, { headers: { Accept: '*/*' }, signal: ctrl.signal });
  clearTimeout(tid);
  return r;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=21600');
  if (req.method === 'OPTIONS') return res.status(200).end();

  let csvUrl = null;

  // Step 1: discover current CSV filename via datapackage_show
  try {
    const r = await get(`${BASE}/api/3/action/datapackage_show?id=${DATASET_ID}`, 8000);
    if (r.ok) {
      const j = await r.json();
      const resources = j.result?.resources || [];
      const res0 = resources.find(r => r.id === RESOURCE_ID) || resources[0];
      if (res0?.path) csvUrl = res0.path.startsWith('http') ? res0.path : BASE + res0.path;
      if (res0?.url)  csvUrl = res0.url;
    }
  } catch(e) {}

  // Step 2: fallback to known static URL pattern (update date in filename)
  if (!csvUrl) {
    csvUrl = `${BASE}/dataset/${DATASET_ID}/resource/${RESOURCE_ID}/download/tec-register-27-january-2026.csv`;
  }

  // Step 3: fetch and parse CSV
  let csvText = null;
  const errors = [];
  for (const url of [csvUrl, csvUrl.replace('27-january-2026', '18-march-2026'), csvUrl.replace('27-january-2026','14-march-2025')]) {
    try {
      const r = await get(url, 20000);
      if (r.ok) { csvText = await r.text(); break; }
      else errors.push(`${url.split('/').pop()}: HTTP ${r.status}`);
    } catch(e) { errors.push(`${url.split('/').pop()}: ${e.message}`); }
  }

  if (!csvText) {
    return res.status(500).json({ error: 'Could not fetch TEC CSV', tried: errors, csvUrl });
  }

  const rows = parseCSV(csvText);
  if (rows.length < 2) return res.status(500).json({ error: 'CSV parse returned <2 rows' });

  // Build header index
  const headers = rows[0].map(h => h.trim().toLowerCase().replace(/[^a-z0-9\s]/g,'').replace(/\s+/g,' '));
  const col = {
    projectNo:  headers.findIndex(h => h.includes('project no')),
    projectId:  headers.findIndex(h => h.includes('project id') && !h.includes('old')),
    company:    headers.findIndex(h => h.includes('company')),
    technology: headers.findIndex(h => h.includes('technology')),
    tec:        headers.findIndex(h => h === 'tec' || h.includes('installed capacity') || (h.includes('tec') && !h.includes('stec') && !h.includes('ldtec'))),
    gsp:        headers.findIndex(h => h.includes('gsp') && !h.includes('group')),
    gspGroup:   headers.findIndex(h => h.includes('gsp group') || h.includes('gsp grp')),
    stage:      headers.findIndex(h => h === 'stage'),
    gate:       headers.findIndex(h => h === 'gate'),
    energDate:  headers.findIndex(h => h.includes('energisation') || (h.includes('date') && !h.includes('application'))),
    status:     headers.findIndex(h => h === 'status'),
  };

  const get_ = (row, key) => col[key] >= 0 ? (row[col[key]] || '').trim() : '';

  const records = [];
  const clusterTotals = {}, techCounts = {};
  let totalMW = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.length < 3) continue;
    const gsp = get_(row,'gsp') || get_(row,'gspGroup');
    const cluster = getCluster(gsp);
    const tech = normTech(get_(row,'technology'));
    const mw = parseFloat(get_(row,'tec')) || 0;
    const gate = get_(row,'gate');
    const company = get_(row,'company');
    if (!company && !gsp) continue; // skip blank rows

    totalMW += mw;
    clusterTotals[cluster] = (clusterTotals[cluster] || 0) + mw;
    techCounts[tech] = (techCounts[tech] || 0) + 1;

    records.push({
      project_no:  get_(row,'projectNo') || get_(row,'projectId'),
      company,
      technology:  tech,
      technology_raw: get_(row,'technology'),
      tec_mw:      mw,
      gsp,
      gsp_group:   get_(row,'gspGroup'),
      cluster,
      stage:       get_(row,'stage'),
      gate,
      gate_label:  gate === '1' ? 'Gate 1 — firm' : gate === '2' ? 'Gate 2 — queue' : gate || '',
      energisation: get_(row,'energDate'),
      status:      get_(row,'status'),
    });
  }

  // Sort by cluster then MW descending
  records.sort((a,b) => {
    if (a.cluster !== b.cluster) return a.cluster.localeCompare(b.cluster);
    return b.tec_mw - a.tec_mw;
  });

  const clustersSorted = Object.entries(clusterTotals)
    .sort((a,b) => b[1]-a[1])
    .map(([cluster, mw]) => ({ cluster, mw: Math.round(mw) }));

  res.status(200).json({
    records,
    meta: {
      total_records: records.length,
      total_mw: Math.round(totalMW),
      clusters: clustersSorted,
      tech_counts: techCounts,
      csv_url: csvUrl,
      source: 'NESO TEC Register — Open Data Licence',
      asOf: new Date().toISOString(),
    }
  });
}
