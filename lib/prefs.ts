import { parseCategory } from "./categories";
import type { HopBand } from "./pairs";

/** The solo picker's choice. `category` is the goal film's genre or universe (see lib/categories.ts). */
export type Prefs = { category?: string; hops?: HopBand };

export const PREFS_KEY = "movie-hop:prefs";

/** Parses a stored value defensively; anything invalid falls back to "any". */
export function parsePrefs(raw: string | null, validCategories?: string[]): Prefs {
  let obj: unknown;
  try {
    obj = JSON.parse(raw ?? "{}");
  } catch {
    return {};
  }
  if (typeof obj !== "object" || obj === null) return {};
  const { category, hops } = obj as Record<string, unknown>;
  const prefs: Prefs = {};
  const key = typeof category === "string" ? parseCategory(category) : undefined;
  if (key && (!validCategories || validCategories.includes(key))) prefs.category = key;
  if (hops === 2 || hops === 3 || hops === 4) prefs.hops = hops;
  return prefs;
}

/** Query string for /play, e.g. "?cat=marvel&hops=3" (empty when both are "any"). */
export function prefsToQuery(prefs: Prefs): string {
  const q = new URLSearchParams();
  if (prefs.category !== undefined) q.set("cat", prefs.category);
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
