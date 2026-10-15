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
const DISCOVER_PAGES = Number(process.env.DISCOVER_PAGES ?? 50); // ~20 films each, most-voted first
const TOP_CAST = 6;          // "main cast" = billing order 0..5
const MIN_HOPS = Number(process.env.MIN_HOPS ?? 2);
const MAX_HOPS = Number(process.env.MAX_HOPS ?? 4);
const MAX_ROUTES = 2;
const PAIRS_PER_START = 2;
const TARGET_PAIRS = Number(process.env.TARGET_PAIRS ?? 80);
const CONCURRENCY = 8;
// A person only counts as a link if a normal viewer would know them:
const MIN_APPEARANCES = Number(process.env.MIN_APPEARANCES ?? 3); // main cast / director in this many universe films
const MIN_POPULARITY = Number(process.env.MIN_POPULARITY ?? 5);   // ...or a high TMDB popularity score

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
  const collectionOf = new Map(candidates.map((f, i) => [f.id, details[i]?.belongs_to_collection?.id]));

  // One film per franchise: first by TMDB collection, then (for films with no collection) by title.
  const best = new Map();
  for (const film of candidates) {
    const c = collectionOf.get(film.id);
    const k = c ? `c${c}` : `t${franchise(film.title)}`;
    const prev = best.get(k);
    if (!prev || film.votes > prev.votes) best.set(k, film);
  }
  // a title-keyed film can still be a sequel of a collection film ("Dawn of the Planet of the Apes"
  // vs "War for..."): merge any remaining films that share a title key too.
  const byTitle = new Map();
  for (const film of best.values()) {
    const k = franchise(film.title);
    const prev = byTitle.get(k);
    if (!prev || film.votes > prev.votes) byTitle.set(k, film);
  }
  return [...byTitle.values()];
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
  console.log(`Universe: ${films.length} films (one per franchise). Fetching credits…`);
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
  // famous connectors only: everyone else is dropped from the graph
  const notable = new Set(
    [...personFilms.entries()]
      .filter(([pid, l]) => l.length >= 2 && (l.length >= MIN_APPEARANCES || personPop.get(pid) >= MIN_POPULARITY))
      .map(([pid]) => pid),
  );
  for (const [pid] of [...personFilms]) if (!notable.has(pid)) personFilms.delete(pid);
  for (const people of filmPeople.values()) for (const pid of [...people.keys()]) if (!notable.has(pid)) people.delete(pid);
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
    // prefer routes whose weakest link is the most famous person, then the most famous overall
    const people = (r) => r.filter((_, i) => i % 2 === 1);
    const score = (r) => [Math.min(...people(r).map(fame)), people(r).reduce((a, p) => a + fame(p), 0)];
    all.sort((a, b) => { const [a1, a2] = score(a), [b1, b2] = score(b); return b1 - a1 || b2 - a2; });
    // second route should differ in films, not just in which person links them
    const filmKey = (r) => r.filter((_, i) => i % 2 === 0).join(",");
    const picked = [all[0]];
    if (MAX_ROUTES > 1) {
      const second = all.find((r) => filmKey(r) !== filmKey(all[0])) ?? all[1];
      if (second) picked.push(second);
    }
    return picked;
  }
  const routeNames = (r) => r.map((x, i) => (i % 2 === 0 ? filmById.get(x).title : personName.get(x)));

  // ---- 3. generate pairs ----
  const order = [...films].sort(() => Math.random() - 0.5);
  const dist = {};
  const pairs = [];
  const bands = [];
  for (let h = MIN_HOPS; h <= MAX_HOPS; h++) bands.push(h);
  const perBand = Math.ceil(TARGET_PAIRS / bands.length);
  const count = (h) => pairs.filter((p) => p.minHops === h).length;

  for (const start of order) {
    if (pairs.length >= TARGET_PAIRS) break;
    const seen = bfs(start.id);
    for (const [, v] of seen) dist[v.dist] = (dist[v.dist] || 0) + 1;

    // famous goals first, within the hop band and not over-represented
    const cands = [...seen.entries()]
      .filter(([, v]) => v.dist >= MIN_HOPS && v.dist <= MAX_HOPS && count(v.dist) < perBand)
      .sort((a, b) => filmById.get(b[0]).votes - filmById.get(a[0]).votes);

    let taken = 0;
    const usedBands = new Set();
    for (const [gid, v] of cands) {
      if (taken >= PAIRS_PER_START || pairs.length >= TARGET_PAIRS) break;
      if (usedBands.has(v.dist)) continue; // spread bands within one start
      const goal = filmById.get(gid);
      const rids = routes(start.id, gid, seen);
      const names = rids.map(routeNames);
      pairs.push({
        start: { id: start.id, title: start.title, year: start.year, poster: start.poster, genres: start.genres },
        goal: { id: goal.id, title: goal.title, year: goal.year, poster: goal.poster, genres: goal.genres },
        minHops: v.dist,
        samplePath: names[0],
        samplePaths: names,
        // same routes as ids, alternating [filmId, personId, filmId, ...] — what the game checks against
        samplePathIds: rids,
      });
      usedBands.add(v.dist);
      taken++;
    }
  }

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
  fs.writeFileSync("data/pairs.json", JSON.stringify(pairs, null, 2));
  saveCache();

  const byHop = {};
  pairs.forEach((p) => (byHop[p.minHops] = (byHop[p.minHops] || 0) + 1));
  console.log("\nFilms reached at each hop count (summed over sampled starts):", dist);
  console.log(`Done. ${pairs.length} pairs -> data/pairs.json`);
  console.log("Hop distribution:", byHop);
  for (const p of pairs.slice(0, 6)) {
    console.log(`\n${p.start.title} -> ${p.goal.title} (${p.minHops} hops)`);
    for (const r of p.samplePaths) console.log("   " + r.join(" -> "));
  }
}

main().catch((e) => { console.error(e); saveCache(); process.exit(1); });
