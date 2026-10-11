# Movie Oracle

Movie Oracle is a static browser app with Vercel serverless API routes for TMDB requests.

## Deployment

- Deploy the repository on Vercel so `/api/discover` and `/api/tmdb` are available.
- Configure `TMDB_ACCESS_TOKEN` as a server-side Vercel environment variable. Never expose it through browser configuration or a `NEXT_PUBLIC_*` variable.
- The API routes allow only the app's supported TMDB resources and discovery filters. They accept GET requests and apply a per-runtime, per-IP limit of 60 requests per minute. For deployments with multiple serverless instances, add a shared-store or edge rate limiter for a global quota.

## Tests

Run `npm test` with Node.js 20 or later.
