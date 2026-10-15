"use client";

import Link from "next/link";
import { useMemo, useSyncExternalStore } from "react";
import { ALL_PAIRS, availableCategories, filterPairs, type HopBand } from "@/lib/pairs";
import { parsePrefs, prefsToQuery, readStoredPrefs, writeStoredPrefs, type Prefs } from "@/lib/prefs";
import CategoryTiles from "./CategoryTiles";

const CATEGORIES = availableCategories(ALL_PAIRS);
const CATEGORY_KEYS = CATEGORIES.map((c) => c.key);
const BANDS: { value: HopBand | undefined; label: string }[] = [
  { value: 2, label: "2" },
  { value: 3, label: "3" },
  { value: 4, label: "4" },
  { value: undefined, label: "Any" },
];

const CHANGE_EVENT = "movie-hop:prefs-change";

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

export default function PlayPicker() {
  // Server and first client render see null (= "any"); the stored choice appears right after hydration.
  const raw = useSyncExternalStore(subscribe, readStoredPrefs, () => null);
  const prefs = useMemo(() => parsePrefs(raw, CATEGORY_KEYS), [raw]);
  const matching = useMemo(() => filterPairs(ALL_PAIRS, prefs).length, [prefs]);
  // how many pairs each tile would give with the hop band currently chosen
  const counts = useMemo(
    () => new Map(CATEGORIES.map((c) => [c.key, filterPairs(ALL_PAIRS, { category: c.key, hops: prefs.hops }).length])),
    [prefs.hops],
  );

  function update(next: Prefs) {
    writeStoredPrefs(next);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }

  return (
    <div className="mt-8 w-full text-left">
      <section aria-labelledby="goal-heading">
        <h2 id="goal-heading" className="text-sm font-semibold text-muted">
          What kind of film is your goal?
        </h2>
        <p className="text-xs text-muted">Pick one, or leave it empty for a surprise.</p>
        <CategoryTiles
          categories={CATEGORIES}
          counts={counts}
          selected={prefs.category}
          onSelect={(key) => update({ ...prefs, category: prefs.category === key ? undefined : key })}
        />
      </section>

      <fieldset className="mt-6">
        <legend className="text-sm font-semibold text-muted">Hops (movies to reach, at best)</legend>
        <div className="mt-2 grid grid-cols-4 gap-2">
          {BANDS.map((b) => {
            const active = prefs.hops === b.value;
            return (
              <button
                key={b.label}
                type="button"
                aria-pressed={active}
                onClick={() => update({ ...prefs, hops: b.value })}
                className={`rounded-lg border px-3 py-2 font-semibold ${
                  active
                    ? "border-accent bg-accent text-accent-ink"
                    : "border-line bg-surface hover:bg-surface-hi"
                }`}
              >
                {b.label}
              </button>
            );
          })}
        </div>
      </fieldset>

      {/* sticky so Play is always reachable above the tab bar, however far down the tiles you scroll */}
      <div className="sticky bottom-[4.75rem] z-10 mt-6 -mx-4 bg-gradient-to-t from-background via-background/90 to-transparent px-4 pt-6 pb-2">
        {matching === 0 ? (
          <p role="status" className="rounded-lg border border-danger/40 bg-surface p-3 text-center">
            No pairs match. Try a different genre or number of hops.
          </p>
        ) : (
          <>
            <Link
              href={`/play${prefsToQuery(prefs)}`}
              className="btn-glow block rounded-full px-8 py-3 text-center text-lg font-bold text-accent-ink"
            >
              Play
            </Link>
            <p className="mt-1 text-center text-xs text-muted">{matching} pairs available</p>
          </>
        )}
      </div>
    </div>
  );
}
