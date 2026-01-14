
const { verify, parseCookies, json } = require('../_lib/auth');
module.exports = async (req, res) => {
  try {
    const secret = process.env.AUTH_SECRET || 'dev-secret-change-me';
    const cookies = parseCookies(req);
    const session = verify(cookies.tw_session, secret);
    if (!session) return json(res, 200, { authenticated: false });
    return json(res, 200, { authenticated: true, role: session.role, userId: session.userId || null });
  } catch (e) {
    console.error(e);
    return json(res, 500, { error: e.message || String(e) });
  }
};
