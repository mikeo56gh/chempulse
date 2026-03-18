// api/sites.js
// Returns chemical site data.
// UK: Full COMAH register subset (key sites — expand by loading HSE CSV into Supabase)
// EU: Key Seveso III sites from major clusters (SPIRS database subset)
//
// TO EXPAND TO FULL ~850 SITES:
// 1. Download: https://www.hse.gov.uk/comah/siteinfo.htm (CSV)
// 2. Geocode with: https://nominatim.openstreetmap.org/search?q=ADDRESS&format=json
// 3. Upload to Supabase table 'sites'
// 4. Replace static data below with: const { data } = await supabase.from('sites').select('*')

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  res.status(200).json({ sites: ALL_SITES, count: ALL_SITES.length });
}

const UK_SITES = [
  // Scotland
  { n:'INEOS Grangemouth — Ethylene Plant',  op:'INEOS',          lat:56.009,lng:-3.721, st:'alert', ty:['COMAH Upper'],  pr:['Ethylene','Propylene'],  al:'Cracker offline — unplanned outage', region:'Scotland' },
  { n:'INEOS Styrolution Grangemouth',        op:'INEOS',          lat:56.012,lng:-3.718, st:'alert', ty:['COMAH Upper'],  pr:['Styrene','ABS'],          al:'Supply disruption', region:'Scotland' },
  { n:'Petroineos Grangemouth Refinery',      op:'Petroineos',     lat:56.007,lng:-3.728, st:'warn',  ty:['Refinery','COMAH Upper'], pr:['Fuels','LPG','Naphtha'], al:'Planned maintenance Q2', region:'Scotland' },
  { n:'INEOS Phenol Grangemouth',             op:'INEOS',          lat:56.010,lng:-3.720, st:'ok',    ty:['COMAH Upper'],  pr:['Phenol','Acetone'],       region:'Scotland' },
  // Teesside
  { n:'Teesside Chemical Cluster (SABIC)',    op:'SABIC',          lat:54.560,lng:-1.154, st:'ok',    ty:['COMAH Upper'],  pr:['HDPE','Polypropylene'],   region:'Teesside' },
  { n:'Huntsman Polyurethanes Wilton',        op:'Huntsman',       lat:54.582,lng:-1.089, st:'ok',    ty:['COMAH Upper'],  pr:['MDI','Polyurethanes'],    region:'Teesside' },
  { n:'Dow Wilton — Ethylene Oxide',          op:'Dow',            lat:54.578,lng:-1.095, st:'warn',  ty:['COMAH Upper'],  pr:['Ethylene Oxide','Glycols'],al:'Q2 maintenance window', region:'Teesside' },
  { n:'CF Fertilisers Billingham',            op:'CF Industries',  lat:54.612,lng:-1.284, st:'ok',    ty:['COMAH Upper'],  pr:['Ammonia','Nitric Acid','AN Fertiliser'], region:'Teesside' },
  { n:'Seal Sands — Multiple Operators',      op:'Multiple',       lat:54.635,lng:-1.178, st:'ok',    ty:['COMAH Upper'],  pr:['Petrochemicals','Chlorine'], region:'Teesside' },
  { n:'PX Group (Seal Sands)',                op:'PX Group',       lat:54.630,lng:-1.180, st:'ok',    ty:['COMAH Lower'],  pr:['Hydrocarbons'],           region:'Teesside' },
  { n:'Lotte Chemical Titan',                 op:'Lotte Chemical', lat:54.574,lng:-1.200, st:'ok',    ty:['COMAH Upper'],  pr:['Polyethylene'],           region:'Teesside' },
  { n:'Nuplex Resins Teesside',               op:'Allnex',         lat:54.570,lng:-1.190, st:'ok',    ty:['COMAH Lower'],  pr:['Resins'],                 region:'Teesside' },
  // Humber / Hull
  { n:'Saltend Chemicals Park',               op:'Multiple (INEOS, Croda)', lat:53.732,lng:-0.224, st:'ok', ty:['COMAH Upper'], pr:['Acetyls','Hydrogen','Glycols'], region:'Humber' },
  { n:'INEOS Acetyls Saltend',                op:'INEOS',          lat:53.730,lng:-0.220, st:'ok',    ty:['COMAH Upper'],  pr:['Acetic Acid','Ethyl Acetate'], region:'Humber' },
  { n:'Croda International Saltend',          op:'Croda',          lat:53.733,lng:-0.225, st:'ok',    ty:['COMAH Lower'],  pr:['Oleochemicals','Esters'], region:'Humber' },
  { n:'Perstorp UK Hull',                     op:'Perstorp',       lat:53.741,lng:-0.336, st:'ok',    ty:['COMAH Upper'],  pr:['Pentaerythritol','Formaldehyde'], region:'Humber' },
  { n:'Brenntag Hull',                        op:'Brenntag',       lat:53.748,lng:-0.331, st:'ok',    ty:['Distributor'],  pr:['Chemical Distribution'], region:'Humber' },
  { n:'South Humber Bank Energy Centre',      op:'VPI Immingham',  lat:53.620,lng:-0.080, st:'ok',    ty:['COMAH Upper'],  pr:['Biofuels','Power Generation'], region:'Humber' },
  { n:'Tronox Stallingborough',               op:'Tronox',         lat:53.596,lng:-0.186, st:'warn',  ty:['COMAH Upper'],  pr:['Titanium Dioxide'],       al:'Permit review ongoing', region:'Humber' },
  { n:'Croda Goole',                          op:'Croda',          lat:53.703,lng:-0.867, st:'ok',    ty:['COMAH Lower'],  pr:['Oleochemicals'],          region:'Humber' },
  // Runcorn / Cheshire
  { n:'Runcorn Chemical Complex',             op:'INEOS Chlor',    lat:53.338,lng:-2.711, st:'ok',    ty:['COMAH Upper'],  pr:['Chlorine','Caustic Soda','VCM'], region:'Runcorn' },
  { n:'Tronox Runcorn (TiO₂)',                op:'Tronox',         lat:53.340,lng:-2.708, st:'ok',    ty:['COMAH Upper'],  pr:['Titanium Dioxide'],       region:'Runcorn' },
  { n:'Mexichem (Mexichem UK)',               op:'Mexichem',       lat:53.345,lng:-2.720, st:'ok',    ty:['COMAH Upper'],  pr:['Fluoropolymers','Refrigerants'], region:'Runcorn' },
  { n:'Venator Materials Wynyard',            op:'Venator',        lat:54.582,lng:-1.370, st:'ok',    ty:['COMAH Upper'],  pr:['Titanium Dioxide'],       region:'Teesside' },
  // Lancashire
  { n:'Victrex — Thornton Cleveleys',         op:'Victrex',        lat:53.865,lng:-3.027, st:'ok',    ty:['COMAH Upper'],  pr:['PEEK Polymer'],           region:'Lancashire' },
  // Yorkshire / Midlands
  { n:'Nufarm Bradford',                      op:'Nufarm',         lat:53.773,lng:-1.758, st:'ok',    ty:['COMAH Upper'],  pr:['Herbicides','Agrochemicals'], region:'Yorkshire' },
  { n:'Synthomer Harlow',                     op:'Synthomer',      lat:51.768,lng:0.091,  st:'ok',    ty:['COMAH Upper'],  pr:['Latex','Acrylic Polymers'], region:'South East' },
  { n:'Lanxess Newbury',                      op:'Lanxess',        lat:51.400,lng:-1.322, st:'ok',    ty:['COMAH Lower'],  pr:['Rubber Chemicals'],       region:'South England' },
  { n:'Rhodia Staveley (Solvay)',             op:'Solvay',         lat:53.269,lng:-1.350, st:'ok',    ty:['COMAH Upper'],  pr:['Rare Earth Compounds'],   region:'East Midlands' },
  { n:'Eastman Chemical Workington',          op:'Eastman',        lat:54.650,lng:-3.540, st:'ok',    ty:['COMAH Upper'],  pr:['Acetate Tow'],            region:'Cumbria' },
  { n:'Blyth Chemicals (Lubrizol)',           op:'Lubrizol',       lat:55.130,lng:-1.510, st:'ok',    ty:['COMAH Upper'],  pr:['Lubricant Additives'],    region:'North East' },
  { n:'Fujifilm Diosynth Billingham',         op:'Fujifilm',       lat:54.608,lng:-1.281, st:'ok',    ty:['COMAH Lower'],  pr:['Biologics','APIs'],       region:'Teesside' },
  { n:'NEO Performance Materials Widnes',     op:'NEO',            lat:53.361,lng:-2.744, st:'ok',    ty:['COMAH Upper'],  pr:['Rare Earths','Magnets'],  region:'Runcorn' },
  // Wales
  { n:'INEOS Chlor Amlwch',                   op:'INEOS',          lat:53.401,lng:-4.336, st:'ok',    ty:['COMAH Upper'],  pr:['Chlorine'],               region:'Wales' },
  { n:'Dow Chemical Barry',                   op:'Dow',            lat:51.400,lng:-3.281, st:'ok',    ty:['COMAH Upper'],  pr:['Specialty Chemicals'],    region:'Wales' },
];

const EU_SITES = [
  // Netherlands
  { n:'BASF Antwerp',                         op:'BASF',           lat:51.275,lng:4.362,  st:'ok',    ty:['Seveso III Upper'], pr:['Chemicals','Polymers'],  region:'Antwerp', country:'Belgium' },
  { n:'Dow Benelux Terneuzen',                op:'Dow',            lat:51.330,lng:3.830,  st:'ok',    ty:['Seveso III Upper'], pr:['Ethylene','Polyethylene'], region:'Terneuzen', country:'Netherlands' },
  { n:'LyondellBasell Rotterdam',             op:'LyondellBasell', lat:51.895,lng:4.331,  st:'warn',  ty:['Seveso III Upper'], pr:['PP','PE','Cracker'],      al:'Water constraint — reduced throughput', region:'Rotterdam', country:'Netherlands' },
  { n:'Shell Pernis Refinery',                op:'Shell',          lat:51.888,lng:4.389,  st:'ok',    ty:['Seveso III Upper'], pr:['Fuels','Chemicals'],     region:'Rotterdam', country:'Netherlands' },
  { n:'Neste Rotterdam Refinery',             op:'Neste',          lat:51.896,lng:4.340,  st:'ok',    ty:['Seveso III Upper'], pr:['Renewable Fuels'],       region:'Rotterdam', country:'Netherlands' },
  { n:'SABIC Geleen',                         op:'SABIC',          lat:51.000,lng:5.836,  st:'warn',  ty:['Seveso III Upper'], pr:['Ethylene','Polyethylene'], al:'Emission exceedance reported', region:'Chemelot', country:'Netherlands' },
  { n:'Chemelot Site Geleen',                 op:'Multiple',       lat:50.990,lng:5.830,  st:'ok',    ty:['Seveso III Upper'], pr:['Petrochemicals','Polymers'], region:'Chemelot', country:'Netherlands' },
  // Germany
  { n:'BASF Ludwigshafen (Verbund)',           op:'BASF',           lat:49.506,lng:8.441,  st:'ok',    ty:['Seveso III Upper'], pr:['Chemicals','Polymers','Intermediates'], region:'Rhine-Palatinate', country:'Germany' },
  { n:'Covestro Leverkusen',                  op:'Covestro',       lat:51.034,lng:6.970,  st:'ok',    ty:['Seveso III Upper'], pr:['MDI','TDI','Polycarbonate'], region:'Rhine-Ruhr', country:'Germany' },
  { n:'Lanxess Leverkusen',                   op:'Lanxess',        lat:51.040,lng:6.960,  st:'ok',    ty:['Seveso III Upper'], pr:['Specialty Chemicals'],   region:'Rhine-Ruhr', country:'Germany' },
  { n:'Evonik Marl Chemical Park',            op:'Evonik',         lat:51.660,lng:7.086,  st:'ok',    ty:['Seveso III Upper'], pr:['Specialty Chemicals','H₂O₂'], region:'Rhine-Ruhr', country:'Germany' },
  { n:'Borealis Burghausen',                  op:'Borealis',       lat:48.165,lng:12.836, st:'ok',    ty:['Seveso III Upper'], pr:['Polyolefins'],            region:'Bavaria', country:'Germany' },
  // Belgium
  { n:'Total Energies Antwerp Refinery',      op:'TotalEnergies',  lat:51.280,lng:4.370,  st:'ok',    ty:['Seveso III Upper'], pr:['Fuels','Petrochemicals'], region:'Antwerp', country:'Belgium' },
  { n:'Solvay Antwerp',                       op:'Solvay',         lat:51.260,lng:4.350,  st:'ok',    ty:['Seveso III Upper'], pr:['Soda Ash','Chlorine'],    region:'Antwerp', country:'Belgium' },
  // France
  { n:'TotalEnergies La Mède Refinery',       op:'TotalEnergies',  lat:43.398,lng:5.050,  st:'ok',    ty:['Seveso III Upper'], pr:['Biofuels','Fuels'],       region:'Provence', country:'France' },
];

const ALL_SITES = [...UK_SITES, ...EU_SITES];
