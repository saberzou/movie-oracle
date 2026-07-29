// Pure recommendation logic: shuffling, question selection, TMDB filter
// building, and the flavour text. Nothing here touches the DOM or the network,
// which is what makes it testable — see test/filters.test.js.

import { GENRE_NAMES } from './questions.js';

const EARLIEST = '1990-01-01';
const LATEST = '2026-12-31';
const BASE_VOTE_AVG = 6.0;

/**
 * Fisher-Yates. The previous `[...items].sort(() => Math.random() - 0.5)` is
 * not a uniform shuffle: comparator-based shuffles bias heavily toward the
 * original ordering, so the same questions and the same films kept surfacing.
 */
export function shuffle(items) {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

export function pickQuestions(pool, count = 3) {
    return shuffle(pool).slice(0, count);
}

/** Genre ids implied by the answers given so far. */
export function collectGenres(questions, answers) {
    const genres = new Set();
    questions.forEach((q, i) => {
        const filter = q.filters[answers[i]];
        if (filter && filter.genres) filter.genres.forEach((g) => genres.add(g));
    });
    return genres;
}

/**
 * Fold the answered questions into a single TMDB /discover/movie query.
 *
 * Returns the filters plus `relax()`, which loosens the quality floor for the
 * retry path when a query legitimately matches nothing.
 */
export function buildFilters(questions, answers) {
    const genres = collectGenres(questions, answers);
    let yearGte = EARLIEST;
    let yearLte = LATEST;
    let voteAvg = BASE_VOTE_AVG;

    questions.forEach((q, i) => {
        const f = q.filters[answers[i]];
        if (!f) return;
        if (f.yearGte && f.yearGte > yearGte) yearGte = f.yearGte;
        if (f.yearLte && f.yearLte < yearLte) yearLte = f.yearLte;
        if (f.voteAvg && f.voteAvg > voteAvg) voteAvg = f.voteAvg;
    });

    // Two answers can pull the window in opposite directions — "Fresh release"
    // wants >= 2020 while "Analog" wants <= 2012 — leaving a range no film can
    // fall inside. TMDB answers that with zero results, and because the retry
    // path only loosens the vote filters the user used to dead-end on the error
    // screen. An impossible window is worth less than no window, so drop it.
    if (yearGte > yearLte) {
        yearGte = EARLIEST;
        yearLte = LATEST;
    }

    return {
        // Pipe is OR, comma is AND. This was a comma, which demanded a film
        // belonging to *every* selected genre at once — usually nothing, and
        // the reason recommendations so often fell through to the retry path.
        with_genres: shuffle([...genres]).slice(0, 3).join('|'),
        'primary_release_date.gte': yearGte,
        'primary_release_date.lte': yearLte,
        'vote_average.gte': voteAvg,
        'vote_count.gte': 500,
        // Sorting by vote_average.desc over pages 1-3 served the same few dozen
        // universally-acclaimed films to everybody. popularity.desc keeps a
        // recognisable pool while the caller randomises the page across the
        // real result set.
        sort_by: 'popularity.desc',
        language: 'en-US',
        page: 1,
    };
}

/** Loosened copy of `filters` for the retry when a query matches nothing. */
export function relaxFilters(filters) {
    return {
        ...filters,
        'vote_average.gte': BASE_VOTE_AVG,
        'vote_count.gte': 200,
        page: 1,
    };
}

const GENRE_HOOKS = {
    27: ['Something watches from the dark. The Oracle dares you.',
         'Sleep is overrated. This film proves it.'],
    53: ['Your pulse will thank you later.',
         'The Oracle senses you crave tension. Delivered.'],
    10749: ['A romantic at heart. The Oracle sees through you.',
            'Love stories hit different when the Oracle picks them.'],
    878: ['The future called. The Oracle answered.',
          'Your curiosity runs deep. This one rewards it.'],
    18: ['The Oracle found weight in your answers. This film carries it.',
         'Not every great film is easy. This one earns every minute.'],
    28: ['You chose intensity. The Oracle respects that.',
         'Adrenaline was written in your answers.'],
    35: ['The Oracle prescribes laughter. No refills needed.',
         "Life's too short for boring movies. The Oracle agrees."],
    80: ['The Oracle detects a fascination with the morally grey.',
         'Rules were made to be broken. This film knows it.'],
    14: ['The Oracle sees a dreamer. This world was built for you.',
         'Reality is optional. The Oracle prefers it that way.'],
    9648: ['The Oracle loves a puzzle. So do you, apparently.',
           "Questions without easy answers. The Oracle's specialty."],
    12: ['Adventure found you. The Oracle just pointed the way.',
         'Your answers smell like wanderlust.'],
    16: ["Animation isn't just for kids. The Oracle knows better.",
         'Frame by frame, this one was made for you.'],
};

const DEFAULT_HOOKS = [
    'The Oracle sees exactly what you need. Trust it.',
    'Your answers reveal a hidden craving. This one satisfies it.',
    'An unexpected choice — but the Oracle knows best.',
    'The stars aligned for this recommendation.',
    'Bold choices deserve bold cinema.',
    "Your vibe? Unmistakable. Here's your match.",
];

function sample(list) {
    return list[Math.floor(Math.random() * list.length)];
}

export function getHook(questions, answers) {
    const genres = [...collectGenres(questions, answers)].filter((g) => GENRE_HOOKS[g]);
    if (genres.length) return sample(GENRE_HOOKS[sample(genres)]);
    return sample(DEFAULT_HOOKS);
}

export function getWhyText(movie, questions, answers) {
    const selected = collectGenres(questions, answers);
    const matched = (movie.genre_ids || [])
        .filter((g) => selected.has(g))
        .map((g) => GENRE_NAMES[g])
        .filter(Boolean);
    if (matched.length) {
        return `The Oracle matched your ${matched.slice(0, 2).join(' + ')} energy.`;
    }
    return 'The Oracle works in mysterious ways.';
}

/** Genres a film belongs to, as display names. */
export function movieGenreNames(movie, limit = 2) {
    return (movie.genre_ids || [])
        .map((g) => GENRE_NAMES[g])
        .filter(Boolean)
        .slice(0, limit);
}

export function releaseYear(movie) {
    if (movie.release_date) return movie.release_date.split('-')[0];
    return movie.year ? String(movie.year) : '';
}

/**
 * Film-specific placeholder shown for the moment before the real TMDB tagline
 * arrives, so a slow network never flashes generic copy.
 */
export function buildPlaceholderHook(movie) {
    const year = releaseYear(movie);
    const [genre] = movieGenreNames(movie, 1);
    if (year && genre) return `${year}’s ${genre.toLowerCase()}.`;
    if (genre) return `${genre}, hand-picked.`;
    if (year) return `${year}, hand-picked.`;
    return 'Hand-picked by the Oracle.';
}
