
const { sign, setCookie, json, readJson, verifyPassword } = require('../_lib/auth');
const { readJsonFile } = require('../_lib/github');
const isProd = process.env.NODE_ENV === 'production';

const USERS_FILE = process.env.GITHUB_USERS_FILE || 'data/users.json';
function normUserId(u){ return String(u||'').trim(); }

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

    const secret = process.env.AUTH_SECRET || 'dev-secret-change-me';
    const adminUser = process.env.ADMIN_USER || 'admin';
    const adminPass = process.env.ADMIN_PASSWORD || 'admin';

    let body = {};
    try { body = await readJson(req); } catch (e) { return json(res, 400, { error: e.message }); }

    const userId = normUserId(body.userId || body.username);
    const password = String(body.password || '');
    if (!userId || !password) return json(res, 400, { error: 'User ID and password required' });

    // Bootstrap admin from env (no GitHub needed)
    if (userId === adminUser && password === adminPass) {
      const token = sign({ role: 'admin', userId }, secret);
      setCookie(res, 'tw_session', token, { httpOnly: true, sameSite: 'Lax', secure: isProd, maxAge: 60*60*12 });
      return json(res, 200, { authenticated: true, role: 'admin', userId });
    }

    // Non-admin users come from GitHub users file
    let data = null;
    try {
      data = await readJsonFile(USERS_FILE);
    } catch (e) {
      // If env missing, return clear error (not crash)
      return json(res, 500, { error: e.message || String(e) });
    }

    if (!data || !Array.isArray(data.users)) return json(res, 401, { error: 'Invalid credentials' });
    const u = data.users.find(x => normUserId(x.userId) === userId);
    if (!u || !verifyPassword(password, u.pass)) return json(res, 401, { error: 'Invalid credentials' });

    const role = u.role || 'viewer';
    const token = sign({ role, userId }, secret);
    setCookie(res, 'tw_session', token, { httpOnly: true, sameSite: 'Lax', secure: isProd, maxAge: 60*60*12 });
    return json(res, 200, { authenticated: true, role, userId });

  } catch (e) {
    console.error(e);
    return json(res, 500, { error: e.message || String(e) });
  }
};
