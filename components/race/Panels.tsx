"use client";

import { useState } from "react";
import CategoryTiles from "@/components/CategoryTiles";
import Poster from "@/components/Poster";
import { categoryName } from "@/lib/categories";
import { ALL_PAIRS, availableCategories, filterPairs, pairKey, type HopBand, type Pair } from "@/lib/pairs";
import {
  activePlayers,
  canStart,
  choosePair,
  formatMs,
  matchView,
  ordinal,
  readiness,
  roundView,
  seatsLeft,
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

export function LobbyPanel({
  room,
  players,
  myId,
  busy,
  onStart,
}: {
  room: Room;
  players: RoomPlayer[];
  myId: string;
  busy: boolean;
  onStart: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const isHost = room.host_id === myId;
  const startable = canStart(room, players, myId);
  const hostName = players.find((p) => p.player_id === room.host_id)?.nickname ?? "the host";
  const empty = seatsLeft(room, players);

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
      <p className="mt-2 text-xs text-muted">
        Up to {room.max_players} players · {room.rounds_total} rounds · {bandText(room.band)}
      </p>

      <ul aria-label="Players in the room" className="mt-5 space-y-2 text-left" data-testid="lobby-players">
        {players.map((p) => (
          <li key={p.player_id} className="flex items-center justify-between rounded-lg bg-surface-hi px-3 py-2">
            <span className="font-semibold">
              {p.nickname}
              {p.player_id === myId && <span className="font-normal text-muted"> (you)</span>}
            </span>
            {p.player_id === room.host_id && (
              <span className="text-[10px] font-semibold tracking-widest text-accent-soft uppercase">Host</span>
            )}
          </li>
        ))}
        {Array.from({ length: empty }, (_, i) => (
          <li key={`empty-${i}`} className="rounded-lg border border-dashed border-line px-3 py-2 text-sm text-muted">
            Waiting for a player…
          </li>
        ))}
      </ul>

      <div className="mt-5">
        {isHost ? (
          <>
            <PrimaryButton onClick={onStart} disabled={busy || !startable} testId="start-match">
              {startable ? `Start with ${players.length} players` : "Waiting for at least 2 players"}
            </PrimaryButton>
            <p className="mt-2 text-xs text-muted">The match also starts by itself when the room is full.</p>
          </>
        ) : (
          <p className="text-muted" role="status">
            Waiting for {hostName} to start the match…
          </p>
        )}
      </div>
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
  players,
  busy,
  onReady,
}: {
  room: Room;
  pair: Pair | undefined;
  me: RoomPlayer | undefined;
  players: RoomPlayer[];
  busy: boolean;
  onReady: () => void;
}) {
  const active = activePlayers(players);
  const notReady = active.filter((p) => !p.ready);
  const { ready: readyCount, total } = readiness(players);
  return (
    <Card className="text-center">
      <p className="text-xs font-semibold tracking-widest text-muted uppercase">
        Round {room.round_no} of {room.rounds_total}
        {room.category ? ` · ${categoryName(room.category)}` : " · Surprise"}
      </p>
      {pair ? <Matchup pair={pair} className="mt-4" /> : <p className="mt-4 text-danger">This pair isn&apos;t in your data. Reload the page.</p>}
      <p className="mt-4 text-sm text-muted">Same start, same goal for everyone. Lowest time wins.</p>
      <div className="mt-5">
        <PrimaryButton onClick={onReady} disabled={busy || me?.ready} testId="ready-button">
          {me?.ready ? "Ready ✓" : "I'm ready"}
        </PrimaryButton>
      </div>
      <ul aria-label="Who is ready" className="mt-4 flex flex-wrap justify-center gap-2" data-testid="ready-list">
        {active.map((p) => (
          <li
            key={p.player_id}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${p.ready ? "bg-accent/30 text-accent-soft" : "bg-surface-hi text-muted"}`}
          >
            {p.nickname} {p.ready ? "✓" : "…"}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-sm text-muted" role="status">
        {me?.ready && notReady.length > 0
          ? `Waiting for ${notReady.map((p) => p.nickname).join(", ")}…`
          : `${readyCount} of ${total} ready`}
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
  waitingFor,
  windowLeftMs,
}: {
  mine: RoundResult | undefined;
  /** nicknames of the players who haven't finished yet */
  waitingFor: string[];
  /** milliseconds left of the finishing window, once someone finished first */
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
        {waitingFor.length > 0 ? `Waiting for ${waitingFor.join(", ")} to finish…` : "Wrapping up the round…"}
      </p>
      {windowLeftMs !== null && waitingFor.length > 0 && (
        <p className="mt-1 text-sm text-muted">
          {waitingFor.length === 1 ? "They have" : "They each have"} {Math.max(0, Math.ceil(windowLeftMs / 1000))}s left
          before the round is scored at the cap.
        </p>
      )}
    </Card>
  );
}

function outcomeText(row: { outcome: string; hints: number }) {
  const base = row.outcome === "gaveup" ? "gave up" : row.outcome === "timeout" ? "ran out of time" : "finished";
  return row.hints > 0 ? `${base} · hint` : base;
}

function Place({ n, highlight }: { n: number; highlight?: boolean }) {
  return (
    <span
      aria-hidden
      className={`mr-3 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-black ${
        highlight ? "bg-accent text-accent-ink" : "bg-surface text-muted"
      }`}
    >
      {n}
    </span>
  );
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
  const myPlace = view.ranks[myId];
  const hasLeft = (id: string) => players.find((p) => p.player_id === id)?.has_left ?? false;
  return (
    <Card>
      <h2 className="text-center text-xl font-black" data-testid="round-winner">
        {view.tie ? "A tie!" : winner ? (winner.playerId === myId ? "You won the round!" : `${winner.nickname} won the round`) : "Round over"}
      </h2>
      {players.length > 2 && myPlace !== undefined && myPlace > 1 && (
        <p className="mt-1 text-center text-sm text-muted">
          You finished {ordinal(myPlace)} of {players.length}.
        </p>
      )}
      <ol aria-label="Round results, fastest first" className="mt-4 space-y-2">
        {view.ordered.map((r) => (
          <li key={r.playerId} className="flex items-center justify-between rounded-lg bg-surface-hi px-3 py-2">
            <span className="flex items-center">
              {view.ranks[r.playerId] !== undefined && <Place n={view.ranks[r.playerId]} highlight={view.ranks[r.playerId] === 1} />}
              <span>
                <span className="font-semibold">{r.nickname}</span>
                {r.playerId === myId && <span className="text-muted"> (you)</span>}
                <span className="block text-xs text-muted">
                  {hasLeft(r.playerId) && r.outcome !== "finished" ? "left the match" : outcomeText(r)}
                </span>
              </span>
            </span>
            <span className="text-lg font-bold tabular-nums">{r.ms !== null ? formatMs(r.ms) : "…"}</span>
          </li>
        ))}
      </ol>
      <p className="mt-4 text-center text-sm text-muted">
        Total so far: {totals.ordered.map((r) => `${totals.ranks[r.playerId] ?? ""} ${r.nickname} ${formatMs(r.totalMs)}`.trim()).join(" · ")}
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
  onLeave,
}: {
  room: Room;
  players: RoomPlayer[];
  results: RoundResult[];
  myId: string;
  rematchBusy: boolean;
  onRematch: () => void;
  onLeave: () => void;
}) {
  const match = matchView(results, players, room.forfeit_winner);
  const me = players.find((p) => p.player_id === myId);
  const others = activePlayers(players).filter((p) => p.player_id !== myId);
  const waitingOn = others.filter((p) => !p.rematch);
  const wanting = others.filter((p) => p.rematch);
  const winner = players.find((p) => p.player_id === match.winnerId);
  const myPlace = match.ranks[myId];
  const headline = match.tie
    ? "It's a draw!"
    : winner?.player_id === myId
      ? "You won the match!"
      : `${winner?.nickname ?? "Your opponent"} won the match`;

  const rematchLabel = me?.rematch
    ? `Waiting for ${waitingOn.map((p) => p.nickname).join(", ") || "the others"}…`
    : wanting.length > 0
      ? `${wanting.map((p) => p.nickname).join(", ")} want${wanting.length === 1 ? "s" : ""} a rematch: play again`
      : "Rematch";

  return (
    <Card>
      <h2 className="text-center text-2xl font-black" data-testid="match-winner">
        {headline}
      </h2>
      {match.byForfeit && (
        <p className="mt-1 text-center text-sm text-muted">
          {players.length > 2 ? "Everyone else left, so the match ended early." : "The other player left, so the match ended early."}
        </p>
      )}
      {!match.byForfeit && players.length > 2 && myPlace !== undefined && myPlace > 1 && (
        <p className="mt-1 text-center text-sm text-muted">
          You finished {ordinal(myPlace)} of {players.length}.
        </p>
      )}

      <ol aria-label="Final standings" className="mt-4 space-y-2">
        {match.ordered.map((r) => (
          <li
            key={r.playerId}
            className={`flex items-center justify-between rounded-lg px-3 py-2 ${r.playerId === match.winnerId ? "bg-accent/25 ring-1 ring-accent" : "bg-surface-hi"}`}
          >
            <span className="flex items-center">
              {match.ranks[r.playerId] !== undefined && <Place n={match.ranks[r.playerId]} highlight={r.playerId === match.winnerId} />}
              <span>
                <span className="font-semibold">{r.nickname}</span>
                {r.playerId === myId && <span className="text-muted"> (you)</span>}
                <span className="block text-xs text-muted">
                  {r.hasLeft ? "left the match · " : ""}
                  {r.roundWins} round {r.roundWins === 1 ? "win" : "wins"}
                </span>
              </span>
            </span>
            <span className="text-lg font-bold tabular-nums">{formatMs(r.totalMs)}</span>
          </li>
        ))}
      </ol>

      <details className="mt-4 text-sm">
        <summary className="cursor-pointer text-muted">Round by round</summary>
        <ol className="mt-2 space-y-2">
          {Array.from({ length: room.rounds_total }, (_, i) => i + 1).map((n) => {
            const v = roundView(results, players, n);
            if (!v.complete) return null;
            return (
              <li key={n}>
                <span className="text-muted">Round {n}</span>
                <span className="mt-0.5 block tabular-nums">
                  {v.ordered.map((r) => `${r.nickname} ${formatMs(r.ms!)}`).join("  ·  ")}
                </span>
              </li>
            );
          })}
        </ol>
      </details>

      <div className="mt-5 space-y-3">
        <PrimaryButton onClick={onRematch} disabled={rematchBusy || me?.rematch || others.length === 0} testId="rematch">
          {rematchLabel}
        </PrimaryButton>
        <button
          type="button"
          onClick={onLeave}
          data-testid="leave-match"
          className="block w-full rounded-full border border-line px-6 py-3 text-center font-semibold hover:bg-surface-hi"
        >
          Leave
        </button>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------

export function AwayBanner({
  away,
  remaining,
  onForfeit,
  busy,
}: {
  /** the players who have gone quiet */
  away: { name: string; silentMs: number; canForfeit: boolean }[];
  /** how many players are still in the match, counting you */
  remaining: number;
  onForfeit: () => void;
  busy: boolean;
}) {
  if (away.length === 0) return null;
  const names = away.map((a) => a.name).join(" and ");
  const droppable = away.filter((a) => a.canForfeit);
  const wait = Math.max(0, 20 - Math.floor(Math.max(...away.map((a) => a.silentMs)) / 1000));
  // if everyone else is gone, carrying on means winning; otherwise the match goes on without them
  const lastOneStanding = remaining - droppable.length < 2;
  return (
    <div role="alert" className="mb-3 rounded-xl border border-danger/50 bg-surface p-3 text-sm">
      <p className="font-semibold">
        {names} {away.length === 1 ? "seems" : "seem"} to have left.
      </p>
      {droppable.length > 0 ? (
        <button
          type="button"
          onClick={onForfeit}
          disabled={busy}
          data-testid="claim-win"
          className="mt-2 rounded-full bg-accent px-4 py-1.5 font-bold text-accent-ink disabled:opacity-50"
        >
          {lastOneStanding ? "Claim the win" : `Carry on without ${droppable.map((d) => d.name).join(" and ")}`}
        </button>
      ) : (
        <p className="text-muted">
          You can {remaining - away.length < 2 ? "claim the win" : "carry on without them"} in {wait}s if they don&apos;t come back.
        </p>
      )}
    </div>
  );
}
