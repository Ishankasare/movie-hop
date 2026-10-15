import { GRAPH } from "./graph";
import { genreName } from "./genres";
import { pairKey, type Pair } from "./pairs";

/**
 * A deliberately vague, one-shot hint about the film just before the goal on one shortest route and
 * the person who links it to the goal. It never names a film or a person, and it doesn't depend on
 * where the player currently is.
 *
 * To keep hints from all sounding alike, each pair gets its own mix of clues (decade, genre, the first
 * letter range or length of the title, the link person's role and initial). The mix is chosen from the
 * pair itself, so both players in a race get the same hint for the same round.
 */

const BUCKETS = ["A–F", "G–L", "M–R", "S–Z"] as const;

function bucketOf(letter: string): string {
  const c = letter.toUpperCase();
  return BUCKETS.find((b) => c >= b[0] && c <= b[2]) ?? "S–Z";
}

/** Title without a leading article, so "The Matrix" counts as an M, not a T. */
export function sortTitle(title: string): string {
  return title.replace(/^(the|a|an)\s+/i, "").replace(/^[^a-z0-9]+/i, "");
}

function titleBucket(title: string): string {
  const first = sortTitle(title).match(/[a-z]/i)?.[0];
  return first ? bucketOf(first) : "S–Z";
}

function wordCountText(title: string): string {
  const n = sortTitle(title).split(/\s+/).filter(Boolean).length;
  return n <= 1 ? "one-word" : n === 2 ? "two-word" : n === 3 ? "three-word" : "long";
}

/** "a" or "an" for the word that follows ("an Action film", "a Drama film"). */
function an(word: string): string {
  return /^[aeiou]/i.test(word) ? "an" : "a";
}

/** Small stable hash so the same pair always gets the same hint. */
function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function hintFor(pair: Pair): string {
  const ids = pair.samplePathIds[0];
  const beforeGoal = GRAPH.films[ids[ids.length - 3]];
  const link = GRAPH.people[ids[ids.length - 2]];
  const goalFilm = GRAPH.films[pair.goal.id];
  const role = goalFilm?.people.find((p) => p.id === ids[ids.length - 2])?.role;

  const year = Number(beforeGoal?.year);
  const decade = Number.isFinite(year) && year > 0 ? `${Math.floor(year / 10) * 10}s` : "";
  const firstGenre = beforeGoal?.genres?.[0];
  const genre = firstGenre !== undefined ? genreName(firstGenre) : "";
  const title = beforeGoal?.title ?? "";

  const h = hash(pairKey(pair));

  // the film just before the goal: one of five ways to describe it
  const films = [
    decade && genre ? `a ${decade} ${genre} film` : "",
    genre && title ? `${an(genre)} ${genre} film whose title starts with ${titleBucket(title)}` : "",
    decade && title ? `a film from the ${decade} with a ${wordCountText(title)} title` : "",
    decade && title ? `a ${decade} film whose title starts with ${titleBucket(title)}` : "",
    genre && title ? `${an(genre)} ${genre} film with a ${wordCountText(title)} title` : "",
  ].filter(Boolean);
  const filmClause = films[h % Math.max(films.length, 1)] ?? "a film";

  // the person who links it to the goal: the role, and (on some pairs) a letter range for their name
  const roleText = role === "director" ? "its director" : "an actor";
  const personClause =
    link?.name && (h >> 5) % 2 === 1
      ? `${roleText} whose name starts with ${bucketOf(link.name[0])}`
      : roleText;

  return `One shortest route ends through ${filmClause}, linked to the goal by ${personClause}.`;
}
