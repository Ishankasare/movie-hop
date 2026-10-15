import { z } from "zod";
import rawPairs from "@/data/pairs.json";
import { genreName } from "./genres";

const filmSchema = z.object({
  id: z.number().int().positive(),
  title: z.string().min(1),
  year: z.string(),
  poster: z.string().nullable(),
});

// genres are TMDB genre ids; older pairs.json files don't have them.
const endpointSchema = filmSchema.extend({
  genres: z.array(z.number().int()).optional(),
  // "universes" the film belongs to (goal films only): shown next to the genres in the picker
  tags: z.array(z.enum(["marvel", "dc", "disney", "saga"])).optional(),
});

const pairSchema = z.object({
  start: endpointSchema,
  goal: endpointSchema,
  // Films reached on a shortest route (film -> person -> film = 1 hop).
  minHops: z.number().int().min(2).max(4),
  // Shortest routes, alternating film / person: names for display, ids for checking against the graph.
  samplePath: z.array(z.string()).min(3),
  samplePaths: z.array(z.array(z.string()).min(3)).optional(),
  samplePathIds: z.array(z.array(z.number().int()).min(3)).min(1),
});

export type Pair = z.infer<typeof pairSchema>;
export type HopBand = 2 | 3 | 4;
export type PairFilter = { genre?: number; hops?: HopBand };

export function parsePairs(input: unknown): Pair[] {
  return z.array(pairSchema).parse(input);
}

export const ALL_PAIRS: Pair[] = parsePairs(rawPairs);

export function pairKey(pair: Pair): string {
  return `${pair.start.id}-${pair.goal.id}`;
}

/** Genre = the start film's first genre id. Hops = exact shortest-path length. */
export function filterPairs(pairs: Pair[], filter: PairFilter = {}): Pair[] {
  return pairs.filter(
    (p) =>
      (filter.genre === undefined || p.start.genres?.[0] === filter.genre) &&
      (filter.hops === undefined || p.minHops === filter.hops),
  );
}

export type GenreOption = { id: number; name: string; count: number };

/** Genres that have at least one pair. Empty when the data has no genres. */
export function availableGenres(pairs: Pair[]): GenreOption[] {
  const counts = new Map<number, number>();
  for (const p of pairs) {
    const g = p.start.genres?.[0];
    if (g !== undefined) counts.set(g, (counts.get(g) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([id, count]) => ({ id, name: genreName(id), count }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Picks a pair, preferring ones not in `recentKeys`; falls back to any if all were recent. */
export function pickPair(
  pairs: Pair[],
  recentKeys: string[] = [],
  rng: () => number = Math.random,
): Pair | undefined {
  if (pairs.length === 0) return undefined;
  const recent = new Set(recentKeys);
  const fresh = pairs.filter((p) => !recent.has(pairKey(p)));
  const pool = fresh.length > 0 ? fresh : pairs;
  return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
}

/** Up to 2 distinct shortest routes as names, alternating film, person, film, … */
export function routesOf(pair: Pair): string[][] {
  return pair.samplePaths && pair.samplePaths.length > 0
    ? pair.samplePaths
    : [pair.samplePath];
}

// ---- recently played (localStorage, last 20) ----

export const RECENT_KEY = "movie-hop:recent";
export const RECENT_MAX = 20;

export function loadRecent(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((k): k is string => typeof k === "string")
      : [];
  } catch {
    return [];
  }
}

export function rememberPair(pair: Pair): void {
  try {
    const next = [...loadRecent().filter((k) => k !== pairKey(pair)), pairKey(pair)];
    localStorage.setItem(RECENT_KEY, JSON.stringify(next.slice(-RECENT_MAX)));
  } catch {
    // storage unavailable (private mode etc.): just don't remember
  }
}
