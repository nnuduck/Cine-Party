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

function seedPartyAndUsers(sqlite) {
  sqlite.exec(`
    INSERT INTO users (id, first_name, username) VALUES (101, 'Nico', 'nico');
    INSERT INTO users (id, first_name, username) VALUES (102, 'Nina', 'nina');
    INSERT INTO parties (id, name, code, created_by) VALUES (1, 'Movie Club', 'CODE1234', 101);
    INSERT INTO members (party_id, user_id) VALUES (1, 101);
    INSERT INTO members (party_id, user_id) VALUES (1, 102);
  `);
}

async function apiReq(env, userId, method, urlPath, body) {
  const req = new Request(`http://localhost${urlPath}`, {
    method,
    headers: {
      Authorization: `dev ${userId}:User${userId}`,
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const res = await worker.fetch(req, env);
  const data = await res.json();
  return { status: res.status, data };
}

test('Folders API: CRUD, uniqueness, permissions, movie movement, and cover cleanup', async () => {
  const db = createSqliteD1();
  seedPartyAndUsers(db.sqlite);
  const env = { DB: db, DEV_AUTH: '1' };

  // 1. Validation errors
  let res = await apiReq(env, 101, 'POST', '/api/parties/1/folders', { name: '   ', color: '#D71921', kind: 'together' });
  assert.equal(res.status, 400);

  res = await apiReq(env, 101, 'POST', '/api/parties/1/folders', { name: 'x'.repeat(41), color: '#D71921', kind: 'together' });
  assert.equal(res.status, 400);

  res = await apiReq(env, 101, 'POST', '/api/parties/1/folders', { name: 'Sci-Fi', color: 'red', kind: 'together' });
  assert.equal(res.status, 400);

  res = await apiReq(env, 101, 'POST', '/api/parties/1/folders', { name: 'Sci-Fi', color: '#D71921', kind: 'invalid' });
  assert.equal(res.status, 400);

  // 2. Create together folder + conflict 409
  res = await apiReq(env, 101, 'POST', '/api/parties/1/folders', { name: 'Weekend Marathon', color: '#3B82F6', kind: 'together' });
  assert.equal(res.status, 201);
  const sharedFolderId = res.data.id;
  assert.equal(res.data.name, 'Weekend Marathon');
  assert.equal(res.data.color, '#3B82F6');
  assert.equal(res.data.kind, 'together');
  assert.equal(res.data.user_id, null);
  assert.equal(res.data.movie_count, 0);

  res = await apiReq(env, 102, 'POST', '/api/parties/1/folders', { name: 'Weekend Marathon', color: '#10B981', kind: 'together' });
  assert.equal(res.status, 409);

  // 3. Same name in personal scope works for both users
  res = await apiReq(env, 101, 'POST', '/api/parties/1/folders', { name: 'Weekend Marathon', color: '#F59E0B', kind: 'personal' });
  assert.equal(res.status, 201);
  const u1PersonalId = res.data.id;

  res = await apiReq(env, 102, 'POST', '/api/parties/1/folders', { name: 'Weekend Marathon', color: '#EC4899', kind: 'personal' });
  assert.equal(res.status, 201);
  const u2PersonalId = res.data.id;

  // 4. Add movies inside folders & check counts/preview posters by status
  for (let i = 1; i <= 5; i++) {
    const r = await apiReq(env, 101, 'POST', '/api/parties/1/movies', {
      title: `Shared Movie ${i}`,
      kind: 'together',
      status: i <= 4 ? 'want' : 'watched',
      poster: `/api/covers/cafe000${i}`,
      folder_id: sharedFolderId,
    });
    assert.equal(r.status, 201);
  }
  // Seed covers table to verify deleteMovies cover cleanup later
  db.sqlite.prepare("INSERT INTO covers (id, user_id, mime, data) VALUES ('cafe0001', 101, 'image/webp', X'524946460000000057454250')").run();
  db.sqlite.prepare("INSERT INTO covers (id, user_id, mime, data) VALUES ('cafe0002', 101, 'image/webp', X'524946460000000057454250')").run();

  // Check list folders for together/want vs together/watched
  res = await apiReq(env, 101, 'GET', '/api/parties/1/folders?tab=together&status=want');
  assert.equal(res.status, 200);
  assert.equal(res.data.folders.length, 1);
  assert.equal(res.data.folders[0].movie_count, 4);
  assert.equal(res.data.folders[0].total_movie_count, 5);
  assert.equal(res.data.folders[0].preview_posters.length, 4);

  res = await apiReq(env, 101, 'GET', '/api/parties/1/folders?tab=together&status=watched');
  assert.equal(res.status, 200);
  assert.equal(res.data.folders[0].movie_count, 1);
  assert.equal(res.data.folders[0].total_movie_count, 5);
  assert.equal(res.data.folders[0].preview_posters.length, 1);
  assert.equal(res.data.folders[0].preview_posters[0], '/api/covers/cafe0005');

  // Check tab=mine vs tab=others
  res = await apiReq(env, 101, 'GET', '/api/parties/1/folders?tab=mine&status=want');
  assert.equal(res.data.folders.length, 1);
  assert.equal(res.data.folders[0].id, u1PersonalId);

  res = await apiReq(env, 101, 'GET', '/api/parties/1/folders?tab=others&status=want');
  assert.equal(res.data.folders.length, 1);
  assert.equal(res.data.folders[0].id, u2PersonalId);

  // 5. Ownership checks on PATCH and DELETE
  res = await apiReq(env, 101, 'PATCH', `/api/folders/${u2PersonalId}`, { name: 'Hacked' });
  assert.equal(res.status, 403);

  res = await apiReq(env, 101, 'DELETE', `/api/folders/${u2PersonalId}?deleteMovies=false`);
  assert.equal(res.status, 403);

  // Partner CAN rename/recolor shared folder
  res = await apiReq(env, 102, 'PATCH', `/api/folders/${sharedFolderId}`, { name: 'Shared Classics', color: '#10B981' });
  assert.equal(res.status, 200);
  assert.equal(res.data.name, 'Shared Classics');
  assert.equal(res.data.color, '#10B981');

  // Rename to duplicate name returns 409
  const extraTogether = await apiReq(env, 101, 'POST', '/api/parties/1/folders', { name: 'Sci-Fi', kind: 'together' });
  assert.equal(extraTogether.status, 201);
  res = await apiReq(env, 101, 'PATCH', `/api/folders/${extraTogether.data.id}`, { name: 'Shared Classics' });
  assert.equal(res.status, 409);

  // 6. Move movie validation: personal movie cannot go in together folder
  const pm = await apiReq(env, 101, 'POST', '/api/parties/1/movies', {
    title: 'My Personal Pick',
    kind: 'personal',
    status: 'want',
  });
  assert.equal(pm.status, 201);
  const personalMovieId = pm.data.id;

  res = await apiReq(env, 101, 'PATCH', `/api/movies/${personalMovieId}`, { folder_id: sharedFolderId });
  assert.equal(res.status, 400);

  // Move into own personal folder works, then switching kind -> together clears folder_id
  res = await apiReq(env, 101, 'PATCH', `/api/movies/${personalMovieId}`, { folder_id: u1PersonalId });
  assert.equal(res.status, 200);
  assert.equal(res.data.folder_id, u1PersonalId);

  res = await apiReq(env, 101, 'PATCH', `/api/movies/${personalMovieId}`, { kind: 'together' });
  assert.equal(res.status, 200);
  assert.equal(res.data.folder_id, null);

  // 7. Delete folder keep movies (deleteMovies=false)
  const tempFolder = await apiReq(env, 101, 'POST', '/api/parties/1/folders', { name: 'Keep Movies', kind: 'together' });
  assert.equal(tempFolder.status, 201);
  const keptMovie = await apiReq(env, 101, 'POST', '/api/parties/1/movies', {
    title: 'Kept Film',
    kind: 'together',
    status: 'want',
    folder_id: tempFolder.data.id,
  });
  assert.equal(keptMovie.status, 201);

  res = await apiReq(env, 101, 'DELETE', `/api/folders/${tempFolder.data.id}?deleteMovies=false`);
  assert.equal(res.status, 200);
  const moviesAfterKeep = await apiReq(env, 101, 'GET', '/api/parties/1/movies');
  const foundKept = moviesAfterKeep.data.movies.find((m) => m.id === keptMovie.data.id);
  assert.ok(foundKept);
  assert.equal(foundKept.folder_id, null);

  // 8. Delete folder WITH movies (deleteMovies=true) removes movies and covers
  res = await apiReq(env, 102, 'DELETE', `/api/folders/${sharedFolderId}?deleteMovies=true`);
  assert.equal(res.status, 200);

  const moviesAfterDelete = await apiReq(env, 101, 'GET', '/api/parties/1/movies');
  const stillInShared = moviesAfterDelete.data.movies.filter((m) => m.title.startsWith('Shared Movie '));
  assert.equal(stillInShared.length, 0);

  const cover1Row = db.sqlite.prepare("SELECT id FROM covers WHERE id = 'cafe0001'").get();
  const cover2Row = db.sqlite.prepare("SELECT id FROM covers WHERE id = 'cafe0002'").get();
  assert.equal(cover1Row, undefined);
  assert.equal(cover2Row, undefined);
});

test('BackButton transitions across folder sheets and confirm dialogs', () => {
  const handlers = new Set();
  let isVisible = false;
  let backButtonBound = false;
  let currentOverlay = null;
  let onSheetClose = null;

  const mockTg = {
    BackButton: {
      show() { isVisible = true; },
      hide() { isVisible = false; },
      onClick(fn) { handlers.add(fn); },
      offClick(fn) { handlers.delete(fn); },
    },
  };

  function closeSheet() {
    currentOverlay = null;
    if (mockTg.BackButton) {
      mockTg.BackButton.hide();
      if (backButtonBound) {
        mockTg.BackButton.offClick(closeSheet);
        backButtonBound = false;
      }
    }
    if (onSheetClose) {
      const cb = onSheetClose;
      onSheetClose = null;
      cb();
    }
  }

  function openSheet(name) {
    closeSheet();
    currentOverlay = { name };
    if (mockTg.BackButton) {
      mockTg.BackButton.show();
      if (!backButtonBound) {
        mockTg.BackButton.onClick(closeSheet);
        backButtonBound = true;
      }
    }
  }

  // Open Folder Context Sheet
  openSheet('folder-context');
  assert.equal(isVisible, true);
  assert.equal(handlers.size, 1);
  assert.ok(handlers.has(closeSheet));

  // Transition directly into Rename (Folder Editor)
  closeSheet();
  openSheet('folder-editor');
  assert.equal(isVisible, true);
  assert.equal(handlers.size, 1);

  // Transition to Delete Folder sheet then confirmSheet
  openSheet('delete-folder');
  let resolvedValue = null;
  openSheet('confirm-sheet');
  onSheetClose = () => { resolvedValue = false; };
  assert.equal(isVisible, true);
  assert.equal(handlers.size, 1);

  // Simulate user tapping Telegram BackButton
  for (const fn of [...handlers]) fn();
  assert.equal(resolvedValue, false);
  assert.equal(isVisible, false);
  assert.equal(handlers.size, 0);
  assert.equal(currentOverlay, null);
});
