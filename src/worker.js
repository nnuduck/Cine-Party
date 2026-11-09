// Main Cloudflare Worker entrypoint and API router.
import { authenticate, HttpError } from './auth.js';
import * as db from './db.js';
import { searchMovies } from './movieSearch.js';
import { handleTelegramWebhook } from './telegram.js';

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  });
}

function posterOk(p) {
  if (p == null || p === '') return true;
  if (typeof p !== 'string') return false;
  return (
    p.startsWith('https://image.tmdb.org/t/p/') ||
    p.startsWith('https://m.media-amazon.com/images/') ||
    p.startsWith('https://images.metahub.space/') ||
    /^\/api\/covers\/[a-f0-9]+$/.test(p)
  );
}

function cleanMovie(b) {
  const out = {};
  if ('title' in b) {
    const t = String(b.title || '').trim().slice(0, 120);
    out.title = t;
  }
  if ('year' in b) {
    const y = String(b.year || '').trim().slice(0, 4);
    out.year = y || null;
  }
  if ('note' in b) {
    const n = String(b.note || '').trim().slice(0, 500);
    out.note = n || null;
  }
  if ('poster' in b) {
    out.poster = b.poster || null;
  }
  if ('rating' in b) {
    const r = Number(b.rating);
    out.rating = Number.isInteger(r) && r >= 1 && r <= 5 ? r : null;
  }
  if ('kind' in b && ['together', 'personal'].includes(b.kind)) {
    out.kind = b.kind;
  }
  if ('status' in b && ['want', 'watched'].includes(b.status)) {
    out.status = b.status;
  }
  return out;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // Telegram webhook
    if (path === '/telegram' && method === 'POST') {
      return await handleTelegramWebhook(request, env);
    }

    // Public cover assets from D1
    if (path.startsWith('/api/covers/') && method === 'GET') {
      const coverId = path.slice('/api/covers/'.length);
      const row = await db.getCover(env, coverId);
      if (!row || !row.data) {
        return new Response('Not Found', { status: 404 });
      }
      const rawBytes = Array.isArray(row.data)
        ? new Uint8Array(row.data)
        : (row.data instanceof ArrayBuffer ? new Uint8Array(row.data) : row.data);

      return new Response(rawBytes, {
        headers: {
          'Content-Type': row.mime || 'image/webp',
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      });
    }

    // API routes
    if (path.startsWith('/api/')) {
      try {
        return await handleApi(request, env, url, path, method);
      } catch (err) {
        if (err instanceof HttpError) {
          return json({ error: err.message }, err.status);
        }
        console.error('API Error:', err);
        return json({ error: 'Internal Server Error' }, 500);
      }
    }

    // Static assets fallback
    return env.ASSETS ? await env.ASSETS.fetch(request) : new Response('Not Found', { status: 404 });
  },
};

async function handleApi(request, env, url, path, method) {
  // Movie search route (open catalog + optional TMDB, auth required)
  if ((path === '/api/movies/search' || path === '/api/tmdb/search') && method === 'GET') {
    await authenticate(request, env);
    const q = url.searchParams.get('q') || '';
    const results = await searchMovies(q, env);
    return json({ results });
  }

  // Cover image upload
  if (path === '/api/covers' && method === 'POST') {
    const user = await authenticate(request, env);
    let bytes = null;
    let mime = 'image/webp';

    const contentType = request.headers.get('content-type') || '';
    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const file = formData.get('file');
      if (!file || typeof file === 'string') {
        throw new HttpError(400, 'Image file is required');
      }
      mime = file.type || 'image/webp';
      bytes = new Uint8Array(await file.arrayBuffer());
    } else {
      mime = contentType.split(';')[0].trim() || 'image/webp';
      bytes = new Uint8Array(await request.arrayBuffer());
    }

    const allowedMimes = ['image/webp', 'image/jpeg', 'image/png'];
    if (!allowedMimes.includes(mime)) {
      throw new HttpError(400, 'Only WebP, JPEG, and PNG images are allowed');
    }
    if (bytes.byteLength > 200 * 1024) {
      throw new HttpError(413, 'Image must be under 200 KB');
    }
    if (bytes.byteLength < 12) {
      throw new HttpError(400, 'Invalid image data');
    }

    const coverId = await db.saveCover(env, user.id, mime, bytes);
    return json({ id: coverId, url: `/api/covers/${coverId}` }, 201);
  }

  // Authentication check for all subsequent API endpoints
  const user = await authenticate(request, env);

  // GET /api/me
  if (path === '/api/me' && method === 'GET') {
    const parties = await db.partiesForUser(env, user.id);
    const fullUser = (await db.getUser(env, user.id)) || user;

    let inviteBase = '';
    if (env.APP_SHORT_NAME && env.BOT_USERNAME) {
      inviteBase = `https://t.me/${env.BOT_USERNAME}/${env.APP_SHORT_NAME}?startapp=`;
    } else if (env.BOT_USERNAME) {
      inviteBase = `https://t.me/${env.BOT_USERNAME}?start=`;
    } else {
      inviteBase = `${url.origin}?code=`;
    }

    return json({
      user: {
        id: fullUser.id,
        first_name: fullUser.first_name,
        username: fullUser.username,
        custom_name: fullUser.custom_name || null,
        display_name: fullUser.display_name || fullUser.custom_name || fullUser.first_name || 'You',
        avatar_url: fullUser.avatar_url || null,
        accent: fullUser.accent || null,
      },
      parties,
      invite_base: inviteBase,
    });
  }

  // PATCH /api/me/profile
  if (path === '/api/me/profile' && method === 'PATCH') {
    const body = await request.json().catch(() => ({}));
    const updated = await db.updateUserProfile(env, user.id, {
      name: body.name,
      avatarUrl: body.avatar_url,
    });
    return json({ user: updated });
  }

  // PATCH /api/me/accent
  if (path === '/api/me/accent' && method === 'PATCH') {
    const body = await request.json().catch(() => ({}));
    let accent = body.accent;
    if (accent !== null && typeof accent === 'string') {
      accent = accent.trim();
      if (!/^#[0-9A-Fa-f]{6}$/.test(accent)) {
        throw new HttpError(400, 'Invalid hex color code');
      }
    } else {
      accent = null;
    }
    await db.setAccent(env, user.id, accent);
    return json({ ok: true, accent });
  }

  // POST /api/parties
  if (path === '/api/parties' && method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const name = String(body.name || '').trim();
    if (!name) throw new HttpError(400, 'Party name is required');
    const party = await db.createParty(env, user.id, name);
    return json(party, 201);
  }

  // POST /api/parties/join
  if (path === '/api/parties/join' && method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const code = String(body.code || '').trim();
    if (!code) throw new HttpError(400, 'Invite code is required');
    const partyId = await db.joinByCode(env, user.id, code);
    if (!partyId) throw new HttpError(404, 'Party not found');
    return json({ id: partyId });
  }

  // PATCH /api/parties/:id
  const partyMatch = path.match(/^\/api\/parties\/(\d+)$/);
  if (partyMatch && method === 'PATCH') {
    const partyId = Number(partyMatch[1]);
    if (!(await db.isMember(env, partyId, user.id))) {
      throw new HttpError(403, 'Access denied');
    }
    const body = await request.json().catch(() => ({}));
    const name = String(body.name || '').trim();
    if (!name) throw new HttpError(400, 'Party name is required');
    await db.updateParty(env, partyId, name);
    return json({ ok: true, name });
  }

  // POST /api/parties/:id/leave
  const leaveMatch = path.match(/^\/api\/parties\/(\d+)\/leave$/);
  if (leaveMatch && method === 'POST') {
    const partyId = Number(leaveMatch[1]);
    if (!(await db.isMember(env, partyId, user.id))) {
      throw new HttpError(403, 'Access denied');
    }
    await db.leaveParty(env, partyId, user.id);
    return json({ ok: true });
  }

  // GET /api/parties/:id/movies
  const partyMoviesMatch = path.match(/^\/api\/parties\/(\d+)\/movies$/);
  if (partyMoviesMatch && method === 'GET') {
    const partyId = Number(partyMoviesMatch[1]);
    if (!(await db.isMember(env, partyId, user.id))) {
      throw new HttpError(403, 'Access denied');
    }
    const movies = await db.getMovies(env, partyId);
    return json({ movies });
  }

  // POST /api/parties/:id/movies
  if (partyMoviesMatch && method === 'POST') {
    const partyId = Number(partyMoviesMatch[1]);
    if (!(await db.isMember(env, partyId, user.id))) {
      throw new HttpError(403, 'Access denied');
    }
    const body = await request.json().catch(() => ({}));
    const m = cleanMovie(body);
    if (!m.title) throw new HttpError(400, 'Movie title is required');
    if (!posterOk(m.poster)) throw new HttpError(400, 'Invalid poster URL');

    const created = await db.addMovie(env, partyId, user.id, {
      kind: m.kind || 'together',
      status: m.status || 'want',
      title: m.title,
      year: m.year,
      poster: m.poster,
      note: m.note,
      rating: m.status === 'watched' ? m.rating : null,
    });
    return json(created, 201);
  }

  // PATCH /api/movies/:id
  const movieMatch = path.match(/^\/api\/movies\/(\d+)$/);
  if (movieMatch && method === 'PATCH') {
    const movieId = Number(movieMatch[1]);
    const movie = await db.getMovie(env, movieId);
    if (!movie || !(await db.isMember(env, movie.party_id, user.id))) {
      throw new HttpError(404, 'Movie not found');
    }

    // Personal movies can only be edited by their author
    if (movie.kind === 'personal' && movie.added_by !== user.id) {
      throw new HttpError(403, 'Cannot edit personal movie of another member');
    }

    const body = await request.json().catch(() => ({}));
    const m = cleanMovie(body);
    if ('title' in m && !m.title) throw new HttpError(400, 'Movie title is required');
    if ('poster' in m && !posterOk(m.poster)) throw new HttpError(400, 'Invalid poster URL');

    // Only author can convert shared to personal
    if (m.kind === 'personal' && movie.added_by !== user.id) {
      delete m.kind;
    }

    const updated = await db.updateMovie(env, movieId, m);
    return json(updated);
  }

  // DELETE /api/movies/:id
  if (movieMatch && method === 'DELETE') {
    const movieId = Number(movieMatch[1]);
    const movie = await db.getMovie(env, movieId);
    if (!movie || !(await db.isMember(env, movie.party_id, user.id))) {
      throw new HttpError(404, 'Movie not found');
    }

    // Personal movies can only be deleted by their author
    if (movie.kind === 'personal' && movie.added_by !== user.id) {
      throw new HttpError(403, 'Cannot delete personal movie of another member');
    }

    await db.deleteMovie(env, movieId);
    return json({ ok: true });
  }

  throw new HttpError(404, 'Not Found');
}
