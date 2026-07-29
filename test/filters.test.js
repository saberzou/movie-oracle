import test from 'node:test';
import assert from 'node:assert/strict';

import { QUESTION_POOL } from '../questions.js';
import {
    shuffle,
    pickQuestions,
    buildFilters,
    relaxFilters,
    collectGenres,
    getHook,
    getWhyText,
    buildPlaceholderHook,
    releaseYear,
} from '../filters.js';

/** Minimal question fixtures so tests don't depend on the live pool. */
const q = (filters) => ({ text: 'x?', options: ['a', 'b'], filters });

test('genres are OR-combined, not AND-combined', () => {
    // A comma means "belongs to every one of these genres" in TMDB's API, which
    // is almost always an empty result set. It must be a pipe.
    const questions = [
        q([{ genres: [28] }, {}]),
        q([{ genres: [878] }, {}]),
        q([{ genres: [9648] }, {}]),
    ];
    const filters = buildFilters(questions, [0, 0, 0]);

    assert.ok(!filters.with_genres.includes(','), 'with_genres must not use comma (AND)');
    assert.equal(filters.with_genres.split('|').sort().join('|'), '28|878|9648');
});

test('at most three genres are requested', () => {
    const questions = [
        q([{ genres: [1, 2, 3] }, {}]),
        q([{ genres: [4, 5, 6] }, {}]),
        q([{ genres: [7, 8, 9] }, {}]),
    ];
    const filters = buildFilters(questions, [0, 0, 0]);
    assert.equal(filters.with_genres.split('|').length, 3);
});

test('contradictory year windows are dropped rather than shipped', () => {
    // "Fresh release" wants >= 2020 and "Analog" wants <= 2012. Left alone that
    // is a window no film can fall inside, and the retry path only loosens the
    // vote filters — so the user dead-ended on the error screen.
    const questions = [
        q([{ yearGte: '2020-01-01' }, {}]),
        q([{ yearLte: '2012-12-31' }, {}]),
        q([{ genres: [18] }, {}]),
    ];
    const filters = buildFilters(questions, [0, 0, 0]);

    assert.ok(
        filters['primary_release_date.gte'] <= filters['primary_release_date.lte'],
        'year window must be satisfiable'
    );
});

test('the real question pair that triggered the dead end now yields a valid window', () => {
    const fresh = QUESTION_POOL.find((x) => x.text === 'Old film or Fresh release?');
    const analog = QUESTION_POOL.find((x) => x.text === 'Analog or Digital?');
    assert.ok(fresh && analog, 'fixture questions still exist in the pool');

    // "Fresh release" is option index 1; "Analog" is option index 0.
    const filters = buildFilters([fresh, analog], [1, 0]);
    assert.ok(filters['primary_release_date.gte'] <= filters['primary_release_date.lte']);
});

test('compatible year windows are preserved, not discarded', () => {
    const questions = [
        q([{ yearGte: '2000-01-01' }, {}]),
        q([{ yearLte: '2015-12-31' }, {}]),
    ];
    const filters = buildFilters(questions, [0, 0]);
    assert.equal(filters['primary_release_date.gte'], '2000-01-01');
    assert.equal(filters['primary_release_date.lte'], '2015-12-31');
});

test('the strictest vote average wins', () => {
    const questions = [q([{ voteAvg: 7.5 }, {}]), q([{ voteAvg: 6.5 }, {}])];
    assert.equal(buildFilters(questions, [0, 0])['vote_average.gte'], 7.5);
});

test('answers select the matching filter branch', () => {
    const questions = [q([{ genres: [28] }, { genres: [35] }])];
    assert.equal(buildFilters(questions, [0]).with_genres, '28');
    assert.equal(buildFilters(questions, [1]).with_genres, '35');
});

test('relaxFilters loosens the quality floor and resets the page', () => {
    const base = buildFilters([q([{ voteAvg: 7.5 }, {}])], [0]);
    const relaxed = relaxFilters({ ...base, page: 7 });
    assert.equal(relaxed['vote_average.gte'], 6.0);
    assert.equal(relaxed['vote_count.gte'], 200);
    assert.equal(relaxed.page, 1);
    assert.equal(relaxed.with_genres, base.with_genres, 'genres are untouched');
});

test('shuffle returns a permutation without mutating its input', () => {
    const input = [1, 2, 3, 4, 5];
    const out = shuffle(input);
    assert.deepEqual(input, [1, 2, 3, 4, 5]);
    assert.deepEqual([...out].sort((a, b) => a - b), [1, 2, 3, 4, 5]);
});

test('shuffle does not bias toward the original ordering', () => {
    // `[...].sort(() => Math.random() - 0.5)` leaves the first element in place
    // far more often than chance. Fisher-Yates should sit near 1/10.
    const runs = 5000;
    let stayed = 0;
    for (let i = 0; i < runs; i++) {
        if (shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])[0] === 0) stayed++;
    }
    const rate = stayed / runs;
    assert.ok(rate > 0.06 && rate < 0.16, `first element held position ${rate}, expected ~0.1`);
});

test('pickQuestions returns the requested count with no repeats', () => {
    const picked = pickQuestions(QUESTION_POOL, 3);
    assert.equal(picked.length, 3);
    assert.equal(new Set(picked.map((x) => x.text)).size, 3);
});

test('collectGenres ignores unanswered questions', () => {
    const questions = [q([{ genres: [28] }, {}]), q([{ genres: [35] }, {}])];
    assert.deepEqual([...collectGenres(questions, [0])], [28]);
});

test('getWhyText names only genres the film actually shares', () => {
    const questions = [q([{ genres: [28, 878] }, {}])];
    const movie = { genre_ids: [878, 10749] };
    assert.equal(getWhyText(movie, questions, [0]), 'The Oracle matched your Sci-Fi energy.');
});

test('getWhyText falls back when nothing overlaps', () => {
    const questions = [q([{ genres: [28] }, {}])];
    assert.equal(getWhyText({ genre_ids: [99] }, questions, [0]), 'The Oracle works in mysterious ways.');
});

test('getHook always returns a non-empty string', () => {
    const questions = [q([{ genres: [27] }, {}])];
    assert.ok(getHook(questions, [0]).length > 0);
    assert.ok(getHook([q([{}, {}])], [0]).length > 0); // no genres at all
});

test('placeholder hook degrades cleanly as data thins out', () => {
    assert.equal(buildPlaceholderHook({ release_date: '1999-03-31', genre_ids: [878] }), '1999’s sci-fi.');
    assert.equal(buildPlaceholderHook({ genre_ids: [35] }), 'Comedy, hand-picked.');
    assert.equal(buildPlaceholderHook({ release_date: '2004-01-01' }), '2004, hand-picked.');
    assert.equal(buildPlaceholderHook({}), 'Hand-picked by the Oracle.');
});

test('releaseYear handles both shapes and missing data', () => {
    assert.equal(releaseYear({ release_date: '2011-07-15' }), '2011');
    assert.equal(releaseYear({ year: 1994 }), '1994');
    assert.equal(releaseYear({}), '');
});

test('every question in the pool is well formed', () => {
    for (const question of QUESTION_POOL) {
        assert.equal(question.options.length, 2, `${question.text} needs two options`);
        assert.equal(question.filters.length, 2, `${question.text} needs two filters`);
        for (const filter of question.filters) {
            if (filter.yearGte && filter.yearLte) {
                assert.ok(filter.yearGte <= filter.yearLte, `${question.text} has an impossible window`);
            }
        }
    }
});

test('no single answer can build an unsatisfiable query', () => {
    // Exhaustive over the pool: every question, both answers, on its own.
    for (const question of QUESTION_POOL) {
        for (const answer of [0, 1]) {
            const filters = buildFilters([question], [answer]);
            assert.ok(
                filters['primary_release_date.gte'] <= filters['primary_release_date.lte'],
                `${question.text} / ${question.options[answer]} produced an impossible window`
            );
        }
    }
});

test('no pair of answers anywhere in the pool can build an unsatisfiable query', () => {
    for (let a = 0; a < QUESTION_POOL.length; a++) {
        for (let b = a + 1; b < QUESTION_POOL.length; b++) {
            for (const i of [0, 1]) {
                for (const j of [0, 1]) {
                    const filters = buildFilters([QUESTION_POOL[a], QUESTION_POOL[b]], [i, j]);
                    assert.ok(
                        filters['primary_release_date.gte'] <= filters['primary_release_date.lte'],
                        `"${QUESTION_POOL[a].text}"/${i} + "${QUESTION_POOL[b].text}"/${j} is impossible`
                    );
                }
            }
        }
    }
});
