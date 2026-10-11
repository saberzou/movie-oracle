import {
  forwardTmdbRequest,
  getRequestQuery,
  guardGetRequest,
} from '../server/tmdb.js';

export default async function handler(req, res) {
  if (!guardGetRequest(req, res)) return;

  const query = getRequestQuery(req);
  const allowedKeys = new Set(['resource', 'id']);
  for (const key of Object.keys(query)) {
    if (!allowedKeys.has(key)) return res.status(400).json({ error: `Unsupported query parameter: ${key}` });
    if (typeof query[key] !== 'string') return res.status(400).json({ error: `Invalid value for ${key}` });
  }

  const resource = query.resource;
  const params = new URLSearchParams({ language: 'en-US' });
  if (resource === 'trending' && query.id === undefined) {
    return forwardTmdbRequest(res, '/trending/movie/week', params);
  }

  if ((resource === 'movie' || resource === 'videos') && /^\d{1,10}$/.test(query.id || '') && Number(query.id) > 0) {
    const suffix = resource === 'videos' ? '/videos' : '';
    const path = `/movie/${query.id}${suffix}`;
    return forwardTmdbRequest(res, path, params);
  }

  return res.status(400).json({ error: 'Unsupported TMDB resource.' });
}
