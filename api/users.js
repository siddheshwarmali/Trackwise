
const { verify, parseCookies, json, readJson, hashPassword } = require('./_lib/auth');
const { readJsonFile, ghPutFile } = require('./_lib/github');

const USERS_FILE = process.env.GITHUB_USERS_FILE || 'data/users.json';
function normUserId(u){ return String(u||'').trim(); }

function getSession(req){
  const secret = process.env.AUTH_SECRET || 'dev-secret-change-me';
  const cookies = parseCookies(req);
  return verify(cookies.tw_session, secret);
}

async function loadUsers(){
  const data = await readJsonFile(USERS_FILE);
  if (data && typeof data === 'object' && Array.isArray(data.users)) return data;
  return { users: [] };
}

async function saveUsers(data, actor){
  const payload = { users: data.users || [], updatedAt: new Date().toISOString(), updatedBy: actor || 'admin' };
  await ghPutFile(USERS_FILE, JSON.stringify(payload, null, 2), 'Update users');
}

module.exports = async (req, res) => {
  try {
    const session = getSession(req);
    if (!session) return json(res, 401, { error: 'Not authenticated' });
    if (session.role !== 'admin') return json(res, 403, { error: 'Forbidden' });

    if (req.method === 'GET') {
      const data = await loadUsers();
      const users = (data.users || []).map(u => ({ userId: u.userId, role: u.role || 'viewer', updatedAt: u.updatedAt || null }));
      return json(res, 200, { users });
    }

    if (req.method === 'POST') {
      const body = await readJson(req);
      const userId = normUserId(body.userId);
      const password = String(body.password || '');
      const role = String(body.role || 'viewer').toLowerCase();
      if (!userId) return json(res, 400, { error: 'userId required' });
      if (!password) return json(res, 400, { error: 'password required' });
      if (!['admin','creator','viewer'].includes(role)) return json(res, 400, { error: 'invalid role' });

      const data = await loadUsers();
      const now = new Date().toISOString();
      const existing = (data.users || []).find(u => normUserId(u.userId) === userId);
      const pass = hashPassword(password);
      if (existing) {
        existing.role = role;
        existing.pass = pass;
        existing.updatedAt = now;
      } else {
        (data.users = data.users || []).push({ userId, role, pass, createdAt: now, updatedAt: now });
      }
      await saveUsers(data, session.userId);
      return json(res, 200, { ok: true });
    }

    if (req.method === 'PUT') {
      const body = await readJson(req);
      const userId = normUserId(body.userId);
      if (!userId) return json(res, 400, { error: 'userId required' });
      const data = await loadUsers();
      const u = (data.users || []).find(x => normUserId(x.userId) === userId);
      if (!u) return json(res, 404, { error: 'user not found' });
      const now = new Date().toISOString();
      if (body.role) {
        const role = String(body.role).toLowerCase();
        if (!['admin','creator','viewer'].includes(role)) return json(res, 400, { error: 'invalid role' });
        u.role = role;
      }
      if (body.password) {
        u.pass = hashPassword(String(body.password));
      }
      u.updatedAt = now;
      await saveUsers(data, session.userId);
      return json(res, 200, { ok: true });
    }

    if (req.method === 'DELETE') {
      const body = await readJson(req);
      const userId = normUserId(body.userId);
      if (!userId) return json(res, 400, { error: 'userId required' });
      if (userId === (process.env.ADMIN_USER || 'admin')) return json(res, 400, { error: 'cannot delete bootstrap admin' });
      const data = await loadUsers();
      data.users = (data.users || []).filter(u => normUserId(u.userId) !== userId);
      await saveUsers(data, session.userId);
      return json(res, 200, { ok: true });
    }

    return json(res, 405, { error: 'Method not allowed' });

  } catch (e) {
    console.error(e);
    return json(res, 500, { error: e.message || String(e) });
  }
};
