
const crypto = require('crypto');

function b64urlEncode(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input));
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function b64urlDecode(str) {
  str = String(str || '').replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Buffer.from(str, 'base64');
}

function sign(payload, secret, ttlSeconds = 60 * 60 * 12) {
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + ttlSeconds };
  const bodyB64 = b64urlEncode(JSON.stringify(body));
  const sig = crypto.createHmac('sha256', secret).update(bodyB64).digest();
  return bodyB64 + '.' + b64urlEncode(sig);
}

function verify(token, secret) {
  if (!token || typeof token !== 'string' || token.indexOf('.') === -1) return null;
  const [bodyB64, sigB64] = token.split('.');
  const expected = crypto.createHmac('sha256', secret).update(bodyB64).digest();
  const given = b64urlDecode(sigB64);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    const body = JSON.parse(b64urlDecode(bodyB64).toString('utf8'));
    const now = Math.floor(Date.now() / 1000);
    if (body.exp && now > body.exp) return null;
    return body;
  } catch {
    return null;
  }
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  header.split(';').map(s => s.trim()).filter(Boolean).forEach(kv => {
    const idx = kv.indexOf('=');
    if (idx === -1) return;
    const k = kv.slice(0, idx).trim();
    const v = kv.slice(idx + 1).trim();
    out[k] = decodeURIComponent(v);
  });
  return out;
}

function setCookie(res, name, value, opts = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${opts.path || '/'}`);
  if (opts.httpOnly !== false) parts.push('HttpOnly');
  parts.push(`SameSite=${opts.sameSite || 'Lax'}`);
  if (opts.secure) parts.push('Secure');
  if (opts.maxAge != null) parts.push(`Max-Age=${opts.maxAge}`);
  const cookie = parts.join('; ');
  const existing = res.getHeader('Set-Cookie');
  if (!existing) res.setHeader('Set-Cookie', cookie);
  else res.setHeader('Set-Cookie', Array.isArray(existing) ? existing.concat(cookie) : [existing, cookie]);
}

function json(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(obj));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

// PBKDF2 password hashing
const PBKDF2_ITERS = parseInt(process.env.PBKDF2_ITERS || '120000', 10);
const PBKDF2_KEYLEN = 32;
const PBKDF2_DIGEST = 'sha256';

function hashPassword(password, salt = null) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  const dk = crypto.pbkdf2Sync(String(password), salt, PBKDF2_ITERS, PBKDF2_KEYLEN, PBKDF2_DIGEST);
  return { salt, iters: PBKDF2_ITERS, hash: dk.toString('hex'), alg: `pbkdf2-${PBKDF2_DIGEST}` };
}

function verifyPassword(password, passObj) {
  if (!passObj || !passObj.salt || !passObj.hash) return false;
  const iters = parseInt(passObj.iters || PBKDF2_ITERS, 10);
  const dk = crypto.pbkdf2Sync(String(password), String(passObj.salt), iters, PBKDF2_KEYLEN, PBKDF2_DIGEST);
  const a = Buffer.from(String(passObj.hash), 'hex');
  if (a.length !== dk.length) return false;
  return crypto.timingSafeEqual(a, dk);
}

module.exports = { sign, verify, parseCookies, setCookie, json, readJson, hashPassword, verifyPassword };
