// api/news.js
// Server-side RSS fetcher — bypasses browser CORS restrictions
// Sources: HSE, ECHA, Environment Agency, Gov.uk DESNZ

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const FEEDS = [
    { url: 'https://www.hse.gov.uk/press/press-rss.xml',              source: 'HSE',                defaultTag: 'safety' },
    { url: 'https://echa.europa.eu/rss/news.xml',                     source: 'ECHA',               defaultTag: 'regulatory' },
    { url: 'https://www.gov.uk/government/organisations/environment-agency.atom', source: 'Environment Agency', defaultTag: 'environment' },
    { url: 'https://www.gov.uk/government/organisations/department-for-energy-security-and-net-zero.atom', source: 'DESNZ', defaultTag: 'energy' },
    { url: 'https://www.gov.uk/government/organisations/health-and-safety-executive.atom', source: 'HSE Gov', defaultTag: 'safety' },
  ];

  const allItems = [];

  for (const feed of FEEDS) {
    try {
      const r = await fetch(feed.url, {
        headers: { 'User-Agent': 'ChemPulse/1.0 (chemical industry intelligence platform)' },
        signal: AbortSignal.timeout(5000)
      });
      if (!r.ok) continue;
      const xml = await r.text();
      const items = parseRSS(xml, feed.source, feed.defaultTag);
      allItems.push(...items);
    } catch (e) {
      // Silently skip failed feeds
    }
  }

  // Sort by date descending, limit to 20
  allItems.sort((a, b) => new Date(b.rawDate || 0) - new Date(a.rawDate || 0));
  const limited = allItems.slice(0, 25);

  res.status(200).json({ items: limited, count: limited.length, sources: [...new Set(limited.map(i => i.source))] });
}

function parseRSS(xml, source, defaultTag) {
  const items = [];
  try {
    // Handle both RSS (item) and Atom (entry) formats
    const isAtom = xml.includes('<feed');
    const entryTag = isAtom ? 'entry' : 'item';
    
    const entries = extractTags(xml, entryTag);
    
    for (const entry of entries.slice(0, 8)) {
      const title = stripHTML(extractTag(entry, 'title') || '').trim();
      const rawDesc = extractTag(entry, isAtom ? 'summary' : 'description') || 
                      extractTag(entry, 'content') || '';
      const desc = stripHTML(rawDesc).trim().slice(0, 250);
      
      // Atom links are attributes, RSS links are text
      let link = '';
      if (isAtom) {
        const linkMatch = entry.match(/<link[^>]+href="([^"]+)"/);
        link = linkMatch ? linkMatch[1] : '';
      } else {
        link = extractTag(entry, 'link') || '';
      }
      
      const rawDate = extractTag(entry, isAtom ? 'updated' : 'pubDate') || 
                      extractTag(entry, 'published') || '';
      
      const date = rawDate ? formatDate(rawDate) : '';

      if (!title || title.length < 5) continue;

      items.push({
        title,
        desc: desc || title,
        link: link.trim(),
        date,
        rawDate,
        source,
        tag: classifyTag(title + ' ' + desc, defaultTag)
      });
    }
  } catch (e) {}
  return items;
}

function extractTags(xml, tag) {
  const results = [];
  const regex = new RegExp(`<${tag}[\\s>][\\s\\S]*?<\\/${tag}>`, 'gi');
  const matches = xml.match(regex) || [];
  return matches;
}

function extractTag(xml, tag) {
  const regex = new RegExp(`<${tag}(?:[^>]*)>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const match = xml.match(regex);
  return match ? match[1] : null;
}

function stripHTML(str) {
  return str
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#\d+;/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatDate(dateStr) {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch { return ''; }
}

function classifyTag(text, def) {
  const t = text.toLowerCase();
  if (/enforcement|prohibition notice|improvement notice|incident|fire|explosion|accident|leak|spill|injury|fatality|riddor/.test(t)) return 'safety';
  if (/reach|svhc|restriction|authorisation|clp|classification|biocide|regulation|compliance|cbam/.test(t)) return 'regulatory';
  if (/emission|pollution|water quality|waste|contamination|discharge|environment/.test(t)) return 'environment';
  if (/gas price|energy price|power price|carbon price|ttf|nbp|ets|electricity cost/.test(t)) return 'energy';
  if (/production|output|capacity|plant|site|shutdown|maintenance|operations/.test(t)) return 'ops';
  return def || 'ops';
}
