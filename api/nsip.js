// api/nsip.js — National Infrastructure Planning (NSIP) projects
// Source: Planning Inspectorate "Find a National Infrastructure Project"
// Fetches the full CSV download (all 271 projects) and filters for
// energy/industrial projects relevant to UK chemical clusters
// Cached 12 hours — project list changes slowly

export const config = { maxDuration: 20 };

const CSV_URL = 'https://national-infrastructure-consenting.planninginspectorate.gov.uk/api/applications-download';
const BASE_URL = 'https://national-infrastructure-consenting.planninginspectorate.gov.uk';

// Sectors relevant to ChemPulse
const RELEVANT_SECTORS = [
  'energy', 'electricity', 'gas', 'pipeline', 'harbour', 'offshore', 'onshore',
  'wind', 'solar', 'battery', 'storage', 'hydrogen', 'carbon capture', 'ccs',
  'nuclear', 'power', 'interconnector', 'transmission', 'substation', 'pylon'
];

// Locations relevant to chemical clusters
const CLUSTER_KEYWORDS = {
  Humber: ['humber','hull','goole','grimsby','keadby','saltend','immingham','scunthorpe','doncaster','lincolnshire','bicker fen','drax','eggborough','ferrybridge','west burton','creyke'],
  Teesside: ['teesside','tees','middlesbrough','hartlepool','lackenby','wilton','seal sands','blyth','northumberland','sunderland'],
  Grangemouth: ['grangemouth','forth','falkirk','fife','longannet'],
  Runcorn: ['runcorn','merseyside','cheshire','deeside','frodsham','stanlow'],
  'South Wales': ['wales','welsh','pembroke','swansea','milford'],
  National: [] // catch-all for nationally significant energy projects
};

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

function getCluster(location, name, description) {
  const haystack = `${location} ${name} ${description}`.toLowerCase();
  for (const [cluster, keywords] of Object.entries(CLUSTER_KEYWORDS)) {
    if (cluster === 'National') continue;
    if (keywords.some(k => haystack.includes(k))) return cluster;
  }
  return null;
}

function isRelevant(sector, name, description) {
  const haystack = `${sector} ${name} ${description}`.toLowerCase();
  return RELEVANT_SECTORS.some(k => haystack.includes(k));
}

function normaliseStage(stage) {
  const s = (stage || '').toLowerCase();
  if (s.includes('pre-application') || s.includes('pre application')) return 'Pre-Application';
  if (s.includes('pre-examination') || s.includes('pre examination')) return 'Pre-Examination';
  if (s.includes('examination')) return 'Examination';
  if (s.includes('recommendation')) return 'Recommendation';
  if (s.includes('decision') && !s.includes('decided')) return 'Decision';
  if (s.includes('decided') || s.includes('granted') || s.includes('refused')) return 'Decided';
  if (s.includes('withdrawn')) return 'Withdrawn';
  return stage || 'Unknown';
}

function stageOrder(stage) {
  const order = ['Pre-Application','Pre-Examination','Examination','Recommendation','Decision','Decided','Withdrawn'];
  const i = order.indexOf(stage);
  return i === -1 ? 99 : i;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=43200, stale-while-revalidate=3600');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 15000);
    const r = await fetch(CSV_URL, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'ChemPulse/1.0 (energy intelligence platform)',
        'Accept': 'text/csv,text/plain,*/*'
      }
    });
    clearTimeout(tid);

    if (!r.ok) throw new Error(`HTTP ${r.status} from Planning Inspectorate`);
    const text = await r.text();

    const rows = parseCSV(text);
    if (rows.length < 2) throw new Error('CSV returned no data');

    // Detect headers
    const headers = rows[0].map(h => h.trim().toLowerCase().replace(/[^a-z0-9\s]/g,'').replace(/\s+/g,' '));
    const fi = (...c) => { for (const s of c) { const i = headers.findIndex(h => h.includes(s)); if (i >= 0) return i; } return -1; };
    const col = {
      ref:         fi('project ref','case ref','reference','project id'),
      name:        fi('project name','case name','name'),
      promoter:    fi('promoter','applicant','developer'),
      location:    fi('location','site location'),
      sector:      fi('sector','category','type'),
      stage:       fi('current stage','stage','status'),
      submitted:   fi('date submitted','date of application','dco submission'),
      decided:     fi('date decided','date of decision','decision date'),
      description: fi('description','summary'),
    };
    const get = (row, k) => col[k] >= 0 ? (row[col[k]] || '').trim() : '';

    const projects = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length < 3) continue;
      const name     = get(row, 'name');
      const location = get(row, 'location');
      const sector   = get(row, 'sector');
      const desc     = get(row, 'description');
      if (!name) continue;

      // Only include energy/industrial relevant projects
      if (!isRelevant(sector, name, desc)) continue;

      const stage   = normaliseStage(get(row, 'stage'));
      const ref     = get(row, 'ref');
      const cluster = getCluster(location, name, desc);

      projects.push({
        ref,
        name,
        promoter:    get(row, 'promoter'),
        location,
        sector,
        stage,
        submitted:   get(row, 'submitted'),
        decided:     get(row, 'decided'),
        cluster:     cluster || 'National',
        url:         ref ? `${BASE_URL}/projects/${ref}` : null,
        active:      !['Decided','Withdrawn'].includes(stage),
      });
    }

    // Sort: active first (by stage progress), then decided
    projects.sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
      return stageOrder(a.stage) - stageOrder(b.stage);
    });

    const stageCounts = {};
    const clusterCounts = {};
    projects.forEach(p => {
      stageCounts[p.stage] = (stageCounts[p.stage] || 0) + 1;
      clusterCounts[p.cluster] = (clusterCounts[p.cluster] || 0) + 1;
    });

    return res.status(200).json({
      projects,
      meta: {
        total: projects.length,
        active: projects.filter(p => p.active).length,
        stage_counts: stageCounts,
        cluster_counts: clusterCounts,
        source: 'Planning Inspectorate — Find a National Infrastructure Project',
        source_url: BASE_URL,
        asOf: new Date().toISOString(),
      }
    });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
