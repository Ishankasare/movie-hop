"use client";

import Link from "next/link";
import { useMemo, useSyncExternalStore } from "react";
import { ALL_PAIRS, availableGenres, filterPairs, type HopBand } from "@/lib/pairs";
import { parsePrefs, prefsToQuery, readStoredPrefs, writeStoredPrefs, type Prefs } from "@/lib/prefs";

const GENRES = availableGenres(ALL_PAIRS);
const GENRE_IDS = GENRES.map((g) => g.id);
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
  const prefs = useMemo(() => parsePrefs(raw, GENRE_IDS), [raw]);
  const matching = useMemo(() => filterPairs(ALL_PAIRS, prefs).length, [prefs]);

  function update(next: Prefs) {
    writeStoredPrefs(next);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }

  return (
    <div className="mt-10 w-full max-w-sm text-left">
      {GENRES.length > 0 && (
        <div>
          <label htmlFor="genre" className="text-sm font-semibold text-muted">
            Genre of the start film
          </label>
          <select
            id="genre"
            value={prefs.genre ?? ""}
            onChange={(e) =>
              update({ ...prefs, genre: e.target.value === "" ? undefined : Number(e.target.value) })
            }
            className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2"
          >
            <option value="">Any genre</option>
            {GENRES.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name} ({g.count})
              </option>
            ))}
          </select>
        </div>
      )}

      <fieldset className="mt-5">
        <legend className="text-sm font-semibold text-muted">Hops (movies to reach, at best)</legend>
        <div className="mt-1 grid grid-cols-4 gap-2">
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

      {matching === 0 ? (
        <p role="status" className="mt-6 rounded-lg border border-danger/40 bg-surface p-3 text-center">
          No pairs match. Try a different genre or number of hops.
        </p>
      ) : (
        <>
          <Link
            href={`/play${prefsToQuery(prefs)}`}
            className="btn-glow mt-6 block rounded-full px-8 py-3 text-center text-lg font-bold text-accent-ink"
          >
            Play
          </Link>
          <p className="mt-2 text-center text-xs text-muted">{matching} pairs available</p>
        </>
      )}
    </div>
  );
}
