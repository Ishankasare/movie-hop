// precompute_pairs.mjs — the data pipeline for Movie Speedrun.
//
// WHY THIS EXISTS: the game can't pick two random films and hope they're a
// good round. From the playtest we learned two hard rules:
//   1. A good pair is 4–6 hops apart (floor 4 = not trivial, ceiling 6 = not a slog).
//   2. EVERY film on the shortest path must be recognizable, or a human can't
//      navigate it (Lion King→Conjuring exists at 7 hops but routes through
//      "House of the Long Shadows" — unsolvable by instinct, so it's a BAD pair).
// This script finds pairs that satisfy both, offline, and writes pairs.json.
// The live game then just serves a precomputed pair and fetches each film's
// recommendations one call at a time as the player clicks (that part is cheap).
//
// RUN (on your machine, where TMDB is reachable):
//   TMDB_KEY=your_key_here node precompute_pairs.mjs
// Node 18+ (you have 24). No dependencies. Caches to graph_cache.json so
// re-runs are fast. Outputs pairs.json.

import fs from 'node:fs';

const KEY = process.env.TMDB_KEY;
if (!KEY) { console.error('Set TMDB_KEY env var first.'); process.exit(1); }

const BASE = 'https://api.themoviedb.org/3';
const CACHE_FILE = 'graph_cache.json';

// ---- tuning knobs ----
const POOL_PAGES    = 12;    // /movie/popular pages to seed start films (~20 each)
const MIN_VOTES     = 800;   // "recognizable" threshold — a film a normal person knows
const MIN_HOPS      = 4;     // difficulty floor (shortest path)
const MAX_HOPS      = 6;     // difficulty ceiling
const NEIGH         = 18;    // recommendations treated as edges per film
const MAX_ROUTES    = 2;     // record up to 2 distinct shortest routes per pair (any route wins)
const PAIRS_PER_START = 2;   // cap goals taken from each start, for variety
const TARGET_PAIRS  = 80;    // stop once we have this many good pairs

// ---- tiny cached TMDB client ----
let cache = {};
try { cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch {}
let dirty = 0;
function saveCache(){ if(dirty){ fs.writeFileSync(CACHE_FILE, JSON.stringify(cache)); dirty=0; } }

async function get(path){
  const k = path;
  if (cache[k]) return cache[k];
  for (let attempt=0; attempt<4; attempt++){
    const r = await fetch(`${BASE}${path}${path.includes('?')?'&':'?'}api_key=${KEY}`);
    if (r.status === 429){ await new Promise(s=>setTimeout(s, 1500*(attempt+1))); continue; }
    if (!r.ok) throw new Error(`TMDB ${r.status} for ${path}`);
    const j = await r.json();
    cache[k] = j; dirty++;
    if (dirty % 50 === 0) saveCache();
    return j;
  }
  throw new Error('rate limited repeatedly on ' + path);
}

const norm = t => (t||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();

// recommendations as directed edges, keeping only fields we need
async function recs(id){
  const j = await get(`/movie/${id}/recommendations`);
  return (j.results||[]).slice(0, NEIGH).map(m=>({
    id:m.id, title:m.title, year:(m.release_date||'').slice(0,4),
    poster:m.poster_path, votes:m.vote_count||0, genres:m.genre_ids||[]
  }));
}

// ---- 1. seed a pool of recognizable start films ----
async function buildPool(){
  const films = new Map();
  for (let p=1; p<=POOL_PAGES; p++){
    const j = await get(`/movie/popular?page=${p}`);
    for (const m of (j.results||[])){
      if ((m.vote_count||0) >= MIN_VOTES)
        films.set(m.id, {id:m.id, title:m.title, year:(m.release_date||'').slice(0,4),
          poster:m.poster_path, votes:m.vote_count, genres:m.genre_ids||[]});
    }
  }
  return [...films.values()];
}

// ---- 2. restricted BFS: only ever step onto recognizable films, dedupe remakes ----
// Returns map of reachable filmId -> {dist, node, parents[]} for dist in 1..MAX_HOPS.
async function reachable(start){
  const startNorm = norm(start.title);
  const seen = new Map();              // id -> {dist,node,parents}
  const seenTitles = new Set([startNorm]);
  let frontier = [{id:start.id, node:start}];
  for (let dist=1; dist<=MAX_HOPS; dist++){
    const next = [];
    for (const f of frontier){
      let list;
      try { list = await recs(f.id); } catch { continue; }
      for (const nb of list){
        if (nb.votes < MIN_VOTES) continue;          // must be recognizable
        const known = seen.get(nb.id);
        if (known) {                                     // alternate shortest route (same depth)
          if (known.dist === dist && known.parents.length < MAX_ROUTES && !known.parents.includes(f.id)) known.parents.push(f.id);
          continue;
        }
        const nt = norm(nb.title);
        if (nt === startNorm || seenTitles.has(nt)) continue; // dedupe remakes/dupes
        seen.set(nb.id, {dist, node:nb, parents:[f.id]});
        seenTitles.add(nt);
        next.push({id:nb.id, node:nb});
      }
    }
    frontier = next;
    if (!frontier.length) break;
  }
  return seen;
}

// Up to MAX_ROUTES distinct shortest routes (arrays of films) from start to goal.
function routes(start, goalId, seen){
  const startNode = {id:start.id,title:start.title,year:start.year,poster:start.poster};
  const walk = id => {
    if (id === start.id) return [[startNode]];
    const e = seen.get(id); if (!e) return [];
    const out = [];
    for (const p of e.parents){
      for (const path of walk(p)){ out.push([...path, e.node]); if (out.length >= MAX_ROUTES) return out; }
    }
    return out;
  };
  return walk(goalId);
}

// ---- 3. generate pairs ----
const PRIMARY = g => (g && g[0]) || 0;   // crude "primary genre" for a different-feel check

async function main(){
  console.log('Seeding film pool…');
  const pool = await buildPool();
  console.log(`Pool: ${pool.length} recognizable films.`);

  const pairs = [];
  const shuffled = pool.sort(()=>Math.random()-0.5);

  for (const start of shuffled){
    if (pairs.length >= TARGET_PAIRS) break;
    let seen;
    try { seen = await reachable(start); } catch { continue; }

    // goal candidates: reached at dist in [MIN_HOPS,MAX_HOPS], different primary genre
    const cands = [...seen.values()]
      .filter(e => e.dist >= MIN_HOPS && e.dist <= MAX_HOPS)
      .filter(e => PRIMARY(e.node.genres) !== PRIMARY(start.genres))
      .sort((a,b)=> b.node.votes - a.node.votes);   // prefer most famous goals

    let taken = 0;
    for (const c of cands){
      if (taken >= PAIRS_PER_START || pairs.length >= TARGET_PAIRS) break;
      const rs = routes(start, c.node.id, seen);
      pairs.push({
        start: {id:start.id, title:start.title, year:start.year, poster:start.poster, genres:start.genres},
        goal:  {id:c.node.id, title:c.node.title, year:c.node.year, poster:c.node.poster, genres:c.node.genres},
        minHops: c.dist,
        samplePath: rs[0].map(f=>f.title),           // first route (kept for backwards compatibility)
        samplePaths: rs.map(r=>r.map(f=>f.title))    // 1–2 distinct shortest routes (all recognizable)
      });
      taken++;
    }
    saveCache();
    console.log(`${start.title}: +${taken} pairs (total ${pairs.length})`);
  }

  fs.mkdirSync('data',{recursive:true});
  fs.writeFileSync('data/pairs.json', JSON.stringify(pairs, null, 2));
  saveCache();

  const byHop = {}; pairs.forEach(p=>byHop[p.minHops]=(byHop[p.minHops]||0)+1);
  console.log(`\nDone. ${pairs.length} pairs -> pairs.json`);
  console.log('Hop distribution:', byHop);
  console.log('Example:', pairs[0] ? `${pairs[0].start.title} -> ${pairs[0].goal.title} (${pairs[0].minHops} hops): ${pairs[0].samplePath.join(' -> ')}` : 'none');
}

main().catch(e=>{ console.error(e); saveCache(); process.exit(1); });
