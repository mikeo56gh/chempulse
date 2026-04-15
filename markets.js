// api/news.js — Server-side RSS aggregator for ChemPulse
// 17 sources fetched in parallel, server-side to bypass CORS

export const config = { maxDuration: 25 };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=120');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const FEEDS = [
    // Safety & Regulatory
    { url: 'https://www.hse.gov.uk/press/press-rss.xml',                                                  source: 'HSE',                tag: 'safety',      maxItems: 5 },
    { url: 'https://press.hse.gov.uk/feed/',                                                               source: 'HSE Press',          tag: 'safety',      maxItems: 5 },
    { url: 'https://echa.europa.eu/rss/news.xml',                                                          source: 'ECHA',               tag: 'regulatory',  maxItems: 5 },
    { url: 'https://www.chemicalwatch.com/news/rss',                                                       source: 'Chemical Watch',     tag: 'regulatory',  maxItems: 4 },
    { url: 'https://www.cefic.org/feed/',                                                                   source: 'CEFIC',              tag: 'regulatory',  maxItems: 4 },
    // UK Government
    { url: 'https://www.gov.uk/government/organisations/environment-agency.atom',                          source: 'Environment Agency', tag: 'environment', maxItems: 3 },
    { url: 'https://www.gov.uk/government/organisations/department-for-energy-security-and-net-zero.atom', source: 'DESNZ',              tag: 'energy',      maxItems: 5 },
    { url: 'https://www.gov.uk/government/organisations/oil-and-gas-authority.atom',                       source: 'NSTA',               tag: 'energy',      maxItems: 4 },
    // GovWire (confirmed RSS XML)
    { url: 'https://www.govwire.co.uk/rss/department-for-energy-security-and-net-zero',                   source: 'GovWire DESNZ',      tag: 'energy',      maxItems: 5 },
    { url: 'https://www.govwire.co.uk/rss/department-for-science-innovation-and-technology',              source: 'GovWire DSIT',       tag: 'energy',      maxItems: 4 },
    { url: 'https://www.govwire.co.uk/rss/environment-agency',                                             source: 'GovWire EA',         tag: 'environment', maxItems: 3 },
    { url: 'https://www.govwire.co.uk/rss/department-for-environment-food-rural-affairs',                  source: 'GovWire DEFRA',      tag: 'environment', maxItems: 3 },
    // Energy & Industry News
    { url: 'https://www.energylivenews.com/feed/',                                                         source: 'Energy Live News',   tag: 'energy',      maxItems: 6 },
    { url: 'https://www.energyinst.org/rss/news',                                                          source: 'Energy Institute',   tag: 'energy',      maxItems: 5 },
    { url: 'https://www.carbonbrief.org/feed/',                                                            source: 'Carbon Brief',       tag: 'environment', maxItems: 4 },
    // S&P Global Commodity Insights (free RSS)
    { url: 'https://www.spglobal.com/energy/en/rss/latest-natural-gas-headlines',                         source: 'S&P Global Gas',     tag: 'energy',      maxItems: 5 },
    { url: 'https://www.spglobal.com/energy/en/rss/latest-chemicals-headlines',                           source: 'S&P Global Chem',    tag: 'ops',         maxItems: 5 },
  ];

  // Titles containing these strings are low-value noise — skip them
  const NOISE_PATTERNS = [
    /environmental permit application advertisement/i,
    /permit application advertisement/i,
    /^notice:/i,
    /EPR\/[A-Z0-9]+/,
    /planning application/i,
    /prior approval/i,
    /variation application/i,
  ];

  const allItems = [];
  const sourceStatus = {};

  await Promise.allSettled(FEEDS.map(async feed => {
    try {
      const r = await fetch(feed.url, {
        headers: {
          'User-Agent': 'ChemPulse/1.0 (chemical industry intelligence platform)',
          'Accept': 'application/rss+xml, application/atom+xml, text/xml, */*'
        },
        signal: AbortSignal.timeout(7000)
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const xml = await r.text();
      const items = parseRSS(xml, feed.source, feed.tag, feed.maxItems, NOISE_PATTERNS);
      allItems.push(...items);
      sourceStatus[feed.source] = 'ok:' + items.length;
    } catch(e) {
      sourceStatus[feed.source] = 'fail:' + (e.message || 'unknown');
    }
  }));

  // Sort by date descending, deduplicate by title
  allItems.sort((a, b) => new Date(b.rawDate || 0) - new Date(a.rawDate || 0));
  const seen = new Set();
  const deduped = allItems.filter(item => {
    const key = item.title.toLowerCase().slice(0, 80);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 50);

  res.status(200).json({
    items: deduped,
    count: deduped.length,
    sources: [...new Set(deduped.map(i => i.source))],
    sourceStatus
  });
}

function parseRSS(xml, source, defaultTag, maxItems, noisePatterns) {
  const items = [];
  try {
    const isAtom = xml.includes('<feed');
    const entries = extractTags(xml, isAtom ? 'entry' : 'item');
    for (const entry of entries) {
      if (items.length >= maxItems) break;
      const title = stripHTML(extractTag(entry, 'title') || '').trim();
      if (!title || title.length < 5) continue;
      // Skip noise
      if (noisePatterns.some(p => p.test(title))) continue;
      const rawDesc = extractTag(entry, isAtom ? 'summary' : 'description') || extractTag(entry, 'content') || '';
      const desc = stripHTML(rawDesc).trim().slice(0, 300);
      let link = '';
      if (isAtom) { const m = entry.match(/<link[^>]+href="([^"]+)"/); link = m ? m[1] : ''; }
      else { link = extractTag(entry, 'link') || ''; }
      const rawDate = extractTag(entry, isAtom ? 'updated' : 'pubDate') || extractTag(entry, 'published') || '';
      items.push({
        title, desc: desc || title, link: link.trim(),
        date: rawDate ? formatDate(rawDate) : '',
        rawDate, source,
        tag: classifyTag(title + ' ' + desc, defaultTag)
      });
    }
  } catch(e) {}
  return items;
}

function extractTags(xml, tag) {
  return xml.match(new RegExp('<' + tag + '[\\s>][\\s\\S]*?<\\/' + tag + '>', 'gi')) || [];
}
function extractTag(xml, tag) {
  const m = xml.match(new RegExp('<' + tag + '(?:[^>]*)>([\\s\\S]*?)<\\/' + tag + '>', 'i'));
  return m ? m[1] : null;
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
  if (/enforcement|prohibition|improvement notice|incident|fire|explosion|accident|leak|spill|injury|fatality|riddor|comah|prosecution/.test(t)) return 'safety';
  if (/reach|svhc|restriction|authorisation|clp|classification|biocide|regulation|compliance|cbam/.test(t)) return 'regulatory';
  if (/emission|pollution|water|waste|contamination|discharge|environment|defra|carbon capture|ccs|net zero|climate/.test(t)) return 'environment';
  if (/gas|energy|power|carbon price|ttf|nbp|ets|electricity|hydrogen|offshore wind|renewable|grid|lng|oil|brent|crude/.test(t)) return 'energy';
  if (/production|output|capacity|plant|site|shutdown|maintenance|feedstock|ethylene|ammonia|methanol|chemical/.test(t)) return 'ops';
  return def || 'ops';
}
