import { GRAPH } from "./graph";
import { genreName } from "./genres";
import type { Pair } from "./pairs";

/**
 * A deliberately vague, one-shot hint: it describes the film just before the goal on one shortest
 * route (decade + genre) and how that film links to the goal (an actor or the director).
 * It never names a film or a person, and it doesn't depend on where the player currently is.
 */
export function hintFor(pair: Pair): string {
  const ids = pair.samplePathIds[0];
  const beforeGoal = GRAPH.films[ids[ids.length - 3]];
  const linkId = ids[ids.length - 2];
  const goalFilm = GRAPH.films[pair.goal.id];

  const year = Number(beforeGoal?.year);
  const decade = Number.isFinite(year) && year > 0 ? `${Math.floor(year / 10) * 10}s ` : "";
  const firstGenre = beforeGoal?.genres?.[0];
  const genre = firstGenre !== undefined ? `${genreName(firstGenre)} ` : "";

  const role = goalFilm?.people.find((p) => p.id === linkId)?.role;
  const link = role === "director" ? "its director" : "an actor";

  return `One shortest route ends through a ${decade}${genre}film, linked to the goal by ${link}.`;
}
