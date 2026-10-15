"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  ALL_PAIRS,
  filterPairs,
  loadRecent,
  pickPair,
  rememberPair,
  type HopBand,
  type Pair,
} from "@/lib/pairs";
import { parseCategory } from "@/lib/categories";
import Game from "./Game";

function parseHops(v: string | null): HopBand | undefined {
  return v === "2" || v === "3" || v === "4" ? (Number(v) as HopBand) : undefined;
}

const subscribeNever = () => () => {};

/** False on the server and during hydration, true afterwards. */
function useMounted(): boolean {
  return useSyncExternalStore(subscribeNever, () => true, () => false);
}

export default function PlayClient() {
  const params = useSearchParams();
  const category = parseCategory(params.get("cat"));
  const hops = parseHops(params.get("hops"));
  const matching = useMemo(() => filterPairs(ALL_PAIRS, { category, hops }), [category, hops]);
  const [roundNo, setRoundNo] = useState(0);
  const mounted = useMounted();

  if (matching.length === 0) {
    return (
      <main className="mx-auto max-w-md px-4 py-20 text-center">
        <h1 className="text-2xl font-black">No pairs match</h1>
        <p className="mt-2 text-muted">Try a different genre or number of hops.</p>
        <Link
          href="/play"
          className="mt-6 inline-block rounded-full bg-accent px-6 py-2 font-bold text-accent-ink"
        >
          Play any pair
        </Link>
      </main>
    );
  }

  // The pair is random and recent plays live in localStorage, so it is chosen on the client only.
  if (!mounted) return <PlayLoading />;
  return (
    <Round
      key={`${category ?? "any"}-${hops ?? "any"}-${roundNo}`}
      matching={matching}
      onPlayAgain={() => setRoundNo((n) => n + 1)}
    />
  );
}

function Round({ matching, onPlayAgain }: { matching: Pair[]; onPlayAgain: () => void }) {
  const [pair] = useState(() => pickPair(matching, loadRecent()));

  useEffect(() => {
    if (pair) rememberPair(pair);
  }, [pair]);

  if (!pair) return <PlayLoading />;
  return <Game pair={pair} onPlayAgain={onPlayAgain} />;
}

export function PlayLoading() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-20 text-center text-muted" role="status">
      Setting up your round…
    </main>
  );
}
