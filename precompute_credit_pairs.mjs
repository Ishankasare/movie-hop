// precompute_credit_pairs.mjs — data pipeline for the "cast & director" version of Movie Hop.
//
// A hop is: film -> person (main cast / director of that film) -> another film that person
// is main cast / director of. Every link is something a player can see and explain.
//
// How it works (few API calls, then everything is in-memory):
//   1. Take a UNIVERSE of very famous films (/discover sorted by vote_count), one per franchise.
//   2. Fetch each film's credits once (cached): top-billed cast + director.
//   3. Build the film<->person graph from those credits and BFS it offline.
//   4. Emit start/goal pairs whose shortest route (in films hopped to) is in [MIN_HOPS, MAX_HOPS],
//      with up to 2 distinct shortest routes.
//
// RUN:  node precompute_credit_pairs.mjs            (reads TMDB_KEY from env or .env.local)
// OUT:  data/pairs.json  (the game's round data; also writes data/graph.json)
//       credits_cache.json       (local cache, gitignored)

import fs from "node:fs";

try { process.loadEnvFile(".env.local"); } catch {}
const KEY = process.env.TMDB_KEY;
if (!KEY) { console.error("Set TMDB_KEY (env var or .env.local)."); process.exit(1); }

const BASE = "https://api.themoviedb.org/3";
const CACHE_FILE = "credits_cache.json";

// ---- tuning knobs ----
const DISCOVER_PAGES = Number(process.env.DISCOVER_PAGES ?? 80); // ~20 films each, most-voted first
const TOP_CAST = 6;          // "main cast" = billing order 0..5
const MIN_HOPS = Number(process.env.MIN_HOPS ?? 2);
const MAX_HOPS = Number(process.env.MAX_HOPS ?? 4);
const MAX_ROUTES = 2;
// Pairs are generated per (goal category x hop band) cell so every genre / universe has rounds to play.
const PER_CELL = Number(process.env.PER_CELL ?? 6);        // pairs wanted per category and band
const MAX_PER_GOAL = 2;                                     // keep the same goal film from dominating
const MAX_PER_START = 3;
const CONCURRENCY = 8;
// A person only counts as a link if a normal viewer would know them:
const MIN_APPEARANCES = Number(process.env.MIN_APPEARANCES ?? 3); // main cast / director in this many universe films
const MIN_POPULARITY = Number(process.env.MIN_POPULARITY ?? 5);   // ...or a high TMDB popularity score
// Directors are rarely recognised by face or name, so they must be genuinely famous to be a link:
const MIN_DIRECTOR_FILMS = Number(process.env.MIN_DIRECTOR_FILMS ?? 4); // directed this many universe films
// Start films come from the better-known part of the universe (share of films, ranked by TMDB votes):
const START_TOP_SHARE = Number(process.env.START_TOP_SHARE ?? 0.5);
// No pairs for genres that have no recognisable films in a "famous films" universe:
const SKIP_GENRES = new Set([99, 10770]); // Documentary, TV Movie

// ---- "universes": extra categories next to the normal genres (goal film belongs to one) ----
const MARVEL_COMPANIES = new Set([420, 7505, 19551]);   // Marvel Studios / Entertainment / Enterprises
const DC_COMPANIES = new Set([9993, 128064, 429]);      // DC Entertainment / DC Films / DC Comics
const DISNEY_COMPANIES = new Set([2, 3, 6125]);         // Walt Disney Pictures / Pixar / Walt Disney Animation
const SAGA_RE = /star wars|harry potter|lord of the rings|hobbit|fantastic beasts/i; // by TMDB collection name
const TAGS = ["marvel", "dc", "disney", "saga"];
const NOT_DC = /^RED( 2)?$/; // comic adaptations credited to DC Entertainment, not DC superhero films

function tagsOf(details, title) {
  const companies = new Set((details?.production_companies ?? []).map((c) => c.id));
  const has = (set) => [...companies].some((id) => set.has(id));
  const tags = [];
  const marvel = has(MARVEL_COMPANIES);
  const saga = SAGA_RE.test(details?.belongs_to_collection?.name ?? "");
  if (marvel) tags.push("marvel");
  if (has(DC_COMPANIES) && !NOT_DC.test(title)) tags.push("dc");
  if (saga) tags.push("saga");
  if (has(DISNEY_COMPANIES) && !marvel && !saga) tags.push("disney"); // Marvel / Star Wars are Disney-owned; keep them in their own bucket
  return tags;
}

// ---- tiny cached TMDB client ----
let cache = {};
try { cache = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")); } catch {}
let dirty = 0;
const saveCache = () => { if (dirty) { fs.writeFileSync(CACHE_FILE, JSON.stringify(cache)); dirty = 0; } };
const inflight = new Map();

async function get(path) {
  if (cache[path]) return cache[path];
  if (inflight.has(path)) return inflight.get(path);
  const p = (async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const r = await fetch(`${BASE}${path}${path.includes("?") ? "&" : "?"}api_key=${KEY}`);
      if (r.status === 429) { await new Promise((s) => setTimeout(s, 1500 * (attempt + 1))); continue; }
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`TMDB ${r.status} for ${path}`);
      return r.json();
    }
    throw new Error("rate limited repeatedly on " + path);
  })();
  inflight.set(path, p);
  try {
    const j = await p;
    if (j) { cache[path] = j; if (++dirty % 100 === 0) saveCache(); }
    return j;
  } finally { inflight.delete(path); }
}

async function mapLimit(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

const norm = (t) => (t || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
// crude franchise key: "Avengers: Endgame" -> "avengers", "Toy Story 3" -> "toy story"
const franchise = (t) =>
  norm(t.split(/[:–—-]/)[0]).replace(/\s+(\d+|ii|iii|iv|v|vi|vii|viii|ix|x)$/, "");

// ---- 1. universe ----
async function buildUniverse() {
  const pages = await mapLimit(
    Array.from({ length: DISCOVER_PAGES }, (_, i) => i + 1), CONCURRENCY,
    (p) => get(`/discover/movie?sort_by=vote_count.desc&page=${p}`),
  );
  const candidates = [];
  for (const pg of pages) for (const m of pg?.results ?? []) {
    if (!m.poster_path || !m.title) continue;
    candidates.push({ id: m.id, title: m.title, year: (m.release_date || "").slice(0, 4),
      poster: m.poster_path, votes: m.vote_count || 0, genres: m.genre_ids || [] });
  }
  // TMDB knows which films belong to the same collection (sequels, trilogies).
  const details = await mapLimit(candidates, CONCURRENCY, (f) => get(`/movie/${f.id}`));
  candidates.forEach((f, i) => {
    const c = details[i]?.belongs_to_collection?.id;
    f.fkey = c ? `c${c}` : `t${franchise(f.title)}`;   // films with the same fkey are sequels / same franchise
    f.tags = tagsOf(details[i], f.title);
  });

  // Untagged films: one per franchise (first by TMDB collection, then by title) so routes can't
  // just hop between sequels. Films in a universe (Marvel, DC, Disney, sagas) are ALL kept so those
  // categories have enough goals; routes that pass through two films of one franchise are rejected later.
  const tagged = candidates.filter((f) => f.tags.length > 0);
  const best = new Map();
  for (const film of candidates.filter((f) => f.tags.length === 0)) {
    const prev = best.get(film.fkey);
    if (!prev || film.votes > prev.votes) best.set(film.fkey, film);
  }
  const byTitle = new Map();
  for (const film of best.values()) {
    const k = franchise(film.title);
    const prev = byTitle.get(k);
    if (!prev || film.votes > prev.votes) byTitle.set(k, film);
  }
  return [...byTitle.values(), ...tagged];
}

// ---- 2. credits: top cast + director ----
async function peopleOf(film) {
  const j = await get(`/movie/${film.id}/credits`);
  const people = new Map();
  for (const c of j?.cast ?? []) if (c.order < TOP_CAST) people.set(c.id, { name: c.name, pop: c.popularity || 0, photo: c.profile_path || null, role: "cast" });
  for (const c of j?.crew ?? []) if (c.job === "Director") people.set(c.id, { name: c.name, pop: c.popularity || 0, photo: c.profile_path || null, role: "director" });
  return people; // id -> {name, pop}
}

async function main() {
  console.log("Building film universe…");
  const films = await buildUniverse();
  console.log(`Universe: ${films.length} films. Fetching credits…`);
  const filmById = new Map(films.map((f) => [f.id, f]));

  const credits = await mapLimit(films, CONCURRENCY, (f) => peopleOf(f));
  saveCache();

  // bipartite graph
  const filmPeople = new Map();   // filmId -> Map(personId -> name)
  const personFilms = new Map();  // personId -> [filmId]
  const personName = new Map();
  const personPop = new Map();
  const personPhoto = new Map();
  films.forEach((f, i) => {
    filmPeople.set(f.id, credits[i]);
    for (const [pid, { name, pop, photo }] of credits[i]) {
      personName.set(pid, name);
      if (photo && !personPhoto.has(pid)) personPhoto.set(pid, photo);
      personPop.set(pid, Math.max(personPop.get(pid) ?? 0, pop));
      if (!personFilms.has(pid)) personFilms.set(pid, []);
      personFilms.get(pid).push(f.id);
    }
  });
  // famous connectors only: everyone else is dropped from the graph.
  // Actors: main cast in several films (or very popular). Directors: must have directed many films here.
  const castCount = new Map(), dirCount = new Map();
  for (const people of filmPeople.values()) {
    for (const [pid, p] of people) {
      const m = p.role === "director" ? dirCount : castCount;
      m.set(pid, (m.get(pid) ?? 0) + 1);
    }
  }
  const actorOk = (pid) => (castCount.get(pid) ?? 0) >= 2 && ((castCount.get(pid) ?? 0) >= MIN_APPEARANCES || personPop.get(pid) >= MIN_POPULARITY);
  const directorOk = (pid) => (dirCount.get(pid) ?? 0) >= MIN_DIRECTOR_FILMS;
  for (const people of filmPeople.values()) {
    for (const [pid, p] of [...people]) if (!(p.role === "director" ? directorOk(pid) : actorOk(pid))) people.delete(pid);
  }
  personFilms.clear();
  for (const [fid, people] of filmPeople) for (const pid of people.keys()) {
    if (!personFilms.has(pid)) personFilms.set(pid, []);
    personFilms.get(pid).push(fid);
  }
  for (const [pid, l] of [...personFilms]) if (l.length < 2) {
    personFilms.delete(pid);
    for (const people of filmPeople.values()) people.delete(pid);
  }
  const notable = new Set(personFilms.keys());
  console.log(`People: ${personName.size}, famous connectors kept: ${notable.size}`);
  // fame of a person = how many universe films they are main cast / director in
  const fame = (pid) => personFilms.get(pid).length;

  // BFS from a film over film->person->film. dist = number of films hopped to.
  function bfs(startId) {
    const seen = new Map([[startId, { dist: 0, parents: [] }]]);
    let frontier = [startId];
    for (let dist = 1; dist <= MAX_HOPS; dist++) {
      const next = [];
      for (const fid of frontier) {
        for (const [pid] of filmPeople.get(fid) ?? []) {
          for (const nb of personFilms.get(pid) ?? []) {
            const known = seen.get(nb);
            if (!known) { seen.set(nb, { dist, parents: [{ pid, from: fid }] }); next.push(nb); }
            else if (known.dist === dist && known.parents.length < 40) known.parents.push({ pid, from: fid });
          }
        }
      }
      frontier = next;
    }
    return seen;
  }

  // Up to MAX_ROUTES distinct shortest routes as [film, person, film, ...] id arrays.
  function routes(startId, goalId, seen) {
    const all = [];
    const walk = (id, suffix) => {
      if (all.length >= 400) return;
      if (id === startId) { all.push([id, ...suffix]); return; }
      for (const { pid, from } of seen.get(id).parents) walk(from, [pid, id, ...suffix]);
    };
    walk(goalId, []);
    const noRepeatFranchise = (r) => {
      const keys = r.filter((_, i) => i % 2 === 0).map((id) => filmById.get(id).fkey);
      return new Set(keys).size === keys.length;
    };
    all.splice(0, all.length, ...all.filter(noRepeatFranchise));
    if (all.length === 0) return null;
    // prefer routes whose weakest link is the most famous person, then the most famous overall
    const people = (r) => r.filter((_, i) => i % 2 === 1);
    const score = (r) => [Math.min(...people(r).map(fame)), people(r).reduce((a, p) => a + fame(p), 0)];
    all.sort((a, b) => { const [a1, a2] = score(a), [b1, b2] = score(b); return b1 - a1 || b2 - a2; });
    // second route should differ in films, not just in which person links them
    // A second route only counts if it passes through genuinely different films, not a sequel swap
    // (Guardians vs Guardians Vol. 2): at least 2 new franchises (or 1 for a 2-hop route).
    const middle = (r) => r.filter((_, i) => i % 2 === 0).slice(1, -1).map((id) => filmById.get(id).fkey);
    const first = new Set(middle(all[0]));
    const needed = Math.min(2, first.size);
    const picked = [all[0]];
    if (MAX_ROUTES > 1) {
      const second = all.find((r) => new Set(middle(r).filter((k) => !first.has(k))).size >= needed);
      if (second) picked.push(second);
    }
    return picked;
  }
  const routeNames = (r) => r.map((x, i) => (i % 2 === 0 ? filmById.get(x).title : personName.get(x)));

  // ---- 3. generate pairs: PER_CELL for every (goal category x hop band) ----
  const N = films.length;
  const index = new Map(films.map((f, i) => [f.id, i]));
  const distTo = films.map((f) => {          // distTo[s][g] = shortest film-hop distance (0 = unreachable within MAX_HOPS)
    const row = new Int8Array(N);
    for (const [id, v] of bfs(f.id)) row[index.get(id)] = v.dist;
    return row;
  });
  const genreIds = [...new Set(films.flatMap((f) => f.genres))].filter((g) => !SKIP_GENRES.has(g));
  const byVotes = films.map((f) => f.votes).sort((a, b) => b - a);
  const minStartVotes = byVotes[Math.floor(byVotes.length * START_TOP_SHARE)] ?? 0;
  const startOk = films.map((f) => f.votes >= minStartVotes);
  const categories = [
    ...TAGS.map((t) => ({ key: t, test: (f) => f.tags.includes(t) })),
    ...genreIds.map((g) => ({ key: `g${g}`, test: (f) => f.genres.includes(g) })),
  ];

  const pairs = [];
  const used = new Set();
  const goalUse = new Map();
  const startUse = new Map();
  const cellCount = {};
  const noise = () => 0.5 + Math.random();

  for (const cat of categories) {
    const goalIdx = films.map((f, i) => (cat.test(f) ? i : -1)).filter((i) => i >= 0);
    for (let band = MIN_HOPS; band <= MAX_HOPS; band++) {
      // candidate (start, goal) pairs for this cell, famous goals first (with noise for variety)
      const cands = [];
      for (const g of goalIdx) {
        for (let si = 0; si < N; si++) {
          if (startOk[si] && distTo[si][g] === band && films[si].fkey !== films[g].fkey) {
            cands.push({ si, g, w: films[g].votes * noise() * noise() });
          }
        }
      }
      cands.sort((a, b) => b.w - a.w);
      let got = 0;
      const key = `${cat.key}|${band}`;
      for (const { si, g } of cands) {
        if (got >= PER_CELL) break;
        const start = films[si], goal = films[g];
        const k = `${start.id}-${goal.id}`;
        if (used.has(k)) { got++; continue; }   // already generated for another category: counts for this cell too
        if ((goalUse.get(goal.id) ?? 0) >= MAX_PER_GOAL || (startUse.get(start.id) ?? 0) >= MAX_PER_START) continue;
        const seen = bfs(start.id);
        const rids = routes(start.id, goal.id, seen);
        if (!rids) continue;
        const names = rids.map(routeNames);
        pairs.push({
          start: { id: start.id, title: start.title, year: start.year, poster: start.poster, genres: start.genres },
          goal: { id: goal.id, title: goal.title, year: goal.year, poster: goal.poster, genres: goal.genres, tags: goal.tags },
          minHops: band,
          samplePath: names[0],
          samplePaths: names,
          // same routes as ids, alternating [filmId, personId, filmId, ...] — what the game checks against
          samplePathIds: rids,
        });
        used.add(k);
        goalUse.set(goal.id, (goalUse.get(goal.id) ?? 0) + 1);
        startUse.set(start.id, (startUse.get(start.id) ?? 0) + 1);
        got++;
      }
      cellCount[key] = got;
    }
  }
  const dist = {};
  for (const row of distTo) for (const d of row) dist[d] = (dist[d] || 0) + 1;

  // static graph the game ships with: famous connectors only, so no runtime TMDB calls are needed
  const graph = { films: {}, people: {} };
  for (const f of films) {
    const people = [...(filmPeople.get(f.id) ?? [])].map(([id, p]) => ({ id, role: p.role }));
    if (people.length === 0) continue;
    graph.films[f.id] = { title: f.title, year: f.year, poster: f.poster, genres: f.genres, people };
  }
  for (const [pid, fids] of personFilms) {
    const inGraph = fids.filter((id) => graph.films[id]);
    if (inGraph.length >= 2) graph.people[pid] = { name: personName.get(pid), photo: personPhoto.get(pid) ?? null, films: inGraph };
  }
  fs.writeFileSync("data/graph.json", JSON.stringify(graph));
  console.log(`Graph: ${Object.keys(graph.films).length} films, ${Object.keys(graph.people).length} people -> data/graph.json`);

  fs.mkdirSync("data", { recursive: true });
  fs.writeFileSync("data/pairs.json", JSON.stringify(pairs));
  saveCache();

  const byHop = {};
  pairs.forEach((p) => (byHop[p.minHops] = (byHop[p.minHops] || 0) + 1));
  console.log("\nFilm pairs by hop distance over the whole universe:", dist);
  console.log(`Done. ${pairs.length} pairs -> data/pairs.json`);
  console.log("Hop distribution:", byHop);
  const thin = Object.entries(cellCount).filter(([, n]) => n < PER_CELL);
  console.log(`Cells below ${PER_CELL} pairs (${thin.length}/${Object.keys(cellCount).length}):`, thin.map(([k, n]) => `${k}=${n}`).join(" ") || "none");
  const tagCount = Object.fromEntries(TAGS.map((t) => [t, films.filter((f) => f.tags.includes(t)).length]));
  console.log("Films per universe tag:", tagCount);
  for (const t of TAGS) console.log(`  ${t}: ` + films.filter((f) => f.tags.includes(t)).map((f) => f.title).slice(0, 40).join(", "));
}

main().catch((e) => { console.error(e); saveCache(); process.exit(1); });
