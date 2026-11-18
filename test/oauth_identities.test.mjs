import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/worker.js';
import { base64UrlEncode, verifyGoogleIdToken } from '../src/auth.js';

function createSqliteD1() {
  const sqlite = new DatabaseSync(':memory:');
  const migDir = path.resolve('migrations');
  const files = fs.readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    sqlite.exec(fs.readFileSync(path.join(migDir, file), 'utf8'));
  }

  return {
    sqlite,
    prepare(sql) {
      let args = [];
      const stmt = {
        bind(...params) {
          args = params.map((p) => (p === undefined ? null : p));
          return stmt;
        },
        async first() {
          const prepared = sqlite.prepare(sql);
          return prepared.get(...args) ?? null;
        },
        async all() {
          const prepared = sqlite.prepare(sql);
          return { results: prepared.all(...args), success: true };
        },
        async run() {
          const prepared = sqlite.prepare(sql);
          const info = prepared.run(...args);
          return {
            success: true,
            meta: {
              last_row_id: Number(info.lastInsertRowid || 0),
              changes: Number(info.changes || 0),
            },
          };
        },
      };
      return stmt;
    },
  };
}

async function req(env, method, urlPath, { body, token, headers = {}, ip = '9.8.7.6' } = {}) {
  const merged = {
    'Content-Type': 'application/json',
    'CF-Connecting-IP': ip,
    ...headers,
  };
  if (token) {
    merged.Authorization = `Bearer ${token}`;
  }
  const res = await worker.fetch(
    new Request(`https://cinema-party.test${urlPath}`, {
      method,
      headers: merged,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
    env
  );
  const text = await res.text();
  let data = {};
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  return { status: res.status, data };
}

async function generateRsaFixture(kid = 'test-kid-1') {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify']
  );
  const jwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  jwk.kid = kid;
  jwk.use = 'sig';
  jwk.alg = 'RS256';
  return { privateKey: keyPair.privateKey, jwk };
}

async function signJwt({ privateKey, kid, payload }) {
  const enc = new TextEncoder();
  const headerB64 = base64UrlEncode(enc.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid })));
  const payloadB64 = base64UrlEncode(enc.encode(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, enc.encode(signingInput));
  return `${signingInput}.${base64UrlEncode(new Uint8Array(sig))}`;
}

test('native Telegram login syncs pre-existing DB user, movies, folders, and supports linking/unlinking Google', async () => {
  const db = createSqliteD1();
  const env = {
    DB: db,
    BOT_USERNAME: 'cine_party_bot',
    BOT_TOKEN: '123:test-bot-token',
    WEBHOOK_SECRET: 'hook-secret',
    GOOGLE_CLIENT_ID: 'google-client-123.apps.googleusercontent.com',
  };

  // Seed pre-existing Telegram user (ID 555666) who created a party, folder, and movie in Mini App
  db.sqlite.prepare(
    "INSERT INTO users (id, first_name, username, custom_name, accent) VALUES (555666, 'Viktor', 'viktor_tg', 'Viktor V', '#D71921')"
  ).run();
  db.sqlite.prepare(
    "INSERT INTO user_identities (provider, provider_uid, user_id, handle, display_name) VALUES ('telegram', '555666', 555666, 'viktor_tg', 'Viktor V')"
  ).run();
  const partyRow = db.sqlite.prepare(
    "INSERT INTO parties (name, code, created_by) VALUES ('Retro Night', 'RETRO1', 555666)"
  ).run();
  const partyId = Number(partyRow.lastInsertRowid);
  db.sqlite.prepare('INSERT INTO members (party_id, user_id) VALUES (?1, 555666)').run(partyId);
  const folderRow = db.sqlite.prepare(
    "INSERT INTO folders (party_id, user_id, kind, name, color) VALUES (?1, 555666, 'personal', 'Favorites', '#3B82F6')"
  ).run(partyId);
  db.sqlite.prepare(
    "INSERT INTO movies (party_id, added_by, kind, status, title, year, folder_id) VALUES (?1, 555666, 'personal', 'want', 'Dune', '2021', ?2)"
  ).run(partyId, Number(folderRow.lastInsertRowid));

  // 1. Discover providers (unauthenticated)
  const providersRes = await req(env, 'GET', '/api/auth/providers');
  assert.equal(providersRes.status, 200);
  assert.equal(providersRes.data.telegram.enabled, true);
  assert.equal(providersRes.data.telegram.bot_username, 'cine_party_bot');
  assert.equal(providersRes.data.google.enabled, true);
  assert.equal(providersRes.data.google.client_id, 'google-client-123.apps.googleusercontent.com');

  // 2. Start Telegram native login challenge
  const startRes = await req(env, 'POST', '/api/auth/telegram/start', { body: { mode: 'login' } });
  assert.equal(startRes.status, 201);
  const { challenge_id: cid, client_secret: csec, tg_deep_link } = startRes.data;
  assert.ok(tg_deep_link.startsWith(`tg://resolve?domain=cine_party_bot&start=auth_${cid}`));

  // Wrong secret on poll is rejected
  const badPoll = await req(env, 'POST', '/api/auth/challenge/poll', {
    body: { challenge_id: cid, client_secret: 'deadbeef' },
  });
  assert.equal(badPoll.status, 401);

  // Pending while unconfirmed
  const pendingPoll = await req(env, 'POST', '/api/auth/challenge/poll', {
    body: { challenge_id: cid, client_secret: csec },
  });
  assert.equal(pendingPoll.data.status, 'pending');

  // 3. Mock outbound Telegram Bot API calls while simulating webhook /start + callback confirmation
  const { privateKey, jwk } = await generateRsaFixture('test-kid-google-1');
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const s = String(url);
    if (s.startsWith('https://api.telegram.org/bot')) {
      return new Response(JSON.stringify({ ok: true, result: { photos: [] } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (s === 'https://www.googleapis.com/oauth2/v3/certs') {
      return new Response(JSON.stringify({ keys: [jwk] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return await origFetch(url, init);
  };

  try {
    // User taps Start in bot
    const whStart = await req(env, 'POST', '/telegram', {
      headers: { 'X-Telegram-Bot-Api-Secret-Token': 'hook-secret' },
      body: {
        message: {
          text: `/start auth_${cid}`,
          chat: { id: 555666 },
          from: { id: 555666, first_name: 'Viktor', username: 'viktor_tg' },
        },
      },
    });
    assert.equal(whStart.status, 200);

    // User taps Confirm button
    const whConfirm = await req(env, 'POST', '/telegram', {
      headers: { 'X-Telegram-Bot-Api-Secret-Token': 'hook-secret' },
      body: {
        callback_query: {
          id: 'cb_1',
          data: `tg_auth_ok:${cid}`,
          from: { id: 555666, first_name: 'Viktor', username: 'viktor_tg' },
          message: { chat: { id: 555666 }, message_id: 99 },
        },
      },
    });
    assert.equal(whConfirm.status, 200);

    // 4. App polls & receives Bearer session for EXISTING user 555666
    const okPoll = await req(env, 'POST', '/api/auth/challenge/poll', {
      body: { challenge_id: cid, client_secret: csec },
    });
    assert.equal(okPoll.status, 200);
    assert.equal(okPoll.data.status, 'authenticated');
    assert.equal(okPoll.data.user.id, 555666);
    assert.equal(okPoll.data.user.display_name, 'Viktor V');
    assert.deepEqual(
      okPoll.data.user.identities.map((i) => i.provider),
      ['telegram']
    );
    const tgSessionToken = okPoll.data.token;

    // Verify all existing rooms and movies are synced!
    const meRes = await req(env, 'GET', '/api/me', { token: tgSessionToken });
    assert.equal(meRes.status, 200);
    assert.equal(meRes.data.parties.length, 1);
    assert.equal(meRes.data.parties[0].code, 'RETRO1');

    const moviesRes = await req(env, 'GET', `/api/parties/${partyId}/movies`, { token: tgSessionToken });
    assert.equal(moviesRes.status, 200);
    assert.equal(moviesRes.data.movies[0].title, 'Dune');

    // Cannot unlink sole identity (telegram without password/google)
    const soleUnlink = await req(env, 'DELETE', '/api/me/identities/telegram', { token: tgSessionToken });
    assert.equal(soleUnlink.status, 400);

    // 5. Link Google account to 555666 via verified OIDC id_token
    const validIdToken = await signJwt({
      privateKey,
      kid: 'test-kid-google-1',
      payload: {
        iss: 'https://accounts.google.com',
        aud: 'google-client-123.apps.googleusercontent.com',
        sub: 'google-sub-999',
        email: 'viktor@gmail.com',
        email_verified: true,
        name: 'Viktor G',
        picture: 'https://lh3.googleusercontent.com/a/avatar',
        exp: Math.floor(Date.now() / 1000) + 3600,
      },
    });

    const linkRes = await req(env, 'POST', '/api/me/identities/google/id-token', {
      token: tgSessionToken,
      body: { id_token: validIdToken },
    });
    assert.equal(linkRes.status, 200);
    assert.deepEqual(
      linkRes.data.user.identities.map((i) => i.provider).sort(),
      ['google', 'telegram']
    );

    // 6. Fresh login using ONLY Google id_token resolves straight into existing user 555666!
    const googleLoginRes = await req(env, 'POST', '/api/auth/google/id-token', {
      body: { id_token: validIdToken },
    });
    assert.equal(googleLoginRes.status, 200);
    assert.equal(googleLoginRes.data.user.id, 555666);

    // 7. Reject wrong audience & tampered signature
    const badAudToken = await signJwt({
      privateKey,
      kid: 'test-kid-google-1',
      payload: {
        iss: 'https://accounts.google.com',
        aud: 'wrong-client-id',
        sub: 'google-sub-999',
        email_verified: true,
        exp: Math.floor(Date.now() / 1000) + 3600,
      },
    });
    await assert.rejects(
      () => verifyGoogleIdToken(badAudToken, 'google-client-123.apps.googleusercontent.com', globalThis.fetch),
      { status: 401 }
    );
    const tampered = `${validIdToken.slice(0, -4)}AAAA`;
    await assert.rejects(
      () => verifyGoogleIdToken(tampered, 'google-client-123.apps.googleusercontent.com', globalThis.fetch),
      { status: 401 }
    );

    // 8. Unlink Google now succeeds because Telegram identity remains
    const unlinkRes = await req(env, 'DELETE', '/api/me/identities/google', { token: tgSessionToken });
    assert.equal(unlinkRes.status, 200);
    assert.deepEqual(
      unlinkRes.data.user.identities.map((i) => i.provider),
      ['telegram']
    );

    // 9. Telegram cancel button marks challenge as error/cancelled
    const startCancel = await req(env, 'POST', '/api/auth/telegram/start', { body: { mode: 'login' } });
    await req(env, 'POST', '/telegram', {
      headers: { 'X-Telegram-Bot-Api-Secret-Token': 'hook-secret' },
      body: {
        callback_query: {
          id: 'cb_cancel',
          data: `tg_auth_no:${startCancel.data.challenge_id}`,
          from: { id: 555666, first_name: 'Viktor' },
          message: { chat: { id: 555666 }, message_id: 100 },
        },
      },
    });
    const cancelPoll = await req(env, 'POST', '/api/auth/challenge/poll', {
      body: {
        challenge_id: startCancel.data.challenge_id,
        client_secret: startCancel.data.client_secret,
      },
    });
    assert.equal(cancelPoll.data.status, 'error');
  } finally {
    globalThis.fetch = origFetch;
  }
});
