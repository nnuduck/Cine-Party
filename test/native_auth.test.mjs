import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/worker.js';

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

async function req(env, method, urlPath, { body, token, ip = '1.2.3.4' } = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'CF-Connecting-IP': ip,
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const res = await worker.fetch(
    new Request(`https://cinema-party.test${urlPath}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
    env
  );
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

test('native standalone auth: register, duplicate rejection, login, Bearer party flow, and logout', async () => {
  const db = createSqliteD1();
  const env = { DB: db };

  // 1. Validation failures
  let res = await req(env, 'POST', '/api/auth/register', { body: { login: 'a', password: 'secret' } });
  assert.equal(res.status, 400);

  res = await req(env, 'POST', '/api/auth/register', { body: { login: 'alex', password: '123' } });
  assert.equal(res.status, 400);

  // 2. Successful registration (Alice)
  res = await req(env, 'POST', '/api/auth/register', {
    body: {
      login: 'Alice.K',
      password: 'password123',
      display_name: 'Alice',
    },
  });
  assert.equal(res.status, 201);
  assert.ok(res.data.token && res.data.token.length >= 32);
  assert.equal(res.data.user.username, 'alice.k');
  assert.equal(res.data.user.display_name, 'Alice');
  assert.ok(res.data.user.id >= 1_000_000_000_000);
  const aliceToken = res.data.token;

  // 3. Duplicate login returns 409 (case-insensitive)
  res = await req(env, 'POST', '/api/auth/register', {
    body: {
      login: 'alice.k',
      password: 'password456',
    },
  });
  assert.equal(res.status, 409);

  // 4. Register second standalone user (Elena)
  res = await req(env, 'POST', '/api/auth/register', {
    body: {
      login: 'elena_v',
      password: 'password789',
      display_name: 'Elena',
    },
    ip: '5.6.7.8',
  });
  assert.equal(res.status, 201);
  const elenaToken = res.data.token;

  // 5. Login with wrong password fails 401
  res = await req(env, 'POST', '/api/auth/login', {
    body: {
      login: 'alice.k',
      password: 'wrongpassword',
    },
  });
  assert.equal(res.status, 401);

  // 6. Login with valid password issues new working Bearer token
  res = await req(env, 'POST', '/api/auth/login', {
    body: {
      login: 'alice.k',
      password: 'password123',
    },
  });
  assert.equal(res.status, 200);
  const aliceLoginToken = res.data.token;
  assert.notEqual(aliceLoginToken, aliceToken);

  // 7. Full multi-user party, folder, and movie sync over Bearer auth (zero Telegram involved)
  res = await req(env, 'POST', '/api/parties', { body: { name: 'Nothing Night' }, token: aliceLoginToken });
  assert.equal(res.status, 201);
  const partyId = res.data.id;
  const partyCode = res.data.code;

  res = await req(env, 'POST', '/api/parties/join', { body: { code: partyCode }, token: elenaToken });
  assert.equal(res.status, 200);
  assert.equal(res.data.id, partyId);

  const folderRes = await req(env, 'POST', `/api/parties/${partyId}/folders`, {
    body: { name: 'Sci-Fi Vault', color: '#D71921', kind: 'together' },
    token: aliceLoginToken,
  });
  assert.equal(folderRes.status, 201);

  const movieRes = await req(env, 'POST', `/api/parties/${partyId}/movies`, {
    body: {
      title: 'Blade Runner 2049',
      year: '2017',
      kind: 'together',
      status: 'watched',
      rating: 5,
      folder_id: folderRes.data.id,
      tags: '#sci-fi #cyberpunk',
    },
    token: elenaToken,
  });
  assert.equal(movieRes.status, 201);
  assert.equal(movieRes.data.added_by_name, 'Elena');

  // Verify Alice sees Elena's movie & folder via GET /api/me + movies
  const meAlice = await req(env, 'GET', '/api/me', { token: aliceLoginToken });
  assert.equal(meAlice.status, 200);
  assert.equal(meAlice.data.parties.length, 1);
  assert.equal(meAlice.data.parties[0].members.length, 2);

  // 8. Logout invalidates the session token
  res = await req(env, 'POST', '/api/auth/logout', { token: aliceLoginToken });
  assert.equal(res.status, 200);

  const afterLogout = await req(env, 'GET', '/api/me', { token: aliceLoginToken });
  assert.equal(afterLogout.status, 401);
});
