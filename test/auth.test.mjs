import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { verifyInitData, authenticate } from '../src/auth.js';

const TOKEN = '123456:TEST-TOKEN';

function sign(fields, token = TOKEN) {
  const params = new URLSearchParams(fields);
  const dcs = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  params.set('hash', crypto.createHmac('sha256', secret).update(dcs).digest('hex'));
  return params.toString();
}

const now = () => String(Math.floor(Date.now() / 1000));
const userJson = (id = 42, first_name = 'Alex') => JSON.stringify({ id, first_name });

test('accepts valid initData', async () => {
  const raw = sign({ auth_date: now(), user: userJson() });
  const u = await verifyInitData(raw, TOKEN);
  assert.ok(u);
  assert.equal(u.id, 42);
  assert.equal(u.first_name, 'Alex');
});

test('rejects tampered data', async () => {
  const good = sign({ auth_date: now(), user: userJson(42) });
  const bad = good.replace('42', '43');
  assert.notEqual(good, bad);
  const u = await verifyInitData(bad, TOKEN);
  assert.equal(u, null);
});

test('rejects data signed with another token', async () => {
  const forged = sign({ auth_date: now(), user: userJson() }, 'other:bot-token');
  const u = await verifyInitData(forged, TOKEN);
  assert.equal(u, null);
});

test('rejects expired data (> 24 hours)', async () => {
  const old = String(Math.floor(Date.now() / 1000) - 86400 * 2);
  const raw = sign({ auth_date: old, user: userJson() });
  const u = await verifyInitData(raw, TOKEN);
  assert.equal(u, null);
});

test('rejects missing hash', async () => {
  const params = new URLSearchParams({ auth_date: now(), user: userJson() });
  const u = await verifyInitData(params.toString(), TOKEN);
  assert.equal(u, null);
});

test('dev header is rejected unless DEV_AUTH=1', async () => {
  const req = new Request('http://localhost/api/me', {
    headers: { Authorization: 'dev 999:TestUser' },
  });

  const mockDb = {
    prepare: () => ({
      bind: () => ({
        run: async () => {},
      }),
    }),
  };

  // With DEV_AUTH=0
  await assert.rejects(
    async () => await authenticate(req, { DEV_AUTH: '0', DB: mockDb }),
    { status: 401 }
  );

  // With DEV_AUTH=1
  const u = await authenticate(req, { DEV_AUTH: '1', DB: mockDb });
  assert.equal(u.id, 999);
  assert.equal(u.first_name, 'TestUser');
});
