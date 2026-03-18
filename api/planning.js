// api/planning.js
// Planning applications from:
// 1. Planning Inspectorate NSIP (Nationally Significant Infrastructure Projects) - free JSON
// 2. Hull City Council Idox portal - server-side scrape
// 3. East Riding of Yorkshire Idox portal - server-side scrape
// 4. planning.data.gov.uk API - free, no key

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const keyword = req.query.keyword || '';
  const council = req.query.council || 'all';
  const allItems = [];

  // 1. Planning Inspectorate - Nationally Significant Infrastructure Projects
  // This covers major wind, solar, BESS, hydrogen, CCS projects
  try {
    const r = await fetch(
      'https://infrastructure.planninginspectorate.gov.uk/wp-json/wp/v2/project?per_page=50&categories=5,6,7,8&_fields=id,title,acf,link,date',
      { headers: { 'User-Agent': 'ChemPulse/1.0' }, signal: AbortSignal.timeout(6000) }
    );
    if (r.ok) {
      const projects = await r.json();
      for (const p of projects) {
        const title = p.title?.rendered || '';
        const region = p.acf?.region || '';
        const status = p.acf?.project_stage || p.acf?.status || 'In progress';
        const kw = detectKeyword(title);
        if (kw && (keyword === '' || kw === keyword)) {
          allItems.push({
            title,
            desc: `Nationally Significant Infrastructure Project. Region: ${region}.`,
            address: region,
            date: p.date ? new Date(p.date).toLocaleDateString('en-GB') : '',
            status: normaliseStatus(status),
            keyword: kw,
            council: 'Planning Inspectorate (NSIP)',
            link: p.link || 'https://infrastructure.planninginspectorate.gov.uk/projects/',
            type: 'nsip'
          });
        }
      }
    }
  } catch (e) {}

  // 2. Hull City Council - Idox weekly list scrape
  if (council === 'all' || council === 'hull') {
    const HULL_KEYWORDS = keyword ? [keyword] : ['solar', 'battery', 'wind', 'hydrogen', 'BESS', 'chemical', 'biomass'];
    for (const kw of HULL_KEYWORDS.slice(0, 4)) {
      try {
        const searchUrl = `https://www.hullcc.gov.uk/padcbc/publicaccess-live/search.do?action=simple&searchType=Application&searchText=${encodeURIComponent(kw)}`;
        const r = await fetch(searchUrl, {
          headers: { 
            'User-Agent': 'Mozilla/5.0 (compatible; ChemPulse/1.0)',
            'Accept': 'text/html'
          },
          signal: AbortSignal.timeout(8000)
        });
        if (r.ok) {
          const html = await r.text();
          const items = parseIdox(html, 'Hull City Council', 'https://www.hullcc.gov.uk/padcbc/publicaccess-live/');
          allItems.push(...items.filter(i => !keyword || i.keyword === keyword));
        }
      } catch (e) {}
    }
  }

  // 3. East Riding of Yorkshire - Idox weekly list scrape
  if (council === 'all' || council === 'eastriding') {
    const ER_KEYWORDS = keyword ? [keyword] : ['solar', 'battery', 'wind', 'hydrogen', 'BESS'];
    for (const kw of ER_KEYWORDS.slice(0, 4)) {
      try {
        const searchUrl = `https://newplanningaccess.eastriding.gov.uk/online-applications/search.do?action=simple&searchType=Application&searchText=${encodeURIComponent(kw)}`;
        const r = await fetch(searchUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; ChemPulse/1.0)',
            'Accept': 'text/html'
          },
          signal: AbortSignal.timeout(8000)
        });
        if (r.ok) {
          const html = await r.text();
          const items = parseIdox(html, 'East Riding of Yorkshire', 'https://newplanningaccess.eastriding.gov.uk/online-applications/');
          allItems.push(...items.filter(i => !keyword || i.keyword === keyword));
        }
      } catch (e) {}
    }
  }

  // 4. Deduplicate by title
  const seen = new Set();
  const unique = allItems.filter(p => {
    const key = p.title.toLowerCase().slice(0, 50);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  res.status(200).json({ items: unique, count: unique.length });
}

function parseIdox(html, council, baseUrl) {
  const items = [];
  try {
    // Idox search results pattern
    const resultPattern = /<li[^>]*class="[^"]*searchresult[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
    let match;
    while ((match = resultPattern.exec(html)) !== null) {
      const block = match[1];
      const titleMatch = block.match(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
      const title = titleMatch ? titleMatch[2].replace(/<[^>]+>/g,'').trim() : '';
      const href = titleMatch ? titleMatch[1] : '';
      const addrMatch = block.match(/class="[^"]*address[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>/i);
      const addr = addrMatch ? addrMatch[1].replace(/<[^>]+>/g,'').trim() : '';
      const dateMatch = block.match(/(?:Validated|Received):?\s*([\d\/]+)/i);
      const date = dateMatch ? dateMatch[1] : '';
      const statusMatch = block.match(/class="[^"]*status[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>/i);
      const status = statusMatch ? statusMatch[1].replace(/<[^>]+>/g,'').trim() : 'Pending';
      const kw = detectKeyword(title + ' ' + addr);
      if (kw && title.length > 4) {
        items.push({
          title,
          desc: '',
          address: addr,
          date,
          status: normaliseStatus(status),
          keyword: kw,
          council,
          link: href.startsWith('http') ? href : baseUrl + href.replace(/^\//, ''),
          type: 'council'
        });
      }
    }
  } catch (e) {}
  return items;
}

function detectKeyword(text) {
  const t = text.toLowerCase();
  if (/bess|battery.{0,20}storage|energy.{0,15}storage/.test(t)) return 'bess';
  if (/solar|photovoltaic|pv.{0,10}(array|farm|panel)/.test(t)) return 'solar';
  if (/wind.{0,20}(farm|turbine)|wind\s+energy|offshore\s+wind/.test(t)) return 'wind';
  if (/hydrogen|electrolyser|fuel.cell/.test(t)) return 'hydrogen';
  if (/carbon.{0,15}capture|ccs|ccus/.test(t)) return 'ccs';
  if (/biomass|biogas|anaerobic.{0,10}digestion|bioenergy/.test(t)) return 'biomass';
  if (/chemical|hazardous|industrial.{0,20}(unit|facility|process)|refinery/.test(t)) return 'chemical';
  return null;
}

function normaliseStatus(status) {
  const s = (status || '').toLowerCase();
  if (/approv|grant|consent|decided/.test(s)) return 'Approved';
  if (/refus|reject/.test(s)) return 'Refused';
  if (/withdraw/.test(s)) return 'Withdrawn';
  return 'Pending';
}
