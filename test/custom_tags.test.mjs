import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';

test('custom-tags normalization and storage', async () => {
  let storedTags = '[]';
  const mockDb = {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() {
              if (sql.includes('SELECT custom_tags')) {
                return { custom_tags: storedTags };
              }
              return null;
            },
            async run() {
              if (sql.includes('UPDATE users SET custom_tags')) {
                storedTags = args[0];
                return { success: true };
              }
              return {};
            },
          };
        },
      };
    },
  };

  const mockEnv = {
    DB: mockDb,
    DEV_AUTH: '1',
  };

  // 1. Initial GET
  const reqGet = new Request('http://localhost/api/me/custom-tags', {
    method: 'GET',
    headers: { Authorization: 'dev 42:TestUser' },
  });
  const resGet = await worker.fetch(reqGet, mockEnv);
  assert.equal(resGet.status, 200);
  const dataGet = await resGet.json();
  assert.deepEqual(dataGet.tags, []);

  // 2. PATCH with valid and invalid tags
  const reqPatch = new Request('http://localhost/api/me/custom-tags', {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'dev 42:TestUser',
    },
    body: JSON.stringify({
      tags: ['date_night', '#With_Kolya', '#date_night', 'Invalid$$$Tag!!!', '#favorite-2024'],
    }),
  });
  const resPatch = await worker.fetch(reqPatch, mockEnv);
  assert.equal(resPatch.status, 200);
  const dataPatch = await resPatch.json();
  assert.deepEqual(dataPatch.tags, ['#date_night', '#with_kolya', '#favorite-2024']);

  // 3. GET again to ensure DB persistence
  const resGet2 = await worker.fetch(reqGet, mockEnv);
  assert.equal(resGet2.status, 200);
  const dataGet2 = await resGet2.json();
  assert.deepEqual(dataGet2.tags, ['#date_night', '#with_kolya', '#favorite-2024']);
});
