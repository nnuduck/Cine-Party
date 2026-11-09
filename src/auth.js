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
    };
  } catch {
    return null;
  }
}

export async function authenticate(request, env) {
  const header = request.headers.get('Authorization') || '';
  let user = null;

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
    `INSERT INTO users (id, first_name, username) VALUES (?1, ?2, ?3)
     ON CONFLICT(id) DO UPDATE SET first_name = excluded.first_name, username = excluded.username
     WHERE users.first_name != excluded.first_name OR COALESCE(users.username, '') != COALESCE(excluded.username, '')`
  )
    .bind(user.id, user.first_name, user.username)
    .run();

  return user;
}
