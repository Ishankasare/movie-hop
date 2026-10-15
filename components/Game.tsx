"use client";

import { useEffect, useState } from "react";
import { castOf, filmsOf } from "@/lib/graph";
import { formatTime } from "@/lib/format";
import { gameReducer, initialState, type GameAction } from "@/lib/game";
import { hintFor } from "@/lib/hint";
import type { Pair } from "@/lib/pairs";
import type { Film, Person } from "@/lib/types";
import Poster from "./Poster";
import ResultPanel from "./ResultPanel";

type Props = {
  pair: Pair;
  onPlayAgain: () => void;
};

type Finished = { outcome: "won" | "gaveup"; ms: number };

/** Wall-clock helper kept at module level: it is only ever called from effects and event handlers. */
const now = () => performance.now();

function toFilm(f: Film): Film {
  return { id: f.id, title: f.title, year: f.year, poster: f.poster };
}

export default function Game({ pair, onPlayAgain }: Props) {
  const [game, setGame] = useState(() => initialState(toFilm(pair.start)));
  // The clock starts when the round is revealed (this component mounts).
  const [startedAt] = useState(() => now());
  const [elapsed, setElapsed] = useState(0);
  const [finished, setFinished] = useState<Finished | null>(null);
  // Person whose films are showing. Opening / closing this is free; only reaching a film is a move.
  const [selected, setSelected] = useState<Person | null>(null);
  const [hintText, setHintText] = useState<string | null>(null);

  const current = game.path[game.path.length - 1];
  const isFinished = finished !== null;
  const goal = pair.goal;

  useEffect(() => {
    if (isFinished) return;
    const timer = setInterval(() => setElapsed(now() - startedAt), 250);
    return () => clearInterval(timer);
  }, [isFinished, startedAt]);

  function dispatch(action: GameAction) {
    const next = gameReducer(game, action);
    if (next === game) return;
    setGame(next);
    setSelected(null);
    if (next.won) setFinished({ outcome: "won", ms: now() - startedAt });
  }

  // One hint per run; it costs a move and doesn't close the person screen you're on.
  function revealHint() {
    const next = gameReducer(game, { type: "hint" });
    if (next === game) return;
    setGame(next);
    setHintText(hintFor(pair));
  }

  const cast = castOf(current.id);
  const films = selected ? filmsOf(selected.id, current.id) : [];
  const shownMs = finished ? finished.ms : elapsed;

  return (
    <main className="mx-auto max-w-3xl px-4 py-5">
      {/* start -> goal header */}
      <header className="flex items-center gap-3 rounded-xl border border-line bg-surface p-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Poster title={pair.start.title} poster={pair.start.poster} className="w-10 shrink-0" />
          <div className="min-w-0">
            <p className="text-[10px] font-semibold tracking-widest text-muted uppercase">Start</p>
            <p className="truncate text-sm font-semibold" data-testid="start-title">
              {pair.start.title}
            </p>
          </div>
        </div>
        <span aria-hidden className="text-accent-soft">
          →
        </span>
        <div className="flex min-w-0 flex-1 items-center justify-end gap-2 text-right">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold tracking-widest text-accent-soft uppercase">Goal</p>
            <p className="truncate text-sm font-semibold" data-testid="goal-title">
              {goal.title}
            </p>
          </div>
          <Poster title={goal.title} poster={goal.poster} className="w-10 shrink-0" />
        </div>
      </header>

      {/* stats */}
      <div className="mt-3 flex items-center justify-between text-sm">
        <p>
          <span className="text-muted">Hops </span>
          <span className="font-bold tabular-nums" data-testid="hop-count">
            {game.moves}
          </span>
        </p>
        <p>
          <span className="text-muted">Time </span>
          <span className="font-bold tabular-nums" data-testid="timer">
            {formatTime(shownMs)}
          </span>
        </p>
      </div>

      {hintText && !finished && (
        <p
          role="note"
          data-testid="hint-text"
          className="mt-3 rounded-lg border border-accent/40 bg-surface p-3 text-sm"
        >
          <span aria-hidden>💡 </span>
          {hintText}
        </p>
      )}

      {/* breadcrumb: Film › Person › Film … */}
      <nav aria-label="Your path" className="mt-3">
        <ol className="flex flex-wrap items-center gap-x-1 gap-y-1 text-xs text-muted">
          {game.path.map((f, i) => {
            const last = i === game.path.length - 1;
            return (
              <li key={`${f.id}-${i}`} className="flex items-center gap-1">
                {i > 0 && (
                  <>
                    <span aria-hidden>›</span>
                    <span className="text-accent-soft">{game.via[i - 1].name}</span>
                    <span aria-hidden>›</span>
                  </>
                )}
                <span
                  className={last && !selected ? "font-semibold text-foreground" : ""}
                  aria-current={last && !selected ? "step" : undefined}
                >
                  {f.title}
                </span>
              </li>
            );
          })}
          {selected && (
            <li className="flex items-center gap-1">
              <span aria-hidden>›</span>
              <span className="font-semibold text-accent-soft">{selected.name}</span>
            </li>
          )}
        </ol>
      </nav>

      {finished ? (
        <div className="mt-5">
          <ResultPanel
            pair={pair}
            game={game}
            outcome={finished.outcome}
            ms={finished.ms}
            onPlayAgain={onPlayAgain}
          />
        </div>
      ) : (
        <>
          <section className="mt-5" aria-labelledby="current-heading">
            <p className="text-xs text-muted">You&apos;re at</p>
            <h2 id="current-heading" className="text-2xl font-black" data-testid="current-title">
              {current.title}
              {current.year && <span className="ml-2 text-base font-normal text-muted">{current.year}</span>}
            </h2>
            <p className="mt-1 text-sm text-muted">
              {selected
                ? `Pick a film with ${selected.name} to hop to.`
                : "Pick someone from this film: they'll lead you to another film."}
            </p>
          </section>

          <section className="mt-4">
            {selected ? (
              films.length === 0 ? (
                <p className="rounded-xl border border-line bg-surface p-4" data-testid="dead-end">
                  Dead end: {selected.name} has no other films here. Go back to the cast.
                </p>
              ) : (
                <ul
                  className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5"
                  aria-label={`Films with ${selected.name}`}
                >
                  {films.map((film) => (
                    <li key={film.id}>
                      <button
                        type="button"
                        onClick={() => dispatch({ type: "hop", film, via: selected, goalId: goal.id })}
                        aria-label={`Hop to ${film.title}${film.year ? ` (${film.year})` : ""}`}
                        className="group block w-full text-left"
                      >
                        <Poster
                          title={film.title}
                          poster={film.poster}
                          className="w-full transition group-hover:brightness-110 group-hover:ring-2 group-hover:ring-accent"
                        />
                        <span className="mt-1 line-clamp-2 block text-xs leading-tight">{film.title}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )
            ) : cast.length === 0 ? (
              <p className="rounded-xl border border-line bg-surface p-4" data-testid="dead-end">
                Dead end: nobody from this film leads anywhere else. Go Back.
              </p>
            ) : (
              <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5" aria-label="Cast and director">
                {cast.map(({ person, role }) => (
                  <li key={person.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(person)}
                      aria-label={`Choose ${person.name}${role === "director" ? " (director)" : ""}`}
                      className="group block w-full text-left"
                    >
                      <Poster
                        title={person.name}
                        poster={person.photo}
                        alt={`${person.name}`}
                        className="w-full transition group-hover:brightness-110 group-hover:ring-2 group-hover:ring-accent"
                      />
                      <span className="mt-1 line-clamp-2 block text-xs leading-tight">{person.name}</span>
                      <span className="block text-[10px] tracking-wide text-muted uppercase">
                        {role === "director" ? "Director" : "Cast"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            {selected ? (
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="rounded-full border border-line px-5 py-2 font-semibold hover:bg-surface-hi"
              >
                Back to cast
              </button>
            ) : (
              <button
                type="button"
                onClick={() => dispatch({ type: "back" })}
                disabled={game.path.length <= 1}
                className="rounded-full border border-line px-5 py-2 font-semibold hover:bg-surface-hi disabled:opacity-40"
              >
                Back
              </button>
            )}
            <button
              type="button"
              onClick={revealHint}
              disabled={game.hintUsed}
              className="rounded-full border border-line px-5 py-2 font-semibold hover:bg-surface-hi disabled:opacity-40"
            >
              {game.hintUsed ? "Hint used" : "Hint (+1 hop)"}
            </button>
            <button
              type="button"
              onClick={() => setFinished({ outcome: "gaveup", ms: now() - startedAt })}
              className="rounded-full border border-line px-5 py-2 font-semibold text-muted hover:bg-surface-hi"
            >
              Give up
            </button>
            {!selected && <span className="text-xs text-muted">Back counts as a hop.</span>}
          </div>
        </>
      )}
    </main>
  );
}
