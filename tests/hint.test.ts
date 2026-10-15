import { describe, expect, it } from "vitest";
import { GRAPH } from "@/lib/graph";
import { hintFor } from "@/lib/hint";
import { ALL_PAIRS } from "@/lib/pairs";

describe("hintFor", () => {
  it("is one vague sentence about decade, genre and link type for every pair", () => {
    for (const pair of ALL_PAIRS) {
      expect(hintFor(pair)).toMatch(
        /^One shortest route ends through a (\d{4}s )?(\S+( \S+)? )?film, linked to the goal by (an actor|its director)\.$/,
      );
    }
  });

  it("never names a film or a person", () => {
    for (const pair of ALL_PAIRS) {
      const hint = hintFor(pair).toLowerCase();
      for (const id of pair.samplePathIds.flat()) {
        const name = (GRAPH.films[id]?.title ?? GRAPH.people[id]?.name ?? "").toLowerCase();
        // short names like "Her" can't be told apart from prose, so only check longer ones
        if (name.length > 5) expect(hint, name).not.toContain(name);
      }
    }
  });

  it("describes the film just before the goal and the link into it", () => {
    const pair = ALL_PAIRS[0];
    const ids = pair.samplePathIds[0];
    const before = GRAPH.films[ids[ids.length - 3]];
    const decade = `${Math.floor(Number(before.year) / 10) * 10}s`;
    expect(hintFor(pair)).toContain(decade);
    const role = GRAPH.films[pair.goal.id].people.find((p) => p.id === ids[ids.length - 2])?.role;
    expect(hintFor(pair)).toContain(role === "director" ? "its director" : "an actor");
  });
});
