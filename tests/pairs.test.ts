import { describe, expect, it } from "vitest";
import {
  ALL_PAIRS,
  availableCategories,
  filterPairs,
  MIN_PAIRS_PER_CATEGORY,
  pairKey,
  parsePairs,
  pickPair,
  routesOf,
  type Pair,
} from "@/lib/pairs";

const base = (
  over: { startId?: number; goalGenres?: number[]; goalTags?: ("marvel" | "dc" | "disney" | "saga")[]; minHops?: number } = {},
): Pair => ({
  start: { id: over.startId ?? 1, title: "A", year: "2000", poster: "/a.jpg" },
  goal: { id: 2, title: "B", year: "2001", poster: "/b.jpg", genres: over.goalGenres, tags: over.goalTags },
  minHops: over.minHops ?? 2,
  samplePath: ["A", "Actor", "B"],
  samplePathIds: [[1, 9, 2]],
});

describe("pairs.json data", () => {
  it("validates with the zod schema", () => {
    expect(ALL_PAIRS.length).toBeGreaterThan(0);
  });

  it("has 1–2 routes per pair, each 2*minHops+1 steps (film, person, film, …) from start to goal", () => {
    for (const pair of ALL_PAIRS) {
      const routes = routesOf(pair);
      expect(routes.length).toBeGreaterThanOrEqual(1);
      expect(routes.length).toBeLessThanOrEqual(2);
      expect(pair.samplePathIds).toHaveLength(routes.length);
      for (const route of routes) {
        expect(route).toHaveLength(2 * pair.minHops + 1);
        expect(route[0]).toBe(pair.start.title);
        expect(route[route.length - 1]).toBe(pair.goal.title);
      }
      for (const ids of pair.samplePathIds) {
        expect(ids[0]).toBe(pair.start.id);
        expect(ids[ids.length - 1]).toBe(pair.goal.id);
      }
    }
  });

  it("keeps hops within the 2–4 band", () => {
    for (const p of ALL_PAIRS) expect([2, 3, 4]).toContain(p.minHops);
  });
});

describe("parsePairs", () => {
  it("accepts a pair without genres or a second route", () => {
    const [p] = parsePairs([base()]);
    expect(p.start.genres).toBeUndefined();
    expect(routesOf(p)).toEqual([p.samplePath]);
  });

  it("rejects bad data", () => {
    expect(() => parsePairs([{ ...base(), minHops: 6 }])).toThrow();
    expect(() => parsePairs([{ ...base(), samplePathIds: undefined }])).toThrow();
    expect(() => parsePairs([{ start: {} }])).toThrow();
  });
});

describe("filterPairs (goal genre / universe)", () => {
  const pairs = [
    base({ startId: 1, goalGenres: [28, 12], goalTags: ["marvel"], minHops: 2 }),
    base({ startId: 3, goalGenres: [35], minHops: 3 }),
    base({ startId: 4, goalGenres: [28], goalTags: ["dc"], minHops: 4 }),
  ];

  it("matches ANY of the goal film's genres, not just the first", () => {
    expect(filterPairs(pairs, { category: "g28" }).map((p) => p.start.id)).toEqual([1, 4]);
    expect(filterPairs(pairs, { category: "g12" }).map((p) => p.start.id)).toEqual([1]);
  });
  it("matches universes by the goal film's tags", () => {
    expect(filterPairs(pairs, { category: "marvel" }).map((p) => p.start.id)).toEqual([1]);
    expect(filterPairs(pairs, { category: "dc" }).map((p) => p.start.id)).toEqual([4]);
    expect(filterPairs(pairs, { category: "saga" })).toEqual([]);
  });
  it("ignores the start film's genres", () => {
    const p = base({ goalGenres: [35] });
    p.start.genres = [28];
    expect(filterPairs([p], { category: "g28" })).toEqual([]);
  });
  it("filters by hop band and combines both", () => {
    expect(filterPairs(pairs, { hops: 3 }).map((p) => p.start.id)).toEqual([3]);
    expect(filterPairs(pairs, { category: "g28", hops: 4 }).map((p) => p.start.id)).toEqual([4]);
    expect(filterPairs(pairs, { category: "g35", hops: 4 })).toEqual([]);
  });
});

describe("availableCategories", () => {
  it("offers only categories with enough pairs, universes first then genres A–Z", () => {
    const many = (n: number, over: Parameters<typeof base>[0]) =>
      Array.from({ length: n }, (_, i) => base({ ...over, startId: 100 + i }));
    const options = availableCategories([
      ...many(MIN_PAIRS_PER_CATEGORY, { goalGenres: [35], goalTags: ["dc"] }),
      ...many(MIN_PAIRS_PER_CATEGORY, { goalGenres: [28] }),
      ...many(MIN_PAIRS_PER_CATEGORY - 1, { goalGenres: [27] }), // too few: left out
    ]);
    expect(options.map((o) => o.key)).toEqual(["dc", "g28", "g35"]);
    expect(options[0]).toMatchObject({ name: "DC", universe: true, count: MIN_PAIRS_PER_CATEGORY });
    expect(options[1]).toMatchObject({ name: "Action", universe: false });
    expect(options[0].posters.length).toBeGreaterThan(0);
  });

  it("gives every tile its own poster, so the grid doesn't show the same film twice", () => {
    const options = availableCategories(ALL_PAIRS);
    const shown = options.flatMap((o) => o.posters);
    expect(new Set(shown).size).toBe(shown.length);
  });

  it("covers every goal genre and universe in the real data with at least one pair per hop band", () => {
    const options = availableCategories(ALL_PAIRS);
    expect(options.filter((o) => o.universe).map((o) => o.key)).toEqual(["marvel", "dc", "disney", "saga"]);
    for (const o of options) {
      for (const hops of [2, 3, 4] as const) {
        expect(filterPairs(ALL_PAIRS, { category: o.key, hops }).length, `${o.name} @ ${hops}`).toBeGreaterThan(0);
      }
    }
  });
});

describe("pickPair", () => {
  const pairs = [base({ startId: 1 }), base({ startId: 2 }), base({ startId: 3 })];

  it("returns undefined for no pairs", () => {
    expect(pickPair([])).toBeUndefined();
  });
  it("avoids recently played pairs", () => {
    const recent = [pairKey(pairs[0]), pairKey(pairs[1])];
    for (const r of [0, 0.5, 0.99]) expect(pickPair(pairs, recent, () => r)).toBe(pairs[2]);
  });
  it("falls back to any pair when all were recent", () => {
    const recent = pairs.map(pairKey);
    expect(pickPair(pairs, recent, () => 0)).toBe(pairs[0]);
  });
  it("never indexes out of range when rng returns 1", () => {
    expect(pickPair(pairs, [], () => 1)).toBe(pairs[2]);
  });
});
