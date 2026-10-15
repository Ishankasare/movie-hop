# Movie Speedrun — build brief for Claude Code

Hand this whole file to Claude Code in your project folder as the spec. It captures
every decision already made so you don't re-explain. Build in this order; each step
is shippable before the next.

## What it is
A web game: you're given a START film and a GOAL film. From the start you see its
"similar movies" and click one to hop to it; its similar movies appear; repeat until
you reach the goal. Fewest hops / fastest time wins. Solo first, then race-a-friend.

## Hard rules (learned from a validated playtest — do not relax these)
- **Pairs are precomputed offline**, never generated live. `pairs.json` (from
  `precompute_pairs.mjs`) is the source of truth for rounds.
- **Difficulty floor 4, ceiling 6 hops** (shortest path). Below 4 is trivial, above 6 is a slog.
- **Every film on the shortest path must be recognizable** (vote_count ≥ ~800). A path
  through obscure films is unsolvable by instinct and kills the fun. The precompute
  already enforces this — the game must only serve pairs from `pairs.json`.
- **Dedupe remakes/same-title** so a player can't hop between two versions of one film
  (precompute strips these; keep it that way if you add any live logic).
- Keep the head-to-head race **clean — no ads mid-race.**

## Data
- **Source: TMDB.** Free API key, non-commercial for now. `/movie/{id}/recommendations`
  is the graph (behaviour-driven, better than `/similar`). Posters:
  `https://image.tmdb.org/t/p/w185{poster_path}`.
- **At runtime the game makes ONE call per click** — fetch the current film's
  recommendations when the player lands on it. That's cheap and fine. Do NOT run
  breadth-first search live.
- `minHops` for "best possible" comes from `pairs.json`, not live computation.
- Licensing: TMDB is free non-commercial. Only when you add subscriptions/ads do you
  need a commercial agreement — sort that at monetization time, not now.

## Stack (already decided)
- **Next.js (App Router) + TypeScript**, deploy on **Vercel** free tier.
- **Supabase** for auth (optional at first) and realtime multiplayer rooms.
- Keep the TMDB key server-side (a Next route handler proxies TMDB) so it isn't exposed
  in the client bundle.

## Build order
1. **Solo game, client-only.** Load `pairs.json`, pick a pair, play by fetching
   recommendations per click through a `/api/recs/[id]` route. Show current film + poster,
   clickable recommendation grid, hop counter, timer, breadcrumb path, Back button, and a
   win screen with your hops vs. `minHops` and time. (This is the prototype you already
   played, rebuilt properly.)
2. **Genre/difficulty picker.** Filter `pairs.json` by the start film's genre and by
   hop band so the player can choose.
3. **Multiplayer race.** Supabase realtime: host creates a room code, both players get the
   SAME pair, live hop-count/progress, first to the goal wins. One pair, two players,
   shared timer.
4. **Polish + deploy.** Vercel. Then it's ready for the TikTok format test.

## Monetization (later, not now)
Freemium: solo + 2-player free; paid unlocks group rooms (3+), cosmetics, custom pairs,
stats. Don't build the paywall until the core loop has real players.

## Files you're starting with
- `precompute_pairs.mjs` — run `TMDB_KEY=... node precompute_pairs.mjs` to produce
  `pairs.json`. Re-run periodically to refresh/expand the pair set.
- `pairs.json` — the round data (generate it first, before building the UI).
