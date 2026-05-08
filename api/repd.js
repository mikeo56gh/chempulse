// api/repd.js
// Renewable Energy Planning Database — DESNZ / Barbour ABI
// Source: GOV.UK assets CDN (Open Government Licence)
// Returns GeoJSON FeatureCollection with simple fast BNG→WGS84 transform

export const config = { maxDuration: 60 };

const REPD_CSV_URL =
  'https://assets.publishing.service.gov.uk/media/6985c316d3f57710b50a9b1f/REPD_Publication_Q4_2025.csv';

// Simplified BNG → WGS84 conversion (Ordnance Survey approximate algorithm)
// Accurate to ~5m which is plenty for renewable project mapping
function bngToWgs84(E, N) {
  if (!E || !N || isNaN(E) || isNaN(N) || E < 1000 || N < 1000) return null;
  if (E > 800000 || N > 1300000) return null;

  const a = 6377563.396, b = 6356256.909;
  const F0 = 0.9996012717;
  const lat0 = 49 * Math.PI / 180;
  const lon0 = -2 * Math.PI / 180;
  const N0 = -100000, E0 = 400000;
  const e2 = 1 - (b*b)/(a*a);
  const n = (a-b)/(a+b);
  const n2 = n*n, n3 = n*n*n;

  let lat = (N - N0) / (a*F0) + lat0;
  for (let i = 0; i < 6; i++) {
    const M = b * F0 * (
      (1 + n + 5/4*n2 + 5/4*n3) * (lat - lat0)
      - (3*n + 3*n2 + 21/8*n3) * Math.sin(lat - lat0) * Math.cos(lat + lat0)
      + (15/8*n2 + 15/8*n3) * Math.sin(2*(lat - lat0)) * Math.cos(2*(lat + lat0))
      - 35/24*n3 * Math.sin(3*(lat - lat0)) * Math.cos(3*(lat + lat0))
    );
    lat = lat + (N - N0 - M) / (a*F0);
  }

  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const tanLat = Math.tan(lat);
  const tan2Lat = tanLat*tanLat;
  const tan4Lat = tan2Lat*tan2Lat;

  const v = a*F0 / Math.sqrt(1 - e2*sinLat*sinLat);
  const rho = a*F0 * (1 - e2) / Math.pow(1 - e2*sinLat*sinLat, 1.5);
  const eta2 = v/rho - 1;

  const VII  = tanLat / (2*rho*v);
  const VIII = tanLat / (24*rho*v*v*v) * (5 + 3*tan2Lat + eta2 - 9*tan2Lat*eta2);
  const IX   = tanLat / (720*rho*v*v*v*v*v) * (61 + 90*tan2Lat + 45*tan4Lat);
  const X    = 1 / (cosLat*v);
  const XI   = 1 / (cosLat*6*v*v*v) * (v/rho + 2*tan2Lat);
  const XII  = 1 / (cosLat*120*v*v*v*v*v) * (5 + 28*tan2Lat + 24*tan4Lat);

  const dE = E - E0;
  const dE2 = dE*dE, dE3 = dE2*dE, dE4 = dE2*dE2, dE5 = dE4*dE, dE6 = dE3*dE3;
  const latOSGB = lat - VII*dE2 + VIII*dE4 - IX*dE6;
  const lonOSGB = lon0 + X*dE - XI*dE3 + XII*dE5;

  // Simple OSGB36 → WGS84 shift (rough but good enough at ~3-5m)
  const latDeg = latOSGB * 180/Math.PI + 0.0009;
  const lonDeg = lonOSGB * 180/Math.PI - 0.0006;

  if (latDeg < 49.5 || latDeg > 61.5 || lonDeg < -9.0 || lonDeg > 2.5) return null;
  return [Math.round(lonDeg*1e6)/1e6, Math.round(latDeg*1e6)/1e6];
}

function normaliseStatus(raw) {
  const s = String(raw || '').toLowerCase();
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

function parseCSV(text) {
  const rows = [];
  let field = '', row = [], inQuotes = false;
  const len = text.length;
  for (let i = 0; i < len; i++) {
    const ch = text.charCodeAt(i);
    if (ch === 34) {
      if (inQuotes && text.charCodeAt(i+1) === 34) { field += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === 44 && !inQuotes) {
      row.push(field); field = '';
    } else if ((ch === 10 || ch === 13) && !inQuotes) {
      if (ch === 13 && text.charCodeAt(i+1) === 10) i++;
      row.push(field); field = '';
      if (row.length > 0) rows.push(row);
      row = [];
    } else {
      field += text[i];
    }
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=43200');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 30000);
    const r = await fetch(REPD_CSV_URL, {
      signal: controller.signal,
      headers: { 'Accept': 'text/csv,text/plain,*/*' }
    });
    clearTimeout(tid);
    if (!r.ok) throw new Error('GOV.UK CSV fetch failed: ' + r.status);

    const text = await r.text();
    const rows = parseCSV(text);
    if (rows.length < 2) throw new Error('CSV parse returned no rows');

    const headers = rows[0].map(h => h.trim().replace(/^\uFEFF/, ''));
    const findIdx = (...names) => {
      for (const n of names) {
        const i = headers.findIndex(h => h.toLowerCase() === n.toLowerCase());
        if (i >= 0) return i;
      }
      for (const n of names) {
        const i = headers.findIndex(h => h.toLowerCase().includes(n.toLowerCase()));
        if (i >= 0) return i;
      }
      return -1;
    };

    const col = {
      refId:        findIdx('Ref ID'),
      operator:     findIdx('Operator (or Applicant)', 'Operator'),
      siteName:     findIdx('Site Name'),
      techType:     findIdx('Technology Type'),
      capacity:     findIdx('Installed Capacity (MWelec)', 'Installed Capacity'),
      chp:          findIdx('CHP Enabled'),
      devStatus:    findIdx('Development Status'),
      county:       findIdx('County'),
      region:       findIdx('Region'),
      country:      findIdx('Country'),
      postcode:     findIdx('Post Code', 'Postcode'),
      easting:      findIdx('X-coordinate', 'Easting'),
      northing:     findIdx('Y-coordinate', 'Northing'),
      planningAuth: findIdx('Planning Authority'),
      planRef:      findIdx('Planning Application Reference'),
      planSubmit:   findIdx('Planning Application Submitted'),
      planGranted:  findIdx('Planning Permission Granted'),
      operational:  findIdx('Operational'),
      cfdRound:     findIdx('CfD Allocation Round'),
    };

    const features = [];
    let skipped = 0;
    const showAll = req.query.all === '1';

    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r || r.length < 5) continue;

      const status = normaliseStatus(col.devStatus >= 0 ? r[col.devStatus] : '');
      if (!showAll && (status === 'Abandoned' || status === 'Decommissioned' ||
          status === 'Refused' || status === 'Appeal Refused' || status === 'Withdrawn')) {
        skipped++; continue;
      }

      const E = col.easting  >= 0 ? parseFloat(r[col.easting])  : NaN;
      const N = col.northing >= 0 ? parseFloat(r[col.northing]) : NaN;
      const coords = bngToWgs84(E, N);
      if (!coords) { skipped++; continue; }

      const capacity = parseFloat(col.capacity >= 0 ? r[col.capacity] : 0) || 0;

      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: coords },
        properties: {
          id:          (col.refId       >= 0 ? r[col.refId]       : String(i)).trim(),
          name:        (col.siteName    >= 0 ? r[col.siteName]    : 'Unknown').trim(),
          operator:    (col.operator    >= 0 ? r[col.operator]    : '').trim(),
          tech:        (col.techType    >= 0 ? r[col.techType]    : 'Unknown').trim(),
          status:      status,
          capacity_mw: capacity,
          chp:         (col.chp >= 0 ? r[col.chp] : '').trim().toLowerCase() === 'yes',
          county:      (col.county      >= 0 ? r[col.county]      : '').trim(),
          region:      (col.region      >= 0 ? r[col.region]      : '').trim(),
          country:     (col.country     >= 0 ? r[col.country]     : '').trim(),
          postcode:    (col.postcode    >= 0 ? r[col.postcode]    : '').trim(),
          plan_auth:   (col.planningAuth>= 0 ? r[col.planningAuth]: '').trim(),
          plan_ref:    (col.planRef     >= 0 ? r[col.planRef]     : '').trim(),
          date_submitted:   (col.planSubmit  >= 0 ? r[col.planSubmit]  : '').trim(),
          date_granted:     (col.planGranted >= 0 ? r[col.planGranted] : '').trim(),
          date_operational: (col.operational >= 0 ? r[col.operational] : '').trim(),
          cfd_round:        (col.cfdRound    >= 0 ? r[col.cfdRound]    : '').trim(),
        }
      });
    }

    const techCounts = {}, statusCounts = {};
    for (let i = 0; i < features.length; i++) {
      const p = features[i].properties;
      techCounts[p.tech]     = (techCounts[p.tech]     || 0) + 1;
      statusCounts[p.status] = (statusCounts[p.status] || 0) + 1;
    }

    res.status(200).json({
      type: 'FeatureCollection',
      features: features,
      meta: {
        total:    features.length,
        skipped:  skipped,
        source:   'DESNZ / Barbour ABI — Open Government Licence',
        csv_url:  REPD_CSV_URL,
        asOf:     new Date().toISOString(),
        tech_counts:   techCounts,
        status_counts: statusCounts,
      }
    });

  } catch (e) {
    res.status(500).json({
      error: String(e && e.message ? e.message : e),
      stage: 'repd handler',
      csv_url: REPD_CSV_URL,
    });
  }
}
