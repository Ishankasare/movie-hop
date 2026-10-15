import { z } from "zod";
import rawPairs from "@/data/pairs.json";
import { categoryName, inCategory, isUniverse, UNIVERSES } from "./categories";

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
export type PairFilter = { category?: string; hops?: HopBand };

export function parsePairs(input: unknown): Pair[] {
  return z.array(pairSchema).parse(input);
}

export const ALL_PAIRS: Pair[] = parsePairs(rawPairs);

export function pairKey(pair: Pair): string {
  return `${pair.start.id}-${pair.goal.id}`;
}

/** Category = a genre or universe of the GOAL film (see lib/categories.ts). Hops = exact shortest-path length. */
export function filterPairs(pairs: Pair[], filter: PairFilter = {}): Pair[] {
  return pairs.filter(
    (p) =>
      (filter.category === undefined || inCategory(p.goal, filter.category)) &&
      (filter.hops === undefined || p.minHops === filter.hops),
  );
}

export type CategoryOption = {
  key: string;
  name: string;
  /** Universes (Marvel, DC, …) are shown separately from the plain genres. */
  universe: boolean;
  count: number;
  /** Posters of the most common goal films in this category, for the picker tile. */
  posters: string[];
};

/** A category needs this many pairs (2 per hop band) to be offered at all. */
export const MIN_PAIRS_PER_CATEGORY = 6;

/** Universes first (in their fixed order), then genres A–Z. Categories with too few pairs are left out. */
export function availableCategories(pairs: Pair[]): CategoryOption[] {
  const keys = new Set<string>(UNIVERSES.map((u) => u.key));
  for (const p of pairs) for (const g of p.goal.genres ?? []) keys.add(`g${g}`);

  // each category's goal posters, most common goals first
  const ranked = new Map<string, { posters: string[]; count: number }>();
  for (const key of keys) {
    const inCat = pairs.filter((p) => inCategory(p.goal, key));
    if (inCat.length < MIN_PAIRS_PER_CATEGORY) continue;
    const byGoal = new Map<number, { poster: string; n: number }>();
    for (const p of inCat) {
      if (!p.goal.poster) continue;
      const e = byGoal.get(p.goal.id) ?? { poster: p.goal.poster, n: 0 };
      e.n++;
      byGoal.set(p.goal.id, e);
    }
    ranked.set(key, {
      posters: [...byGoal.values()].sort((a, b) => b.n - a.n).map((e) => e.poster),
      count: inCat.length,
    });
  }

  // Famous goals fit many genres (The Avengers is Action, Adventure and Sci-Fi), so hand out posters
  // so that tiles don't all show the same film: universes first, then the smallest genres.
  const used = new Set<string>();
  const take = (candidates: string[], n: number): string[] => {
    const picked = candidates.filter((p) => !used.has(p)).slice(0, n);
    for (const p of candidates) if (picked.length < n && !picked.includes(p)) picked.push(p); // all taken: reuse
    picked.forEach((p) => used.add(p));
    return picked;
  };
  const posterFor = new Map<string, string[]>();
  const assignOrder = [...ranked.keys()].sort((a, b) => {
    const ua = isUniverse(a), ub = isUniverse(b);
    return ua !== ub ? (ua ? -1 : 1) : ranked.get(a)!.count - ranked.get(b)!.count;
  });
  for (const key of assignOrder) posterFor.set(key, take(ranked.get(key)!.posters, isUniverse(key) ? 3 : 1));

  const options: CategoryOption[] = [];
  for (const [key, r] of ranked) {
    options.push({ key, name: categoryName(key), universe: isUniverse(key), count: r.count, posters: posterFor.get(key)! });
  }
  const order = (o: CategoryOption) => UNIVERSES.findIndex((u) => u.key === o.key);
  return options.sort((a, b) =>
    a.universe !== b.universe ? (a.universe ? -1 : 1) : a.universe ? order(a) - order(b) : a.name.localeCompare(b.name),
  );
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
