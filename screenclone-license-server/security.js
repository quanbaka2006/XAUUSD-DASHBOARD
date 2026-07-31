const crypto = require('crypto');

const PASSWORD_ITERATIONS = 210000;
const PASSWORD_KEY_LENGTH = 64;
const PASSWORD_DIGEST = 'sha512';

function timingSafeEqual(left, right) {
  const a = Buffer.isBuffer(left) ? left : Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.isBuffer(right) ? right : Buffer.from(String(right || ''), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) {
    throw new Error('Password must contain between 12 and 128 characters');
  }
  const salt = crypto.randomBytes(16);
  const derived = crypto.pbkdf2Sync(
    password,
    salt,
    PASSWORD_ITERATIONS,
    PASSWORD_KEY_LENGTH,
    PASSWORD_DIGEST
  );
  return `pbkdf2-sha512$${PASSWORD_ITERATIONS}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

function verifyPassword(password, storedHash) {
  if (typeof password !== 'string' || typeof storedHash !== 'string') return false;
  const parts = storedHash.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2-sha512') return false;
  const iterations = Number.parseInt(parts[1], 10);
  if (!Number.isInteger(iterations) || iterations < 100000 || iterations > 2000000
      || !/^[a-f0-9]{32}$/i.test(parts[2]) || !/^[a-f0-9]{128}$/i.test(parts[3])) {
    return false;
  }
  const derived = crypto.pbkdf2Sync(
    password,
    Buffer.from(parts[2], 'hex'),
    iterations,
    PASSWORD_KEY_LENGTH,
    PASSWORD_DIGEST
  );
  return timingSafeEqual(derived, Buffer.from(parts[3], 'hex'));
}

function signAdminSession(payload, secret, lifetimeSeconds = 30 * 60) {
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new Error('Admin session secret is not configured');
  }
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({
    ...payload,
    aud: 'screenclone-admin',
    iat: now,
    exp: now + Math.min(60 * 60, Math.max(5 * 60, lifetimeSeconds)),
    jti: crypto.randomBytes(16).toString('hex')
  })).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

function verifyAdminSession(token, secret) {
  if (typeof token !== 'string' || typeof secret !== 'string' || secret.length < 32) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const expected = crypto.createHmac('sha256', secret).update(`${parts[0]}.${parts[1]}`).digest('base64url');
  if (!timingSafeEqual(parts[2], expected)) return null;
  try {
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    const now = Math.floor(Date.now() / 1000);
    if (header.alg !== 'HS256' || header.typ !== 'JWT'
        || payload.aud !== 'screenclone-admin'
        || payload.role !== 'Owner'
        || !payload.sub
        || payload.iat > now + 60
        || payload.exp <= now) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

module.exports = {
  hashPassword,
  signAdminSession,
  timingSafeEqual,
  verifyAdminSession,
  verifyPassword
};
