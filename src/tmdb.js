// TMDB search helper.

export async function searchMovies(query, apiKey) {
  if (!apiKey) {
    return { results: [], error: 'TMDB API key is not configured on the server' };
  }

  const q = String(query || '').trim().slice(0, 100);
  if (q.length < 2) {
    return { results: [] };
  }

  const url = new URL('https://api.themoviedb.org/3/search/movie');
  url.searchParams.set('query', q);
  url.searchParams.set('language', 'en-US');
  url.searchParams.set('include_adult', 'false');

  const headers = { Accept: 'application/json' };
  if (apiKey.length > 60) {
    headers.Authorization = `Bearer ${apiKey}`;
  } else {
    url.searchParams.set('api_key', apiKey);
  }

  try {
    const res = await fetch(url.toString(), { headers });
    if (!res.ok) {
      return { results: [], error: `TMDB error: HTTP ${res.status}` };
    }
    const data = await res.json();
    const results = (data.results || [])
      .filter((m) => m.poster_path)
      .slice(0, 12)
      .map((m) => ({
        id: m.id,
        title: m.title,
        year: (m.release_date || '').slice(0, 4),
        poster: `https://image.tmdb.org/t/p/w342${m.poster_path}`,
      }));
    return { results };
  } catch (err) {
    return { results: [], error: 'Failed to communicate with TMDB' };
  }
}
