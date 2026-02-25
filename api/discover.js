export default async function handler(req, res) {
  const token = process.env.TMDB_ACCESS_TOKEN;
  if (!token) {
    return res.status(500).json({ error: 'TMDB_ACCESS_TOKEN not configured' });
  }

  // Forward all query params to TMDB discover endpoint
  const params = new URLSearchParams(req.query);
  const url = `https://api.themoviedb.org/3/discover/movie?${params}`;

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    res.status(502).json({ error: 'Failed to reach TMDB' });
  }
}
