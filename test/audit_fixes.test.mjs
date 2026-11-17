import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/worker.js';
import { isAllowedPosterUrl } from '../src/movieSearch.js';

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

function seedUsersAndParty(sqlite) {
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
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

test('scheduled cron preserves recent covers across UTC midnight and protects referenced covers', async () => {
  const db = createSqliteD1();
  seedUsersAndParty(db.sqlite);
  const env = { DB: db, DEV_AUTH: '1' };

  const now = Date.now();
  const formatSqliteUtc = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

  // Freeze real Date.now around 03:00 UTC on a known day only via realistic relative timestamps:
  // Recent unreferenced cover uploaded 2 hours ago (format: "YYYY-MM-DD HH:MM:SS")
  const recent2h = formatSqliteUtc(now - 2 * 60 * 60 * 1000);
  // Stale unreferenced cover uploaded 30 hours ago
  const stale30h = formatSqliteUtc(now - 30 * 60 * 60 * 1000);

  db.sqlite.prepare("INSERT INTO covers (id, user_id, mime, data, created_at) VALUES ('recent01', 101, 'image/webp', X'52494646', ?)").run(recent2h);
  db.sqlite.prepare("INSERT INTO covers (id, user_id, mime, data, created_at) VALUES ('stale001', 101, 'image/webp', X'52494646', ?)").run(stale30h);
  db.sqlite.prepare("INSERT INTO covers (id, user_id, mime, data, created_at) VALUES ('movie001', 101, 'image/webp', X'52494646', ?)").run(stale30h);
  db.sqlite.prepare("INSERT INTO covers (id, user_id, mime, data, created_at) VALUES ('avatar01', 101, 'image/webp', X'52494646', ?)").run(stale30h);

  db.sqlite.prepare("INSERT INTO movies (party_id, added_by, kind, status, title, poster) VALUES (1, 101, 'together', 'want', 'Protected', '/api/covers/movie001')").run();
  db.sqlite.prepare("UPDATE users SET avatar_url = '/api/covers/avatar01' WHERE id = 101").run();

  await worker.scheduled({}, env, {});

  const remaining = db.sqlite.prepare('SELECT id FROM covers ORDER BY id').all().map((r) => r.id);
  assert.deepEqual(remaining, ['avatar01', 'movie001', 'recent01']);

  // Also explicitly verify SQLite datetime() comparison across midnight boundary ("YYYY-MM-DD 23:59:59" < 24h vs "YYYY-MM-DD+1 03:00:00" cutoff)
  const cmpRow = db.sqlite
    .prepare("SELECT (datetime('2026-11-16 23:59:59') < datetime('2026-11-16T03:00:00.000Z')) AS wrong_lt, ('2026-11-16 23:59:59' < '2026-11-16T03:00:00.000Z') AS str_bug")
    .get();
  assert.equal(cmpRow.str_bug, 1);
  assert.equal(cmpRow.wrong_lt, 0);
});

test('profile avatar validation and reference-checked cover cleanup', async () => {
  const db = createSqliteD1();
  seedUsersAndParty(db.sqlite);
  const env = { DB: db, DEV_AUTH: '1' };

  // Seed two covers
  db.sqlite.prepare("INSERT INTO covers (id, user_id, mime, data) VALUES ('deadbeef01', 101, 'image/webp', X'52494646')").run();
  db.sqlite.prepare("INSERT INTO covers (id, user_id, mime, data) VALUES ('deadbeef02', 101, 'image/webp', X'52494646')").run();

  // Reject unsafe avatar URLs
  let res = await apiReq(env, 101, 'PATCH', '/api/me/profile', { avatar_url: 'javascript:alert(1)' });
  assert.equal(res.status, 400);

  res = await apiReq(env, 101, 'PATCH', '/api/me/profile', { avatar_url: 'http://evil.com/a.jpg' });
  assert.equal(res.status, 400);

  // Set cover avatar -> replace with HTTPS avatar -> old unreferenced cover is deleted
  res = await apiReq(env, 101, 'PATCH', '/api/me/profile', { avatar_url: '/api/covers/deadbeef01' });
  assert.equal(res.status, 200);
  assert.equal(res.data.user.avatar_url, '/api/covers/deadbeef01');

  res = await apiReq(env, 101, 'PATCH', '/api/me/profile', { avatar_url: 'https://example.com/a.jpg' });
  assert.equal(res.status, 200);
  assert.equal(res.data.user.avatar_url, 'https://example.com/a.jpg');
  assert.equal(db.sqlite.prepare("SELECT id FROM covers WHERE id = 'deadbeef01'").get(), undefined);

  // If cover is also referenced by a movie, replacing avatar keeps cover intact
  db.sqlite.prepare("INSERT INTO movies (party_id, added_by, kind, status, title, poster) VALUES (1, 101, 'together', 'want', 'Shared Cover', '/api/covers/deadbeef02')").run();
  res = await apiReq(env, 101, 'PATCH', '/api/me/profile', { avatar_url: '/api/covers/deadbeef02' });
  assert.equal(res.status, 200);
  res = await apiReq(env, 101, 'PATCH', '/api/me/profile', { avatar_url: null });
  assert.equal(res.status, 200);
  assert.ok(db.sqlite.prepare("SELECT id FROM covers WHERE id = 'deadbeef02'").get());
});

test('isAllowedPosterUrl allows live.metahub.space and rejects disallowed hosts', () => {
  assert.equal(isAllowedPosterUrl('https://live.metahub.space/poster/medium/tt0111161/img'), true);
  assert.equal(isAllowedPosterUrl('https://images.metahub.space/poster/small/tt0111161/img'), true);
  assert.equal(isAllowedPosterUrl('https://image.tmdb.org/t/p/w500/abc.jpg'), true);
  assert.equal(isAllowedPosterUrl('/api/covers/abcdef123456'), true);
  assert.equal(isAllowedPosterUrl('https://evil.example/x.jpg'), false);
  assert.equal(isAllowedPosterUrl('javascript:alert(1)'), false);
});

test('Others folders exclude personal folders after a member leaves the party', async () => {
  const db = createSqliteD1();
  seedUsersAndParty(db.sqlite);
  const env = { DB: db, DEV_AUTH: '1' };

  const created = await apiReq(env, 102, 'POST', '/api/parties/1/folders', {
    name: 'Nina Picks',
    color: '#10B981',
    kind: 'personal',
  });
  assert.equal(created.status, 201);

  let others = await apiReq(env, 101, 'GET', '/api/parties/1/folders?tab=others&status=want');
  assert.equal(others.status, 200);
  assert.equal(others.data.folders.length, 1);

  const left = await apiReq(env, 102, 'POST', '/api/parties/1/leave');
  assert.equal(left.status, 200);

  others = await apiReq(env, 101, 'GET', '/api/parties/1/folders?tab=others&status=want');
  assert.equal(others.status, 200);
  assert.equal(others.data.folders.length, 0);
});

test('Stacked dialog BackButton preserves underlying currentOverlay on cancel', () => {
  const handlers = new Set();
  let isVisible = false;
  let currentOverlay = null;
  let activeDialogOverlay = null;
  let backButtonBound = false;
  let dialogBackButtonBound = false;

  const mockTg = {
    BackButton: {
      show() { isVisible = true; },
      hide() { isVisible = false; },
      onClick(fn) { handlers.add(fn); },
      offClick(fn) { handlers.delete(fn); },
    },
  };

  function closeSheet() {
    if (activeDialogOverlay) closeDialogSheet();
    currentOverlay = null;
    mockTg.BackButton.hide();
    if (backButtonBound) {
      mockTg.BackButton.offClick(closeSheet);
      backButtonBound = false;
    }
  }

  function openSheet(name) {
    closeSheet();
    currentOverlay = { name };
    mockTg.BackButton.show();
    if (!backButtonBound) {
      mockTg.BackButton.onClick(closeSheet);
      backButtonBound = true;
    }
  }

  function closeDialogSheet() {
    activeDialogOverlay = null;
    if (dialogBackButtonBound) {
      mockTg.BackButton.offClick(closeDialogSheet);
      dialogBackButtonBound = false;
    }
    if (currentOverlay) {
      if (!backButtonBound) {
        mockTg.BackButton.onClick(closeSheet);
        backButtonBound = true;
      }
      mockTg.BackButton.show();
    } else {
      mockTg.BackButton.hide();
    }
  }

  function openDialogSheet(name) {
    closeDialogSheet();
    activeDialogOverlay = { name };
    if (backButtonBound) {
      mockTg.BackButton.offClick(closeSheet);
      backButtonBound = false;
    }
    mockTg.BackButton.show();
    if (!dialogBackButtonBound) {
      mockTg.BackButton.onClick(closeDialogSheet);
      dialogBackButtonBound = true;
    }
  }

  openSheet('movie-editor');
  assert.equal(currentOverlay.name, 'movie-editor');
  assert.ok(handlers.has(closeSheet));

  openDialogSheet('add-custom-tag-prompt');
  assert.equal(currentOverlay.name, 'movie-editor');
  assert.equal(activeDialogOverlay.name, 'add-custom-tag-prompt');
  assert.equal(handlers.size, 1);
  assert.ok(handlers.has(closeDialogSheet));

  // First BackButton press closes dialog only, leaving Movie Editor intact
  for (const fn of [...handlers]) fn();
  assert.equal(activeDialogOverlay, null);
  assert.equal(currentOverlay.name, 'movie-editor');
  assert.equal(isVisible, true);
  assert.ok(handlers.has(closeSheet));

  // Second BackButton press closes Movie Editor
  for (const fn of [...handlers]) fn();
  assert.equal(currentOverlay, null);
  assert.equal(isVisible, false);
  assert.equal(handlers.size, 0);
});

test('Frontend cover-only drag ghost, XSS-safe onerror, stacked dialog, and CSS hygiene contracts', () => {
  const appJs = fs.readFileSync(path.resolve('public/app.js'), 'utf8');
  const stylesCss = fs.readFileSync(path.resolve('public/styles.css'), 'utf8');

  // Cover-only drag ghost CSS rules without border, outline, shadow, or card container
  const ghostBlockMatch = stylesCss.match(/\.drag-ghost\s*\{[\s\S]*?\}/);
  assert.ok(ghostBlockMatch, 'Expected .drag-ghost rule in public/styles.css');
  const ghostBlock = ghostBlockMatch[0];
  assert.match(ghostBlock, /border:\s*none\b/);
  assert.match(ghostBlock, /outline:\s*none\b/);
  assert.match(ghostBlock, /box-shadow:\s*none\b/);
  assert.match(ghostBlock, /border-radius:\s*18px\b/);
  assert.match(ghostBlock, /overflow:\s*hidden\b/);
  assert.equal(/\.card\.drag-ghost\b/.test(stylesCss), false);
  assert.equal(/\.drag-ghost\s+\.poster-box\b/.test(stylesCss), false);

  // Stacked dialog, breadcrumb hover, dimmed poster source, and CSS deduplication
  assert.match(stylesCss, /\.overlay\.dialog-overlay\b/);
  assert.match(stylesCss, /\.folder-breadcrumb\.drag-hover\b/);
  assert.match(stylesCss, /\.drag-source-active\s+\.poster-box\b/);
  assert.equal((stylesCss.match(/\.icon-btn\s*\{/g) || []).length, 1);
  assert.equal((stylesCss.match(/\.member-row\s*\{/g) || []).length, 1);

  // Zero interpolated ${esc(...)} inside inline onerror handlers (use safe this.alt instead)
  const onerrorMatches = appJs.match(/onerror="[^"]*"/g) || [];
  assert.ok(onerrorMatches.length >= 2);
  for (const attr of onerrorMatches) {
    assert.equal(attr.includes('${esc('), false, `Unsafe interpolation in ${attr}`);
    assert.equal(attr.includes('this.alt'), true, `Expected this.alt fallback in ${attr}`);
  }

  // Required audit fix symbols in public/app.js and legacy tmdb.js removal
  assert.match(appJs, /function createCoverGhost\(/);
  assert.match(appJs, /function dropOutToRoot\(/);
  assert.match(appJs, /function openDialogSheet\(/);
  assert.match(appJs, /function closeDialogSheet\(/);
  assert.match(appJs, /id="removeFromFolderBtn"/);
  assert.equal(fs.existsSync(path.resolve('src/tmdb.js')), false);
});
