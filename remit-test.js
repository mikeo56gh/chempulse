// api/remit-test.js
// Minimal REMIT test — makes ONE known-working request and returns the raw result
// Same exact URL your browser test showed returns 2 messages
// Deploy this file then hit https://chempulse.vercel.app/api/remit-test
// to see EXACTLY what Vercel's server-side fetch returns

export const config = { maxDuration: 15 };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const now = new Date();
  const fromD = new Date(now.getTime() - 7 * 86400000);
  const from = fromD.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const to   = now.toISOString().replace(/\.\d{3}Z$/, 'Z');

  const url = `https://data.elexon.co.uk/bmrs/api/v1/remit/list/by-publish?from=${from}&to=${to}&assetId=T_SCCL-3&latestRevisionOnly=true&format=json`;

  const result = {
    url,
    now: now.toISOString(),
    from, to,
  };

  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 10000);
    const r = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: ctrl.signal,
    });
    clearTimeout(tid);

    result.status = r.status;
    result.statusText = r.statusText;
    result.ok = r.ok;

    const text = await r.text();
    result.response_length = text.length;
    result.response_raw = text.slice(0, 2000);

    try {
      const d = JSON.parse(text);
      result.parsed = true;
      result.message_count = (d.data || []).length;
      result.sample = d.data?.[0] || null;
    } catch (e) {
      result.parse_error = e.message;
    }
  } catch (e) {
    result.fetch_error = e.message;
    result.error_name = e.name;
  }

  res.status(200).json(result);
}
