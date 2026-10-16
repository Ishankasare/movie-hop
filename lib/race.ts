import { z } from "zod";
import { filterPairs, ALL_PAIRS, pairKey, pickPair, type HopBand, type Pair } from "./pairs";

// Pure rules for the 2-player race. The database (supabase/migrations/0001_race.sql) is the referee;
// this file only reads what it sends back and works out what to show.

export const HINT_PENALTY_MS = 15_000;
export const FINISH_WINDOW_MS = 60_000;
export const FORFEIT_AFTER_MS = 20_000;
export const OPPONENT_AWAY_MS = 12_000;
export const CODE_LENGTH = 5;
export const NICKNAME_MAX = 16;

// ---- what the server sends (room_snapshot) ----

const roomSchema = z.object({
  code: z.string(),
  host_id: z.string(),
  status: z.enum(["lobby", "picking", "ready", "racing", "round_over", "finished"]),
  rounds_total: z.number().int(),
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

export function seats(players: RoomPlayer[], myId: string): { me?: RoomPlayer; opponent?: RoomPlayer } {
  return { me: players.find((p) => p.player_id === myId), opponent: players.find((p) => p.player_id !== myId) };
}

export function isPicker(room: Room, myId: string): boolean {
  return room.picker_id === myId;
}

// ---- disconnects ----

export type Presence = { away: boolean; canForfeit: boolean; silentMs: number };

/** The opponent sends a heartbeat every ~5 s. "Away" is shown after 12 s; the server allows a forfeit after 20 s. */
export function opponentPresence(opponent: RoomPlayer | undefined, offset: number, nowMs: number): Presence {
  if (!opponent) return { away: false, canForfeit: false, silentMs: 0 };
  const silentMs = Math.max(0, nowMs + offset - new Date(opponent.last_seen).getTime());
  return { away: silentMs >= OPPONENT_AWAY_MS, canForfeit: silentMs >= FORFEIT_AFTER_MS, silentMs };
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
export type RoundView = { rows: RoundRow[]; winnerId: string | null; tie: boolean; complete: boolean };

/** One round's results, in seat order. The lower time wins; equal times are a tie. */
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
  const complete = rows.length === 2 && rows.every((r) => r.ms !== null);
  if (!complete) return { rows, winnerId: null, tie: false, complete };
  const [a, b] = rows;
  const tie = a.ms === b.ms;
  return { rows, winnerId: tie ? null : a.ms! < b.ms! ? a.playerId : b.playerId, tie, complete };
}

export type TotalsRow = { playerId: string; nickname: string; totalMs: number; roundWins: number };
export type MatchView = { rows: TotalsRow[]; winnerId: string | null; tie: boolean; byForfeit: boolean };

/** Whole-match totals. The lowest total time wins; a forfeit overrides the times. */
export function matchView(results: RoundResult[], players: RoomPlayer[], forfeitWinner: string | null = null): MatchView {
  const roundNos = [...new Set(results.map((r) => r.round_no))].sort((a, b) => a - b);
  const rows: TotalsRow[] = players.map((p) => ({ playerId: p.player_id, nickname: p.nickname, totalMs: 0, roundWins: 0 }));
  for (const n of roundNos) {
    const view = roundView(results, players, n);
    if (!view.complete) continue;
    for (const row of view.rows) rows.find((t) => t.playerId === row.playerId)!.totalMs += row.ms!;
    if (view.winnerId) rows.find((t) => t.playerId === view.winnerId)!.roundWins += 1;
  }
  if (forfeitWinner) return { rows, winnerId: forfeitWinner, tie: false, byForfeit: true };
  const [a, b] = rows;
  if (!a || !b || a.totalMs === b.totalMs) return { rows, winnerId: null, tie: !!a && !!b, byForfeit: false };
  return { rows, winnerId: a.totalMs < b.totalMs ? a.playerId : b.playerId, tie: false, byForfeit: false };
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
};

export function friendlyError(message: string | undefined | null): string {
  if (!message) return "Something went wrong. Try again.";
  const code = Object.keys(ERRORS).find((k) => message.includes(k));
  return code ? ERRORS[code] : "Something went wrong. Try again.";
}
