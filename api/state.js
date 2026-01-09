// Vercel Serverless Function: GitHub-backed state storage
// Endpoint: /api/state
// Query params:
//   ?list=1               -> GET list of dashboards (manifest)
//   ?dash=<id>            -> GET dashboard state
// Methods:
//   POST   /api/state?dash=<id>    body: { state: <any> }
//   DELETE /api/state?dash=<id>

const API_BASE = 'https://api.github.com';
const MANIFEST_PATH = 'data/manifest.json';
const DASH_DIR = 'data/dashboards';

function ghHeaders(token) {
  return {
    Authorization: 'Bearer ' + token,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

function toBase64(str) {
  return Buffer.from(str, 'utf8').toString('base64');
}

function fromBase64(b64) {
  return Buffer.from(b64, 'base64').toString('utf8');
}

function encodeGitHubPath(p) {
  return String(p || '').split('/').map(encodeURIComponent).join('/');
}

async function ghGetFile(token, owner, repo, path, branch) {
  const encPath = encodeGitHubPath(path);
  const url = `${API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encPath}?ref=${encodeURIComponent(branch)}`;
  const r = await fetch(url, { method: 'GET', headers: ghHeaders(token) });
  if (r.status === 404) return { exists: false, url };
  const raw = await r.text();
  if (!r.ok) return { error: { stage: 'github_get', status: r.status, statusText: r.statusText, url, raw } };
  const data = JSON.parse(raw);
  const contentB64 = String(data.content || '').split('\n').join('');
  return { exists: true, sha: data.sha, contentB64, url };
}

async function ghPutFile(token, owner, repo, path, branch, message, contentStr, sha) {
  const encPath = encodeGitHubPath(path);
  const url = `${API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encPath}`;
  const body = { message, content: toBase64(contentStr), branch };
  if (sha) body.sha = sha;
  const r = await fetch(url, {
    method: 'PUT',
    headers: Object.assign({ 'Content-Type': 'application/json' }, ghHeaders(token)),
    body: JSON.stringify(body),
  });
  const raw = await r.text();
  if (!r.ok) return { error: { stage: 'github_put', status: r.status, statusText: r.statusText, url, raw } };
  const data = JSON.parse(raw);
  return { ok: true, sha: data.content?.sha || null, commitUrl: data.commit?.html_url || null, url };
}

async function ghDeleteFile(token, owner, repo, path, branch, sha) {
  const encPath = encodeGitHubPath(path);
  const url = `${API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encPath}`;
  const body = { message: `Delete ${path} (${new Date().toISOString()})`, sha, branch };
  const r = await fetch(url, {
    method: 'DELETE',
    headers: Object.assign({ 'Content-Type': 'application/json' }, ghHeaders(token)),
    body: JSON.stringify(body),
  });
  const raw = await r.text();
  if (!r.ok) return { error: { stage: 'github_delete', status: r.status, statusText: r.statusText, url, raw } };
  let data = {};
  try { data = JSON.parse(raw || '{}'); } catch (_) {}
  return { ok: true, commitUrl: data.commit?.html_url || null, url };
}

function safeDashId(id) {
  const s = String(id || '').trim();
  if (!s) return null;
  if (!/^[a-zA-Z0-9_-]{3,80}$/.test(s)) return null;
  return s;
}

async function loadManifest(token, owner, repo, branch) {
  const file = await ghGetFile(token, owner, repo, MANIFEST_PATH, branch);
  if (file.error) return { error: file.error };
  if (!file.exists) return { exists: false, sha: null, list: [] };
  try {
    const txt = fromBase64(file.contentB64);
    const list = JSON.parse(txt);
    return { exists: true, sha: file.sha, list: Array.isArray(list) ? list : [] };
  } catch (_) {
    return { exists: true, sha: file.sha, list: [] };
  }
}

async function saveManifest(token, owner, repo, branch, manifestSha, list) {
  const contentStr = JSON.stringify(list, null, 2);
  return ghPutFile(token, owner, repo, MANIFEST_PATH, branch, `Update manifest (${new Date().toISOString()})`, contentStr, manifestSha);
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
}

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  const missing = ['GITHUB_TOKEN', 'GITHUB_OWNER', 'GITHUB_REPO'].filter(k => !process.env[k]);
  if (missing.length) return res.status(500).json({ error: 'Missing env vars', missing });

  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || 'main';

  if (String(repo).includes('/')) {
    return res.status(400).json({ error: 'GITHUB_REPO must be repo name only', got: repo });
  }

  const dash = req.query.dash;
  const listFlag = req.query.list;

  try {
    if (req.method === 'GET' && listFlag) {
      const man = await loadManifest(token, owner, repo, branch);
      if (man.error) return res.status(502).json({ error: 'Manifest GET failed', details: man.error });
      return res.status(200).json({ dashboards: man.list });
    }

    if (req.method === 'GET') {
      const id = safeDashId(dash);
      if (!id) return res.status(400).json({ error: 'Missing/invalid dash id' });
      const path = `${DASH_DIR}/${id}.json`;
      const file = await ghGetFile(token, owner, repo, path, branch);
      if (file.error) return res.status(502).json({ error: 'GitHub GET failed', details: file.error });
      if (!file.exists) return res.status(200).json({ state: null, exists: false });
      const state = JSON.parse(fromBase64(file.contentB64));
      return res.status(200).json({ state, exists: true });
    }

    if (req.method === 'POST') {
      const id = safeDashId(dash);
      if (!id) return res.status(400).json({ error: 'Missing/invalid dash id' });
      const path = `${DASH_DIR}/${id}.json`;

      const payload = req.body && typeof req.body === 'object' ? req.body : (() => {
        try { return JSON.parse(req.body || '{}'); } catch { return {}; }
      })();

      const state = Object.prototype.hasOwnProperty.call(payload, 'state') ? payload.state : null;

      const existing = await ghGetFile(token, owner, repo, path, branch);
      if (existing.error) return res.status(502).json({ error: 'GitHub GET pre-update failed', details: existing.error });

      const contentStr = JSON.stringify(state, null, 2);
      const saved = await ghPutFile(token, owner, repo, path, branch, `Update dashboard ${id} (${new Date().toISOString()})`, contentStr, existing.exists ? existing.sha : null);
      if (saved.error) return res.status(502).json({ error: 'GitHub PUT failed', details: saved.error });

      const man = await loadManifest(token, owner, repo, branch);
      if (man.error) return res.status(502).json({ error: 'Manifest GET failed', details: man.error });

      const list = man.list || [];
      const now = new Date().toISOString();
      const name = state && state.__meta && state.__meta.name ? String(state.__meta.name) : null;
      const idx = list.findIndex(x => x && x.id === id);
      const entry = { id, name, updatedAt: now };
      if (idx >= 0) list[idx] = Object.assign({}, list[idx], entry);
      else list.push(entry);

      const manSaved = await saveManifest(token, owner, repo, branch, man.exists ? man.sha : null, list);
      if (manSaved.error) return res.status(502).json({ error: 'Manifest PUT failed', details: manSaved.error });

      return res.status(200).json({ ok: true, commitUrl: saved.commitUrl });
    }

    if (req.method === 'DELETE') {
      const id = safeDashId(dash);
      if (!id) return res.status(400).json({ error: 'Missing/invalid dash id' });
      const path = `${DASH_DIR}/${id}.json`;

      const file = await ghGetFile(token, owner, repo, path, branch);
      if (file.error) return res.status(502).json({ error: 'GitHub GET pre-delete failed', details: file.error });
      if (!file.exists) return res.status(200).json({ ok: true, deleted: false });

      const del = await ghDeleteFile(token, owner, repo, path, branch, file.sha);
      if (del.error) return res.status(502).json({ error: 'GitHub DELETE failed', details: del.error });

      const man = await loadManifest(token, owner, repo, branch);
      if (!man.error) {
        const newList = (man.list || []).filter(x => x && x.id !== id);
        await saveManifest(token, owner, repo, branch, man.exists ? man.sha : null, newList);
      }

      return res.status(200).json({ ok: true, commitUrl: del.commitUrl });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: 'Unhandled', details: String(e && e.message ? e.message : e), stack: String(e && e.stack ? e.stack : '') });
  }
};
