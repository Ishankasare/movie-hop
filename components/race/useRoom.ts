"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  friendlyError,
  msUntil,
  parseSnapshot,
  pollIntervalMs,
  serverOffset,
  wantsRealtime,
  type Snapshot,
} from "@/lib/race";
import { callRpc, ensureUser, getSupabase } from "@/lib/supabase";

const HEARTBEAT_MS = 5000;

type Load =
  | { phase: "loading" }
  | { phase: "not_member"; myId: string }
  | { phase: "error"; message: string }
  | { phase: "ready"; myId: string; snapshot: Snapshot; offset: number };

export type RoomApi = {
  load: Load;
  /** Latest friendly error from an action (cleared by the next successful one). */
  error: string | null;
  busy: boolean;
  /** Server time in ms, corrected for this device's clock. */
  serverNow: () => number;
  join: (nickname: string) => Promise<boolean>;
  pick: (category: string | null, pairKey: string) => Promise<boolean>;
  ready: () => Promise<boolean>;
  progress: (moves: number) => void;
  hint: () => Promise<boolean>;
  finish: (moves: number) => Promise<boolean>;
  giveUp: () => Promise<boolean>;
  nextRound: (fromRound: number) => Promise<boolean>;
  forfeit: () => Promise<boolean>;
  rematch: () => Promise<boolean>;
  /** Host: start the match from the lobby with the players who are in. */
  start: () => Promise<boolean>;
  /** Leave the room (mid-match you are scored at the cap and the others carry on). */
  leave: () => Promise<boolean>;
};

/**
 * Everything a room screen needs: the live snapshot, a heartbeat so the others can tell we're here,
 * the timeout settle call, and the actions. Realtime is only used while a match is moving (see
 * wantsRealtime); the rest of the time, and whenever realtime is unavailable, it polls instead.
 * The database decides everything; this hook only asks and displays.
 */
export function useRoom(code: string): RoomApi {
  const [load, setLoad] = useState<Load>({ phase: "loading" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rtState, setRtState] = useState<"ok" | "down">("down");
  const offsetRef = useRef(0);
  const alive = useRef(true);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastProgress = useRef(-1);

  const member = load.phase === "ready";

  const fetchSnapshot = useCallback(async () => {
    try {
      const id = await ensureUser();
      const raw = await callRpc("room_snapshot", { p_code: code });
      if (!alive.current) return;
      const snapshot = parseSnapshot(raw);
      const offset = serverOffset(snapshot.now, Date.now());
      offsetRef.current = offset;
      setLoad({ phase: "ready", myId: id, snapshot, offset });
    } catch (e) {
      if (!alive.current) return;
      const message = e instanceof Error ? e.message : "";
      if (message.includes("room_not_found")) {
        try {
          const id = await ensureUser();
          if (alive.current) setLoad({ phase: "not_member", myId: id });
        } catch {
          if (alive.current) setLoad({ phase: "error", message: friendlyError("not_signed_in") });
        }
      } else if (message.includes("supabase_not_configured")) {
        setLoad({ phase: "error", message: "The race isn't set up on this site yet." });
      } else {
        // a hiccup after we already have a snapshot is ignored: the next poll will recover
        setLoad((prev) => (prev.phase === "ready" ? prev : { phase: "error", message: friendlyError(message) }));
      }
    }
  }, [code]);

  /** Re-read soon (several realtime events arrive together, so batch them). */
  const refresh = useCallback(() => {
    if (refreshTimer.current) return;
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      void fetchSnapshot();
    }, 60);
  }, [fetchSnapshot]);

  useEffect(() => {
    alive.current = true;
    const first = setTimeout(() => void fetchSnapshot(), 0); // a timer callback, not the effect body, sets state
    return () => {
      alive.current = false;
      clearTimeout(first);
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, [fetchSnapshot]);

  const status = load.phase === "ready" ? load.snapshot.room.status : null;
  const useRealtime = member && wantsRealtime(status);
  const realtimeOk = useRealtime && rtState === "ok";

  // realtime (only while a match is moving): any change to this room's rows triggers a re-read.
  // If the connection can't be made (e.g. the plan's limit is reached) rtState says so and we poll faster instead.
  useEffect(() => {
    if (!useRealtime) return;
    const db = getSupabase();
    const ch = db
      .channel(`room:${code}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "rooms", filter: `code=eq.${code}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "room_players", filter: `room_code=eq.${code}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "round_results", filter: `room_code=eq.${code}` }, refresh)
      .subscribe((s) => {
        if (s === "SUBSCRIBED") {
          setRtState("ok");
          refresh(); // catch up on anything that happened before the connection was ready
        } else if (s === "CHANNEL_ERROR" || s === "TIMED_OUT" || s === "CLOSED") {
          setRtState("down");
        }
      });
    return () => {
      void db.removeChannel(ch);
    };
  }, [useRealtime, code, refresh]);

  // polling: a safety net while realtime works, the main way of staying up to date otherwise
  const myId = load.phase === "ready" ? load.myId : undefined;
  const askedForRematch =
    load.phase === "ready" && load.snapshot.players.find((p) => p.player_id === myId)?.rematch === true;
  const pollMs = pollIntervalMs(status, realtimeOk, status === "finished" && askedForRematch);
  useEffect(() => {
    if (!member) return;
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") void fetchSnapshot();
    }, pollMs);
    const onVisible = () => {
      if (document.visibilityState === "visible") void fetchSnapshot(); // catch up after a phone wakes up
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [member, pollMs, fetchSnapshot]);

  // heartbeat so the others can tell we're still here
  useEffect(() => {
    if (!member) return;
    const beat = setInterval(() => void callRpc("touch", { p_code: code }).catch(() => undefined), HEARTBEAT_MS);
    void callRpc("touch", { p_code: code }).catch(() => undefined);
    return () => clearInterval(beat);
  }, [member, code]);

  // the server resets hop counts for each round, so forget what we last reported
  const racing = load.phase === "ready" && load.snapshot.room.status === "racing";
  useEffect(() => {
    if (!racing) lastProgress.current = -1;
  }, [racing]);

  // when the round's deadline passes, ask the server to close it (idempotent)
  const deadline = load.phase === "ready" && load.snapshot.room.status === "racing" ? load.snapshot.room.deadline_at : null;
  useEffect(() => {
    if (!deadline) return;
    const wait = Math.max(0, msUntil(deadline, offsetRef.current, Date.now())) + 400;
    const t = setTimeout(() => {
      void callRpc("settle", { p_code: code })
        .catch(() => undefined)
        .then(() => fetchSnapshot());
    }, wait);
    return () => clearTimeout(t);
  }, [deadline, code, fetchSnapshot]);

  const run = useCallback(
    async (fn: string, args: Record<string, unknown>, opts: { quiet?: boolean } = {}): Promise<boolean> => {
      if (!opts.quiet) setBusy(true);
      try {
        await callRpc(fn, { p_code: code, ...args });
        if (alive.current) setError(null);
        await fetchSnapshot();
        return true;
      } catch (e) {
        if (alive.current) setError(friendlyError(e instanceof Error ? e.message : ""));
        return false;
      } finally {
        if (alive.current && !opts.quiet) setBusy(false);
      }
    },
    [code, fetchSnapshot],
  );

  return useMemo<RoomApi>(
    () => ({
      load,
      error,
      busy,
      serverNow: () => Date.now() + offsetRef.current,
      join: (nickname) => run("join_room", { p_nickname: nickname }),
      pick: (category, pairKey) => run("pick_round", { p_category: category, p_pair_key: pairKey }),
      ready: () => run("set_ready", {}),
      progress: (moves) => {
        if (moves === lastProgress.current) return;
        lastProgress.current = moves;
        void callRpc("report_progress", { p_code: code, p_moves: moves }).catch(() => undefined);
      },
      hint: () => run("use_hint", {}, { quiet: true }),
      finish: (moves) => run("finish_round", { p_moves: moves }),
      giveUp: () => run("give_up", {}),
      nextRound: (fromRound) => run("next_round", { p_from_round: fromRound }, { quiet: true }),
      forfeit: () => run("forfeit", {}),
      rematch: () => run("rematch", {}),
      start: () => run("start_match", {}),
      leave: () => run("leave_room", {}),
    }),
    [load, error, busy, run, code],
  );
}
