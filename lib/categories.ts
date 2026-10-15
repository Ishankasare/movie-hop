import { genreName } from "./genres";

/** "Universes" shown next to the normal genres. A pair belongs to one if its goal film is tagged with it. */
export const UNIVERSES = [
  { key: "marvel", name: "Marvel", blurb: "Avengers, Spider-Man, X-Men" },
  { key: "dc", name: "DC", blurb: "Batman, Superman, Wonder Woman" },
  { key: "disney", name: "Disney / Pixar", blurb: "Animated classics and more" },
  { key: "saga", name: "Sagas", blurb: "Star Wars, Harry Potter, LOTR" },
] as const;

export type UniverseKey = (typeof UNIVERSES)[number]["key"];

export function isUniverse(key: string): key is UniverseKey {
  return UNIVERSES.some((u) => u.key === key);
}

/**
 * A category key is a universe ("marvel", "dc", "disney", "saga") or a TMDB genre ("g28").
 * Returns the key if it is well-formed, otherwise undefined.
 */
export function parseCategory(v: string | null | undefined): string | undefined {
  if (!v) return undefined;
  return isUniverse(v) || /^g\d{1,6}$/.test(v) ? v : undefined;
}

export function categoryName(key: string): string {
  const universe = UNIVERSES.find((u) => u.key === key);
  if (universe) return universe.name;
  return genreName(Number(key.slice(1)));
}

/** Does a goal film belong to the category? (Any of its genres counts, not just the first.) */
export function inCategory(goal: { genres?: number[]; tags?: string[] }, key: string): boolean {
  return isUniverse(key) ? (goal.tags?.includes(key) ?? false) : (goal.genres?.includes(Number(key.slice(1))) ?? false);
}
