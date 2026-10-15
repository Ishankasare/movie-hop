import { describe, expect, it } from "vitest";
import { isUniverse, parseCategory } from "@/lib/categories";
import { parsePrefs, prefsToQuery } from "@/lib/prefs";

describe("parsePrefs", () => {
  it("returns 'any' for missing or corrupt storage", () => {
    expect(parsePrefs(null)).toEqual({});
    expect(parsePrefs("not json")).toEqual({});
    expect(parsePrefs("42")).toEqual({});
    expect(parsePrefs("null")).toEqual({});
  });
  it("reads a valid category and hops", () => {
    expect(parsePrefs('{"category":"marvel","hops":3}')).toEqual({ category: "marvel", hops: 3 });
    expect(parsePrefs('{"category":"g28"}')).toEqual({ category: "g28" });
  });
  it("drops invalid values, including the old start-genre format", () => {
    expect(parsePrefs('{"category":"nonsense","hops":6}')).toEqual({});
    expect(parsePrefs('{"category":28}')).toEqual({});
    expect(parsePrefs('{"genre":28,"hops":3}')).toEqual({ hops: 3 });
  });
  it("drops a category that is no longer offered", () => {
    expect(parsePrefs('{"category":"dc","hops":2}', ["marvel"])).toEqual({ hops: 2 });
  });
});

describe("prefsToQuery", () => {
  it("builds the /play query string", () => {
    expect(prefsToQuery({})).toBe("");
    expect(prefsToQuery({ category: "marvel" })).toBe("?cat=marvel");
    expect(prefsToQuery({ category: "g28", hops: 4 })).toBe("?cat=g28&hops=4");
    expect(prefsToQuery({ hops: 3 })).toBe("?hops=3");
  });
});

describe("parseCategory", () => {
  it("accepts universes and genre keys only", () => {
    expect(parseCategory("saga")).toBe("saga");
    expect(parseCategory("g878")).toBe("g878");
    for (const bad of [null, undefined, "", "g", "g1x", "genre28", "Marvel", "28"]) expect(parseCategory(bad)).toBeUndefined();
    expect(isUniverse("disney")).toBe(true);
    expect(isUniverse("g28")).toBe(false);
  });
});
