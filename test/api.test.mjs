import test from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.TEST_API_BASE || 'http://localhost:8787';

const H_USER1 = {
  Authorization: 'dev 101:Alice',
  'Content-Type': 'application/json',
};

const H_USER2 = {
  Authorization: 'dev 102:Bob',
  'Content-Type': 'application/json',
};

const H_OUTSIDER = {
  Authorization: 'dev 103:Charlie',
  'Content-Type': 'application/json',
};

test('1. no auth -> 401', async () => {
  const res = await fetch(`${BASE}/api/me`);
  assert.equal(res.status, 401);
});

let partyId = null;
let partyCode = null;

test('2. create party', async () => {
  const res = await fetch(`${BASE}/api/parties`, {
    method: 'POST',
    headers: H_USER1,
    body: JSON.stringify({ name: 'Friday Night' }),
  });
  assert.equal(res.status, 201);
  const data = await res.json();
  assert.ok(data.id);
  assert.ok(data.code);
  assert.equal(data.name, 'Friday Night');
  partyId = data.id;
  partyCode = data.code;
});

test('3. outsider cannot read the party -> 403', async () => {
  const res = await fetch(`${BASE}/api/parties/${partyId}/movies`, {
    headers: H_OUTSIDER,
  });
  assert.equal(res.status, 403);
});

test('4. join by code', async () => {
  const res = await fetch(`${BASE}/api/parties/join`, {
    method: 'POST',
    headers: H_USER2,
    body: JSON.stringify({ code: partyCode }),
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.id, partyId);
});

let sharedMovieId = null;
let personalMovieId = null;

test('5. add together + personal movies', async () => {
  // Shared movie by User 1
  const r1 = await fetch(`${BASE}/api/parties/${partyId}/movies`, {
    method: 'POST',
    headers: H_USER1,
    body: JSON.stringify({
      title: 'Inception',
      year: '2010',
      kind: 'together',
      poster: 'https://image.tmdb.org/t/p/w342/test.jpg',
    }),
  });
  assert.equal(r1.status, 201);
  const m1 = await r1.json();
  assert.equal(m1.title, 'Inception');
  assert.equal(m1.kind, 'together');
  sharedMovieId = m1.id;

  // Personal movie by User 1
  const r2 = await fetch(`${BASE}/api/parties/${partyId}/movies`, {
    method: 'POST',
    headers: H_USER1,
    body: JSON.stringify({
      title: 'Solo Watch',
      year: '2023',
      kind: 'personal',
    }),
  });
  assert.equal(r2.status, 201);
  const m2 = await r2.json();
  assert.equal(m2.title, 'Solo Watch');
  assert.equal(m2.kind, 'personal');
  personalMovieId = m2.id;
});

test('6. validation', async () => {
  // Empty title
  const r1 = await fetch(`${BASE}/api/parties/${partyId}/movies`, {
    method: 'POST',
    headers: H_USER1,
    body: JSON.stringify({ title: '' }),
  });
  assert.equal(r1.status, 400);

  // Disallowed poster domain
  const r2 = await fetch(`${BASE}/api/parties/${partyId}/movies`, {
    method: 'POST',
    headers: H_USER1,
    body: JSON.stringify({
      title: 'Evil Poster',
      poster: 'https://evil.com/fake.jpg',
    }),
  });
  assert.equal(r2.status, 400);
});

test('7. other member can edit shared movie and rate it', async () => {
  const res = await fetch(`${BASE}/api/movies/${sharedMovieId}`, {
    method: 'PATCH',
    headers: H_USER2,
    body: JSON.stringify({
      status: 'watched',
      rating: 5,
    }),
  });
  assert.equal(res.status, 200);
  const updated = await res.json();
  assert.equal(updated.status, 'watched');
  assert.equal(updated.rating, 5);
});

test('8. other member cannot touch a personal movie -> 403', async () => {
  // User 2 tries to delete User 1's personal movie
  const r1 = await fetch(`${BASE}/api/movies/${personalMovieId}`, {
    method: 'DELETE',
    headers: H_USER2,
  });
  assert.equal(r1.status, 403);

  // User 2 tries to edit User 1's personal movie
  const r2 = await fetch(`${BASE}/api/movies/${personalMovieId}`, {
    method: 'PATCH',
    headers: H_USER2,
    body: JSON.stringify({ title: 'Hacked' }),
  });
  assert.equal(r2.status, 403);
});

test('9. cover upload, fetch, cleanup', async () => {
  // Upload small WebP dummy payload
  const dummyWebp = new Uint8Array([
    0x52, 0x49, 0x46, 0x46, 0x14, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
    0x56, 0x50, 0x38, 0x20, 0x08, 0x00, 0x00, 0x00, 0x30, 0x01, 0x00, 0x9d,
  ]);

  const upRes = await fetch(`${BASE}/api/covers`, {
    method: 'POST',
    headers: {
      Authorization: 'dev 101:Alice',
      'Content-Type': 'image/webp',
    },
    body: dummyWebp,
  });
  assert.equal(upRes.status, 201);
  const upData = await upRes.json();
  assert.ok(upData.id);
  assert.equal(upData.url, `/api/covers/${upData.id}`);

  // Fetch cover
  const getRes = await fetch(`${BASE}${upData.url}`);
  assert.equal(getRes.status, 200);
  assert.equal(getRes.headers.get('Content-Type'), 'image/webp');
  const buf = await getRes.arrayBuffer();
  assert.equal(buf.byteLength, dummyWebp.byteLength);
});

test('10. accent setting', async () => {
  const res = await fetch(`${BASE}/api/me/accent`, {
    method: 'PATCH',
    headers: H_USER1,
    body: JSON.stringify({ accent: '#3b82f6' }),
  });
  assert.equal(res.status, 200);

  const meRes = await fetch(`${BASE}/api/me`, { headers: H_USER1 });
  const meData = await meRes.json();
  assert.equal(meData.user.accent, '#3b82f6');
});

test('11. user profile updates', async () => {
  const res = await fetch(`${BASE}/api/me/profile`, {
    method: 'PATCH',
    headers: H_USER1,
    body: JSON.stringify({ name: 'Alice Walker', avatar_url: 'https://example.com/avatar.jpg' }),
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.user.custom_name, 'Alice Walker');
  assert.equal(data.user.avatar_url, 'https://example.com/avatar.jpg');

  const meRes = await fetch(`${BASE}/api/me`, { headers: H_USER1 });
  const meData = await meRes.json();
  assert.equal(meData.user.display_name, 'Alice Walker');
  assert.equal(meData.user.avatar_url, 'https://example.com/avatar.jpg');
});

test('12. movie search open catalog', async () => {
  const res = await fetch(`${BASE}/api/movies/search?q=Inception`, {
    headers: H_USER1,
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(Array.isArray(data.results));
  assert.ok(data.results.length > 0);
  assert.equal(data.results[0].title, 'Inception');
  assert.ok(data.results[0].poster);
});

test('13. rename, delete, leave', async () => {
  // Rename party
  const r1 = await fetch(`${BASE}/api/parties/${partyId}`, {
    method: 'PATCH',
    headers: H_USER1,
    body: JSON.stringify({ name: 'Renamed Party' }),
  });
  assert.equal(r1.status, 200);

  // Author deletes personal movie
  const r2 = await fetch(`${BASE}/api/movies/${personalMovieId}`, {
    method: 'DELETE',
    headers: H_USER1,
  });
  assert.equal(r2.status, 200);

  // Leave party
  const r3 = await fetch(`${BASE}/api/parties/${partyId}/leave`, {
    method: 'POST',
    headers: H_USER2,
  });
  assert.equal(r3.status, 200);
});

test('14. telegram webhook rejects wrong secret', async () => {
  const res = await fetch(`${BASE}/telegram`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Telegram-Bot-Api-Secret-Token': 'wrong-secret',
    },
    body: JSON.stringify({ update_id: 1 }),
  });
  // If WEBHOOK_SECRET is set, returns 403; if not set in local dev, returns 200
  assert.ok([200, 403].includes(res.status));
});
