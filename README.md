# Movie Hop

Hop from a start film to a goal film through the actors and directors they share
(film → person → film). Fewest hops wins. Play solo, or race a friend in real time.

Built with Next.js (App Router), TypeScript, Tailwind, Supabase (realtime race) and TMDB data.

## Run it

```bash
npm install
cp .env.example .env.local      # then fill in the values below
npm run dev                     # http://localhost:3000
```

| Variable | Needed for | Public? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | the race (project URL, no path) | yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the race (publishable / anon key) | yes (protected by row level security) |
| `TMDB_KEY` | only `node precompute_credit_pairs.mjs` | **no**: never expose it |

The game itself makes no TMDB calls at runtime: all films, people and pairs ship as static data
(`data/graph.json`, `data/pairs.json`). Solo play works without any Supabase settings.

## Tests

```bash
npm run lint
npm run typecheck
npm test            # unit tests
npm run test:e2e    # Playwright (builds and serves the app; the race test needs Supabase settings)
npm run test:db     # database function tests against your real Supabase project
```

## The race (Supabase)

1. Create a Supabase project, switch on **Authentication → Sign In / Providers → Allow anonymous sign-ins**.
2. Run `supabase/migrations/0001_race.sql` once in the **SQL Editor**.
3. Put the project URL and the anon key in `.env.local` (and in your host's environment variables).

Players are anonymous (a nickname, no accounts). Clients can only read their own room; every
write goes through database functions that use the server clock and lock the room.

## Regenerating the game data

```bash
node precompute_credit_pairs.mjs                      # reads TMDB_KEY from .env.local
DISCOVER_PAGES=120 PER_CELL=10 node precompute_credit_pairs.mjs   # bigger film set, more pairs
```

It builds the film ↔ cast/director graph from TMDB credits (famous connectors only), tags
Marvel / DC / Disney / saga films, and writes pairs for every goal genre and hop band.

## Deploying

Import the repo into Vercel (Next.js is detected automatically) and set the two `NEXT_PUBLIC_SUPABASE_*`
variables. `TMDB_KEY` is not needed there.

## Credits

This product uses the TMDB API but is not endorsed or certified by [TMDB](https://www.themoviedb.org/).
TMDB's free API and Vercel's free Hobby plan are for non-commercial use.
