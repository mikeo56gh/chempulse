// api/tec.js — NESO TEC Register
// Downloads CSV directly from known URL, falls back to date-guessing
// Cached 6h on Vercel edge (NESO updates Tue/Fri)

export const config = { maxDuration: 30 };

const BASE        = 'https://api.neso.energy';
const DATASET_ID  = 'cbd45e54-e6e2-4a38-99f1-8de6fd96d7c1';
const RESOURCE_ID = '17becbab-e3e8-473f-b303-3806f43a6a10';
const DL_BASE     = `${BASE}/dataset/${DATASET_ID}/resource/${RESOURCE_ID}/download/tec-register-`;
const MONTHS      = ['january','february','march','april','may','june',
                     'july','august','september','october','november','december'];

// Build candidate URLs — every Tue/Fri going back 90 days + known recent dates
function candidateUrls() {
  const urls = [];
  const now = new Date();

  // Known recent files first (highest chance of success)
  urls.push(`${DL_BASE}31-march-2026.csv`);
  urls.push(`${DL_BASE}28-march-2026.csv`);
  urls.push(`${DL_BASE}25-march-2026.csv`);
  urls.push(`${DL_BASE}18-march-2026.csv`);
  urls.push(`${DL_BASE}11-march-2026.csv`);
  urls.push(`${DL_BASE}04-march-2026.csv`);

  // Then generate Tue/Fri candidates going back 90 days
  for (let d = 0; d < 90; d++) {
    const dt = new Date(now);
    dt.setDate(dt.getDate() - d);
    if (dt.getDay() !== 2 && dt.getDay() !== 5) continue; // Tue=2, Fri=5
    const day = dt.getDate();
    const mon = MONTHS[dt.getMonth()];
    const yr  = dt.getFullYear();
    const dl  = String(day).padStart(2, '0');
    urls.push(`${DL_BASE}${dl}-${mon}-${yr}.csv`);
    if (String(day) !== dl) urls.push(`${DL_BASE}${day}-${mon}-${yr}.csv`);
  }

  // Deduplicate preserving order
  return [...new Map(urls.map(u => [u, u])).values()];
}

function ft(url, ms = 15000) {
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, {
    headers: { 'User-Agent': 'ChemPulse/1.0', Accept: '*/*' },
    signal: ctrl.signal
  }).finally(() => clearTimeout(tid));
}

function isCSV(text) {
  const h = text.slice(0, 500).toLowerCase();
  return h.includes(',') && (
    h.includes('company') || h.includes('tec') || h.includes('gsp') ||
    h.includes('technology') || h.includes('project') || h.includes('capacity')
  );
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
    } else {
      field += c;
    }
  }
  if (field || row.length) { row.push(field.trim()); rows.push(row); }
  return rows;
}

const CLUSTER_MAP = {
  'SALTEND':'Humber','SOUTH HUMBER':'Humber','KILLINGHOLME':'Humber','KEADBY':'Humber',
  'GRIMSBY':'Humber','BICKER FEN':'Humber','DRAX':'Humber','CREYKE BECK':'Humber',
  'FERRYBRIDGE':'Humber','WEST BURTON':'Humber','EGGBOROUGH':'Humber',
  'SEAL SANDS':'Teesside','TEESSIDE':'Teesside','LACKENBY':'Teesside','WILTON':'Teesside','HARTLEPOOL':'Teesside',
  'GRANGEMOUTH':'Grangemouth','LONGANNET':'Grangemouth','MOSSMORRAN':'Grangemouth',
  'FRODSHAM':'Runcorn','STANLOW':'Runcorn','DEESIDE':'Runcorn','BREDBURY':'Runcorn',
  'HEYSHAM':'Nuclear','SIZEWELL':'Nuclear','HINKLEY':'Nuclear','TORNESS':'Nuclear','HUNTERSTON':'Nuclear',
};

function getCluster(gsp) {
  if (!gsp) return 'Other';
  const u = gsp.toUpperCase();
  for (const [k, v] of Object.entries(CLUSTER_MAP)) if (u.includes(k)) return v;
  if (/YORK|LEEDS|BRADFORD|HULL|LINCOLN|NOTTING|DERBY|SHEFFIELD/.test(u)) return 'Yorkshire';
  if (/EDINBURGH|GLASGOW|STIRLING|FIFE|ABERDEEN|HIGHLAND|PETERHEAD|BLACKHILLOCK/.test(u)) return 'Scotland';
  if (/WALES|CARDIFF|SWANSEA|NEWPORT|PEMBROKE/.test(u)) return 'Wales';
  if (/KENT|SURREY|ESSEX|SUFFOLK|NORFOLK|CAMBS/.test(u)) return 'South East';
  if (/DEVON|CORNWALL|DORSET|SOMERSET|WILTS|HANTS/.test(u)) return 'South West';
  if (/MIDLAND|BIRMINGHAM|COVENTRY|STAFFORD|WORCESTER/.test(u)) return 'Midlands';
  if (/MANCHESTER|LIVERPOOL|LANCASHIRE|CHESHIRE|CUMBRIA/.test(u)) return 'North West';
  return 'Other';
}

function normTech(r) {
  const t = (r || '').toLowerCase();
  if (t.includes('offshore'))  return 'Offshore Wind';
  if (t.includes('wind'))      return 'Onshore Wind';
  if (t.includes('solar'))     return 'Solar';
  if (t.includes('battery') || t.includes('storage') || t.includes('energy storage')) return 'Battery Storage';
  if (t.includes('hydrogen'))  return 'Hydrogen';
  if (t.includes('nuclear'))   return 'Nuclear';
  if (t.includes('ccgt') || t.includes('ocgt') || (t.includes('gas') && !t.includes('storage'))) return 'Gas';
  if (t.includes('biomass'))   return 'Biomass';
  if (t.includes('interconnect')) return 'Interconnector';
  if (t.includes('hydro'))     return 'Hydro';
  if (t.includes('ccs') || t.includes('ccus')) return 'CCS/CCUS';
  return r || 'Other';
}

function processRows(rows, sourceFile) {
  if (rows.length < 2) return null;

  const headers = rows[0].map(h =>
    h.trim().toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ')
  );
  const fi = (...needles) => {
    for (const n of needles) {
      const i = headers.findIndex(h => h.includes(n));
      if (i >= 0) return i;
    }
    return -1;
  };

  const col = {
    id:      fi('project no', 'project id', 'project number'),
    company: fi('customer name', 'company name', 'company'),
    tech:    fi('plant type', 'technology type', 'technology'),
    tec:     fi('cumulative total capacity', 'tec mw', 'mw increase', 'installed capacity', 'tec'),
    gsp:     fi('connection site', 'grid supply point', 'gsp name', 'gsp'),
    gspGrp:  fi('gsp group', 'gsp grp'),
    stage:   fi('stage'),
    gate:    fi('gate'),
    energ:   fi('energisation date', 'energisation', 'mw effective from'),
    status:  fi('project status', 'connection status', 'status'),
  };

  const g = (row, k) => col[k] >= 0 ? (row[col[k]] || '').trim() : '';

  const records = [], clusterTot = {}, techCnt = {};
  let totalMW = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length < 3) continue;
    const company = g(row, 'company');
    const gsp     = g(row, 'gsp') || g(row, 'gspGrp');
    if (!company && !gsp) continue;

    const cluster = getCluster(gsp);
    const tech    = normTech(g(row, 'tech'));
    const mw      = Math.abs(parseFloat(g(row, 'tec')) || 0);
    const gate    = g(row, 'gate');

    totalMW += mw;
    clusterTot[cluster] = (clusterTot[cluster] || 0) + mw;
    techCnt[tech]       = (techCnt[tech] || 0) + 1;

    records.push({
      project_no:       g(row, 'id'),
      company,
      technology:       tech,
      technology_raw:   g(row, 'tech'),
      tec_mw:           mw,
      gsp,
      cluster,
      stage:            g(row, 'stage'),
      gate,
      gate_label:       gate === '1' ? 'Gate 1 — firm' : gate === '2' ? 'Gate 2 — queue' : gate || '',
      energisation:     g(row, 'energ'),
      status:           g(row, 'status'),
    });
  }

  if (!records.length) return null;

  records.sort((a, b) => a.cluster.localeCompare(b.cluster) || b.tec_mw - a.tec_mw);
  const clusters = Object.entries(clusterTot)
    .sort((a, b) => b[1] - a[1])
    .map(([cluster, mw]) => ({ cluster, mw: Math.round(mw) }));

  return {
    records,
    meta: {
      total_records: records.length,
      total_mw:      Math.round(totalMW),
      clusters,
      tech_counts:   techCnt,
      source:        sourceFile,
      asOf:          new Date().toISOString(),
    }
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=3600');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const candidates = candidateUrls();
  const errors = [];

  // Try candidates in batches of 4 in parallel
  for (let i = 0; i < candidates.length; i += 4) {
    const batch = candidates.slice(i, i + 4);
    const results = await Promise.allSettled(
      batch.map(url =>
        ft(url, 12000)
          .then(async r => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const text = await r.text();
            if (!isCSV(text)) throw new Error('Not a CSV');
            return { url, text };
          })
          .catch(e => { errors.push(`${url.split('/').pop()}: ${e.message}`); return null; })
      )
    );

    const hit = results.find(r => r.status === 'fulfilled' && r.value);
    if (hit) {
      const { url, text } = hit.value;
      const rows   = parseCSV(text);
      const result = processRows(rows, url.split('/').pop());
      if (result) return res.status(200).json(result);
      errors.push(`${url.split('/').pop()}: parsed 0 records`);
    }
  }

  return res.status(500).json({
    error: 'Could not load TEC register from NESO',
    tried: candidates.slice(0, 8).map(u => u.split('/').pop()),
    details: errors.slice(0, 10),
  });
}
