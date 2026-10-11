import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRateLimiter, validateDiscoverQuery } from '../server/tmdb.js';
import { broadenFilters, getTodayIsoDate, normalizeDateRange } from '../lib/discovery.js';
import { shuffle } from '../lib/random.js';
import discoverHandler from '../api/discover.js';
import tmdbHandler from '../api/tmdb.js';

function createResponse() {
  return {
    headers: {},
    statusCode: null,
    body: null,
    setHeader(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function request(query = {}, method = 'GET', ip = `test-${Math.random()}`) {
  return { method, query, headers: { 'x-forwarded-for': ip }, socket: {} };
}

test('discover query validation permits only safe app filters and preserves genre OR syntax', () => {
  const result = validateDiscoverQuery({
    with_genres: '28|53|878',
    'primary_release_date.gte': '1990-01-01',
    'primary_release_date.lte': '2026-10-11',
    'vote_average.gte': '6.8',
    'vote_count.gte': '100',
    sort_by: 'vote_average.desc',
    language: 'en-US',
    page: '2',
  });
  assert.equal(result.ok, true);
  assert.equal(result.params.get('with_genres'), '28|53|878');
  assert.equal(result.params.get('page'), '2');
});

test('discover validation rejects arbitrary parameters, AND-style commas, invalid dates, and impossible bounds', () => {
  assert.equal(validateDiscoverQuery({ api_key: 'attacker-controlled' }).ok, false);
  assert.equal(validateDiscoverQuery({ with_genres: '28,53' }).ok, false);
  assert.equal(validateDiscoverQuery({ 'primary_release_date.gte': '2026-02-30' }).ok, false);
  assert.equal(validateDiscoverQuery({
    'primary_release_date.gte': '2022-01-01',
    'primary_release_date.lte': '2005-12-31',
  }).ok, false);
  assert.equal(validateDiscoverQuery({ page: ['1', '2'] }).ok, false);
});

test('rate limiter caps each key and resets after its window', () => {
  const consume = createRateLimiter({ limit: 2, windowMs: 1000, maxKeys: 10 });
  assert.equal(consume('client', 100).allowed, true);
  assert.equal(consume('client', 200).remaining, 0);
  assert.equal(consume('client', 300).allowed, false);
  assert.equal(consume('client', 1100).allowed, true);
});

test('discover route rejects non-GET methods and forwards only validated filters server-side', async () => {
  const oldToken = process.env.TMDB_ACCESS_TOKEN;
  const oldFetch = globalThis.fetch;
  process.env.TMDB_ACCESS_TOKEN = 'test-token';
  let calledUrl;
  let calledOptions;
  globalThis.fetch = async (url, options) => {
    calledUrl = new URL(url);
    calledOptions = options;
    return { status: 200, json: async () => ({ results: [] }) };
  };
  try {
    const denied = createResponse();
    await discoverHandler(request({}, 'POST'), denied);
    assert.equal(denied.statusCode, 405);
    assert.equal(denied.headers.Allow, 'GET');
    assert.equal(calledUrl, undefined);

    const response = createResponse();
    await discoverHandler(request({ with_genres: '28|53', page: '1', sort_by: 'vote_average.desc' }), response);
    assert.equal(response.statusCode, 200);
    assert.equal(calledUrl.pathname, '/3/discover/movie');
    assert.equal(calledUrl.searchParams.get('with_genres'), '28|53');
    assert.equal(calledUrl.searchParams.has('api_key'), false);
    assert.equal(calledOptions.headers.Authorization, 'Bearer test-token');
  } finally {
    globalThis.fetch = oldFetch;
    if (oldToken === undefined) delete process.env.TMDB_ACCESS_TOKEN;
    else process.env.TMDB_ACCESS_TOKEN = oldToken;
  }
});

test('TMDB route permits only the fixed trending, movie, and videos resources', async () => {
  const oldToken = process.env.TMDB_ACCESS_TOKEN;
  const oldFetch = globalThis.fetch;
  process.env.TMDB_ACCESS_TOKEN = 'test-token';
  let calledUrl;
  globalThis.fetch = async (url) => {
    calledUrl = new URL(url);
    return { status: 200, json: async () => ({ results: [] }) };
  };
  try {
    const response = createResponse();
    await tmdbHandler(request({ resource: 'videos', id: '123' }), response);
    assert.equal(response.statusCode, 200);
    assert.equal(calledUrl.pathname, '/3/movie/123/videos');
    assert.equal(calledUrl.searchParams.get('language'), 'en-US');

    const invalid = createResponse();
    await tmdbHandler(request({ resource: 'movie', id: '1', path: '/configuration' }), invalid);
    assert.equal(invalid.statusCode, 400);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldToken === undefined) delete process.env.TMDB_ACCESS_TOKEN;
    else process.env.TMDB_ACCESS_TOKEN = oldToken;
  }
});

test('date logic avoids contradictory bounds and uses the current date dynamically', () => {
  assert.deepEqual(normalizeDateRange('2020-01-01', '2005-12-31', '2026-10-11'), {
    gte: '1990-01-01', lte: '2026-10-11',
  });
  assert.deepEqual(normalizeDateRange('2015-01-01', '2020-12-31', '2026-10-11'), {
    gte: '2015-01-01', lte: '2020-12-31',
  });
  assert.equal(getTodayIsoDate(new Date('2030-06-07T23:00:00.000Z')), '2030-06-07');
});

test('empty-results fallback broadens genres, release dates, rating, and vote count without mutating originals', () => {
  const original = {
    with_genres: '28|53',
    'primary_release_date.gte': '2020-01-01',
    'primary_release_date.lte': '2024-12-31',
    'vote_average.gte': 7,
    'vote_count.gte': 500,
    page: 3,
  };
  const fallback = broadenFilters(original, '2026-10-11');
  assert.equal('with_genres' in fallback, false);
  assert.equal(fallback['primary_release_date.gte'], '1990-01-01');
  assert.equal(fallback['primary_release_date.lte'], '2026-10-11');
  assert.equal(fallback['vote_average.gte'], 5.5);
  assert.equal(fallback['vote_count.gte'], 100);
  assert.equal(fallback.page, 1);
  assert.equal(original.with_genres, '28|53');
});

test('shuffle uses Fisher–Yates deterministically and does not mutate input', () => {
  const input = [1, 2, 3, 4];
  const values = [0, 0, 0];
  const result = shuffle(input, () => values.shift());
  assert.deepEqual(result, [2, 3, 4, 1]);
  assert.deepEqual(input, [1, 2, 3, 4]);
});

test('browser source contains no TMDB bearer token or direct TMDB API origin', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /api\.themoviedb\.org\/3/i);
  assert.doesNotMatch(html, /Authorization\s*:\s*`?Bearer/i);
  assert.doesNotMatch(html, /accessToken\s*:/i);
});
