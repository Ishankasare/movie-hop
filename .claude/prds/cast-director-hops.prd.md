# Movie Hop: cast and director hops

## Problem
Casual movie fans playing Movie Hop move between films using TMDB's "similar movies". Those links come from viewing behaviour, so a player often can't see why two films are connected, and the shortest route only makes sense after the fact. One playtest ended with the player saying the movies were "just there for the name's sake". A game you can't reason about turns into guessing, which is a poor foundation for the planned head-to-head races.

## Evidence
- One playtest (Evil Dead Rise → Interstellar, 6 hops): the player matched the shortest length but, on seeing the shortest route, concluded there was no real relation between the films.
- The old pair generator deliberately chose goals from a different primary genre than the start, which made routes harder to reason about. This is observed in the script, not user-reported.
- Assumption: this affects most players, not just this one. Needs validation via a short playtest with 5 or more new players.

## Users
- **Primary**: casual movie fans, mostly on mobile, who want a quick trivia-style round, solo first and 1-v-1 races later. The trigger is a spare couple of minutes or a friend challenge. Exact segment: TBD, needs validation via playtests.
- **Not for**: film-database experts looking for obscure-film trivia, or groups of 3+ (deferred).

## Hypothesis
We believe **hopping film → person → film through main cast and directors, with one vague hint per run**, will **make every link something a player can see and explain**, for **casual movie fans**.
We'll know we're right when **playtesters can explain most of the links on their finished route and say the route felt fair**.

## Success Metrics
| Metric | Target | How measured |
|---|---|---|
| Players who say the route felt fair | TBD (proposal: 4 of 5 playtesters) | Short post-round question in playtests |
| Links a player can explain after a round | TBD (proposal: 80% of links) | Ask playtesters to retell their route |
| Round completion rate (win or give-up, not abandoned) | TBD | Analytics, once deployed |
| Hint used at most once per run | 100% | Enforced by the rule itself |

## Scope
**MVP**: solo game where each hop is film → person (top-billed cast or director) → film, scored by films reached, with pairs from precomputed data and one vague hint per run (counts as a move). Genre and difficulty picker retained.

**Out of scope**
- "Similar movies" links: removed, since they caused the problem.
- Writers, composers and other crew: top-billed cast and director only.
- Multiplayer race and the hint's time penalty: planned next, after the solo rebuild.
- Group rooms, paywall, accounts: deferred until the core loop has real players.

## Delivery Milestones
<!-- Status: pending | in-progress | complete -->

| # | Milestone | Outcome | Status | Plan |
|---|---|---|---|---|
| 1 | Cast/director pairs | A reviewed set of pairs with famous-only connectors and two routes where possible | complete (data generated and sample routes approved; final sign-off TBD) | — |
| 2 | Solo cast/director game | A player can play a full round film → person → film and see linking people on the result screen | pending | — |
| 3 | One-time vague hint | A player can use one hint per run, with a fair penalty | pending | — |
| 4 | Playtest check | 5 or more new players report whether routes feel fair | pending | — |
| 5 | Multiplayer race | Two players race the same pair; hint adds a time penalty | pending | — |
| 6 | Polish and deploy | Public, accessible, mobile-checked release | pending | — |

## Open Questions
- [ ] Should person screens show only films from the precomputed set, making "best possible" exact, or any well-known film, letting a player occasionally beat it?
- [ ] Is a 2–4 hop band right, now that famous actors connect most films?
- [ ] Hint penalty size in multiplayer: flat 15 seconds, or scaled by difficulty?
- [ ] How vague is vague enough: one sentence with genre, decade and link type, or less?
- [ ] Second routes sometimes differ only in the linking person. Is that acceptable, or should it be one route in those cases?

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Famous actors make most pairs too easy | Medium | Medium | Hop band tuning, and review real pair distances before locking the band |
| Cast and director screens feel slower than "similar movies" | Medium | High | Playtest early and keep one TMDB call per click |
| A hint is too revealing or too useless | Medium | Medium | Playtest the wording; keep it to three vague facts |
| Person screens show films outside the precomputed set, so "best possible" can be beaten | Medium | Low | Accept for now, or restrict to the set (open question) |
| TMDB commercial terms once monetised | Low (not yet) | High | Sort out the agreement before ads or subscriptions |

---
*Status: DRAFT — requirements only. Implementation planning pending via /plan.*
