import crypto from 'node:crypto';

export function b64url(input) {
  const value =
    typeof input === 'string' || Buffer.isBuffer(input) ? input : JSON.stringify(input);
  return Buffer.from(value).toString('base64url');
}

export function randomId(bytes = 16) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function randomCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

export function sha256(value) {
  return crypto.createHash('sha256').update(value).digest();
}

export function safeEqual(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

export function signJwt(payload, secret, ttlSec) {
  const header = b64url({ alg: 'HS256', typ: 'JWT' });
  const now = Math.floor(Date.now() / 1000);
  const body = b64url({ ...payload, iat: now, exp: now + ttlSec });
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${header}.${body}`)
    .digest('base64url');
  return `${header}.${body}.${signature}`;
}

export function verifyJwt(token, secret, options = {}) {
  if (typeof token !== 'string') throw new Error('token is required');
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('malformed token');
  const [header, body, signature] = parts;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${header}.${body}`)
    .digest('base64url');
  if (!safeEqual(signature, expected)) throw new Error('bad signature');

  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= now) throw new Error('token expired');
  if (options.aud && payload.aud !== options.aud) throw new Error('bad audience');
  if (options.typ && payload.typ !== options.typ) throw new Error('bad token type');
  return payload;
}
