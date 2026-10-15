import { describe, expect, it } from "vitest";
import { pairKey } from "@/lib/pairs";
import {
  choosePair,
  cleanNickname,
  countdown,
  findPair,
  formatMs,
  friendlyError,
  isValidCode,
  matchView,
  msUntil,
  normalizeCode,
  opponentPresence,
  parseSnapshot,
  randomNickname,
  roundView,
  seats,
  serverOffset,
  type RoomPlayer,
  type RoundResult,
} from "@/lib/race";

const player = (id: string, seat: number, over: Partial<RoomPlayer> = {}): RoomPlayer => ({
  player_id: id,
  nickname: id.toUpperCase(),
  seat,
  ready: false,
  moves: 0,
  hints: 0,
  rematch: false,
  last_seen: "2026-01-01T00:00:00.000Z",
  ...over,
});
const A = player("a", 0);
const B = player("b", 1);
const res = (id: string, round: number, ms: number | null, outcome: RoundResult["outcome"] = "finished"): RoundResult => ({
  player_id: id,
  match_no: 1,
  round_no: round,
  outcome,
  ms,
  hints: 0,
  moves: 3,
});

describe("server clock and countdown", () => {
  const start = "2026-01-01T00:00:10.000Z";
  const at = (s: number) => new Date("2026-01-01T00:00:00.000Z").getTime() + s * 1000;

  it("measures the offset between server and client clocks", () => {
    // client clock runs 2 s behind the server
    expect(serverOffset("2026-01-01T00:00:05.000Z", at(3))).toBe(2000);
    expect(msUntil(start, 2000, at(3))).toBe(5000);
  });

  it("shows nothing until 3 s before the start, then 3, 2, 1, GO", () => {
    expect(countdown(start, 0, at(5))).toEqual({ phase: "wait", n: 0 });
    expect(countdown(start, 0, at(7.5))).toEqual({ phase: "count", n: 3 });
    expect(countdown(start, 0, at(8.5))).toEqual({ phase: "count", n: 2 });
    expect(countdown(start, 0, at(9.5))).toEqual({ phase: "count", n: 1 });
    expect(countdown(start, 0, at(10))).toEqual({ phase: "go", n: 0 });
    expect(countdown(start, 0, at(12))).toEqual({ phase: "go", n: 0 });
  });

  it("uses the server's clock, so two players with different clocks see the same number", () => {
    const hostNow = at(8.5);
    const guestNow = at(6.5); // guest's clock is 2 s slow...
    expect(countdown(start, 0, hostNow)).toEqual(countdown(start, 2000, guestNow)); // ...and corrected by its offset
  });
});

describe("rounds", () => {
  it("the lower time wins a round", () => {
    const v = roundView([res("a", 1, 40_000), res("b", 1, 52_000)], [A, B], 1);
    expect(v).toMatchObject({ complete: true, winnerId: "a", tie: false });
  });

  it("equal times tie", () => {
    expect(roundView([res("a", 1, 40_000), res("b", 1, 40_000)], [A, B], 1)).toMatchObject({ winnerId: null, tie: true });
  });

  it("is incomplete until both players have a time", () => {
    const v = roundView([res("a", 1, 40_000)], [A, B], 1);
    expect(v.complete).toBe(false);
    expect(v.winnerId).toBeNull();
    expect(v.rows[1].outcome).toBe("pending");
  });

  it("only looks at the requested round", () => {
    const v = roundView([res("a", 1, 1000), res("b", 1, 2000), res("a", 2, 9000), res("b", 2, 3000)], [A, B], 2);
    expect(v.winnerId).toBe("b");
  });
});

describe("match totals", () => {
  const results = [
    res("a", 1, 40_000), res("b", 1, 52_000), // a wins round 1
    res("a", 2, 90_000, "gaveup"), res("b", 2, 70_000), // b wins round 2 (a gave up: scored the cap)
  ];

  it("adds up times; the lowest total wins, not the most round wins", () => {
    const m = matchView(results, [A, B]);
    expect(m.rows).toEqual([
      { playerId: "a", nickname: "A", totalMs: 130_000, roundWins: 1 },
      { playerId: "b", nickname: "B", totalMs: 122_000, roundWins: 1 },
    ]);
    expect(m.winnerId).toBe("b");
    expect(m.byForfeit).toBe(false);
  });

  it("a total-time tie is a draw", () => {
    const m = matchView([res("a", 1, 10_000), res("b", 1, 10_000)], [A, B]);
    expect(m).toMatchObject({ winnerId: null, tie: true });
  });

  it("a forfeit overrides the times", () => {
    expect(matchView(results, [A, B], "a")).toMatchObject({ winnerId: "a", byForfeit: true });
  });

  it("ignores a round that isn't complete", () => {
    const m = matchView([res("a", 1, 10_000), res("b", 1, 20_000), res("a", 2, 5_000)], [A, B]);
    expect(m.rows.map((r) => r.totalMs)).toEqual([10_000, 20_000]);
  });
});

describe("opponent presence", () => {
  const base = new Date("2026-01-01T00:00:00.000Z").getTime();
  const opp = player("b", 1, { last_seen: "2026-01-01T00:00:00.000Z" });

  it("is fine while heartbeats arrive", () => {
    expect(opponentPresence(opp, 0, base + 6000)).toEqual({ away: false, canForfeit: false, silentMs: 6000 });
  });
  it("shows 'away' after 12 s and allows a forfeit after 20 s (the server checks the same 20 s)", () => {
    expect(opponentPresence(opp, 0, base + 13_000)).toMatchObject({ away: true, canForfeit: false });
    expect(opponentPresence(opp, 0, base + 20_000)).toMatchObject({ away: true, canForfeit: true });
  });
  it("copes with no opponent yet", () => {
    expect(opponentPresence(undefined, 0, base)).toEqual({ away: false, canForfeit: false, silentMs: 0 });
  });
  it("finds me and my opponent", () => {
    expect(seats([A, B], "b")).toEqual({ me: B, opponent: A });
  });
});

describe("pairs", () => {
  it("chooses a pair in the right category and hop band, avoiding played ones", () => {
    const first = choosePair("marvel", 3, [], () => 0)!;
    expect(first.minHops).toBe(3);
    expect(first.goal.tags).toContain("marvel");
    const second = choosePair("marvel", 3, [pairKey(first)], () => 0)!;
    expect(pairKey(second)).not.toBe(pairKey(first));
  });
  it("any category / any band when none is given", () => {
    expect(choosePair(undefined, null, [])).toBeDefined();
  });
  it("finds a pair by the key the server stores", () => {
    const p = choosePair(undefined, 2, [])!;
    expect(findPair(pairKey(p))).toBe(p);
    expect(findPair("1-1")).toBeUndefined();
    expect(findPair(null)).toBeUndefined();
  });
});

describe("codes, nicknames, formatting, errors", () => {
  it("normalises room codes", () => {
    expect(normalizeCode(" ab-c2d3e4 ")).toBe("ABC2D");
    expect(normalizeCode("o0i1l")).toBe("L"); // look-alikes are not in the alphabet
    expect(isValidCode("ABC2D")).toBe(true);
    expect(isValidCode("ABC2")).toBe(false);
    expect(isValidCode("abc2d")).toBe(false);
  });
  it("cleans nicknames", () => {
    expect(cleanNickname("  Ishan   K  ")).toBe("Ishan K");
    expect(cleanNickname("x".repeat(40))).toHaveLength(16);
    expect(randomNickname(() => 0)).toBe("Guest100");
    expect(randomNickname(() => 0.999)).toBe("Guest999");
  });
  it("formats times", () => {
    expect(formatMs(0)).toBe("0:00.0");
    expect(formatMs(83_450)).toBe("1:23.4");
    expect(formatMs(15_692)).toBe("0:15.6");
  });
  it("turns server error codes into friendly text", () => {
    expect(friendlyError("room_full")).toMatch(/two players/);
    expect(friendlyError("Could not find the function public.x")).toMatch(/Something went wrong/);
    expect(friendlyError(undefined)).toMatch(/Something went wrong/);
  });
});

describe("snapshot parsing", () => {
  const room = {
    code: "ABC2D", host_id: "a", status: "picking", rounds_total: 2, band: null, match_no: 1, round_no: 1,
    picker_id: "a", category: null, pair_key: null, used_pairs: [], start_at: null, first_finish_ms: null,
    deadline_at: null, forfeit_winner: null,
  };
  it("accepts what room_snapshot returns", () => {
    const s = parseSnapshot({ now: "2026-01-01T00:00:00Z", room, players: [A, B], results: [res("a", 1, 5)] });
    expect(s.room.status).toBe("picking");
    expect(s.players).toHaveLength(2);
  });
  it("rejects a malformed snapshot", () => {
    expect(() => parseSnapshot({ now: "x", room: { ...room, status: "nope" }, players: [], results: [] })).toThrow();
    expect(() => parseSnapshot(null)).toThrow();
  });
});
