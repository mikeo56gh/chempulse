// api/news.js — Server-side RSS aggregator for ChemPulse
// Fetches all sources server-side to bypass CORS
// Sources: HSE, ECHA, EA, DESNZ, Energy Institute, Oil & Gas UK, NESO, CIA, Carbon Brief, ICIS

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=120');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const FEEDS = [
    // Safety & regulatory (free, reliable)
    { url: 'https://www.hse.gov.uk/press/press-rss.xml',
      source: 'HSE', defaultTag: 'safety' },
    { url: 'https://echa.europa.eu/rss/news.xml',
      source: 'ECHA', defaultTag: 'regulatory' },
    { url: 'https://www.gov.uk/government/organisations/environment-agency.atom',
      source: 'Environment Agency', defaultTag: 'environment' },

    // UK Government energy & industry
    { url: 'https://www.gov.uk/government/organisations/department-for-energy-security-and-net-zero.atom',
      source: 'DESNZ', defaultTag: 'energy' },
    { url: 'https://www.gov.uk/search/news-and-communications.atom?keywords=hydrogen+OR+carbon+capture+OR+CCS+OR+net+zero+OR+offshore+wind',
      source: 'GOV.UK Energy', defaultTag: 'energy' },
    { url: 'https://www.gov.uk/government/organisations/health-and-safety-executive.atom',
      source: 'HSE Gov', defaultTag: 'safety' },
    { url: 'https://www.gov.uk/government/organisations/oil-and-gas-authority.atom',
      source: 'NSTA', defaultTag: 'energy' },

    // Energy & grid
    { url: 'https://www.neso.energy/news-views/feed/',
      source: 'NESO', defaultTag: 'energy' },
    { url: 'https://www.energyinst.org/rss/news',
      source: 'Energy Institute', defaultTag: 'energy' },
    { url: 'https://www.carbonbrief.org/feed/',
      source: 'Carbon Brief', defaultTag: 'energy' },

    // Chemical industry
    { url: 'https://www.chemicalwatch.com/news/rss',
      source: 'Chemical Watch', defaultTag: 'regulatory' },
    { url: 'https://www.cefic.org/feed/',
      source: 'CEFIC', defaultTag: 'regulatory' },
    { url: 'https://www.chemicalindustry.com/rss',
      source: 'Chemical Industry', defaultTag: 'ops' },

    // Planning (NSIP/infrastructure)
    { url: 'https://www.gov.uk/search/news-and-communications.atom?keywords=planning+inspectorate+OR+development+consent+order',
      source: 'Planning Inspectorate', defaultTag: 'ops' },
  ];

  const allItems = [];

  await Promise.allSettled(FEEDS.map(async feed => {
    try {
      const r = await fetch(feed.url, {
        headers: { 'User-Agent': 'ChemPulse/1.0 (chemical industry intelligence platform)', 'Accept': 'application/rss+xml,application/atom+xml,text/xml,*/*' },
        signal: AbortSignal.timeout(6000)
      });
      if (!r.ok) return;
      const xml = await r.text();
      const items = parseRSS(xml, feed.source, feed.defaultTag);
      allItems.push(...items);
    } catch(e) { /* skip failed feed */ }
  }));

  // Sort by date desc, deduplicate by title, limit to 30
  allItems.sort((a, b) => new Date(b.rawDate || 0) - new Date(a.rawDate || 0));
  const seen = new Set();
  const deduped = allItems.filter(i => {
    const key = i.title.toLowerCase().slice(0, 60);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 30);

  res.status(200).json({
    items: deduped,
    count: deduped.length,
    sources: [...new Set(deduped.map(i => i.source))]
  });
}

function parseRSS(xml, source, defaultTag) {
  const items = [];
  try {
    const isAtom = xml.includes('<feed');
    const entryTag = isAtom ? 'entry' : 'item';
    const entries = extractTags(xml, entryTag);

    for (const entry of entries.slice(0, 8)) {
      const title = stripHTML(extractTag(entry, 'title') || '').trim();
      const rawDesc = extractTag(entry, isAtom ? 'summary' : 'description') ||
                      extractTag(entry, 'content') || '';
      const desc = stripHTML(rawDesc).trim().slice(0, 250);

      let link = '';
      if (isAtom) {
        const m = entry.match(/<link[^>]+href="([^"]+)"/);
        link = m ? m[1] : '';
      } else {
        link = extractTag(entry, 'link') || '';
      }

      const rawDate = extractTag(entry, isAtom ? 'updated' : 'pubDate') ||
                      extractTag(entry, 'published') || '';
      const date = rawDate ? formatDate(rawDate) : '';

      if (!title || title.length < 5) continue;
      items.push({
        title, desc: desc || title,
        link: link.trim(), date, rawDate, source,
        tag: classifyTag(title + ' ' + desc, defaultTag)
      });
    }
  } catch(e) {}
  return items;
}

function extractTags(xml, tag) {
  const regex = new RegExp(`<${tag}[\\s>][\\s\\S]*?<\\/${tag}>`, 'gi');
  return xml.match(regex) || [];
}
function extractTag(xml, tag) {
  const regex = new RegExp(`<${tag}(?:[^>]*)>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const match = xml.match(regex);
  return match ? match[1] : null;
}
function stripHTML(str) {
  return str.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1')
    .replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#\d+;/g, '')
    .replace(/\s+/g, ' ').trim();
}
function formatDate(dateStr) {
  try { return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); }
  catch { return ''; }
}
function classifyTag(text, def) {
  const t = text.toLowerCase();
  if (/enforcement|prohibition|improvement notice|incident|fire|explosion|accident|leak|spill|injury|fatality|riddor|comah/.test(t)) return 'safety';
  if (/reach|svhc|restriction|authorisation|clp|classification|biocide|regulation|compliance|cbam|echa/.test(t)) return 'regulatory';
  if (/emission|pollution|water quality|waste|contamination|discharge|environment|carbon capture|ccs/.test(t)) return 'environment';
  if (/gas price|energy price|power price|carbon price|ttf|nbp|ets|electricity|hydrogen|offshore wind|renewable|grid/.test(t)) return 'energy';
  if (/production|output|capacity|plant|site|shutdown|maintenance|operations|planning|consent/.test(t)) return 'ops';
  return def || 'ops';
}
