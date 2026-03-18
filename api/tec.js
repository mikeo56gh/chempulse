// api/tec.js — NESO TEC Register
// NESO updates this every Tue/Fri. The filename encodes the date.
// We generate candidate URLs for the last 6 weeks and try them in parallel.
// api.neso.energy blocks robots but the CSV downloads work from server-side fetch.

export const config = { maxDuration: 30 };

const BASE        = 'https://api.neso.energy';
const DATASET_ID  = 'cbd45e54-e6e2-4a38-99f1-8de6fd96d7c1';
const RESOURCE_ID = '17becbab-e3e8-473f-b303-3806f43a6a10';

// Generate candidate CSV filenames for the last N weeks
// NESO names them: tec-register-DD-monthname-YYYY.csv
function candidateUrls(weeksBack = 8) {
  const months = ['january','february','march','april','may','june',
                  'july','august','september','october','november','december'];
  const urls = [];
  const now = new Date();

  for (let d = 0; d < weeksBack * 7; d++) {
    const date = new Date(now);
    date.setDate(date.getDate() - d);
    const day   = date.getDate();
    const month = months[date.getMonth()];
    const year  = date.getFullYear();
    const dd    = String(day).padStart(2, '0');
    // Both padded and unpadded variants
    for (const dayStr of [dd, String(day)]) {
      urls.push(`${BASE}/dataset/${DATASET_ID}/resource/${RESOURCE_ID}/download/tec-register-${dayStr}-${month}-${year}.csv`);
    }
  }
  // Deduplicate while preserving order
  return [...new Set(urls)];
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

const CLUSTER_MAP = {
  SALTEND:'Humber','SOUTH HUMBER':'Humber',KILLINGHOLME:'Humber',KEADBY:'Humber',
  GRIMSBY:'Humber','BICKER FEN':'Humber',DRAX:'Humber',EGGBOROUGH:'Humber',
  FERRYBRIDGE:'Humber','WEST BURTON':'Humber','CREYKE BECK':'Humber',
  'SEAL SANDS':'Teesside',TEESSIDE:'Teesside',LACKENBY:'Teesside',
  HARTLEPOOL:'Teesside',WILTON:'Teesside',BLYTH:'Teesside',CAMBOIS:'Teesside',
  GRANGEMOUTH:'Grangemouth',LONGANNET:'Grangemouth',MOSSMORRAN:'Grangemouth',
  DENNY:'Grangemouth',
  FRODSHAM:'Runcorn',STANLOW:'Runcorn',DEESIDE:'Runcorn',BREDBURY:'Runcorn',
  PENWORTHAM:'Runcorn',KEARSLEY:'Runcorn',
  HEYSHAM:'Nuclear',SIZEWELL:'Nuclear',HINKLEY:'Nuclear',
  DUNGENESS:'Nuclear',TORNESS:'Nuclear',HUNTERSTON:'Nuclear',WYLFA:'Nuclear',
  PETERHEAD:'Scotland',BLACKHILLOCK:'Scotland',NAIRN:'Scotland',
  INVERNESS:'Scotland',HARKER:'Scotland',CHAPELCROSS:'Scotland',COALBURN:'Scotland',
};

function getCluster(gsp) {
  if (!gsp) return 'Other';
  const u = gsp.toUpperCase();
  for (const [k, v] of Object.entries(CLUSTER_MAP)) if (u.includes(k)) return v;
  if (/YORK|LEEDS|BRADFORD|HULL|LINCOLN|NOTTING|DERBY|SHEFFIELD/.test(u)) return 'Yorkshire';
  if (/EDINBURGH|GLASGOW|STIRLING|FIFE|ANGUS|ABERDEEN|HIGHLAND|ARGYLL|DUNBAR/.test(u)) return 'Scotland';
  if (/WALES|CARDIFF|SWANSEA|NEWPORT|PEMBROKE/.test(u)) return 'Wales';
  if (/LONDON|KENT|SURREY|ESSEX|SUFFOLK|NORFOLK|CAMBS/.test(u)) return 'South East';
  if (/DEVON|CORNWALL|DORSET|SOMERSET|WILTS|HANTS|BRISTOL/.test(u)) return 'South West';
  if (/MIDLAND|BIRMINGHAM|COVENTRY|STAFFORD|WORCESTER|LEICS/.test(u)) return 'Midlands';
  if (/MANCHESTER|LIVERPOOL|LANCASHIRE|CHESHIRE|CUMBRIA/.test(u)) return 'North West';
  return 'Other';
}

function normTech(raw) {
  const t = (raw||'').toLowerCase();
  if (t.includes('offshore')) return 'Offshore Wind';
  if (t.includes('wind'))     return 'Onshore Wind';
  if (t.includes('solar'))    return 'Solar';
  if (t.includes('battery')||t.includes('storage')) return 'Battery Storage';
  if (t.includes('hydrogen')) return 'Hydrogen';
  if (t.includes('nuclear'))  return 'Nuclear';
  if (t.includes('gas')||t.includes('ccgt')||t.includes('ocgt')) return 'Gas';
  if (t.includes('biomass'))  return 'Biomass';
  if (t.includes('interconnect')) return 'Interconnector';
  if (t.includes('hydro'))    return 'Hydro';
  if (t.includes('tidal')||t.includes('wave')) return 'Marine';
  if (t.includes('ccs')||t.includes('ccus')||t.includes('carbon capture')) return 'CCS/CCUS';
  return raw||'Other';
}

async function tryFetch(url, ms = 12000) {
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'ChemPulse/1.0 (energy intelligence platform; data@chempulse.app)',
        'Accept': 'text/csv,text/plain,*/*'
      }
    });
    clearTimeout(tid);
    return r;
  } catch(e) { clearTimeout(tid); throw e; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=21600');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const candidates = candidateUrls(8);
  let csvText = null;
  let successUrl = null;
  const tried = [];

  // Try up to 20 most-recent candidates, in batches of 5 for speed
  const toTry = candidates.slice(0, 30);
  for (let i = 0; i < toTry.length; i += 5) {
    const batch = toTry.slice(i, i + 5);
    const results = await Promise.allSettled(
      batch.map(url => tryFetch(url, 8000).then(async r => {
        if (!r.ok) return { url, ok: false, status: r.status };
        const text = await r.text();
        // Validate it looks like a CSV (has comma-separated header with known columns)
        const firstLine = text.split('\n')[0].toLowerCase();
        if (!firstLine.includes('company') && !firstLine.includes('gsp') && !firstLine.includes('tec')) {
          return { url, ok: false, status: 'invalid_csv' };
        }
        return { url, ok: true, text };
      }).catch(e => ({ url, ok: false, status: e.message }))
    ));

    for (const r of results) {
      if (r.status === 'fulfilled' && r.value.ok) {
        csvText   = r.value.text;
        successUrl = r.value.url;
        break;
      }
      if (r.status === 'fulfilled') tried.push(`${r.value.url.split('/').pop()}: ${r.value.status}`);
    }
    if (csvText) break;
  }

  if (!csvText) {
    return res.status(500).json({
      error: 'Could not fetch TEC CSV — all candidates failed',
      candidates_tried: tried.slice(0, 10),
      hint: `NESO publishes at: ${BASE}/dataset/${DATASET_ID}/resource/${RESOURCE_ID}/download/tec-register-DD-month-YYYY.csv`
    });
  }

  // Parse CSV
  const rows = parseCSV(csvText);
  if (rows.length < 2) return res.status(500).json({ error: 'CSV has <2 rows', url: successUrl });

  const headers = rows[0].map(h => h.trim().toLowerCase().replace(/[^a-z0-9\s]/g,'').replace(/\s+/g,' '));
  const fi = (...c) => { for (const s of c) { const i = headers.findIndex(h => h.includes(s.toLowerCase())); if (i>=0) return i; } return -1; };
  const col = {
    id:      fi('project no','project id'),
    company: fi('company name','company'),
    tech:    fi('technology'),
    tec:     fi('tec installed','tec mw',) >= 0 ? fi('tec installed','tec mw') : headers.findIndex(h => h === 'tec' || (h.includes('tec') && !h.includes('stec') && !h.includes('ldtec') && !h.includes('temp'))),
    gsp:     fi('grid supply point gsp','gsp name','gsp') >= 0 ? fi('grid supply point gsp','gsp name','gsp') : headers.findIndex(h => h.startsWith('gsp') && !h.includes('group')),
    gspGrp:  fi('gsp group','gsp grp'),
    stage:   fi('stage'),
    gate:    fi('gate'),
    energ:   fi('energisation date','energisation year','energisation'),
    status:  fi('status'),
  };

  const get = (row, k) => col[k] >= 0 ? (row[col[k]] || '').trim() : '';

  const records = [];
  const clusterTot = {}, techCnt = {};
  let totalMW = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length < 3) continue;
    const company = get(row,'company');
    const gsp     = get(row,'gsp') || get(row,'gspGrp');
    if (!company && !gsp) continue;

    const cluster = getCluster(gsp);
    const tech    = normTech(get(row,'tech'));
    const mw      = parseFloat(get(row,'tec')) || 0;
    const gate    = get(row,'gate');

    totalMW += mw;
    clusterTot[cluster] = (clusterTot[cluster]||0) + mw;
    techCnt[tech]       = (techCnt[tech]||0) + 1;

    records.push({
      project_no:  get(row,'id'),
      company,
      technology:  tech,
      technology_raw: get(row,'tech'),
      tec_mw:      mw,
      gsp,
      cluster,
      stage:       get(row,'stage'),
      gate,
      gate_label:  gate==='1'?'Gate 1 — firm': gate==='2'?'Gate 2 — queue': gate||'',
      energisation: get(row,'energ'),
      status:      get(row,'status'),
    });
  }

  records.sort((a,b) => a.cluster.localeCompare(b.cluster) || b.tec_mw - a.tec_mw);

  const clusters = Object.entries(clusterTot)
    .sort((a,b)=>b[1]-a[1])
    .map(([cluster,mw])=>({cluster, mw:Math.round(mw)}));

  res.status(200).json({
    records,
    meta: {
      total_records: records.length,
      total_mw: Math.round(totalMW),
      clusters,
      tech_counts: techCnt,
      csv_url: successUrl,
      headers_detected: headers.slice(0,12),
      col_indices: col,
      source: 'NESO TEC Register — Open Data Licence',
      asOf: new Date().toISOString(),
    }
  });
}
