"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { friendlyError, msUntil, parseSnapshot, serverOffset, type Snapshot } from "@/lib/race";
import { callRpc, ensureUser, getSupabase } from "@/lib/supabase";

const HEARTBEAT_MS = 5000;
const POLL_MS = 2500;

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
};

/**
 * Everything a room screen needs: the live snapshot (realtime + a slow poll as a safety net),
 * a heartbeat so the opponent can tell we're here, the timeout settle call, and the actions.
 * The database decides everything; this hook only asks and displays.
 */
export function useRoom(code: string): RoomApi {
  const [load, setLoad] = useState<Load>({ phase: "loading" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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

  // realtime: any change to this room's rows triggers a re-read
  useEffect(() => {
    if (!member) return;
    const db = getSupabase();
    const ch = db
      .channel(`room:${code}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "rooms", filter: `code=eq.${code}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "room_players", filter: `room_code=eq.${code}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "round_results", filter: `room_code=eq.${code}` }, refresh)
      .subscribe();
    return () => {
      void db.removeChannel(ch);
    };
  }, [member, code, refresh]);

  // slow poll as a safety net, plus heartbeat
  useEffect(() => {
    if (!member) return;
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") void fetchSnapshot();
    }, POLL_MS);
    const beat = setInterval(() => void callRpc("touch", { p_code: code }).catch(() => undefined), HEARTBEAT_MS);
    void callRpc("touch", { p_code: code }).catch(() => undefined);
    return () => {
      clearInterval(poll);
      clearInterval(beat);
    };
  }, [member, code, fetchSnapshot]);

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
    }),
    [load, error, busy, run, code],
  );
}
