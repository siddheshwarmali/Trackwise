
const DEFAULT_DIR = 'data/dashboards';

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function ghHeaders() {
  const token = requireEnv('GITHUB_TOKEN');
  return {
    'Accept': 'application/vnd.github+json',
    'Authorization': `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28'
  };
}

function ghBase() {
  const owner = requireEnv('GITHUB_OWNER');
  const repo = requireEnv('GITHUB_REPO');
  return { owner, repo };
}

function ghBranch() { return process.env.GITHUB_BRANCH || 'main'; }

function ghDashDir() {
  return (process.env.GITHUB_DASHBOARD_DIR || DEFAULT_DIR).replace(/^\/+|\/+$/g,'');
}

function b64(s) { return Buffer.from(s, 'utf8').toString('base64'); }

async function ghGetContent(path) {
  const { owner, repo } = ghBase();
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURI(path)}?ref=${encodeURIComponent(ghBranch())}`;
  const r = await fetch(url, { headers: ghHeaders() });
  if (r.status === 404) return null;
  const data = await r.json();
  if (!r.ok) throw new Error((data && data.message) || `GitHub GET failed (${r.status})`);
  return data;
}

async function ghPutFile(path, contentText, message) {
  const existing = await ghGetContent(path);
  const sha = existing && existing.sha ? existing.sha : undefined;
  const body = { message: message || `Update ${path}`, content: b64(contentText), branch: ghBranch() };
  if (sha) body.sha = sha;
  const { owner, repo } = ghBase();
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURI(path)}`;
  const r = await fetch(url, { method: 'PUT', headers: { ...ghHeaders(), 'Content-Type':'application/json' }, body: JSON.stringify(body) });
  const data = await r.json();
  if (!r.ok) throw new Error((data && data.message) || `GitHub PUT failed (${r.status})`);
  return data;
}

async function ghDeleteFile(path, message) {
  const existing = await ghGetContent(path);
  if (!existing || !existing.sha) return { ok: true, skipped: true };
  const { owner, repo } = ghBase();
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURI(path)}`;
  const body = { message: message || `Delete ${path}`, sha: existing.sha, branch: ghBranch() };
  const r = await fetch(url, { method: 'DELETE', headers: { ...ghHeaders(), 'Content-Type':'application/json' }, body: JSON.stringify(body) });
  const data = await r.json();
  if (!r.ok) throw new Error((data && data.message) || `GitHub DELETE failed (${r.status})`);
  return data;
}

async function readJsonFile(path) {
  const file = await ghGetContent(path);
  if (!file || file.type !== 'file' || !file.content) return null;
  const text = Buffer.from(file.content, 'base64').toString('utf8');
  try { return JSON.parse(text); } catch { return null; }
}

module.exports = { ghDashDir, ghGetContent, ghPutFile, ghDeleteFile, readJsonFile };
