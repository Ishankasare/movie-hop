import { describe, expect, it } from "vitest";
import { GRAPH, castOf, filmsOf } from "@/lib/graph";
import { ALL_PAIRS } from "@/lib/pairs";

describe("graph.json", () => {
  it("is symmetric: a person lists a film exactly when the film lists the person", () => {
    for (const [pid, person] of Object.entries(GRAPH.people)) {
      for (const fid of person.films) {
        expect(GRAPH.films[fid], `film ${fid} of person ${pid}`).toBeDefined();
        expect(GRAPH.films[fid].people.some((p) => String(p.id) === pid)).toBe(true);
      }
    }
    for (const [fid, film] of Object.entries(GRAPH.films)) {
      for (const { id } of film.people) {
        expect(GRAPH.people[id], `person ${id} of film ${fid}`).toBeDefined();
        expect(GRAPH.people[id].films).toContain(Number(fid));
      }
    }
  });

  it("castOf puts the director first, and filmsOf excludes the given film", () => {
    const withDirector = Object.keys(GRAPH.films).find((id) =>
      GRAPH.films[Number(id)].people.some((p) => p.role === "director"),
    )!;
    expect(castOf(Number(withDirector))[0].role).toBe("director");

    const [pid, person] = Object.entries(GRAPH.people)[0];
    const except = person.films[0];
    expect(filmsOf(Number(pid), except).map((f) => f.id)).not.toContain(except);
    expect(filmsOf(Number(pid)).length).toBe(person.films.length);
  });
});

describe("pairs vs graph", () => {
  // shortest film-hop distance between two films, over film -> person -> film links
  function distance(from: number, to: number): number {
    const seen = new Set([from]);
    let frontier = [from];
    for (let d = 1; frontier.length > 0; d++) {
      const next: number[] = [];
      for (const f of frontier)
        for (const { id: pid } of GRAPH.films[f].people)
          for (const nb of GRAPH.people[pid].films)
            if (!seen.has(nb)) {
              if (nb === to) return d;
              seen.add(nb);
              next.push(nb);
            }
      frontier = next;
    }
    return Infinity;
  }

  it("every route is a real chain of film-person links with matching names", () => {
    for (const pair of ALL_PAIRS) {
      pair.samplePathIds.forEach((ids, r) => {
        const names = (pair.samplePaths ?? [pair.samplePath])[r];
        ids.forEach((id, i) => {
          if (i % 2 === 0) {
            expect(GRAPH.films[id], `film ${id}`).toBeDefined();
            expect(GRAPH.films[id].title).toBe(names[i]);
          } else {
            expect(GRAPH.people[id], `person ${id}`).toBeDefined();
            expect(GRAPH.people[id].name).toBe(names[i]);
            expect(GRAPH.people[id].films).toContain(ids[i - 1]);
            expect(GRAPH.people[id].films).toContain(ids[i + 1]);
          }
        });
      });
    }
  });

  it("minHops is the true shortest distance in the graph", () => {
    for (const pair of ALL_PAIRS) {
      expect(distance(pair.start.id, pair.goal.id), `${pair.start.title} -> ${pair.goal.title}`).toBe(pair.minHops);
    }
  });
});
