// Authentication and Telegram initData signature verification.

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function hexToBytes(hex) {
  if (hex.length % 2 !== 0) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    const val = parseInt(hex.slice(i, i + 2), 16);
    if (Number.isNaN(val)) return null;
    bytes[i / 2] = val;
  }
  return bytes;
}

function bytesToHex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function generateSaltHex(bytesLen = 16) {
  const bytes = new Uint8Array(bytesLen);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

export async function sha256Hex(inputString) {
  const data = new TextEncoder().encode(String(inputString || ''));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return bytesToHex(new Uint8Array(digest));
}

export async function hashPassword(password, saltHex) {
  const saltBytes = hexToBytes(saltHex);
  if (!saltBytes) throw new Error('Invalid salt');
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(String(password || '')),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  );
  return bytesToHex(new Uint8Array(derivedBits));
}

export async function verifyPassword(password, saltHex, expectedHashHex) {
  const expected = hexToBytes(expectedHashHex);
  if (!expected) return false;
  const computedHex = await hashPassword(password, saltHex);
  const computed = hexToBytes(computedHex);
  if (!computed) return false;
  return timingSafeEqual(computed, expected);
}

export function generateNativeUserId() {
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  let rand40 = 0;
  for (let i = 0; i < 5; i++) {
    rand40 = rand40 * 256 + bytes[i];
  }
  return 1_000_000_000_000 + rand40;
}

export async function createSession(env, userId, ttlDays = 90) {
  const tokenBytes = new Uint8Array(32);
  crypto.getRandomValues(tokenBytes);
  const rawToken = bytesToHex(tokenBytes);
  const tokenHash = await sha256Hex(rawToken);
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString();
  await env.DB.prepare(
    'INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES (?1, ?2, ?3)'
  )
    .bind(tokenHash, userId, expiresAt)
    .run();
  return rawToken;
}

export async function revokeSession(env, rawToken) {
  if (!rawToken) return;
  const tokenHash = await sha256Hex(rawToken);
  await env.DB.prepare('DELETE FROM auth_sessions WHERE token_hash = ?1')
    .bind(tokenHash)
    .run();
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

export async function verifyInitData(initData, botToken, maxAgeSec = 86400) {
  if (!initData || !botToken) return null;

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');

  const givenBytes = hexToBytes(hash);
  if (!givenBytes) return null;

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const enc = new TextEncoder();

  // secret = HMAC-SHA256("WebAppData", botToken)
  const keySecret = await crypto.subtle.importKey(
    'raw',
    enc.encode('WebAppData'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const secretBytes = await crypto.subtle.sign('HMAC', keySecret, enc.encode(botToken));

  // calc = HMAC-SHA256(secret, dataCheckString)
  const keyCalc = await crypto.subtle.importKey(
    'raw',
    secretBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const calcBytes = new Uint8Array(
    await crypto.subtle.sign('HMAC', keyCalc, enc.encode(dataCheckString))
  );

  if (!timingSafeEqual(givenBytes, calcBytes)) return null;

  const authDate = Number(params.get('auth_date') || 0);
  if (!authDate) return null;
  const now = Math.floor(Date.now() / 1000);
  if (now - authDate > maxAgeSec || authDate - now > 300) return null;

  try {
    const raw = params.get('user');
    if (!raw) return null;
    const u = JSON.parse(raw);
    if (!u || !u.id) return null;
    return {
      id: Number(u.id),
      first_name: String(u.first_name || ''),
      username: u.username ? String(u.username) : null,
      photo_url: u.photo_url ? String(u.photo_url) : null,
    };
  } catch {
    return null;
  }
}

export async function authenticate(request, env) {
  const header = request.headers.get('Authorization') || '';
  let user = null;

  if (header.startsWith('Bearer ')) {
    const rawToken = header.slice(7).trim();
    if (rawToken) {
      const tokenHash = await sha256Hex(rawToken);
      const row = await env.DB.prepare(
        `SELECT u.id, u.first_name, u.username
         FROM auth_sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ?1 AND datetime(s.expires_at) > datetime('now')`
      )
        .bind(tokenHash)
        .first();
      if (row) {
        return {
          id: Number(row.id),
          first_name: row.first_name,
          username: row.username,
        };
      }
    }
    throw new HttpError(401, 'Unauthorized');
  }

  if (header.startsWith('tma ')) {
    const initData = header.slice(4).trim();
    user = await verifyInitData(initData, env.BOT_TOKEN);
  } else if (header.startsWith('dev ') && env.DEV_AUTH === '1') {
    // DEV_AUTH is strictly for local automated testing
    const [rawId, ...rest] = header.slice(4).split(':');
    const id = Number(rawId);
    if (Number.isInteger(id) && id > 0) {
      user = {
        id,
        first_name: decodeURIComponent(rest.join(':') || 'Dev User'),
        username: null,
      };
    }
  }

  if (!user) {
    throw new HttpError(401, 'Unauthorized');
  }

  // Upsert user in D1
  await env.DB.prepare(
    `INSERT INTO users (id, first_name, username, avatar_url) VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT(id) DO UPDATE SET
       first_name = CASE WHEN users.custom_name IS NULL THEN excluded.first_name ELSE users.first_name END,
       username = excluded.username,
       avatar_url = COALESCE(users.avatar_url, excluded.avatar_url)`
  )
    .bind(user.id, user.first_name, user.username, user.photo_url || null)
    .run();

  return user;
}
