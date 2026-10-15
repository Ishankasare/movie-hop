import type { HopBand } from "./pairs";

export type Prefs = { genre?: number; hops?: HopBand };

export const PREFS_KEY = "movie-hop:prefs";

/** Parses a stored value defensively; anything invalid falls back to "any". */
export function parsePrefs(raw: string | null, validGenres?: number[]): Prefs {
  let obj: unknown;
  try {
    obj = JSON.parse(raw ?? "{}");
  } catch {
    return {};
  }
  if (typeof obj !== "object" || obj === null) return {};
  const { genre, hops } = obj as Record<string, unknown>;
  const prefs: Prefs = {};
  if (
    typeof genre === "number" &&
    Number.isInteger(genre) &&
    (!validGenres || validGenres.includes(genre))
  ) {
    prefs.genre = genre;
  }
  if (hops === 2 || hops === 3 || hops === 4) prefs.hops = hops;
  return prefs;
}

/** Query string for /play, e.g. "?genre=28&hops=5" (empty when both are "any"). */
export function prefsToQuery(prefs: Prefs): string {
  const q = new URLSearchParams();
  if (prefs.genre !== undefined) q.set("genre", String(prefs.genre));
  if (prefs.hops !== undefined) q.set("hops", String(prefs.hops));
  const s = q.toString();
  return s ? `?${s}` : "";
}

export function readStoredPrefs(): string | null {
  try {
    return localStorage.getItem(PREFS_KEY);
  } catch {
    return null;
  }
}

export function writeStoredPrefs(prefs: Prefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // storage unavailable: the choice just won't persist
  }
}
