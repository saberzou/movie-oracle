# Movie Oracle

Answer 3 absurd questions. Get a film recommendation that somehow feels right.

Two ways in:

- **The reel** — a WebGL cylinder of the week's trending posters you drag, scroll, or tap through.
- **The oracle** — three either/or questions whose answers fold into a TMDB discover query.

No build step. Plain ES modules served straight to the browser.

## Running locally

```bash
npm install -g vercel   # once
vercel env pull         # fetches TMDB_ACCESS_TOKEN into .env.local
npm run dev             # vercel dev, serves the site + /api on :3000
```

The serverless function needs a TMDB **API Read Access Token** (v4 auth, the long
JWT — not the v3 API key) in `TMDB_ACCESS_TOKEN`. Get one at
<https://www.themoviedb.org/settings/api>, then add it under *Project → Settings →
Environment Variables* in Vercel.

Any static file server will serve the front end, but every TMDB call goes through
`/api`, so the reel and the quiz both need `vercel dev` (or a deployment) to work.

## Tests

```bash
npm test
```

Covers the pure recommendation logic in `filters.js` — genre combination, the
year-window guard, shuffling, and the flavour text. Two of these exist because
the corresponding bugs shipped: genres were AND-combined instead of OR-combined,
and contradictory year windows produced queries no film could satisfy.

## Layout

| File | Role |
| --- | --- |
| `index.html` | Markup only |
| `styles.css` | All styling |
| `app.js` | Screen flow, history, result rendering, trailer modal |
| `reel.js` | WebGL poster cylinder (three.js) |
| `tmdb.js` | API access, local caching |
| `filters.js` | Pure recommendation logic — the tested part |
| `questions.js` | Question pool + genre names |
| `api/tmdb/[...path].js` | Serverless TMDB proxy |
| `vendor/` | Pinned three.js + GSAP |

## Notes

**The token is server-side.** `api/tmdb/[...path].js` attaches it and allowlists
the four endpoints the app uses. Nothing credential-shaped reaches the browser.
An earlier version inlined the token in `index.html`; if you are rotating keys,
assume that one is public and burn it.

**Dependencies are vendored.** three.js and GSAP live in `vendor/` rather than
loading from a CDN. Subresource integrity can't be applied to a bare ESM
`import`, so self-hosting is the only way to guarantee what executes — and it
lets the site ship `script-src 'self'` with no exceptions. To upgrade:

```bash
npm pack three@<version> && tar xzf three-<version>.tgz
cp package/build/three.module.min.js vendor/
```

**Social preview.** `og:image` is a relative URL so it resolves against whatever
domain serves the page. If a specific crawler insists on an absolute URL, make it
absolute against the production domain.

**Reduced motion is honoured.** `prefers-reduced-motion: reduce` drops the intro
cascade, the poster shimmer, the ambient CTA breathing, and the drifting
background art. Snapping and transitions stay — they carry state.
