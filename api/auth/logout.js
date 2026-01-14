
const { setCookie, json } = require('../_lib/auth');
const isProd = process.env.NODE_ENV === 'production';
module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST' && req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });
    setCookie(res, 'tw_session', '', { maxAge: 0, secure: isProd });
    return json(res, 200, { ok: true });
  } catch (e) {
    console.error(e);
    return json(res, 500, { error: e.message || String(e) });
  }
};
