// D1 database access methods.

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function randomCode(len = 6) {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

export function randomHex(bytesLen = 12) {
  const bytes = crypto.getRandomValues(new Uint8Array(bytesLen));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function getUser(env, id) {
  return await env.DB.prepare(
    'SELECT id, first_name, username, accent, created_at FROM users WHERE id = ?'
  )
    .bind(id)
    .first();
}

export async function setAccent(env, id, accent) {
  await env.DB.prepare('UPDATE users SET accent = ? WHERE id = ?')
    .bind(accent, id)
    .run();
}

export async function isMember(env, partyId, userId) {
  const row = await env.DB.prepare(
    'SELECT 1 AS ok FROM members WHERE party_id = ? AND user_id = ?'
  )
    .bind(partyId, userId)
    .first();
  return !!row;
}

export async function createParty(env, userId, name) {
  const cleanName = String(name || '').trim().slice(0, 40);
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode(6);
    try {
      const res = await env.DB.prepare(
        'INSERT INTO parties (name, code, created_by) VALUES (?1, ?2, ?3)'
      )
        .bind(cleanName, code, userId)
        .run();
      const partyId = res.meta.last_row_id;
      await env.DB.prepare(
        'INSERT INTO members (party_id, user_id) VALUES (?1, ?2)'
      )
        .bind(partyId, userId)
        .run();
      return { id: partyId, name: cleanName, code };
    } catch (e) {
      if (String(e).includes('UNIQUE constraint failed')) continue;
      throw e;
    }
  }
  throw new Error('Failed to generate unique party code');
}

export async function joinByCode(env, userId, code) {
  const clean = String(code || '').trim().toUpperCase();
  const party = await env.DB.prepare(
    'SELECT id, name FROM parties WHERE code = ?'
  )
    .bind(clean)
    .first();
  if (!party) return null;

  await env.DB.prepare(
    'INSERT OR IGNORE INTO members (party_id, user_id) VALUES (?1, ?2)'
  )
    .bind(party.id, userId)
    .run();

  return party.id;
}

export async function updateParty(env, partyId, name) {
  const clean = String(name || '').trim().slice(0, 40);
  await env.DB.prepare('UPDATE parties SET name = ? WHERE id = ?')
    .bind(clean, partyId)
    .run();
}

export async function leaveParty(env, partyId, userId) {
  await env.DB.prepare('DELETE FROM members WHERE party_id = ? AND user_id = ?')
    .bind(partyId, userId)
    .run();

  const countRow = await env.DB.prepare(
    'SELECT COUNT(*) AS total FROM members WHERE party_id = ?'
  )
    .bind(partyId)
    .first();

  if (!countRow || countRow.total === 0) {
    // Delete associated cover images for this party
    const movies = await env.DB.prepare(
      'SELECT poster FROM movies WHERE party_id = ? AND poster LIKE "/api/covers/%"'
    )
      .bind(partyId)
      .all();
    for (const m of movies.results || []) {
      const coverId = m.poster.slice('/api/covers/'.length);
      await deleteCover(env, coverId);
    }
    await env.DB.prepare('DELETE FROM movies WHERE party_id = ?').bind(partyId).run();
    await env.DB.prepare('DELETE FROM parties WHERE id = ?').bind(partyId).run();
  }
}

export async function partiesForUser(env, userId) {
  const partiesRes = await env.DB.prepare(
    `SELECT p.id, p.name, p.code, p.created_by, p.created_at
     FROM parties p
     JOIN members m ON m.party_id = p.id
     WHERE m.user_id = ?
     ORDER BY p.id`
  )
    .bind(userId)
    .all();

  const parties = partiesRes.results || [];
  if (parties.length === 0) return [];

  const membersRes = await env.DB.prepare(
    `SELECT m.party_id, u.id, u.first_name, u.username
     FROM members m
     JOIN users u ON u.id = m.user_id
     WHERE m.party_id IN (${parties.map(() => '?').join(',')})
     ORDER BY m.joined_at`
  )
    .bind(...parties.map((p) => p.id))
    .all();

  const membersByParty = new Map();
  for (const row of membersRes.results || []) {
    if (!membersByParty.has(row.party_id)) {
      membersByParty.set(row.party_id, []);
    }
    membersByParty.get(row.party_id).push({
      id: row.id,
      first_name: row.first_name,
      username: row.username,
    });
  }

  return parties.map((p) => ({
    ...p,
    members: membersByParty.get(p.id) || [],
  }));
}

export async function getMovies(env, partyId) {
  const res = await env.DB.prepare(
    `SELECT m.*, u.first_name AS added_by_name
     FROM movies m
     JOIN users u ON u.id = m.added_by
     WHERE m.party_id = ?
     ORDER BY COALESCE(m.watched_at, m.created_at) DESC, m.id DESC`
  )
    .bind(partyId)
    .all();
  return res.results || [];
}

export async function getMovie(env, movieId) {
  return await env.DB.prepare(
    `SELECT m.*, u.first_name AS added_by_name
     FROM movies m
     JOIN users u ON u.id = m.added_by
     WHERE m.id = ?`
  )
    .bind(movieId)
    .first();
}

export async function addMovie(env, partyId, userId, data) {
  const res = await env.DB.prepare(
    `INSERT INTO movies (party_id, added_by, kind, status, title, year, poster, note, rating, watched_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`
  )
    .bind(
      partyId,
      userId,
      data.kind,
      data.status,
      data.title,
      data.year || null,
      data.poster || null,
      data.note || null,
      data.rating || null,
      data.status === 'watched' ? new Date().toISOString() : null
    )
    .run();
  return await getMovie(env, res.meta.last_row_id);
}

export async function updateMovie(env, movieId, data) {
  const current = await getMovie(env, movieId);
  if (!current) return null;

  // Cleanup old cover if poster changed to something else
  if (data.poster !== undefined && current.poster && current.poster !== data.poster) {
    if (current.poster.startsWith('/api/covers/')) {
      const oldCoverId = current.poster.slice('/api/covers/'.length);
      await deleteCover(env, oldCoverId);
    }
  }

  let watchedAt = current.watched_at;
  if (data.status && data.status !== current.status) {
    watchedAt = data.status === 'watched' ? new Date().toISOString() : null;
  }

  const fields = {
    title: data.title ?? current.title,
    year: data.year !== undefined ? data.year : current.year,
    poster: data.poster !== undefined ? data.poster : current.poster,
    note: data.note !== undefined ? data.note : current.note,
    rating: data.rating !== undefined ? data.rating : current.rating,
    kind: data.kind ?? current.kind,
    status: data.status ?? current.status,
    watched_at: watchedAt,
  };

  await env.DB.prepare(
    `UPDATE movies SET
       title = ?1,
       year = ?2,
       poster = ?3,
       note = ?4,
       rating = ?5,
       kind = ?6,
       status = ?7,
       watched_at = ?8
     WHERE id = ?9`
  )
    .bind(
      fields.title,
      fields.year,
      fields.poster,
      fields.note,
      fields.rating,
      fields.kind,
      fields.status,
      fields.watched_at,
      movieId
    )
    .run();

  return await getMovie(env, movieId);
}

export async function deleteMovie(env, movieId) {
  const current = await getMovie(env, movieId);
  if (!current) return;

  if (current.poster && current.poster.startsWith('/api/covers/')) {
    const coverId = current.poster.slice('/api/covers/'.length);
    await deleteCover(env, coverId);
  }

  await env.DB.prepare('DELETE FROM movies WHERE id = ?').bind(movieId).run();
}

export async function saveCover(env, userId, mime, bytes) {
  const id = randomHex(12);
  await env.DB.prepare(
    'INSERT INTO covers (id, user_id, mime, data) VALUES (?1, ?2, ?3, ?4)'
  )
    .bind(id, userId, mime, bytes)
    .run();
  return id;
}

export async function getCover(env, coverId) {
  return await env.DB.prepare('SELECT mime, data FROM covers WHERE id = ?')
    .bind(coverId)
    .first();
}

export async function deleteCover(env, coverId) {
  await env.DB.prepare('DELETE FROM covers WHERE id = ?').bind(coverId).run();
}
