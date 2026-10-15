"use client";

import Link from "next/link";
import { useState } from "react";
import CategoryTiles from "@/components/CategoryTiles";
import Poster from "@/components/Poster";
import { categoryName } from "@/lib/categories";
import { ALL_PAIRS, availableCategories, filterPairs, pairKey, type HopBand, type Pair } from "@/lib/pairs";
import {
  choosePair,
  formatMs,
  matchView,
  roundView,
  type Room,
  type RoomPlayer,
  type RoundResult,
} from "@/lib/race";

const CATEGORIES = availableCategories(ALL_PAIRS);

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-line bg-surface p-5 ${className}`}>{children}</section>;
}

export function PrimaryButton({
  children,
  onClick,
  disabled,
  testId,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      className="btn-glow w-full rounded-full px-6 py-3 text-lg font-bold text-accent-ink disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function bandText(band: number | null) {
  return band ? `${band}-hop routes` : "any hop count";
}

// ---------------------------------------------------------------------------------------------

export function LobbyPanel({ room, players }: { room: Room; players: RoomPlayer[] }) {
  const [copied, setCopied] = useState(false);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/race/${room.code}`);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Card className="text-center">
      <p className="text-xs font-semibold tracking-widest text-muted uppercase">Room code</p>
      <p className="mt-1 text-5xl font-black tracking-[0.2em] text-accent-soft" data-testid="room-code">
        {room.code}
      </p>
      <button
        type="button"
        onClick={copyLink}
        className="mt-3 rounded-full border border-line px-5 py-2 text-sm font-semibold hover:bg-surface-hi"
      >
        {copied ? "Link copied!" : "Copy invite link"}
      </button>
      <p className="mt-5 text-muted" role="status">
        Waiting for your friend to join…
      </p>
      <p className="mt-2 text-xs text-muted">
        {room.rounds_total} rounds · {bandText(room.band)}
      </p>
      <p className="mt-3 text-sm">
        In the room: <span className="font-semibold">{players.map((p) => p.nickname).join(", ")}</span>
      </p>
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------

export function PickPanel({
  room,
  isPicker,
  pickerName,
  busy,
  onPick,
}: {
  room: Room;
  isPicker: boolean;
  pickerName: string;
  busy: boolean;
  onPick: (category: string | null, pair: Pair) => void;
}) {
  const band = room.band as HopBand | null;
  const [problem, setProblem] = useState<string | null>(null);
  // tiles show how many fresh pairs each category still has for this match's hop band
  const counts = new Map(
    CATEGORIES.map((c) => [
      c.key,
      filterPairs(ALL_PAIRS, { category: c.key, hops: band ?? undefined }).filter((p) => !room.used_pairs.includes(pairKey(p))).length,
    ]),
  );

  function pick(category: string | undefined) {
    const pair = choosePair(category, band, room.used_pairs);
    if (!pair) {
      setProblem("No fresh pairs left for that choice. Try another.");
      return;
    }
    setProblem(null);
    onPick(category ?? null, pair);
  }

  if (!isPicker) {
    return (
      <Card className="text-center">
        <p className="text-lg font-bold" role="status">
          {pickerName} is choosing the genre…
        </p>
        <p className="mt-1 text-sm text-muted">
          Round {room.round_no} of {room.rounds_total}. The goal film will be from their pick.
        </p>
        <div className="mx-auto mt-5 h-2 w-40 animate-pulse rounded-full bg-surface-hi" aria-hidden />
      </Card>
    );
  }

  return (
    <div>
      <h2 className="text-xl font-black">Your pick</h2>
      <p className="text-sm text-muted">
        Choose the kind of film the goal will be · {bandText(room.band)} · round {room.round_no} of {room.rounds_total}
      </p>
      <CategoryTiles categories={CATEGORIES} counts={counts} selected={undefined} onSelect={(key) => !busy && pick(key)} />
      <button
        type="button"
        disabled={busy}
        onClick={() => pick(undefined)}
        className="mt-5 w-full rounded-full border border-line px-5 py-3 font-semibold hover:bg-surface-hi disabled:opacity-50"
      >
        Surprise me
      </button>
      {problem && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {problem}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

export function Matchup({ pair, className = "" }: { pair: Pair; className?: string }) {
  return (
    <div className={`flex items-center justify-center gap-4 ${className}`}>
      <div className="w-24 text-center">
        <Poster title={pair.start.title} poster={pair.start.poster} size="w185" className="w-full" />
        <p className="mt-1 text-[10px] font-semibold tracking-widest text-muted uppercase">Start</p>
        <p className="line-clamp-2 text-xs font-semibold">{pair.start.title}</p>
      </div>
      <span aria-hidden className="text-2xl text-accent-soft">
        →
      </span>
      <div className="w-24 text-center">
        <Poster title={pair.goal.title} poster={pair.goal.poster} size="w185" className="w-full" />
        <p className="mt-1 text-[10px] font-semibold tracking-widest text-accent-soft uppercase">Goal</p>
        <p className="line-clamp-2 text-xs font-semibold">{pair.goal.title}</p>
      </div>
    </div>
  );
}

export function ReadyPanel({
  room,
  pair,
  me,
  opponent,
  busy,
  onReady,
}: {
  room: Room;
  pair: Pair | undefined;
  me: RoomPlayer | undefined;
  opponent: RoomPlayer | undefined;
  busy: boolean;
  onReady: () => void;
}) {
  return (
    <Card className="text-center">
      <p className="text-xs font-semibold tracking-widest text-muted uppercase">
        Round {room.round_no} of {room.rounds_total}
        {room.category ? ` · ${categoryName(room.category)}` : " · Surprise"}
      </p>
      {pair ? <Matchup pair={pair} className="mt-4" /> : <p className="mt-4 text-danger">This pair isn&apos;t in your data. Reload the page.</p>}
      <p className="mt-4 text-sm text-muted">Same start, same goal for both of you. Lowest time wins.</p>
      <div className="mt-5">
        <PrimaryButton onClick={onReady} disabled={busy || me?.ready} testId="ready-button">
          {me?.ready ? "Ready ✓" : "I'm ready"}
        </PrimaryButton>
      </div>
      <p className="mt-3 text-sm text-muted" role="status">
        {me?.ready && !opponent?.ready
          ? `Waiting for ${opponent?.nickname ?? "your friend"}…`
          : opponent?.ready
            ? `${opponent.nickname} is ready.`
            : ""}
      </p>
    </Card>
  );
}

export function CountdownPanel({ pair, count }: { pair: Pair | undefined; count: { phase: "wait" | "count" | "go"; n: number } }) {
  return (
    <Card className="text-center">
      {pair && <Matchup pair={pair} />}
      <p className="mt-6 text-sm text-muted">Get ready…</p>
      <p className="text-7xl font-black text-accent-soft tabular-nums" role="timer" aria-live="assertive" data-testid="countdown">
        {count.phase === "count" ? count.n : count.phase === "go" ? "GO!" : "·"}
      </p>
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------

export function WaitingPanel({
  mine,
  opponentName,
  windowLeftMs,
}: {
  mine: RoundResult | undefined;
  opponentName: string;
  /** milliseconds left of the finishing window, once the opponent finished first */
  windowLeftMs: number | null;
}) {
  return (
    <Card className="text-center">
      <h2 className="text-xl font-black">
        {mine?.outcome === "gaveup" ? "You gave up" : mine ? "You made it!" : "Submitting…"}
      </h2>
      {mine?.outcome === "finished" && mine.ms !== null && (
        <p className="mt-1 text-3xl font-black tabular-nums text-accent-soft" data-testid="my-time">
          {formatMs(mine.ms)}
          {mine.hints > 0 && <span className="ml-2 text-sm font-normal text-muted">(incl. +15s hint)</span>}
        </p>
      )}
      <p className="mt-4 text-muted" role="status">
        Waiting for {opponentName} to finish…
      </p>
      {windowLeftMs !== null && (
        <p className="mt-1 text-sm text-muted">
          They have {Math.max(0, Math.ceil(windowLeftMs / 1000))}s left before their round is scored at the cap.
        </p>
      )}
    </Card>
  );
}

function outcomeText(row: { outcome: string; hints: number }) {
  const base = row.outcome === "gaveup" ? "gave up" : row.outcome === "timeout" ? "ran out of time" : "finished";
  return row.hints > 0 ? `${base} · hint` : base;
}

export function RoundOverPanel({
  room,
  players,
  results,
  myId,
  secondsLeft,
  onNext,
}: {
  room: Room;
  players: RoomPlayer[];
  results: RoundResult[];
  myId: string;
  secondsLeft: number;
  onNext: () => void;
}) {
  const view = roundView(results, players, room.round_no);
  const totals = matchView(results, players);
  const last = room.round_no >= room.rounds_total;
  const winner = view.rows.find((r) => r.playerId === view.winnerId);
  return (
    <Card>
      <h2 className="text-center text-xl font-black" data-testid="round-winner">
        {view.tie ? "A tie!" : winner ? (winner.playerId === myId ? "You won the round!" : `${winner.nickname} won the round`) : "Round over"}
      </h2>
      <ul className="mt-4 space-y-2">
        {view.rows.map((r) => (
          <li key={r.playerId} className="flex items-center justify-between rounded-lg bg-surface-hi px-3 py-2">
            <span>
              <span className="font-semibold">{r.nickname}</span>
              {r.playerId === myId && <span className="text-muted"> (you)</span>}
              <span className="block text-xs text-muted">{outcomeText(r)}</span>
            </span>
            <span className="text-lg font-bold tabular-nums">{r.ms !== null ? formatMs(r.ms) : "…"}</span>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-center text-sm text-muted">
        Total so far: {totals.rows.map((r) => `${r.nickname} ${formatMs(r.totalMs)}`).join(" · ")}
      </p>
      <div className="mt-5">
        <PrimaryButton onClick={onNext} testId="next-round">
          {last ? "See final result" : "Next round"} ({secondsLeft}s)
        </PrimaryButton>
      </div>
    </Card>
  );
}

export function FinishedPanel({
  room,
  players,
  results,
  myId,
  rematchBusy,
  onRematch,
}: {
  room: Room;
  players: RoomPlayer[];
  results: RoundResult[];
  myId: string;
  rematchBusy: boolean;
  onRematch: () => void;
}) {
  const match = matchView(results, players, room.forfeit_winner);
  const me = players.find((p) => p.player_id === myId);
  const opponent = players.find((p) => p.player_id !== myId);
  const winner = players.find((p) => p.player_id === match.winnerId);
  const headline = match.tie
    ? "It's a draw!"
    : winner?.player_id === myId
      ? "You won the match!"
      : `${winner?.nickname ?? "Your opponent"} won the match`;

  return (
    <Card>
      <h2 className="text-center text-2xl font-black" data-testid="match-winner">
        {headline}
      </h2>
      {match.byForfeit && <p className="mt-1 text-center text-sm text-muted">The other player left, so the match ended early.</p>}

      <ul className="mt-4 space-y-2">
        {match.rows.map((r) => (
          <li
            key={r.playerId}
            className={`flex items-center justify-between rounded-lg px-3 py-2 ${r.playerId === match.winnerId ? "bg-accent/25 ring-1 ring-accent" : "bg-surface-hi"}`}
          >
            <span>
              <span className="font-semibold">{r.nickname}</span>
              {r.playerId === myId && <span className="text-muted"> (you)</span>}
              <span className="block text-xs text-muted">
                {r.roundWins} round {r.roundWins === 1 ? "win" : "wins"}
              </span>
            </span>
            <span className="text-lg font-bold tabular-nums">{formatMs(r.totalMs)}</span>
          </li>
        ))}
      </ul>

      <details className="mt-4 text-sm">
        <summary className="cursor-pointer text-muted">Round by round</summary>
        <ol className="mt-2 space-y-1">
          {Array.from({ length: room.rounds_total }, (_, i) => i + 1).map((n) => {
            const v = roundView(results, players, n);
            if (!v.complete) return null;
            return (
              <li key={n} className="flex justify-between">
                <span className="text-muted">Round {n}</span>
                <span className="tabular-nums">{v.rows.map((r) => formatMs(r.ms!)).join("  vs  ")}</span>
              </li>
            );
          })}
        </ol>
      </details>

      <div className="mt-5 space-y-3">
        <PrimaryButton onClick={onRematch} disabled={rematchBusy || me?.rematch} testId="rematch">
          {me?.rematch ? `Waiting for ${opponent?.nickname ?? "your friend"}…` : opponent?.rematch ? `${opponent.nickname} wants a rematch: play again` : "Rematch"}
        </PrimaryButton>
        <Link href="/race" className="block rounded-full border border-line px-6 py-3 text-center font-semibold hover:bg-surface-hi">
          Leave
        </Link>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------

export function AwayBanner({
  name,
  silentMs,
  canForfeit,
  onForfeit,
  busy,
}: {
  name: string;
  silentMs: number;
  canForfeit: boolean;
  onForfeit: () => void;
  busy: boolean;
}) {
  const wait = Math.max(0, 20 - Math.floor(silentMs / 1000));
  return (
    <div role="alert" className="mb-3 rounded-xl border border-danger/50 bg-surface p-3 text-sm">
      <p className="font-semibold">{name} seems to have left.</p>
      {canForfeit ? (
        <button
          type="button"
          onClick={onForfeit}
          disabled={busy}
          data-testid="claim-win"
          className="mt-2 rounded-full bg-accent px-4 py-1.5 font-bold text-accent-ink disabled:opacity-50"
        >
          Claim the win
        </button>
      ) : (
        <p className="text-muted">You can claim the win in {wait}s if they don&apos;t come back.</p>
      )}
    </div>
  );
}
