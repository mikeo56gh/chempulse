module.exports = async (req, res) => {
  const url = 'https://data.elexon.co.uk/bmrs/api/v1/remit/list/by-publish?from=' + new Date(Date.now() - 7*86400000).toISOString().slice(0,19) + 'Z&to=' + new Date().toISOString().slice(0,19) + 'Z&assetId=T_SCCL-3&latestRevisionOnly=true';
  const out = { url };
  try {
    const r = await fetch(url);
    out.status = r.status;
    out.body = (await r.text()).slice(0, 2000);
  } catch (e) {
    out.err = e.message;
  }
  res.status(200).json(out);
};
