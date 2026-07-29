// Generic TMDB proxy. Attaches the read token server-side so it never ships to
// the browser, and caches at the edge to keep us well inside TMDB's rate limit.
//
// Set TMDB_ACCESS_TOKEN in the Vercel project's environment variables.

const TMDB_BASE = 'https://api.themoviedb.org/3';

// Only the endpoints this app actually uses. Without an allowlist the function
// is an open relay for the whole of TMDB under our credentials.
const ALLOWED_PATHS = [
  /^trending\/movie\/(?:day|week)$/,
  /^discover\/movie$/,
  /^movie\/\d+$/,
  /^movie\/\d+\/videos$/,
];

// Trending and discover churn slowly; movie details barely at all. Serving
// stale while revalidating means a cold TMDB call almost never blocks a user.
const CACHE_CONTROL = 'public, s-maxage=3600, stale-while-revalidate=86400';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = process.env.TMDB_ACCESS_TOKEN;
  if (!token) {
    console.error('TMDB_ACCESS_TOKEN is not configured');
    return res.status(500).json({ error: 'Server is missing its TMDB credentials' });
  }

  const { path, ...query } = req.query;
  const tmdbPath = (Array.isArray(path) ? path : [path].filter(Boolean)).join('/');

  if (!ALLOWED_PATHS.some((pattern) => pattern.test(tmdbPath))) {
    return res.status(404).json({ error: 'Unknown endpoint' });
  }

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    // Vercel surfaces repeated query keys as arrays; TMDB only needs one value.
    params.set(key, Array.isArray(value) ? value[0] : value);
  }

  try {
    const upstream = await fetch(`${TMDB_BASE}/${tmdbPath}?${params}`, {
      headers: { Authorization: `Bearer ${token}`, accept: 'application/json' },
    });
    const body = await upstream.json();
    if (upstream.ok) res.setHeader('Cache-Control', CACHE_CONTROL);
    return res.status(upstream.status).json(body);
  } catch (err) {
    console.error('TMDB request failed:', err);
    return res.status(502).json({ error: 'Failed to reach TMDB' });
  }
}
