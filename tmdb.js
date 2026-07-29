// TMDB access layer.
//
// Every request goes through /api/tmdb/*, a serverless function that attaches
// the credential server-side. The browser never sees a token — previously one
// was hardcoded into the page source and committed to a public repository.

import { relaxFilters } from './filters.js';

export const IMG_W500 = 'https://image.tmdb.org/t/p/w500';
export const IMG_W342 = 'https://image.tmdb.org/t/p/w342';

const API_BASE = '/api/tmdb';
const TRENDING_CACHE_KEY = 'movie-oracle:trending:v1';
const TRENDING_TTL_MS = 6 * 60 * 60 * 1000; // 6h — the weekly list barely moves

// TMDB refuses discover pages beyond 500.
const MAX_DISCOVER_PAGE = 500;

async function tmdbFetch(path, params = {}) {
    const query = new URLSearchParams(params);
    const res = await fetch(`${API_BASE}${path}?${query}`);
    if (!res.ok) throw new Error(`TMDB ${path} failed: ${res.status}`);
    return res.json();
}

function readTrendingCache() {
    try {
        const raw = localStorage.getItem(TRENDING_CACHE_KEY);
        if (!raw) return null;
        const { at, movies } = JSON.parse(raw);
        if (!Array.isArray(movies) || !movies.length) return null;
        if (Date.now() - at > TRENDING_TTL_MS) return null;
        return movies;
    } catch {
        return null; // private mode, quota, or corrupt entry — just refetch
    }
}

function writeTrendingCache(movies) {
    try {
        localStorage.setItem(TRENDING_CACHE_KEY, JSON.stringify({ at: Date.now(), movies }));
    } catch {
        /* storage unavailable — caching is an optimisation, not a requirement */
    }
}

/** Trending films for the reel, cached locally so repeat visits start instantly. */
export async function fetchTrending({ limit = 20 } = {}) {
    const cached = readTrendingCache();
    if (cached) return cached.slice(0, limit);

    try {
        const data = await tmdbFetch('/trending/movie/week', { language: 'en-US' });
        const movies = (data.results || []).filter((m) => m.poster_path).slice(0, limit);
        if (movies.length) writeTrendingCache(movies);
        return movies;
    } catch (err) {
        console.error('Trending fetch failed:', err);
        return [];
    }
}

/**
 * Run a discover query, then re-roll onto a random page of the real result set
 * so two people answering identically don't always land on the same film.
 * Falls back to a loosened query when the filters match nothing.
 */
export async function discoverMovies(filters) {
    let data = await tmdbFetch('/discover/movie', filters);

    if (!data.results || !data.results.length) {
        data = await tmdbFetch('/discover/movie', relaxFilters(filters));
        if (!data.results || !data.results.length) {
            throw new Error('No movies matched');
        }
        return data.results;
    }

    const pages = Math.min(data.total_pages || 1, MAX_DISCOVER_PAGE);
    if (pages > 1) {
        const page = Math.floor(Math.random() * pages) + 1;
        if (page !== 1) {
            try {
                const paged = await tmdbFetch('/discover/movie', { ...filters, page });
                if (paged.results && paged.results.length) return paged.results;
            } catch {
                /* keep page 1 — a failed re-roll shouldn't lose a good result */
            }
        }
    }

    return data.results;
}

/** YouTube key for a film's trailer, or null when it has none. */
export async function fetchTrailerKey(movieId) {
    try {
        const data = await tmdbFetch(`/movie/${movieId}/videos`, { language: 'en-US' });
        const videos = data.results || [];
        const pick =
            videos.find((v) => v.site === 'YouTube' && v.type === 'Trailer' && v.official) ||
            videos.find((v) => v.site === 'YouTube' && v.type === 'Trailer') ||
            videos.find((v) => v.site === 'YouTube' && v.type === 'Teaser');
        return pick && pick.key ? pick.key : null;
    } catch {
        return null;
    }
}

/**
 * The film's real tagline, falling back to the first sentence of its overview.
 * Returns null on failure so the caller keeps whatever it is already showing.
 */
export async function fetchTagline(movieId) {
    try {
        const data = await tmdbFetch(`/movie/${movieId}`, { language: 'en-US' });
        if (data.tagline && data.tagline.trim()) return data.tagline.trim();
        if (data.overview && data.overview.trim()) {
            const first = data.overview.split(/(?<=[.!?])\s+/)[0].trim();
            return first.length > 140 ? `${first.slice(0, 137).trimEnd()}…` : first;
        }
        return null;
    } catch {
        return null;
    }
}
