// api/remit-test.js - minimal diagnostic
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const now = new Date();
  const from = new Date(now.getTime() - 7 * 86400000).toISOString().slice(0, 19) + 'Z';
  const to = now.toISOString().slice(0, 19) + 'Z';
  const url = 'https://data.elexon.co.uk/bmrs/api/v1/remit/list/by-publish?from=' + from + '&to=' + to + '&assetId=T_SCCL-3&latestRevisionOnly=true&format=json';

  const out = { url: url, from: from, to: to };

  try {
    const r = await fetch(url);
    out.status = r.status;
    out.ok = r.ok;
    const text = await r.text();
    out.response_length = text.length;
    out.response_preview = text.slice(0, 1500);
    try {
      const d = JSON.parse(text);
      out.message_count = (d.data || []).length;
      out.first_message = d.data && d.data[0] ? d.data[0] : null;
    } catch (e) {
      out.parse_error = e.message;
    }
  } catch (e) {
    out.fetch_error = e.message;
  }

  res.status(200).json(out);
};
