import { describe, expect, it } from "vitest";
import {
  ALL_PAIRS,
  availableGenres,
  filterPairs,
  pairKey,
  parsePairs,
  pickPair,
  routesOf,
  type Pair,
} from "@/lib/pairs";

const base = (over: { startId?: number; genres?: number[]; minHops?: number } = {}): Pair => ({
  start: { id: over.startId ?? 1, title: "A", year: "2000", poster: "/a.jpg", genres: over.genres },
  goal: { id: 2, title: "B", year: "2001", poster: null },
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

describe("filterPairs / availableGenres", () => {
  const pairs = [
    base({ startId: 1, genres: [28, 12], minHops: 2 }),
    base({ startId: 3, genres: [35], minHops: 3 }),
    base({ startId: 4, genres: [28], minHops: 4 }),
  ];

  it("filters by the start film's first genre", () => {
    expect(filterPairs(pairs, { genre: 28 }).map((p) => p.start.id)).toEqual([1, 4]);
  });
  it("filters by hop band and combines both", () => {
    expect(filterPairs(pairs, { hops: 3 }).map((p) => p.start.id)).toEqual([3]);
    expect(filterPairs(pairs, { genre: 28, hops: 4 }).map((p) => p.start.id)).toEqual([4]);
    expect(filterPairs(pairs, { genre: 35, hops: 4 })).toEqual([]);
  });
  it("lists genres with counts, and is empty when the data has no genres", () => {
    expect(availableGenres(pairs)).toEqual([
      { id: 28, name: "Action", count: 2 },
      { id: 35, name: "Comedy", count: 1 },
    ]);
    expect(availableGenres([base()])).toEqual([]);
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
