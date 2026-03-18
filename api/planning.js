// api/planning.js
// Planning data from Planning Inspectorate NSIP API (free, reliable)
// Council portals block automated requests — AI fallback handles Hull/East Riding

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=1800');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const allItems = [];

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    const r = await fetch(
      'https://infrastructure.planninginspectorate.gov.uk/wp-json/wp/v2/project?per_page=100&_fields=id,title,link,date,status',
      { headers: { 'User-Agent': 'ChemPulse/1.0' }, signal: controller.signal }
    );
    clearTimeout(timeout);

    if (r.ok) {
      const projects = await r.json();
      for (const p of projects) {
        const title = stripHTML(p.title?.rendered || '');
        if (!title) continue;
        const kw = detectKeyword(title);
        if (!kw) continue;
        allItems.push({
          title,
          desc: 'Nationally Significant Infrastructure Project — Planning Act 2008.',
          address: 'England',
          date: p.date ? new Date(p.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '',
          status: normaliseStatus(p.status || ''),
          keyword: kw,
          council: 'Planning Inspectorate (NSIP)',
          link: p.link || 'https://infrastructure.planninginspectorate.gov.uk/projects/',
          type: 'nsip'
        });
      }
    }
  } catch (e) {
    // Timed out or failed — return empty, frontend uses AI fallback
  }

  res.status(200).json({
    items: allItems,
    count: allItems.length,
    council_links: {
      hull: 'https://www.hullcc.gov.uk/padcbc/publicaccess-live/search.do?action=weeklyList',
      east_riding: 'https://newplanningaccess.eastriding.gov.uk/online-applications/search.do?action=weeklyList',
      nsip: 'https://infrastructure.planninginspectorate.gov.uk/projects/'
    }
  });
}

function detectKeyword(text) {
  const t = text.toLowerCase();
  if (/bess|battery.{0,20}storage|energy.{0,15}storage/.test(t)) return 'bess';
  if (/solar|photovoltaic|\bpv\b.{0,10}(array|farm|park)/.test(t)) return 'solar';
  if (/wind.{0,20}(farm|park|turbine)|offshore.{0,10}wind|onshore.{0,10}wind/.test(t)) return 'wind';
  if (/hydrogen|electrolyser|green.{0,5}hydrogen/.test(t)) return 'hydrogen';
  if (/carbon.{0,15}capture|\bccs\b|\bccus\b/.test(t)) return 'ccs';
  if (/biomass|biogas|anaerobic|bioenergy/.test(t)) return 'biomass';
  if (/chemical|refinery|petrochemical|hazardous/.test(t)) return 'chemical';
  return null;
}

function normaliseStatus(s) {
  s = (s || '').toLowerCase();
  if (/publish|accept|approv|grant|consent|decided/.test(s)) return 'Approved';
  if (/refus|reject/.test(s)) return 'Refused';
  if (/withdraw/.test(s)) return 'Withdrawn';
  if (/examin|hearing|inquiry/.test(s)) return 'In Examination';
  if (/pre.applic|scoping/.test(s)) return 'Pre-application';
  return 'In Progress';
}

function stripHTML(str) {
  return str.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#\d+;/g, '').trim();
}
