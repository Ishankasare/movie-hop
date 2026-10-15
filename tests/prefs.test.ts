import { describe, expect, it } from "vitest";
import { parsePrefs, prefsToQuery } from "@/lib/prefs";

describe("parsePrefs", () => {
  it("returns 'any' for missing or corrupt storage", () => {
    expect(parsePrefs(null)).toEqual({});
    expect(parsePrefs("not json")).toEqual({});
    expect(parsePrefs("42")).toEqual({});
    expect(parsePrefs("null")).toEqual({});
  });
  it("reads valid genre and hops", () => {
    expect(parsePrefs('{"genre":28,"hops":3}')).toEqual({ genre: 28, hops: 3 });
  });
  it("drops invalid values", () => {
    expect(parsePrefs('{"genre":"28","hops":6}')).toEqual({});
    expect(parsePrefs('{"genre":1.5}')).toEqual({});
  });
  it("drops a genre that is no longer in the data", () => {
    expect(parsePrefs('{"genre":28,"hops":2}', [35])).toEqual({ hops: 2 });
  });
});

describe("prefsToQuery", () => {
  it("builds the /play query string", () => {
    expect(prefsToQuery({})).toBe("");
    expect(prefsToQuery({ genre: 28 })).toBe("?genre=28");
    expect(prefsToQuery({ genre: 28, hops: 4 })).toBe("?genre=28&hops=4");
    expect(prefsToQuery({ hops: 3 })).toBe("?hops=3");
  });
});
