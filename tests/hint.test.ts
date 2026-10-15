import { describe, expect, it } from "vitest";
import { GRAPH } from "@/lib/graph";
import { hintFor, sortTitle } from "@/lib/hint";
import { ALL_PAIRS } from "@/lib/pairs";

const SHAPE =
  /^One shortest route ends through .+, linked to the goal by (an actor|its director)( whose name starts with [A-Z]–[A-Z])?\.$/;

function parts(pair: (typeof ALL_PAIRS)[number]) {
  const ids = pair.samplePathIds[0];
  return {
    before: GRAPH.films[ids[ids.length - 3]],
    person: GRAPH.people[ids[ids.length - 2]],
    role: GRAPH.films[pair.goal.id].people.find((p) => p.id === ids[ids.length - 2])?.role,
  };
}

const inRange = (letter: string, a: string, b: string) => letter.toUpperCase() >= a && letter.toUpperCase() <= b;

describe("hintFor", () => {
  it("is one vague sentence for every pair", () => {
    for (const pair of ALL_PAIRS) expect(hintFor(pair)).toMatch(SHAPE);
  });

  it("uses 'an' before vowels (an Action film, a Drama film)", () => {
    for (const pair of ALL_PAIRS) {
      const hint = hintFor(pair);
      expect(hint, hint).not.toMatch(/\ba (?!one-word)[aeiou]/i); // "a one-word title" is right: "one" sounds like "won"
      expect(hint, hint).not.toMatch(/\ban [^aeiou\s]/i);
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

  it("is the same for the same pair, so both players in a race get the same hint", () => {
    for (const pair of ALL_PAIRS) expect(hintFor(pair)).toBe(hintFor(pair));
  });

  it("varies from pair to pair and uses every kind of clue", () => {
    const hints = ALL_PAIRS.map(hintFor);
    expect(new Set(hints).size).toBeGreaterThan(150);
    expect(hints.some((h) => /title starts with/.test(h))).toBe(true);
    expect(hints.some((h) => /(one|two|three)-word title|long title/.test(h))).toBe(true);
    expect(hints.some((h) => /name starts with/.test(h))).toBe(true);
    expect(hints.some((h) => /a \d{4}s \w[\w ]* film,/.test(h))).toBe(true);
  });

  it("every clue is true of the film before the goal and of the person who links it", () => {
    for (const pair of ALL_PAIRS) {
      const hint = hintFor(pair);
      const { before, person, role } = parts(pair);

      const decade = hint.match(/(\d{4})s/);
      if (decade) expect(Number(decade[1])).toBe(Math.floor(Number(before.year) / 10) * 10);

      const title = hint.match(/title starts with ([A-Z])–([A-Z])/);
      if (title) expect(inRange(sortTitle(before.title)[0], title[1], title[2]), before.title).toBe(true);

      const name = hint.match(/name starts with ([A-Z])–([A-Z])/);
      if (name) expect(inRange(person.name[0], name[1], name[2]), person.name).toBe(true);

      expect(hint).toContain(role === "director" ? "its director" : "an actor");
    }
  });

  it("ignores a leading article when judging a title", () => {
    expect(sortTitle("The Matrix")).toBe("Matrix");
    expect(sortTitle("A Beautiful Mind")).toBe("Beautiful Mind");
    expect(sortTitle("Up")).toBe("Up");
  });
});
