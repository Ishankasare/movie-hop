import type { Film, Person } from "./types";

export type GameState = {
  /** Films visited, start first. The last one is where the player is now. */
  path: Film[];
  /** via[i] is the person used to hop from path[i] to path[i + 1]. */
  via: Person[];
  /** Every film reached AND every Back counts, so Back can't be used to game the score. */
  moves: number;
  /** The one-per-run hint has been used (it counted as a move). */
  hintUsed: boolean;
  won: boolean;
};

export type GameAction =
  | { type: "hop"; film: Film; via: Person; goalId: number }
  | { type: "back" }
  | { type: "hint" };

export function initialState(start: Film): GameState {
  return { path: [start], via: [], moves: 0, hintUsed: false, won: false };
}

export function gameReducer(state: GameState, action: GameAction): GameState {
  if (state.won) return state;

  switch (action.type) {
    case "hop":
      return {
        ...state,
        path: [...state.path, action.film],
        via: [...state.via, action.via],
        moves: state.moves + 1,
        won: action.film.id === action.goalId,
      };
    case "hint":
      // once per run; costs a move, like Back
      if (state.hintUsed) return state;
      return { ...state, moves: state.moves + 1, hintUsed: true };
    case "back":
      if (state.path.length <= 1) return state;
      return {
        ...state,
        path: state.path.slice(0, -1),
        via: state.via.slice(0, -1),
        moves: state.moves + 1,
        won: false,
      };
  }
}

/** Splits `moves` into forward hops and Back presses (they net out to path length - 1; a hint is 1 move). */
export function movesBreakdown(state: GameState): { hops: number; backs: number } {
  const net = state.path.length - 1;
  const moves = state.moves - (state.hintUsed ? 1 : 0);
  return { hops: (moves + net) / 2, backs: (moves - net) / 2 };
}
