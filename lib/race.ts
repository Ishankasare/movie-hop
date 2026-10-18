import { z } from "zod";
import { filterPairs, ALL_PAIRS, pairKey, pickPair, type HopBand, type Pair } from "./pairs";

// Pure rules for the 2 to 4 player race. The database (supabase/migrations) is the referee;
// this file only reads what it sends back and works out what to show.

export const HINT_PENALTY_MS = 15_000;
export const FINISH_WINDOW_MS = 60_000;
export const FORFEIT_AFTER_MS = 20_000;
export const OPPONENT_AWAY_MS = 12_000;
export const CODE_LENGTH = 5;
export const NICKNAME_MAX = 16;
export const ROUNDS_OPTIONS = [2, 4, 8] as const;
export const PLAYER_OPTIONS = [2, 3, 4] as const;

// ---- what the server sends (room_snapshot) ----

const roomSchema = z.object({
  code: z.string(),
  host_id: z.string(),
  status: z.enum(["lobby", "picking", "ready", "racing", "round_over", "finished"]),
  rounds_total: z.number().int(),
  max_players: z.number().int().default(2),
  band: z.number().int().nullable(),
  match_no: z.number().int(),
  round_no: z.number().int(),
  picker_id: z.string().nullable(),
  category: z.string().nullable(),
  pair_key: z.string().nullable(),
  used_pairs: z.array(z.string()),
  start_at: z.string().nullable(),
  first_finish_ms: z.number().nullable(),
  deadline_at: z.string().nullable(),
  forfeit_winner: z.string().nullable(),
});

const playerSchema = z.object({
  player_id: z.string(),
  nickname: z.string(),
  seat: z.number().int(),
  ready: z.boolean(),
  moves: z.number().int(),
  hints: z.number().int(),
  rematch: z.boolean(),
  has_left: z.boolean().default(false),
  last_seen: z.string(),
});

const resultSchema = z.object({
  player_id: z.string(),
  match_no: z.number().int(),
  round_no: z.number().int(),
  outcome: z.enum(["finished", "gaveup", "timeout"]),
  ms: z.number().nullable(),
  hints: z.number().int(),
  moves: z.number().int(),
});

const snapshotSchema = z.object({
  now: z.string(),
  room: roomSchema,
  players: z.array(playerSchema),
  results: z.array(resultSchema),
});

export type Room = z.infer<typeof roomSchema>;
export type RoomPlayer = z.infer<typeof playerSchema>;
export type RoundResult = z.infer<typeof resultSchema>;
export type Snapshot = z.infer<typeof snapshotSchema>;
export type RoomStatus = Room["status"];

export function parseSnapshot(input: unknown): Snapshot {
  return snapshotSchema.parse(input);
}

// ---- server clock ----

/** server time minus client time, measured when a snapshot arrives. */
export function serverOffset(serverNowIso: string, clientNowMs: number): number {
  return new Date(serverNowIso).getTime() - clientNowMs;
}

/** Milliseconds from now until a server timestamp (negative once it has passed). */
export function msUntil(iso: string, offset: number, nowMs: number): number {
  return new Date(iso).getTime() - (nowMs + offset);
}

export type Countdown = { phase: "wait" | "count" | "go"; n: number };

/** The shared "3, 2, 1, GO" before a race. The server starts the race 4 s after both players are ready. */
export function countdown(startAtIso: string, offset: number, nowMs: number): Countdown {
  const r = msUntil(startAtIso, offset, nowMs);
  if (r <= 0) return { phase: "go", n: 0 };
  if (r > 3000) return { phase: "wait", n: 0 };
  return { phase: "count", n: Math.ceil(r / 1000) };
}

// ---- who is who ----

/**
 * Me and everyone else in the room. `opponent` is the first other player (handy in a 2-player room);
 * `opponents` are all the others who are still in the match, in seat order.
 */
export function seats(
  players: RoomPlayer[],
  myId: string,
): { me?: RoomPlayer; opponent?: RoomPlayer; opponents: RoomPlayer[] } {
  const others = players.filter((p) => p.player_id !== myId);
  return {
    me: players.find((p) => p.player_id === myId),
    opponent: others[0],
    opponents: others.filter((p) => !p.has_left),
  };
}

export function isPicker(room: Room, myId: string): boolean {
  return room.picker_id === myId;
}

/** Players still in the match (people who left stay in the list so their scores don't vanish). */
export function activePlayers(players: RoomPlayer[]): RoomPlayer[] {
  return players.filter((p) => !p.has_left);
}

/** How many players are ready, out of those still in the match. */
export function readiness(players: RoomPlayer[]): { ready: number; total: number } {
  const active = activePlayers(players);
  return { ready: active.filter((p) => p.ready).length, total: active.length };
}

/** The host may start from the lobby once at least 2 players are in. */
export function canStart(room: Room, players: RoomPlayer[], myId: string): boolean {
  return room.status === "lobby" && room.host_id === myId && activePlayers(players).length >= 2;
}

export function seatsLeft(room: Room, players: RoomPlayer[]): number {
  return Math.max(0, room.max_players - players.length);
}

// ---- disconnects ----

export type Presence = { away: boolean; canForfeit: boolean; silentMs: number };

/** Players send a heartbeat every ~5 s. "Away" is shown after 12 s; the server allows dropping them after 20 s. */
export function opponentPresence(opponent: RoomPlayer | undefined, offset: number, nowMs: number): Presence {
  if (!opponent) return { away: false, canForfeit: false, silentMs: 0 };
  const silentMs = Math.max(0, nowMs + offset - new Date(opponent.last_seen).getTime());
  return { away: silentMs >= OPPONENT_AWAY_MS, canForfeit: silentMs >= FORFEIT_AFTER_MS, silentMs };
}

/** Presence of every other player still in the match. */
export function othersPresence(
  players: RoomPlayer[],
  myId: string,
  offset: number,
  nowMs: number,
): { player: RoomPlayer; presence: Presence }[] {
  return seats(players, myId).opponents.map((player) => ({ player, presence: opponentPresence(player, offset, nowMs) }));
}

// ---- results and scoring ----

export type RoundRow = {
  playerId: string;
  nickname: string;
  ms: number | null;
  outcome: RoundResult["outcome"] | "pending";
  hints: number;
  moves: number;
};
export type RoundView = {
  /** in seat order */
  rows: RoundRow[];
  /** best time first (seat order until the round is complete) */
  ordered: RoundRow[];
  /** 1 = fastest; equal times share a place (1, 2, 2, 4) */
  ranks: Record<string, number>;
  winnerId: string | null;
  tie: boolean;
  complete: boolean;
};

/** Places for a list sorted best-first: equal values share a place and the next place is skipped (1, 2, 2, 4). */
export function placesFor<T>(sorted: T[], value: (item: T) => number): number[] {
  return sorted.map((item, i) => {
    let first = i;
    while (first > 0 && value(sorted[first - 1]) === value(item)) first--;
    return first + 1;
  });
}

/** One round's results. The lowest time wins; equal best times are a tie. Works for 2 to 4 players. */
export function roundView(results: RoundResult[], players: RoomPlayer[], roundNo: number): RoundView {
  const rows: RoundRow[] = players.map((p) => {
    const r = results.find((x) => x.round_no === roundNo && x.player_id === p.player_id);
    return {
      playerId: p.player_id,
      nickname: p.nickname,
      ms: r?.ms ?? null,
      outcome: r?.outcome ?? "pending",
      hints: r?.hints ?? 0,
      moves: r?.moves ?? 0,
    };
  });
  const complete = rows.length >= 2 && rows.every((r) => r.ms !== null);
  if (!complete) return { rows, ordered: rows, ranks: {}, winnerId: null, tie: false, complete };

  const ordered = [...rows].sort((a, b) => a.ms! - b.ms!);
  const places = placesFor(ordered, (r) => r.ms!);
  const ranks = Object.fromEntries(ordered.map((r, i) => [r.playerId, places[i]]));
  const tie = places[1] === 1; // the runner-up shares first place
  return { rows, ordered, ranks, winnerId: tie ? null : ordered[0].playerId, tie, complete };
}

export type TotalsRow = {
  playerId: string;
  nickname: string;
  totalMs: number;
  /** rounds won outright */
  roundWins: number;
  /** left the match early (their missed rounds are scored at the cap) */
  hasLeft: boolean;
};
export type MatchView = {
  /** in seat order */
  rows: TotalsRow[];
  /** best first: the forfeit winner on top, otherwise lowest total time */
  ordered: TotalsRow[];
  ranks: Record<string, number>;
  winnerId: string | null;
  tie: boolean;
  byForfeit: boolean;
};

/** Whole-match totals. The lowest total time wins; if everyone else left, the one who stayed wins. */
export function matchView(results: RoundResult[], players: RoomPlayer[], forfeitWinner: string | null = null): MatchView {
  const roundNos = [...new Set(results.map((r) => r.round_no))].sort((a, b) => a - b);
  const rows: TotalsRow[] = players.map((p) => ({
    playerId: p.player_id,
    nickname: p.nickname,
    totalMs: 0,
    roundWins: 0,
    hasLeft: p.has_left,
  }));
  for (const n of roundNos) {
    const view = roundView(results, players, n);
    if (!view.complete) continue;
    for (const row of view.rows) rows.find((t) => t.playerId === row.playerId)!.totalMs += row.ms!;
    if (view.winnerId) rows.find((t) => t.playerId === view.winnerId)!.roundWins += 1;
  }

  const byTime = [...rows].sort((a, b) => a.totalMs - b.totalMs);
  if (forfeitWinner) {
    const ordered = [...byTime.filter((r) => r.playerId === forfeitWinner), ...byTime.filter((r) => r.playerId !== forfeitWinner)];
    const ranks = Object.fromEntries(ordered.map((r, i) => [r.playerId, i + 1]));
    return { rows, ordered, ranks, winnerId: forfeitWinner, tie: false, byForfeit: true };
  }
  if (rows.length < 2) return { rows, ordered: byTime, ranks: {}, winnerId: null, tie: false, byForfeit: false };

  const places = placesFor(byTime, (r) => r.totalMs);
  const ranks = Object.fromEntries(byTime.map((r, i) => [r.playerId, places[i]]));
  const tie = places[1] === 1;
  return { rows, ordered: byTime, ranks, winnerId: tie ? null : byTime[0].playerId, tie, byForfeit: false };
}

// ---- pairs ----

/** The picker's client chooses the pair for the round: the right category and hop band, not yet played. */
export function choosePair(
  category: string | undefined,
  band: number | null,
  usedPairs: string[],
  rng: () => number = Math.random,
): Pair | undefined {
  const hops = band === 2 || band === 3 || band === 4 ? (band as HopBand) : undefined;
  return pickPair(filterPairs(ALL_PAIRS, { category, hops }), usedPairs, rng);
}

export function findPair(key: string | null): Pair | undefined {
  return key ? ALL_PAIRS.find((p) => pairKey(p) === key) : undefined;
}

// ---- keeping within the free Supabase limits ----
// Realtime connections are limited (200 at once on the free plan) and so is data transfer, so a room only holds a
// realtime connection while things are moving fast; waiting rooms and finished matches just poll gently.

/** Realtime is worth a connection while a match is actively moving. */
export function wantsRealtime(status: RoomStatus | null): boolean {
  return status === "picking" || status === "ready" || status === "racing" || status === "round_over";
}

/**
 * How often to re-read the room. With realtime working it is only a safety net (10 s); without it (a lobby, a
 * finished match, or realtime unavailable) we poll faster while a race is on, so the game still feels live.
 */
export function pollIntervalMs(status: RoomStatus | null, realtimeOk: boolean): number {
  if (!wantsRealtime(status)) return status === "finished" ? 6000 : 2500;
  if (realtimeOk) return 10_000;
  return status === "round_over" ? 2500 : 1500;
}

// ---- small helpers for the screens ----

const CODE_CHARS = /[^A-HJ-NP-Z2-9]/g;

/** Room codes are 5 characters from A–Z and 2–9 without the look-alikes (I, O, 0, 1). */
export function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(CODE_CHARS, "").slice(0, CODE_LENGTH);
}

export function isValidCode(code: string): boolean {
  return code.length === CODE_LENGTH && normalizeCode(code) === code;
}

export function cleanNickname(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, NICKNAME_MAX);
}

export function randomNickname(rng: () => number = Math.random): string {
  return `Guest${String(Math.floor(rng() * 900) + 100)}`;
}

/** m:ss.s, e.g. 83_450 -> "1:23.4" */
export function formatMs(ms: number): string {
  const tenths = Math.floor(ms / 100);
  const m = Math.floor(tenths / 600);
  const s = Math.floor((tenths % 600) / 10);
  return `${m}:${String(s).padStart(2, "0")}.${tenths % 10}`;
}

const ERRORS: Record<string, string> = {
  room_not_found: "We couldn't find that room. Check the code and try again.",
  room_full: "That room already has two players.",
  bad_nickname: "Pick a nickname between 1 and 16 characters.",
  not_signed_in: "Couldn't sign you in. Check your connection and try again.",
  not_a_member: "You're not in this room.",
  not_your_pick: "It's not your turn to pick.",
  wrong_state: "That step already happened. Hang on a moment.",
  too_early: "The race hasn't started yet.",
  opponent_still_here: "Your opponent is still connected.",
  pair_already_played: "That pair was already played. Pick again.",
  too_many_rooms: "You've created a lot of rooms recently. Please try again in a little while.",
  not_host: "Only the host can start the match.",
  need_more_players: "You need at least 2 players to start.",
  bad_players: "A room takes 2 to 4 players.",
};

export function friendlyError(message: string | undefined | null): string {
  if (!message) return "Something went wrong. Try again.";
  const code = Object.keys(ERRORS).find((k) => message.includes(k));
  return code ? ERRORS[code] : "Something went wrong. Try again.";
}
