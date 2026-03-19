// api/tec.js — NESO TEC Register proxy
// 3 strategies: CKAN package_show → datastore JSON → date-guessing
// Cached 6h on Vercel edge (NESO updates Tue/Fri)
export const config = { maxDuration: 30 };

const BASE        = 'https://api.neso.energy';
const DATASET_ID  = 'cbd45e54-e6e2-4a38-99f1-8de6fd96d7c1';
const RESOURCE_ID = '17becbab-e3e8-473f-b303-3806f43a6a10';
const CKAN        = `${BASE}/api/3/action`;
const MONTHS = ['january','february','march','april','may','june',
                'july','august','september','october','november','december'];

function candidateUrls() {
  const urls = [], now = new Date();
  for (let d = 0; d < 70; d++) {
    const dt = new Date(now); dt.setDate(dt.getDate() - d);
    if (dt.getDay() !== 2 && dt.getDay() !== 5) continue;
    const day = dt.getDate(), mon = MONTHS[dt.getMonth()], yr = dt.getFullYear();
    const dl = String(day).padStart(2,'0');
    const pfx = `${BASE}/dataset/${DATASET_ID}/resource/${RESOURCE_ID}/download/tec-register-`;
    urls.push(`${pfx}${dl}-${mon}-${yr}.csv`);
    if (dl !== String(day)) urls.push(`${pfx}${day}-${mon}-${yr}.csv`);
  }
  return [...new Set(urls)];
}

async function fetch2(url, ms=18000) {
  const ctrl = new AbortController();
  const tid = setTimeout(()=>ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal:ctrl.signal, headers:{'User-Agent':'ChemPulse/1.0','Accept':'*/*'} });
    clearTimeout(tid); return r;
  } catch(e) { clearTimeout(tid); throw e; }
}

function isCSV(t) { const h=t.split('\n')[0].toLowerCase(); return h.includes('company')||h.includes('gsp')||(h.includes('tec')&&h.includes(',')); }

function parseCSV(text) {
  const rows=[]; let field='',row=[],inQ=false;
  for (let i=0;i<text.length;i++) {
    const c=text[i];
    if(c==='"'){if(inQ&&text[i+1]==='"'){field+='"';i++;}else inQ=!inQ;}
    else if(c===','&&!inQ){row.push(field.trim());field='';}
    else if((c==='\n'||c==='\r')&&!inQ){
      if(c==='\r'&&text[i+1]==='\n')i++;
      row.push(field.trim());field='';
      if(row.some(f=>f))rows.push(row);row=[];
    } else field+=c;
  }
  if(field||row.length){row.push(field.trim());rows.push(row);}
  return rows;
}

const CLUSTER_MAP={
  SALTEND:'Humber','SOUTH HUMBER':'Humber',KILLINGHOLME:'Humber',KEADBY:'Humber',
  GRIMSBY:'Humber','BICKER FEN':'Humber',DRAX:'Humber',EGGBOROUGH:'Humber',
  FERRYBRIDGE:'Humber','WEST BURTON':'Humber','CREYKE BECK':'Humber',
  'SEAL SANDS':'Teesside',TEESSIDE:'Teesside',LACKENBY:'Teesside',HARTLEPOOL:'Teesside',WILTON:'Teesside',
  GRANGEMOUTH:'Grangemouth',LONGANNET:'Grangemouth',MOSSMORRAN:'Grangemouth',
  FRODSHAM:'Runcorn',STANLOW:'Runcorn',DEESIDE:'Runcorn',BREDBURY:'Runcorn',
  HEYSHAM:'Nuclear',SIZEWELL:'Nuclear',HINKLEY:'Nuclear',DUNGENESS:'Nuclear',TORNESS:'Nuclear',HUNTERSTON:'Nuclear',
  PETERHEAD:'Scotland',BLACKHILLOCK:'Scotland',INVERNESS:'Scotland',HARKER:'Scotland',
};
function getCluster(gsp){
  if(!gsp)return 'Other'; const u=gsp.toUpperCase();
  for(const[k,v]of Object.entries(CLUSTER_MAP))if(u.includes(k))return v;
  if(/YORK|LEEDS|BRADFORD|HULL|LINCOLN|NOTTING|DERBY|SHEFFIELD/.test(u))return 'Yorkshire';
  if(/EDINBURGH|GLASGOW|STIRLING|FIFE|ANGUS|ABERDEEN|HIGHLAND|ARGYLL/.test(u))return 'Scotland';
  if(/WALES|CARDIFF|SWANSEA|NEWPORT|PEMBROKE/.test(u))return 'Wales';
  if(/KENT|SURREY|ESSEX|SUFFOLK|NORFOLK|CAMBS/.test(u))return 'South East';
  if(/DEVON|CORNWALL|DORSET|SOMERSET|WILTS|HANTS/.test(u))return 'South West';
  if(/MIDLAND|BIRMINGHAM|COVENTRY|STAFFORD|WORCESTER/.test(u))return 'Midlands';
  if(/MANCHESTER|LIVERPOOL|LANCASHIRE|CHESHIRE|CUMBRIA/.test(u))return 'North West';
  return 'Other';
}
function normTech(r){
  const t=(r||'').toLowerCase();
  if(t.includes('offshore'))return 'Offshore Wind';
  if(t.includes('wind'))return 'Onshore Wind';
  if(t.includes('solar'))return 'Solar';
  if(t.includes('battery')||t.includes('storage'))return 'Battery Storage';
  if(t.includes('hydrogen'))return 'Hydrogen';
  if(t.includes('nuclear'))return 'Nuclear';
  if(t.includes('gas')||t.includes('ccgt')||t.includes('ocgt'))return 'Gas';
  if(t.includes('biomass'))return 'Biomass';
  if(t.includes('interconnect'))return 'Interconnector';
  if(t.includes('hydro'))return 'Hydro';
  if(t.includes('ccs')||t.includes('ccus'))return 'CCS/CCUS';
  return r||'Other';
}

function buildResponse(records, clusterTot, techCnt, totalMW, meta) {
  records.sort((a,b)=>a.cluster.localeCompare(b.cluster)||b.tec_mw-a.tec_mw);
  const clusters=Object.entries(clusterTot).sort((a,b)=>b[1]-a[1]).map(([c,m])=>({cluster:c,mw:Math.round(m)}));
  return { records, meta:{ total_records:records.length, total_mw:Math.round(totalMW), clusters, tech_counts:techCnt, asOf:new Date().toISOString(), ...meta } };
}

function fromCSVRows(rows, source) {
  const headers=rows[0].map(h=>h.trim().toLowerCase().replace(/[^a-z0-9\s]/g,'').replace(/\s+/g,' '));
  const fi=(...c)=>{for(const s of c){const i=headers.findIndex(h=>h.includes(s));if(i>=0)return i;}return -1;};
  const col={
    id:fi('project no','project id'),company:fi('company name','company'),tech:fi('technology'),
    tec:headers.findIndex(h=>h==='tec'||(h.startsWith('tec')&&!h.includes('stec')&&!h.includes('ldtec')&&!h.includes('temp'))),
    gsp:headers.findIndex(h=>(h.includes('gsp')||h.includes('grid supply'))&&!h.includes('group')&&!h.includes('grp')),
    gspGrp:fi('gsp group','gsp grp'),stage:fi('stage'),gate:fi('gate'),energ:fi('energisation'),status:fi('status'),
  };
  const g=(row,k)=>col[k]>=0?(row[col[k]]||'').trim():'';
  const records=[],clusterTot={},techCnt={};let totalMW=0;
  for(let i=1;i<rows.length;i++){
    const row=rows[i];if(!row||row.length<3)continue;
    const company=g(row,'company'),gsp=g(row,'gsp')||g(row,'gspGrp');
    if(!company&&!gsp)continue;
    const cluster=getCluster(gsp),tech=normTech(g(row,'tech'));
    const mw=parseFloat(g(row,'tec'))||0,gate=g(row,'gate');
    totalMW+=mw;clusterTot[cluster]=(clusterTot[cluster]||0)+mw;techCnt[tech]=(techCnt[tech]||0)+1;
    records.push({project_no:g(row,'id'),company,technology:tech,technology_raw:g(row,'tech'),
      tec_mw:mw,gsp,cluster,stage:g(row,'stage'),gate,
      gate_label:gate==='1'?'Gate 1 — firm':gate==='2'?'Gate 2 — queue':gate||'',
      energisation:g(row,'energ'),status:g(row,'status')});
  }
  return records.length ? buildResponse(records,clusterTot,techCnt,totalMW,{source,strategy:'csv'}) : null;
}

function fromJSONRecs(allRecs) {
  if(!allRecs.length)return null;
  const keys=Object.keys(allRecs[0]);
  const fk=(...n)=>keys.find(k=>n.some(needle=>k.toLowerCase().replace(/[^a-z0-9]/g,'').includes(needle.toLowerCase().replace(/[^a-z0-9]/g,'')))||null);
  const F={
    id:fk('projectno','projectid'),company:fk('companyname','company'),tech:fk('technology'),
    tec:keys.find(k=>{const l=k.toLowerCase().replace(/[^a-z0-9]/g,'');return l==='tec'||(l.startsWith('tec')&&!l.includes('stec')&&!l.includes('ldtec'));}),
    gsp:keys.find(k=>k.toLowerCase().includes('gsp')&&!k.toLowerCase().includes('group')),
    gspgrp:fk('gspgroup'),stage:fk('stage'),gate:fk('gate'),energ:fk('energisation'),status:fk('status'),
  };
  const g=(rec,k)=>F[k]?String(rec[F[k]]??'').trim():'';
  const records=[],clusterTot={},techCnt={};let totalMW=0;
  for(const rec of allRecs){
    const company=g(rec,'company'),gsp=g(rec,'gsp')||g(rec,'gspgrp');
    if(!company&&!gsp)continue;
    const cluster=getCluster(gsp),tech=normTech(g(rec,'tech'));
    const mw=parseFloat(g(rec,'tec'))||0,gate=g(rec,'gate');
    totalMW+=mw;clusterTot[cluster]=(clusterTot[cluster]||0)+mw;techCnt[tech]=(techCnt[tech]||0)+1;
    records.push({project_no:g(rec,'id'),company,technology:tech,technology_raw:g(rec,'tech'),
      tec_mw:mw,gsp,cluster,stage:g(rec,'stage'),gate,
      gate_label:gate==='1'?'Gate 1 — firm':gate==='2'?'Gate 2 — queue':gate||'',
      energisation:g(rec,'energ'),status:g(rec,'status')});
  }
  return records.length ? buildResponse(records,clusterTot,techCnt,totalMW,{strategy:'datastore-json'}) : null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=3600');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const errors = [];

  // Strategy 1: CKAN package_show → real CSV URL
  try {
    const r = await fetch2(`${CKAN}/package_show?id=${DATASET_ID}`, 10000);
    if (r.ok) {
      const d = await r.json();
      const resources = d.result?.resources || [];
      const res2 = resources.find(r=>r.id===RESOURCE_ID) || resources.find(r=>(r.format||'').toUpperCase()==='CSV');
      if (res2?.url) {
        const csvR = await fetch2(res2.url, 20000);
        if (csvR.ok) {
          const text = await csvR.text();
          if (isCSV(text)) {
            const rows = parseCSV(text);
            const result = fromCSVRows(rows, res2.url.split('/').pop());
            if (result) return res.status(200).json(result);
          }
        }
      }
    }
  } catch(e) { errors.push(`S1:${e.message}`); }

  // Strategy 2: CKAN datastore_search JSON (paginated)
  try {
    const PAGE = 5000;
    const r0 = await fetch2(`${CKAN}/datastore_search?resource_id=${RESOURCE_ID}&limit=1`, 8000);
    if (r0.ok) {
      const d0 = await r0.json();
      if (d0.success) {
        const total = d0.result.total, pages = Math.ceil(total/PAGE);
        const all = [];
        for (let p=0; p<pages; p++) {
          const rp = await fetch2(`${CKAN}/datastore_search?resource_id=${RESOURCE_ID}&limit=${PAGE}&offset=${p*PAGE}`, 20000);
          if (!rp.ok) break;
          const dp = await rp.json();
          if (!dp.success) break;
          all.push(...(dp.result.records||[]));
        }
        const result = fromJSONRecs(all);
        if (result) return res.status(200).json(result);
      }
    }
  } catch(e) { errors.push(`S2:${e.message}`); }

  // Strategy 3: date-based CSV filename candidates in batches
  try {
    const candidates = candidateUrls();
    for (let i=0; i<candidates.length; i+=4) {
      const batch = candidates.slice(i,i+4);
      const settled = await Promise.allSettled(
        batch.map(url => fetch2(url,10000).then(async r=>{
          if(!r.ok)return null;
          const t=await r.text();
          return isCSV(t)?{url,text:t}:null;
        }).catch(()=>null))
      );
      const hit = settled.find(s=>s.status==='fulfilled'&&s.value);
      if (hit) {
        const {url,text} = hit.value;
        const result = fromCSVRows(parseCSV(text), url.split('/').pop());
        if (result) return res.status(200).json(result);
      }
    }
  } catch(e) { errors.push(`S3:${e.message}`); }

  return res.status(500).json({ error: 'All strategies failed', details: errors });
}
