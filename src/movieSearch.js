// Open movie search engine (Cinemeta open catalog + TMDB fallback).
// Requires ZERO API keys from users!

export async function searchMovies(query, env = {}) {
  const q = String(query || '').trim();
  if (q.length < 2) return [];

  const results = [];
  const seen = new Set();

  // 1. Try TMDB if API key is configured
  if (env.TMDB_API_KEY) {
    try {
      const tmdbUrl = new URL('https://api.themoviedb.org/3/search/movie');
      tmdbUrl.searchParams.set('query', q.slice(0, 100));
      tmdbUrl.searchParams.set('include_adult', 'false');
      tmdbUrl.searchParams.set('page', '1');

      const res = await fetch(tmdbUrl.toString(), {
        headers: {
          Authorization: `Bearer ${env.TMDB_API_KEY}`,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(4000),
      });

      if (res.ok) {
        const data = await res.json();
        for (const item of (data.results || []).slice(0, 8)) {
          if (!item.title) continue;
          const key = item.title.toLowerCase();
          seen.add(key);
          results.push({
            id: `tmdb_${item.id}`,
            title: item.title,
            year: item.release_date ? item.release_date.slice(0, 4) : '',
            poster: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : null,
            description: item.overview || '',
          });
        }
      }
    } catch {
      // Gracefully continue to open catalog
    }
  }

  // 2. Open source movie catalog (Cinemeta - IMDb metadata, 100% free & open, no keys needed)
  if (results.length < 6) {
    try {
      const cinemetaUrl = `https://v3-cinemeta.strem.io/catalog/movie/top/search=${encodeURIComponent(q.slice(0, 80))}.json`;
      const res = await fetch(cinemetaUrl, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(4000),
      });

      if (res.ok) {
        const data = await res.json();
        for (const meta of (data.metas || []).slice(0, 10)) {
          if (!meta.name) continue;
          const key = meta.name.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);

          let poster = meta.poster || null;
          if (poster && poster.includes('._V1_SX')) {
            poster = poster.replace(/\._V1_SX\d+\.jpg$/, '._V1_SX600.jpg');
          }

          results.push({
            id: meta.id || meta.imdb_id || `cm_${results.length}`,
            title: meta.name,
            year: String(meta.year || meta.releaseInfo || '').slice(0, 4),
            poster,
            description: meta.description || '',
          });

          if (results.length >= 8) break;
        }
      }
    } catch {
      // Gracefully ignore
    }
  }

  return results.slice(0, 8);
}
