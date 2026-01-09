// Vercel Serverless Function: Azure DevOps WIQL -> Work Items proxy
// Endpoint: /api/ado
// POST JSON: { org, project, queryId, pat? }
// If pat is omitted, uses process.env.ADO_PAT

const API_VER = '6.0';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
}

module.exports = async (req, res) => {
  setCors(res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const payload = req.body && typeof req.body === 'object' ? req.body : (() => {
    try { return JSON.parse(req.body || '{}'); } catch { return {}; }
  })();

  const org = String(payload.org || '').trim();
  const project = String(payload.project || '').trim();
  const queryId = String(payload.queryId || '').trim();
  const pat = String(payload.pat || process.env.ADO_PAT || '').trim();

  if (!org || !project || !queryId) {
    return res.status(400).json({ error: 'Missing required fields: org, project, queryId' });
  }
  if (!pat) {
    return res.status(400).json({ error: 'Missing PAT. Provide in request or set ADO_PAT env var in Vercel.' });
  }

  const baseUrl = `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis`;
  const authHeader = 'Basic ' + Buffer.from(':' + pat, 'utf8').toString('base64');

  try {
    const wiqlUrl = `${baseUrl}/wit/wiql/${encodeURIComponent(queryId)}?api-version=${API_VER}`;
    const q = await fetch(wiqlUrl, {
      method: 'GET',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json'
      }
    });
    const qText = await q.text();
    if (!q.ok) {
      return res.status(502).json({ error: 'WIQL query failed', status: q.status, details: qText });
    }

    const qData = JSON.parse(qText);
    const ids = (qData.workItems || []).slice(0, 200).map(w => w.id);
    if (!ids.length) {
      return res.status(200).json({ value: [] });
    }

    const detailsUrl = `${baseUrl}/wit/workitems?ids=${ids.join(',')}&api-version=${API_VER}`;
    const d = await fetch(detailsUrl, {
      method: 'GET',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json'
      }
    });
    const dText = await d.text();
    if (!d.ok) {
      return res.status(502).json({ error: 'Work items fetch failed', status: d.status, details: dText });
    }

    const details = JSON.parse(dText);
    return res.status(200).json(details);
  } catch (e) {
    return res.status(500).json({ error: 'Unhandled', details: String(e && e.message ? e.message : e) });
  }
};
