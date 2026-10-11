const TMDB_API_BASE = 'https://api.themoviedb.org/3';
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;

export function createRateLimiter({ limit = RATE_LIMIT, windowMs = RATE_WINDOW_MS, maxKeys = 10_000 } = {}) {
  const buckets = new Map();

  return function consume(key, now = Date.now()) {
    const existing = buckets.get(key);
    const bucket = !existing || now - existing.startedAt >= windowMs
      ? { startedAt: now, count: 0 }
      : existing;

    if (bucket.count >= limit) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((bucket.startedAt + windowMs - now) / 1000)),
      };
    }

    bucket.count += 1;
    buckets.set(key, bucket);

    // Keep memory bounded and discard expired entries when traffic grows.
    if (buckets.size > maxKeys) {
      for (const [client, entry] of buckets) {
        if (now - entry.startedAt >= windowMs || buckets.size > maxKeys) buckets.delete(client);
        if (buckets.size <= maxKeys) break;
      }
    }

    return { allowed: true, remaining: limit - bucket.count, retryAfterSeconds: 0 };
  };
}

// A best-effort per-process limit. For a multi-instance deployment, use an edge
// or shared-store limiter as a second layer; validation still protects every instance.
const consumeRequest = createRateLimiter();

function clientKey(req) {
  const forwarded = req.headers?.['x-forwarded-for'];
  const realIp = req.headers?.['x-real-ip'];
  const candidate = typeof forwarded === 'string'
    ? forwarded.split(',')[0].trim()
    : typeof realIp === 'string'
      ? realIp.trim()
      : req.socket?.remoteAddress || 'unknown';
  return candidate.slice(0, 128) || 'unknown';
}

export function guardGetRequest(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.setHeader('Cache-Control', 'no-store');
    res.status(405).json({ error: 'Method not allowed' });
    return false;
  }

  const result = consumeRequest(clientKey(req));
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-RateLimit-Limit', String(RATE_LIMIT));
  res.setHeader('X-RateLimit-Remaining', String(result.remaining));
  if (!result.allowed) {
    res.setHeader('Retry-After', String(result.retryAfterSeconds));
    res.status(429).json({ error: 'Too many requests. Please try again shortly.' });
    return false;
  }
  return true;
}

export function getRequestQuery(req) {
  if (req.query && typeof req.query === 'object') return req.query;

  const parsed = new URL(req.url || '/', 'http://localhost');
  const result = {};
  for (const key of new Set(parsed.searchParams.keys())) {
    const values = parsed.searchParams.getAll(key);
    result[key] = values.length === 1 ? values[0] : values;
  }
  return result;
}

function isSingleString(value) {
  return typeof value === 'string';
}

function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validateDiscoverQuery(query) {
  const allowedKeys = new Set([
    'with_genres',
    'primary_release_date.gte',
    'primary_release_date.lte',
    'vote_average.gte',
    'vote_count.gte',
    'sort_by',
    'language',
    'page',
  ]);

  for (const key of Object.keys(query)) {
    if (!allowedKeys.has(key)) return { ok: false, error: `Unsupported query parameter: ${key}` };
    if (!isSingleString(query[key])) return { ok: false, error: `Invalid value for ${key}` };
  }

  const params = new URLSearchParams();
  const genres = query.with_genres;
  if (genres !== undefined) {
    const ids = genres.split('|');
    if (!/^[1-9]\d*(?:\|[1-9]\d*){0,2}$/.test(genres) || new Set(ids).size !== ids.length) {
      return { ok: false, error: 'Genres must be up to three numeric IDs separated with |.' };
    }
    params.set('with_genres', genres);
  }

  for (const key of ['primary_release_date.gte', 'primary_release_date.lte']) {
    const value = query[key];
    if (value !== undefined) {
      if (!isIsoDate(value)) return { ok: false, error: `Invalid date for ${key}` };
      params.set(key, value);
    }
  }
  if (query['primary_release_date.gte'] && query['primary_release_date.lte'] &&
      query['primary_release_date.gte'] > query['primary_release_date.lte']) {
    return { ok: false, error: 'Release-date lower bound must not exceed its upper bound.' };
  }

  if (query['vote_average.gte'] !== undefined) {
    const value = Number(query['vote_average.gte']);
    if (!/^\d+(?:\.\d{1,2})?$/.test(query['vote_average.gte']) || value < 0 || value > 10) {
      return { ok: false, error: 'vote_average.gte must be between 0 and 10.' };
    }
    params.set('vote_average.gte', query['vote_average.gte']);
  }

  if (query['vote_count.gte'] !== undefined) {
    const value = Number(query['vote_count.gte']);
    if (!/^\d+$/.test(query['vote_count.gte']) || value < 0 || value > 1_000_000) {
      return { ok: false, error: 'vote_count.gte must be a non-negative integer no greater than 1000000.' };
    }
    params.set('vote_count.gte', query['vote_count.gte']);
  }

  if (query.sort_by !== undefined) {
    if (query.sort_by !== 'vote_average.desc') return { ok: false, error: 'Unsupported sort order.' };
    params.set('sort_by', query.sort_by);
  }

  if (query.language !== undefined) {
    if (query.language !== 'en-US') return { ok: false, error: 'Unsupported language.' };
    params.set('language', query.language);
  }

  if (query.page !== undefined) {
    const value = Number(query.page);
    if (!/^\d+$/.test(query.page) || value < 1 || value > 500) {
      return { ok: false, error: 'page must be an integer between 1 and 500.' };
    }
    params.set('page', query.page);
  }

  return { ok: true, params };
}

export async function forwardTmdbRequest(res, path, params) {
  const token = process.env.TMDB_ACCESS_TOKEN;
  if (!token) return res.status(500).json({ error: 'TMDB_ACCESS_TOKEN not configured' });

  const url = new URL(`${TMDB_API_BASE}${path}`);
  for (const [key, value] of params) url.searchParams.set(key, value);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  timeout.unref?.();
  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    const data = await response.json();
    return res.status(response.status).json(data);
  } catch {
    return res.status(502).json({ error: 'Failed to reach TMDB' });
  } finally {
    clearTimeout(timeout);
  }
}
