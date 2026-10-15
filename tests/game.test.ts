import { describe, expect, it } from "vitest";
import { filmById, personById } from "@/lib/graph";
import { gameReducer, initialState, movesBreakdown } from "@/lib/game";
import { ALL_PAIRS } from "@/lib/pairs";
import type { Film, Person } from "@/lib/types";

const film = (id: number, title = `Film ${id}`): Film => ({ id, title, year: "2000", poster: "/p.jpg" });
const person: Person = { id: 7, name: "Some Actor", photo: null };
const GOAL = 99;
const hop = (id: number) => ({ type: "hop" as const, film: film(id), via: person, goalId: GOAL });

describe("gameReducer", () => {
  it("starts at the start film with no moves", () => {
    expect(initialState(film(1))).toEqual({ path: [film(1)], via: [], moves: 0, hintUsed: false, won: false });
  });

  it("hop appends the film and the person used, and counts a move", () => {
    const s = gameReducer(initialState(film(1)), hop(2));
    expect(s.path.map((f) => f.id)).toEqual([1, 2]);
    expect(s.via).toEqual([person]);
    expect(s.moves).toBe(1);
    expect(s.won).toBe(false);
  });

  it("wins when the film reached is the goal", () => {
    expect(gameReducer(initialState(film(1)), hop(GOAL)).won).toBe(true);
  });

  it("Back removes the last film and person and counts as a move", () => {
    let s = gameReducer(initialState(film(1)), hop(2));
    s = gameReducer(s, { type: "back" });
    expect(s.path.map((f) => f.id)).toEqual([1]);
    expect(s.via).toEqual([]);
    expect(s.moves).toBe(2);
  });

  it("Back at the start is a no-op (same state, no move)", () => {
    const s = initialState(film(1));
    expect(gameReducer(s, { type: "back" })).toBe(s);
  });

  it("does nothing after a win", () => {
    const won = gameReducer(initialState(film(1)), hop(GOAL));
    expect(gameReducer(won, hop(5))).toBe(won);
    expect(gameReducer(won, { type: "back" })).toBe(won);
  });

  it("movesBreakdown separates hops from Back presses", () => {
    let s = initialState(film(1));
    s = gameReducer(s, hop(2));
    s = gameReducer(s, hop(3));
    s = gameReducer(s, { type: "back" });
    expect(movesBreakdown(s)).toEqual({ hops: 2, backs: 1 });
  });

  it("the hint costs one move and works only once", () => {
    const s0 = initialState(film(1));
    const s1 = gameReducer(s0, { type: "hint" });
    expect(s1).toMatchObject({ moves: 1, hintUsed: true });
    expect(s1.path).toEqual(s0.path);
    expect(gameReducer(s1, { type: "hint" })).toBe(s1);
  });

  it("the hint can't be used after a win, and movesBreakdown ignores it", () => {
    let s = gameReducer(initialState(film(1)), { type: "hint" });
    s = gameReducer(s, hop(2));
    s = gameReducer(s, { type: "back" });
    expect(s.moves).toBe(3);
    expect(movesBreakdown(s)).toEqual({ hops: 1, backs: 1 });
    const won = gameReducer(initialState(film(1)), hop(GOAL));
    expect(gameReducer(won, { type: "hint" })).toBe(won);
  });

  it("wins by walking either of a pair's routes, using real graph data", () => {
    const pair = ALL_PAIRS.find((p) => p.samplePathIds.length === 2);
    expect(pair, "data should contain a pair with two routes").toBeDefined();
    for (const route of pair!.samplePathIds) {
      let s = initialState(filmById(route[0])!);
      for (let i = 1; i < route.length; i += 2) {
        s = gameReducer(s, {
          type: "hop",
          film: filmById(route[i + 1])!,
          via: personById(route[i])!,
          goalId: pair!.goal.id,
        });
      }
      expect(s.won).toBe(true);
      expect(s.moves).toBe(pair!.minHops);
    }
  });
});
