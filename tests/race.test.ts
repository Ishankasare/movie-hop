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
  activePlayers,
  canStart,
  matchView,
  msUntil,
  normalizeCode,
  opponentPresence,
  ordinal,
  othersPresence,
  placesFor,
  readiness,
  seatsLeft,
  parseSnapshot,
  pollIntervalMs,
  randomNickname,
  wantsRealtime,
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
  has_left: false,
  last_seen: "2026-01-01T00:00:00.000Z",
  ...over,
});
const A = player("a", 0);
const B = player("b", 1);
const C = player("c", 2);
const D = player("d", 3);
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
      { playerId: "a", nickname: "A", totalMs: 130_000, roundWins: 1, hasLeft: false },
      { playerId: "b", nickname: "B", totalMs: 122_000, roundWins: 1, hasLeft: false },
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
    expect(seats([A, B], "b")).toEqual({ me: B, opponent: A, opponents: [A] });
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
  it("writes places as 1st, 2nd, 3rd, 4th", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd"]);
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

describe("3 and 4 players", () => {
  const four = [A, B, C, D];

  it("places share a rank when times tie (1, 2, 2, 4)", () => {
    expect(placesFor([10, 20, 20, 40], (x) => x)).toEqual([1, 2, 2, 4]);
    expect(placesFor([5, 5, 5], (x) => x)).toEqual([1, 1, 1]);
    expect(placesFor([7], (x) => x)).toEqual([1]);
  });

  it("ranks a 4-player round, fastest first", () => {
    const v = roundView([res("a", 1, 50_000), res("b", 1, 30_000), res("c", 1, 90_000), res("d", 1, 41_000)], four, 1);
    expect(v.complete).toBe(true);
    expect(v.ordered.map((r) => r.playerId)).toEqual(["b", "d", "a", "c"]);
    expect(v.ranks).toEqual({ b: 1, d: 2, a: 3, c: 4 });
    expect(v.winnerId).toBe("b");
    expect(v.tie).toBe(false);
    expect(v.rows.map((r) => r.playerId)).toEqual(["a", "b", "c", "d"]); // seat order is kept too
  });

  it("a tie for first is a tie, a tie further down is not", () => {
    const top = roundView([res("a", 1, 30_000), res("b", 1, 30_000), res("c", 1, 90_000)], [A, B, C], 1);
    expect(top).toMatchObject({ tie: true, winnerId: null });
    expect(top.ranks).toEqual({ a: 1, b: 1, c: 3 });

    const low = roundView([res("a", 1, 10_000), res("b", 1, 30_000), res("c", 1, 30_000)], [A, B, C], 1);
    expect(low).toMatchObject({ tie: false, winnerId: "a" });
    expect(low.ranks).toEqual({ a: 1, b: 2, c: 2 });
  });

  it("a round is incomplete until all four have a time", () => {
    const v = roundView([res("a", 1, 1), res("b", 1, 2), res("c", 1, 3)], four, 1);
    expect(v.complete).toBe(false);
    expect(v.winnerId).toBeNull();
  });

  it("match totals rank everybody by total time, not by round wins", () => {
    const results = [
      res("a", 1, 10_000), res("b", 1, 20_000), res("c", 1, 30_000), res("d", 1, 40_000), // a wins round 1
      res("a", 2, 90_000), res("b", 2, 25_000), res("c", 2, 26_000), res("d", 2, 27_000), // b wins round 2
    ];
    const m = matchView(results, four);
    expect(m.ordered.map((r) => [r.playerId, r.totalMs])).toEqual([
      ["b", 45_000], ["c", 56_000], ["d", 67_000], ["a", 100_000],
    ]);
    expect(m.winnerId).toBe("b");
    expect(m.ranks).toEqual({ b: 1, c: 2, d: 3, a: 4 });
    expect(m.rows.find((r) => r.playerId === "a")!.roundWins).toBe(1);
  });

  it("a player who left is scored at the cap, shown as left, and the rest carry on", () => {
    const leaver = player("c", 2, { has_left: true });
    const results = [
      res("a", 1, 20_000), res("b", 1, 30_000), res("c", 1, 80_000, "timeout"), // c left: scored at 20 s + 60 s
    ];
    const m = matchView(results, [A, B, leaver]);
    expect(m.rows.find((r) => r.playerId === "c")).toMatchObject({ hasLeft: true, totalMs: 80_000 });
    expect(m.winnerId).toBe("a");
    expect(activePlayers([A, B, leaver]).map((p) => p.player_id)).toEqual(["a", "b"]);
    expect(seats([A, B, leaver], "a").opponents.map((p) => p.player_id)).toEqual(["b"]); // leavers aren't opponents any more
  });

  it("a forfeit puts the survivor on top whatever the times were", () => {
    const m = matchView([res("a", 1, 99_000), res("b", 1, 10_000)], [A, B], "a");
    expect(m).toMatchObject({ winnerId: "a", byForfeit: true });
    expect(m.ordered.map((r) => r.playerId)).toEqual(["a", "b"]);
  });

  it("counts who is ready among players still in the match", () => {
    expect(readiness([player("a", 0, { ready: true }), player("b", 1, { ready: true }), player("c", 2)])).toEqual({ ready: 2, total: 3 });
    expect(readiness([A, player("b", 1, { has_left: true, ready: true })])).toEqual({ ready: 0, total: 1 });
  });

  it("only the host can start, and only with 2 or more players", () => {
    const base = { host_id: "a", status: "lobby", max_players: 4 } as Parameters<typeof canStart>[0];
    expect(canStart(base, [A], "a")).toBe(false); // alone
    expect(canStart(base, [A, B], "a")).toBe(true);
    expect(canStart(base, [A, B], "b")).toBe(false); // not the host
    expect(canStart({ ...base, status: "picking" }, [A, B], "a")).toBe(false); // already started
  });

  it("knows how many seats are left", () => {
    const room = { max_players: 4 } as Parameters<typeof seatsLeft>[0];
    expect(seatsLeft(room, [A, B])).toBe(2);
    expect(seatsLeft(room, four)).toBe(0);
    expect(seatsLeft({ max_players: 2 } as typeof room, [A, B, C])).toBe(0);
  });

  it("shows an 'away' state per opponent, so one quiet player doesn't flag the others", () => {
    const base = new Date("2026-01-01T00:00:00.000Z").getTime();
    const quiet = player("c", 2, { last_seen: "2026-01-01T00:00:00.000Z" });
    const lively = player("b", 1, { last_seen: "2026-01-01T00:00:28.000Z" });
    const list = othersPresence([A, lively, quiet], "a", 0, base + 30_000);
    expect(list.map((x) => [x.player.player_id, x.presence.away, x.presence.canForfeit])).toEqual([
      ["b", false, false],
      ["c", true, true],
    ]);
  });
});

describe("staying within the free Supabase limits", () => {
  it("only holds a realtime connection while a match is moving", () => {
    for (const s of ["picking", "ready", "racing", "round_over"] as const) expect(wantsRealtime(s)).toBe(true);
    for (const s of ["lobby", "finished"] as const) expect(wantsRealtime(s)).toBe(false);
    expect(wantsRealtime(null)).toBe(false);
  });

  it("polls only as a slow safety net while realtime works", () => {
    for (const s of ["picking", "ready", "racing", "round_over"] as const) expect(pollIntervalMs(s, true)).toBe(10_000);
  });

  it("polls faster when realtime is unavailable, so a race still feels live", () => {
    expect(pollIntervalMs("racing", false)).toBe(1500);
    expect(pollIntervalMs("ready", false)).toBe(1500);
    expect(pollIntervalMs("picking", false)).toBe(1500);
    expect(pollIntervalMs("round_over", false)).toBe(2500);
  });

  it("polls waiting rooms and finished matches gently, whatever realtime says", () => {
    expect(pollIntervalMs("lobby", false)).toBe(2500);
    expect(pollIntervalMs("lobby", true)).toBe(2500);
    expect(pollIntervalMs("finished", false)).toBe(6000);
    expect(pollIntervalMs(null, false)).toBe(2500);
  });

  it("polls faster on the finished screen once you've asked for a rematch and are waiting on the others", () => {
    expect(pollIntervalMs("finished", false, true)).toBe(2000);
    expect(pollIntervalMs("finished", true, true)).toBe(2000);
  });

  it("never polls slower than the 20 s forfeit rule needs (a missed update must not hide a leaver)", () => {
    for (const s of ["lobby", "picking", "ready", "racing", "round_over", "finished"] as const)
      for (const ok of [true, false]) expect(pollIntervalMs(s, ok)).toBeLessThan(12_000);
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

  it("fills in the 2-player defaults for rooms from before 3-4 player support", () => {
    const old = { ...A } as Partial<RoomPlayer>;
    delete old.has_left;
    const s = parseSnapshot({ now: "2026-01-01T00:00:00Z", room, players: [old], results: [] });
    expect(s.room.max_players).toBe(2);
    expect(s.players[0].has_left).toBe(false);
  });

  it("reads max_players and has_left from a new room", () => {
    const s = parseSnapshot({
      now: "2026-01-01T00:00:00Z",
      room: { ...room, max_players: 4 },
      players: [A, player("b", 1, { has_left: true })],
      results: [],
    });
    expect(s.room.max_players).toBe(4);
    expect(s.players[1].has_left).toBe(true);
  });
  it("rejects a malformed snapshot", () => {
    expect(() => parseSnapshot({ now: "x", room: { ...room, status: "nope" }, players: [], results: [] })).toThrow();
    expect(() => parseSnapshot(null)).toThrow();
  });
});
