// Multilingual Movie & Series Search Engine.
// Full support for Russian and English queries, Soviet/Russian/World cinema, TV series and anime.
// Free open multi-catalog: TMDB Multi-search with ru-RU localization + Cinemeta movie/series fallback.

const TMDB_DEFAULT_KEY = '4e44d9029b1270a757cddc766a1bcb63';

const GENRE_MAP_EN = {
  28: 'action',
  12: 'adventure',
  16: 'animation',
  35: 'comedy',
  80: 'crime',
  99: 'documentary',
  18: 'drama',
  10751: 'family',
  14: 'fantasy',
  36: 'history',
  27: 'horror',
  10402: 'music',
  9648: 'mystery',
  10749: 'romance',
  878: 'sci-fi',
  10770: 'tv-movie',
  53: 'thriller',
  10752: 'war',
  37: 'western',
  10759: 'action-adventure',
  10762: 'kids',
  10765: 'sci-fi-fantasy',
};

export async function searchMovies(query, env = {}) {
  const q = String(query || '').trim();
  if (q.length < 2) return [];

  const results = [];
  const seenTitles = new Set();
  const apiKey = env.TMDB_API_KEY || TMDB_DEFAULT_KEY;
  const isCyrillic = /[а-яё]/i.test(q);

  // 1. TMDB Multi-search (Movies & Series with Russian localization)
  if (apiKey) {
    try {
      const tmdbUrl = new URL('https://api.themoviedb.org/3/search/multi');
      tmdbUrl.searchParams.set('api_key', apiKey);
      tmdbUrl.searchParams.set('query', q.slice(0, 100));
      tmdbUrl.searchParams.set('language', isCyrillic ? 'ru-RU' : 'en-US');
      tmdbUrl.searchParams.set('include_adult', 'false');
      tmdbUrl.searchParams.set('page', '1');

      const res = await fetch(tmdbUrl.toString(), {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(4500),
      });

      if (res.ok) {
        const data = await res.json();
        for (const item of (data.results || []).slice(0, 12)) {
          // Skip people/crew results
          if (item.media_type === 'person') continue;

          const title = (item.title || item.name || '').trim();
          if (!title) continue;

          const origTitle = (item.original_title || item.original_name || '').trim();
          const key = title.toLowerCase();
          if (seenTitles.has(key)) continue;
          seenTitles.add(key);

          const dateStr = item.release_date || item.first_air_date || '';
          const year = dateStr.slice(0, 4);
          const poster = item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : null;

          // Build genre hashtags
          const tags = (item.genre_ids || [])
            .map((gid) => GENRE_MAP_EN[gid])
            .filter(Boolean)
            .slice(0, 3)
            .map((t) => `#${t}`)
            .join(' ');

          results.push({
            id: `tmdb_${item.id}`,
            title,
            original_title: origTitle && origTitle.toLowerCase() !== key ? origTitle : null,
            year,
            poster,
            tags,
            description: item.overview || '',
          });

          if (results.length >= 8) break;
        }
      }
    } catch {
      // Gracefully continue to Cinemeta fallback
    }
  }

  // 2. Cinemeta fallback (Open catalog: search both movies and series)
  if (results.length < 5) {
    const cinemetaTypes = ['movie', 'series'];
    for (const cType of cinemetaTypes) {
      if (results.length >= 8) break;
      try {
        const cinemetaUrl = `https://v3-cinemeta.strem.io/catalog/${cType}/top/search=${encodeURIComponent(q.slice(0, 80))}.json`;
        const res = await fetch(cinemetaUrl, {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(4000),
        });

        if (res.ok) {
          const text = await res.text();
          if (text.startsWith('{')) {
            const data = JSON.parse(text);
            for (const meta of (data.metas || []).slice(0, 8)) {
              if (!meta.name) continue;
              const title = meta.name.trim();
              const key = title.toLowerCase();
              if (seenTitles.has(key)) continue;
              seenTitles.add(key);

              let poster = meta.poster || null;
              if (poster && poster.includes('._V1_SX')) {
                poster = poster.replace(/\._V1_SX\d+\.jpg$/, '._V1_SX600.jpg');
              }

              // Extract genres if available
              const tags = (meta.genres || [])
                .slice(0, 3)
                .map((g) => `#${String(g).toLowerCase().replace(/\s+/g, '-')}`)
                .join(' ');

              results.push({
                id: meta.id || meta.imdb_id || `cm_${results.length}`,
                title,
                original_title: null,
                year: String(meta.year || meta.releaseInfo || '').slice(0, 4),
                poster,
                tags,
                description: meta.description || '',
              });

              if (results.length >= 8) break;
            }
          }
        }
      } catch {
        // Continue
      }
    }
  }

  return results.slice(0, 8);
}
