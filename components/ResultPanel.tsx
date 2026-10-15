"use client";

import Link from "next/link";
import { useState } from "react";
import { movesBreakdown, type GameState } from "@/lib/game";
import { formatTime } from "@/lib/format";
import { routesOf, type Pair } from "@/lib/pairs";

/** Renders [film, person, film, …] with the linking people picked out in the accent colour. */
function RouteLine({ nodes }: { nodes: string[] }) {
  return (
    <>
      {nodes.map((name, i) => (
        <span key={i}>
          {i > 0 && <span className="text-muted"> → </span>}
          {i % 2 === 1 ? <span className="text-accent-soft">{name}</span> : <span className="font-semibold">{name}</span>}
        </span>
      ))}
    </>
  );
}

type Props = {
  pair: Pair;
  game: GameState;
  outcome: "won" | "gaveup";
  ms: number;
  onPlayAgain: () => void;
};

export default function ResultPanel({ pair, game, outcome, ms, onPlayAgain }: Props) {
  const [copied, setCopied] = useState(false);
  const won = outcome === "won";
  const { backs } = movesBreakdown(game);
  const routes = routesOf(pair);
  const yourRoute = game.path.flatMap((f, i) => (i === 0 ? [f.title] : [game.via[i - 1].name, f.title]));
  const time = formatTime(ms);

  async function copy() {
    const text = won
      ? `Movie Hop: ${pair.start.title} → ${pair.goal.title}\n${game.moves} hops (best possible ${pair.minHops}) in ${time}${game.hintUsed ? " 💡" : ""}`
      : `Movie Hop: ${pair.start.title} → ${pair.goal.title}\nGave up after ${game.moves} hops (best possible ${pair.minHops})`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section aria-labelledby="result-heading" className="rounded-xl border border-line bg-surface p-5">
      <h2 id="result-heading" className="text-2xl font-black">
        {won ? "You made it!" : "You gave up"}
      </h2>

      <dl className="mt-4 grid grid-cols-3 gap-3 text-center">
        <div className="rounded-lg bg-surface-hi p-3">
          <dd className="text-2xl font-bold" data-testid="result-hops">
            {game.moves}
          </dd>
          <dt className="text-xs text-muted">your hops</dt>
        </div>
        <div className="rounded-lg bg-surface-hi p-3">
          <dd className="text-2xl font-bold" data-testid="result-best">
            {pair.minHops}
          </dd>
          <dt className="text-xs text-muted">best possible</dt>
        </div>
        <div className="rounded-lg bg-surface-hi p-3">
          <dd className="text-2xl font-bold">{time}</dd>
          <dt className="text-xs text-muted">time</dt>
        </div>
      </dl>
      <p className="mt-3 text-sm text-muted">
        Moves include Back presses{backs > 0 ? ` (you used Back ${backs}×)` : ""}.
        {game.hintUsed ? " 💡 You used the hint (counted as one hop)." : ""}
        {won && game.moves === pair.minHops ? " A perfect run!" : ""}
      </p>

      {won && (
        <>
          <h3 className="mt-5 text-sm font-semibold text-muted">Your route</h3>
          <p className="mt-2 rounded-lg bg-surface-hi p-3 text-sm leading-relaxed" data-testid="your-route">
            <RouteLine nodes={yourRoute} />
          </p>
        </>
      )}

      <h3 className="mt-5 text-sm font-semibold text-muted">
        {routes.length > 1 ? "Shortest routes" : "Shortest route"}
      </h3>
      <ol className="mt-2 space-y-2" data-testid="routes">
        {routes.map((route) => (
          <li key={route.join("|")} className="rounded-lg bg-surface-hi p-3 text-sm leading-relaxed">
            <RouteLine nodes={route} />
          </li>
        ))}
      </ol>

      <div className="mt-6 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={onPlayAgain}
          className="rounded-full bg-accent px-5 py-2 font-bold text-accent-ink hover:brightness-110"
        >
          Play again
        </button>
        <button
          type="button"
          onClick={copy}
          className="rounded-full border border-line px-5 py-2 font-semibold hover:bg-surface-hi"
        >
          {copied ? "Copied!" : "Copy result"}
        </button>
        <Link
          href="/"
          className="rounded-full border border-line px-5 py-2 font-semibold hover:bg-surface-hi"
        >
          Home
        </Link>
      </div>
    </section>
  );
}
