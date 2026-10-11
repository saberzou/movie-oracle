import {
  forwardTmdbRequest,
  getRequestQuery,
  guardGetRequest,
  validateDiscoverQuery,
} from '../server/tmdb.js';

export default async function handler(req, res) {
  if (!guardGetRequest(req, res)) return;

  const validation = validateDiscoverQuery(getRequestQuery(req));
  if (!validation.ok) return res.status(400).json({ error: validation.error });

  return forwardTmdbRequest(res, '/discover/movie', validation.params);
}
