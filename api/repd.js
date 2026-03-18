// api/repd.js
// Renewable Energy Planning Database — DESNZ / Barbour ABI
// Source: GOV.UK assets CDN (Open Government Licence)
// Fetches latest quarterly CSV, converts BNG→WGS84, returns filtered GeoJSON
// No API key required. Vercel function handles CORS + parsing.

export const config = { maxDuration: 30 };

// Latest REPD CSV URL — update each quarter
// Q4 January 2026 (most recent as of build date)
const REPD_CSV_URL =
  'https://assets.publishing.service.gov.uk/media/6985c316d3f57710b50a9b1f/REPD_Publication_Q4_2025.csv';

// BNG (OSGB36 EPSG:27700) → WGS84 (EPSG:4326)
// Helmert 7-parameter transformation — accurate to ~1m for GB
function bngToWgs84(E, N) {
  if (!E || !N || isNaN(E) || isNaN(N)) return null;
  if (E < 0 || E > 800000 || N < 0 || N > 1300000) return null;

  // Airy 1830 ellipsoid
  const a = 6377563.396, b = 6356256.909;
  const e2 = 1 - (b * b) / (a * a);
  const n = (a - b) / (a + b);
  const F0 = 0.9996012717;
  const lat0 = 49 * Math.PI / 180;
  const lon0 = -2 * Math.PI / 180;
  const N0 = -100000, E0 = 400000;

  let lat = lat0;
  const M0 = b * F0 * ((1 + n + 5/4*n**2 + 5/4*n**3)*(lat0-lat0)
    - (3*n + 3*n**2 + 21/8*n**3)*Math.sin(lat0-lat0)*Math.cos(lat0+lat0)
    + (15/8*n**2 + 15/8*n**3)*Math.sin(2*(lat0-lat0))*Math.cos(2*(lat0+lat0))
    - 35/24*n**3*Math.sin(3*(lat0-lat0))*Math.cos(3*(lat0+lat0)));

  for (let i = 0; i < 10; i++) {
    const M = b * F0 * (
      (1 + n + 5/4*n**2 + 5/4*n**3)*(lat - lat0)
      - (3*n + 3*n**2 + 21/8*n**3)*Math.sin(lat - lat0)*Math.cos(lat + lat0)
      + (15/8*n**2 + 15/8*n**3)*Math.sin(2*(lat - lat0))*Math.cos(2*(lat + lat0))
      - 35/24*n**3*Math.sin(3*(lat - lat0))*Math.cos(3*(lat + lat0))
    );
    lat = lat + (N - N0 - M) / (a * F0);
    if (Math.abs(N - N0 - M) < 1e-5) break;
  }

  const sinLat = Math.sin(lat), cosLat = Math.cos(lat), tanLat = Math.tan(lat);
  const v = a * F0 / Math.sqrt(1 - e2 * sinLat**2);
  const rho = a * F0 * (1 - e2) / (1 - e2 * sinLat**2)**1.5;
  const eta2 = v / rho - 1;

  const VII  = tanLat / (2 * rho * v);
  const VIII = tanLat / (24 * rho * v**3) * (5 + 3*tanLat**2 + eta2 - 9*tanLat**2*eta2);
  const IX   = tanLat / (720 * rho * v**5) * (61 + 90*tanLat**2 + 45*tanLat**4);
  const X    = 1 / (cosLat * v);
  const XI   = 1 / (cosLat * 6 * v**3) * (v/rho + 2*tanLat**2);
  const XII  = 1 / (cosLat * 120 * v**5) * (5 + 28*tanLat**2 + 24*tanLat**4);
  const XIIA = 1 / (cosLat * 5040 * v**7) * (61 + 662*tanLat**2 + 1320*tanLat**4 + 720*tanLat**6);

  const dE = E - E0;
  const latWGS = lat - VII*dE**2 + VIII*dE**4 - IX*dE**6;
  const lonWGS = lon0 + X*dE - XI*dE**3 + XII*dE**5 - XIIA*dE**7;

  // Helmert shift: OSGB36 → WGS84
  const tx=-446.448, ty=125.157, tz=-542.060;
  const rx=-0.1502, ry=-0.2470, rz=-0.8421, s=20.4894;
  const x=6378137*Math.cos(latWGS)*Math.cos(lonWGS);
  const y=6378137*Math.cos(latWGS)*Math.sin(lonWGS);
  const z=6356752.3142*Math.sin(latWGS);
  const xH=tx+(1+s*1e-6)*x-(rz/206265)*y+(ry/206265)*z;
  const yH=ty+(rz/206265)*x+(1+s*1e-6)*y-(rx/206265)*z;
  const zH=tz-(ry/206265)*x+(rx/206265)*y+(1+s*1e-6)*z;
  const pWGS=Math.sqrt(xH**2+yH**2);
  const latFinal=Math.atan2(zH+0.00669438*6356752.3142*(zH/Math.sqrt(pWGS**2+zH**2)),pWGS);
  const lonFinal=Math.atan2(yH,xH);
  return [
    +lonFinal*(180/Math.PI).toFixed(6),
    +latFinal*(180/Math.PI).toFixed(6)
  ];
}

// Status normalisation
function normaliseStatus(raw) {
  const s = (raw || '').toLowerCase();
  if (s.includes('operational'))            return 'Operational';
  if (s.includes('under construction'))     return 'Under Construction';
  if (s.includes('awaiting construction'))  return 'Awaiting Construction';
  if (s.includes('permitted development'))  return 'Permitted Development';
  if (s.includes('planning permission granted') || s.includes('consent granted')) return 'Consented';
  if (s.includes('revised'))                return 'Revised';
  if (s.includes('submitted'))              return 'Application Submitted';
  if (s.includes('withdrawn'))              return 'Withdrawn';
  if (s.includes('refused') || s.includes('refusal')) return 'Refused';
  if (s.includes('appeal granted'))         return 'Appeal Granted';
  if (s.includes('appeal refused'))         return 'Appeal Refused';
  if (s.includes('abandoned'))              return 'Abandoned';
  if (s.includes('decommission'))           return 'Decommissioned';
  return raw || 'Unknown';
}

// Simple CSV parser — handles quoted fields including multi-line
function parseCSV(text) {
  const lines = [];
  let field = '', row = [], inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i+1] === '"') { field += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      row.push(field); field = '';
    } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && text[i+1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(f => f.trim())) lines.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field || row.length) { row.push(field); lines.push(row); }
  return lines;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=43200'); // cache 12 hours — REPD is quarterly
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 25000);
    const r = await fetch(REPD_CSV_URL, {
      signal: controller.signal,
      headers: { 'Accept': 'text/csv,text/plain,*/*' }
    });
    clearTimeout(tid);
    if (!r.ok) throw new Error(`GOV.UK CSV fetch failed: ${r.status}`);

    const text = await r.text();
    const rows = parseCSV(text);
    if (rows.length < 2) throw new Error('CSV parse returned no rows');

    // Build header index
    const headers = rows[0].map(h => h.trim().replace(/^\uFEFF/, ''));
    const idx = {};
    headers.forEach((h, i) => { idx[h] = i; });

    // Key column indices
    const col = {
      refId:        idx['Ref ID'] ?? idx['Old Ref ID'] ?? 1,
      operator:     idx['Operator (or Applicant)'] ?? 3,
      siteName:     idx['Site Name'] ?? 4,
      techType:     idx['Technology Type'] ?? 5,
      capacity:     idx['Installed Capacity (MWelec)'] ?? 8,
      chp:          idx['CHP Enabled'] ?? 10,
      devStatus:    idx['Development Status'] ?? 19,
      devStatusShort: idx['Development Status (short)'] ?? 20,
      county:       idx['County'] ?? 26,
      region:       idx['Region'] ?? 27,
      country:      idx['Country'] ?? 28,
      postcode:     idx['Post Code'] ?? 29,
      easting:      idx['X-coordinate'] ?? 30,
      northing:     idx['Y-coordinate'] ?? 31,
      planningAuth: idx['Planning Authority'] ?? 32,
      planRef:      idx['Planning Application Reference'] ?? 33,
      planSubmit:   idx['Planning Application Submitted'] ?? 41,
      planGranted:  idx['Planning Permission  Granted'] ?? idx['Planning Permission Granted'] ?? 48,
      underConst:   idx['Under Construction'] ?? 53,
      operational:  idx['Operational'] ?? 54,
      cfdRound:     idx['CfD Allocation Round'] ?? 11,
    };

    const features = [];
    let skipped = 0;

    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r || r.length < 5) continue;

      const status = normaliseStatus(r[col.devStatus] || r[col.devStatusShort] || '');

      // Default filter: skip totally dead projects (can be overridden by query param)
      const showAll = req.query.all === '1';
      if (!showAll && (status === 'Abandoned' || status === 'Decommissioned' ||
          status === 'Refused' || status === 'Appeal Refused')) {
        skipped++; continue;
      }

      const E = parseFloat(r[col.easting]);
      const N = parseFloat(r[col.northing]);
      const coords = bngToWgs84(E, N);
      if (!coords) { skipped++; continue; }

      const capacity = parseFloat(r[col.capacity]) || 0;

      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: coords },
        properties: {
          id:          r[col.refId]?.trim() || String(i),
          name:        r[col.siteName]?.trim() || 'Unknown',
          operator:    r[col.operator]?.trim() || '',
          tech:        r[col.techType]?.trim() || 'Unknown',
          status,
          capacity_mw: capacity,
          chp:         (r[col.chp] || '').trim().toLowerCase() === 'yes',
          county:      r[col.county]?.trim() || '',
          region:      r[col.region]?.trim() || '',
          country:     r[col.country]?.trim() || '',
          postcode:    r[col.postcode]?.trim() || '',
          plan_auth:   r[col.planningAuth]?.trim() || '',
          plan_ref:    r[col.planRef]?.trim() || '',
          date_submitted: r[col.planSubmit]?.trim() || '',
          date_granted:   r[col.planGranted]?.trim() || '',
          date_operational: r[col.operational]?.trim() || '',
          cfd_round:   r[col.cfdRound]?.trim() || '',
        }
      });
    }

    // Summary stats
    const techCounts = {}, statusCounts = {};
    features.forEach(f => {
      const t = f.properties.tech;
      const s = f.properties.status;
      techCounts[t] = (techCounts[t] || 0) + 1;
      statusCounts[s] = (statusCounts[s] || 0) + 1;
    });

    res.status(200).json({
      type: 'FeatureCollection',
      features,
      meta: {
        total: features.length,
        skipped,
        source: 'DESNZ / Barbour ABI — Open Government Licence',
        csv_url: REPD_CSV_URL,
        asOf: new Date().toISOString(),
        tech_counts: techCounts,
        status_counts: statusCounts,
      }
    });

  } catch (e) {
    res.status(500).json({ error: e.message, csv_url: REPD_CSV_URL });
  }
}
