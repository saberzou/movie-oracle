// Movie Oracle — screen flow, result rendering, and the trailer lightbox.

import { mountReel, isWebGLAvailable } from './reel.js';
import { QUESTION_POOL, GENRE_NAMES } from './questions.js';
import {
    pickQuestions,
    buildFilters,
    getHook,
    getWhyText,
    buildPlaceholderHook,
    movieGenreNames,
    releaseYear,
    shuffle,
} from './filters.js';
import {
    fetchTrending,
    discoverMovies,
    fetchTrailerKey,
    fetchTagline,
    IMG_W500,
    IMG_W342,
} from './tmdb.js';

const $ = (id) => document.getElementById(id);
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Minimum time the loading screen stays up. Runs *alongside* the request rather
// than after it, so the theatre costs nothing when the network is slow.
const DRAMATIC_PAUSE_MS = 1500;

const LOADING_MESSAGES = [
    'Consulting the Oracle...',
    'Reading the film runes...',
    'Divining your perfect match...',
    'Scanning the archives...',
    'The prophecy unfolds...',
    'Decoding your taste...',
    'Summoning a classic...',
    'Aligning the reels...',
    'The Oracle deliberates...',
    'Peering into the filmverse...',
    'Your answers speak volumes...',
    'Almost there...',
];

// =============================================
//  STATE
// =============================================
let reelHandle = null;
let questions = pickQuestions(QUESTION_POOL);
let answers = [];
let currentQuestion = 0;
let results = [];
let resultIndex = 0;
let currentMovie = null;
/** Set while the reel is the visible screen, so we can idle the WebGL loop. */
let inReelMode = true;

// =============================================
//  ANNOUNCEMENTS
// =============================================
function announce(message) {
    const region = $('liveRegion');
    if (region) region.textContent = message;
}

// =============================================
//  SCREENS
// =============================================
function showScreen(id) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
    const el = $(id);
    el.classList.add('active');
    // Re-trigger the entrance animation.
    el.style.animation = 'none';
    void el.offsetHeight; // force reflow
    el.style.animation = '';

    document.querySelectorAll('.deco').forEach((d) => {
        d.style.display = id === 'result' ? 'none' : '';
    });

    // Anchor .app to the top so a tall result screen scrolls instead of being
    // pushed off the viewport (Saber #15503).
    document.body.classList.toggle('result-mode', id === 'result');
    if (id === 'result') window.scrollTo({ top: 0, behavior: 'auto' });
}

function enterReelMode() {
    inReelMode = true;
    document.body.classList.add('reel-mode');
    document.body.classList.remove('result-mode');
    $('reel').classList.add('active');
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
    setDetailsOpen(false);
    // Resume rendering only once the reel is actually on screen again.
    if (reelHandle && !document.hidden) reelHandle.resume();
}

function exitReelMode() {
    inReelMode = false;
    document.body.classList.remove('reel-mode');
    $('reel').classList.remove('active');
    // The canvas is hidden but the render loop is not — idle it, or it keeps
    // drawing 20 shader meshes at 60fps behind the result screen forever.
    if (reelHandle) reelHandle.pause();
}

// =============================================
//  HISTORY
// =============================================
// One state object per meaningful screen. `applyState` is the single place that
// turns a state into UI, so forward/back and in-app navigation cannot drift.
function applyState(state) {
    const screen = (state && state.screen) || 'reel';

    if (screen === 'reel') {
        enterReelMode();
        return;
    }
    exitReelMode();

    if (screen === 'question') {
        const index = state.index || 0;
        // Stepping back into an earlier question discards the answers that
        // came after it, so re-answering behaves the way the user expects.
        currentQuestion = index;
        answers = answers.slice(0, index);
        renderQuestion();
        return;
    }

    if (screen === 'result') {
        showScreen('result');
        setDetailsOpen(Boolean(state.detailsOpen));
        return;
    }

    showScreen(screen);
}

function go(state, { replace = false } = {}) {
    const hash = state.screen === 'reel' ? '#' : `#${state.screen}`;
    if (replace) history.replaceState(state, '', hash);
    else history.pushState(state, '', hash);
    applyState(state);
}

window.addEventListener('popstate', (e) => applyState(e.state));

// =============================================
//  QUIZ FLOW
// =============================================
function startOracle() {
    currentQuestion = 0;
    answers = [];
    questions = pickQuestions(QUESTION_POOL);
    go({ screen: 'question', index: 0 });
}

function renderQuestion() {
    const q = questions[currentQuestion];
    if (!q) return;
    $('questionProgress').textContent = `${currentQuestion + 1} / 3`;
    $('questionText').textContent = q.text;
    $('answerA').textContent = q.options[0];
    $('answerB').textContent = q.options[1];
    $('answerGroup').className = `answer-group q${currentQuestion + 1}`;
    showScreen('question');
    announce(`Question ${currentQuestion + 1} of 3. ${q.text}`);
}

function answer(choice) {
    // Assign rather than push: stepping back and re-answering must overwrite,
    // not append, or `answers` drifts out of alignment with `questions`.
    answers[currentQuestion] = choice;

    if (currentQuestion + 1 < questions.length) {
        go({ screen: 'question', index: currentQuestion + 1 });
    } else {
        runOracle();
    }
}

async function runOracle() {
    $('loadingText').textContent =
        LOADING_MESSAGES[Math.floor(Math.random() * LOADING_MESSAGES.length)];
    showScreen('loading');
    announce('Consulting the Oracle.');

    // Theatre and request run concurrently — the pause only ever costs the
    // difference, never the full 1.5s on top of a slow network.
    const pause = new Promise((r) => setTimeout(r, prefersReducedMotion ? 0 : DRAMATIC_PAUSE_MS));

    try {
        const [movies] = await Promise.all([discoverMovies(buildFilters(questions, answers)), pause]);
        results = shuffle(movies);
        resultIndex = 0;
        showNextResult();
    } catch (err) {
        console.error(err);
        $('errorText').textContent = 'The Oracle stumbled. Check your connection and try again.';
        go({ screen: 'error' });
        announce('Something went wrong. The Oracle is resting.');
    }
}

function showNextResult() {
    if (resultIndex >= results.length) {
        runOracle();
        return;
    }
    const movie = results[resultIndex++];
    renderResult(movie, {
        hook: getHook(questions, answers),
        why: getWhyText(movie, questions, answers),
    });
    // Only offer a re-roll when there is genuinely something else to show.
    $('anotherBtn').hidden = resultIndex >= results.length;
    go({ screen: 'result', detailsOpen: false });
}

// =============================================
//  RESULT RENDERING
// =============================================
// Shared by the quiz and the reel. These were two near-identical copies, and a
// fix landing in only one of them had already caused one regression (#15526).
function renderResult(movie, { hook, why }) {
    currentMovie = movie;

    const posterImg = $('posterImg');
    const posterBtn = $('resultPoster');
    posterImg.classList.remove('loaded');
    posterBtn.classList.remove('poster-loaded');

    if (movie.poster_path) {
        posterImg.onload = () => {
            posterImg.classList.add('loaded');
            posterBtn.classList.add('poster-loaded');
        };
        posterImg.src = IMG_W500 + movie.poster_path;
        posterImg.alt = `Poster for ${movie.title}`;
    } else {
        posterImg.removeAttribute('src');
        posterImg.alt = 'No poster available';
    }

    $('resultTitle').textContent = movie.title;
    const year = releaseYear(movie) || '—';
    const rating = movie.vote_average ? movie.vote_average.toFixed(1) : '—';
    $('resultMeta').textContent = `${year}  ·  ${rating}/10`;
    $('resultHook').textContent = `“${hook}”`;

    $('detailsOverview').textContent =
        movie.overview && movie.overview.trim() ? movie.overview : 'No synopsis available yet.';
    $('detailsWhy').textContent = why;

    setDetailsOpen(false);

    // Reserve the trailer button's layout slot while we look one up, so it
    // cannot pop in late and shift the buttons below it (Saber #15517).
    const trailerBtn = $('trailerBtn');
    trailerBtn.dataset.state = 'loading';
    trailerBtn.dataset.youtubeKey = '';

    if (movie.id) {
        loadTrailer(movie);
        loadTagline(movie);
    } else {
        trailerBtn.dataset.state = 'none';
    }

    announce(`${movie.title}, ${year}, rated ${rating} out of 10.`);
}

// Both loaders check the film is still on screen before touching the DOM —
// a slow response for a film the user already moved past must not overwrite it.
async function loadTrailer(movie) {
    const key = await fetchTrailerKey(movie.id);
    if (!currentMovie || currentMovie.id !== movie.id) return;
    const trailerBtn = $('trailerBtn');
    if (key) {
        trailerBtn.dataset.youtubeKey = key;
        trailerBtn.dataset.state = 'ready';
    } else {
        trailerBtn.dataset.state = 'none';
    }
}

async function loadTagline(movie) {
    const tagline = await fetchTagline(movie.id);
    if (!tagline) return;
    if (!currentMovie || currentMovie.id !== movie.id) return;
    $('resultHook').textContent = `“${tagline}”`;
}

function selectTrendingMovie(movie) {
    results = [movie];
    resultIndex = 1;
    answers = [];
    $('anotherBtn').hidden = true;

    const genres = movieGenreNames(movie);
    renderResult(movie, {
        hook: buildPlaceholderHook(movie),
        why: genres.length ? `Trending in ${genres.join(' + ')}.` : 'Trending this week.',
    });
    go({ screen: 'result', detailsOpen: false });
}

// =============================================
//  DETAILS PANEL
// =============================================
function setDetailsOpen(open) {
    $('resultDetails').classList.toggle('expanded', open);
    $('result').classList.toggle('details-open', open);
    $('resultPoster').setAttribute('aria-expanded', String(open));
}

function toggleDetails() {
    const isOpen = $('result').classList.contains('details-open');
    // Closing walks the history back rather than pushing a new entry, so the
    // stack stays a clean reflection of what is on screen.
    if (isOpen) history.back();
    else go({ screen: 'result', detailsOpen: true });
}

// =============================================
//  TRAILER MODAL
// =============================================
let lastFocusedBeforeModal = null;

function openTrailer() {
    const key = $('trailerBtn').dataset.youtubeKey;
    if (!key) return;

    const modal = $('trailerModal');
    const frame = $('trailerFrame');
    const wrap = modal.querySelector('.trailer-frame-wrap');

    lastFocusedBeforeModal = document.activeElement;
    // src is injected on open so the ~200KB player only loads on demand.
    frame.src = `https://www.youtube-nocookie.com/embed/${key}?autoplay=1&rel=0&modestbranding=1&playsinline=1`;
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    $('trailerClose').focus();

    if (window.gsap && !prefersReducedMotion) {
        gsap.fromTo(modal, { opacity: 0 }, { opacity: 1, duration: 0.25, ease: 'power2.out' });
        gsap.fromTo(wrap, { scale: 0.92, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.35, ease: 'power3.out' });
    } else {
        modal.style.opacity = 1;
        wrap.style.transform = 'scale(1)';
    }
}

function closeTrailer() {
    const modal = $('trailerModal');
    const frame = $('trailerFrame');
    const wrap = modal.querySelector('.trailer-frame-wrap');

    const cleanup = () => {
        modal.hidden = true;
        frame.src = ''; // stop playback and release the network connection
        document.body.style.overflow = '';
        if (wrap) wrap.style.transform = '';
        if (lastFocusedBeforeModal) lastFocusedBeforeModal.focus();
        lastFocusedBeforeModal = null;
    };

    if (window.gsap && !prefersReducedMotion) {
        gsap.to(wrap, { scale: 0.94, opacity: 0, duration: 0.18, ease: 'power2.in' });
        gsap.to(modal, { opacity: 0, duration: 0.2, ease: 'power2.in', onComplete: cleanup });
    } else {
        cleanup();
    }
}

/** Keep Tab inside the dialog while it is open. */
function trapModalFocus(e) {
    if (e.key !== 'Tab') return;
    const modal = $('trailerModal');
    if (modal.hidden) return;
    const focusable = modal.querySelectorAll('button, iframe, [href], [tabindex]:not([tabindex="-1"])');
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
    }
}

// =============================================
//  REEL
// =============================================
function renderFallbackGrid(movies) {
    const grid = $('reelFallbackGrid');
    grid.replaceChildren();

    movies.forEach((movie) => {
        // A button, not a div: the fallback is the path most likely to be used
        // with a keyboard or assistive tech, and it was unreachable by both.
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'reel-fallback-card';

        if (movie.poster_path) {
            const img = document.createElement('img');
            img.src = IMG_W342 + movie.poster_path;
            img.alt = '';
            img.loading = 'lazy';
            card.appendChild(img);
        }

        const title = document.createElement('span');
        title.className = 'reel-fallback-card-title';
        title.textContent = movie.title;
        card.appendChild(title);

        card.addEventListener('click', () => selectTrendingMovie(movie));
        grid.appendChild(card);
    });

    $('reelFallback').classList.add('active');
    $('reelLoading').classList.add('hidden');
}

function updateReelMeta(movie) {
    const titleEl = $('reelMetaTitle');
    const subEl = $('reelMetaSub');

    const write = () => {
        titleEl.textContent = movie.title || '';
        const year = releaseYear(movie);
        const rating = movie.vote_average ? movie.vote_average.toFixed(1) : '';
        subEl.replaceChildren();
        if (!year) return;
        subEl.append(year);
        if (rating) {
            const span = document.createElement('span');
            span.className = 'pink';
            span.textContent = `${rating}/10`;
            subEl.append(' · ', span);
        }
    };

    if (window.gsap && !prefersReducedMotion) {
        const tl = gsap.timeline();
        tl.to([titleEl, subEl], { opacity: 0, y: -6, duration: 0.18, ease: 'power2.in', onComplete: write });
        tl.fromTo(
            [titleEl, subEl],
            { opacity: 0, y: 12 },
            { opacity: 1, y: 0, duration: 0.32, ease: 'power2.out', stagger: 0.04 }
        );
    } else {
        write();
    }
}

function playReelIntro() {
    $('reelLoading').classList.add('hidden');
    if (!window.gsap || prefersReducedMotion) return;

    gsap.from('#reelCanvasHost', { opacity: 0, duration: 0.6, ease: 'power2.out' });
    gsap.from('.reel-header', { opacity: 0, y: -16, duration: 0.6, delay: 0.15, ease: 'power2.out' });
    gsap.from('.reel-hint', { opacity: 0, y: -8, duration: 0.5, delay: 0.35, ease: 'power2.out' });
    gsap.from('.reel-cta-bar', { opacity: 0, y: 24, duration: 0.7, delay: 0.45, ease: 'power3.out' });
    gsap.from('#reelMeta', { opacity: 0, y: 16, duration: 0.6, delay: 0.55, ease: 'power2.out' });
    gsap.to('.reel-cta', {
        scale: 1.025, duration: 2.4, yoyo: true, repeat: -1, ease: 'sine.inOut', delay: 1.2,
    });
}

async function initReel() {
    document.body.classList.add('reel-mode');
    history.replaceState({ screen: 'reel' }, '', '#');

    const movies = await fetchTrending();

    if (!movies.length) {
        // TMDB unreachable — the quiz still works, so fall through to it.
        exitReelMode();
        showScreen('landing');
        return;
    }

    if (!isWebGLAvailable()) {
        renderFallbackGrid(movies);
        return;
    }

    try {
        reelHandle = mountReel($('reelCanvasHost'), movies, {
            onFocus: (idx, movie) => updateReelMeta(movie),
            onSelect: (movie) => selectTrendingMovie(movie),
            reducedMotion: prefersReducedMotion,
        });
        updateReelMeta(movies[Math.floor(movies.length / 2)]);
        requestAnimationFrame(playReelIntro);
    } catch (err) {
        console.error('Reel mount failed:', err);
        renderFallbackGrid(movies);
    }
}

// =============================================
//  EVENT WIRING
// =============================================
// Listeners rather than inline onclick attributes: no globals to re-export, and
// the page can ship a Content-Security-Policy without 'unsafe-inline'.
$('reelCta').addEventListener('click', () => {
    if (window.gsap && !prefersReducedMotion) {
        gsap.to('.reel-cta', { scale: 0.94, duration: 0.08, ease: 'power2.in', yoyo: true, repeat: 1 });
    }
    startOracle();
});

$('startBtn').addEventListener('click', startOracle);
$('answerA').addEventListener('click', () => answer(0));
$('answerB').addEventListener('click', () => answer(1));
$('resultPoster').addEventListener('click', toggleDetails);
$('trailerBtn').addEventListener('click', openTrailer);
$('anotherBtn').addEventListener('click', showNextResult);
$('homeBtn').addEventListener('click', () => go({ screen: 'reel' }));
$('errorHomeBtn').addEventListener('click', () => go({ screen: 'reel' }));

$('trailerClose').addEventListener('click', closeTrailer);
$('trailerModal').addEventListener('click', (e) => {
    if (e.target.id === 'trailerModal') closeTrailer();
});
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('trailerModal').hidden) closeTrailer();
    else trapModalFocus(e);
});

// Don't burn a phone's battery rendering a reel nobody is looking at.
document.addEventListener('visibilitychange', () => {
    if (!reelHandle) return;
    if (document.hidden) reelHandle.pause();
    else if (inReelMode) reelHandle.resume();
});

initReel();
