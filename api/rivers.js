// api/rivers.js
// Real river flow data from:
// - Environment Agency Flood Monitoring API (free, no key)
// - BfG Rhine gauge at Kaub, Germany (free, no key)
// - EA Hydrology API for key chemical cluster rivers

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const results = { gauges: [], rhine: null, summary: [] };

  // 1. EA - Key UK river gauges near chemical clusters
  // Teesside: River Tees at Broken Scar (2001TH)
  // Humber/Hull: River Hull at Hempholme (2602TH)  
  // Runcorn/Mersey: River Mersey at Westy (69043)
  // Grangemouth: River Forth at Stirling (approx via SEPA)
  const EA_STATIONS = [
    { id: '2001TH', name: 'R. Tees at Broken Scar', cluster: 'Teesside' },
    { id: '2602TH', name: 'R. Hull at Hempholme', cluster: 'Humber' },
    { id: '69043',  name: 'R. Mersey at Westy',    cluster: 'Runcorn' },
    { id: '2600SH', name: 'Humber Tidal',           cluster: 'Humber' },
  ];

  for (const station of EA_STATIONS) {
    try {
      const r = await fetch(
        `https://environment.data.gov.uk/flood-monitoring/id/stations/${station.id}/readings?_limit=1&_sorted`,
        { headers: { 'Accept': 'application/json' } }
      );
      if (r.ok) {
        const d = await r.json();
        const reading = d.items?.[0];
        if (reading) {
          results.gauges.push({
            id: station.id,
            name: station.name,
            cluster: station.cluster,
            value: reading.value,
            unit: reading.measure?.includes('level') ? 'm' : 'm³/s',
            dateTime: reading.dateTime,
            status: 'live'
          });
        }
      }
    } catch (e) {
      results.gauges.push({ id: station.id, name: station.name, cluster: station.cluster, status: 'error', error: e.message });
    }
  }

  // 2. BfG Rhine gauge at Kaub (critical for NL/DE chemical logistics)
  // Kaub gauge ID: 6336010 on the PEGELONLINE API
  try {
    const r = await fetch(
      'https://www.pegelonline.wsv.de/webservices/rest-api/v2/stations/KAUB/W/currentmeasurement.json',
      { headers: { 'Accept': 'application/json' } }
    );
    if (r.ok) {
      const d = await r.json();
      results.rhine = {
        station: 'Kaub (Rhine)',
        value: d.value,
        unit: 'cm',
        dateTime: d.timestamp,
        // Kaub low-flow threshold: below 80cm = severe barge restrictions
        // below 150cm = watch level, above 200cm = normal operations
        status: d.value < 80 ? 'critical' : d.value < 150 ? 'warning' : 'normal',
        note: d.value < 80 ? 'Severe barge restrictions likely' :
              d.value < 150 ? 'Low-flow watch — monitor barge capacity' :
              'Normal operations'
      };
    }
  } catch (e) {
    results.rhine = { station: 'Kaub (Rhine)', status: 'error', error: e.message };
  }

  // 3. Build plain-English summary for dashboard
  results.summary = results.gauges.map(g => ({
    name: g.name,
    cluster: g.cluster,
    reading: g.value ? `${Number(g.value).toFixed(2)} ${g.unit}` : 'N/A',
    status: g.status
  }));

  if (results.rhine?.value) {
    results.summary.push({
      name: 'Rhine at Kaub',
      cluster: 'Rotterdam / NL',
      reading: `${results.rhine.value} cm`,
      status: results.rhine.status,
      note: results.rhine.note
    });
  }

  res.status(200).json(results);
}
