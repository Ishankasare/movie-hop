import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

// Integration test for supabase/migrations/0001_race.sql, run against the real project in .env.local with
// three anonymous players (host, guest, an outsider). Skipped when the Supabase variables aren't set.
try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local: the suite below is skipped
}
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function player(): Promise<{ db: SupabaseClient; id: string }> {
  const db = createClient(URL!, KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await db.auth.signInAnonymously();
  if (error || !data.user) throw new Error(`anonymous sign-in failed: ${error?.message}`);
  return { db, id: data.user.id };
}

type Snapshot = {
  now: string;
  room: Record<string, unknown> & { status: string; round_no: number; picker_id: string; match_no: number };
  players: { player_id: string; moves: number; hints: number; nickname: string }[];
  results: { player_id: string; round_no: number; outcome: string; ms: number | null; hints: number }[];
};

async function snap(db: SupabaseClient, code: string): Promise<Snapshot> {
  const { data, error } = await db.rpc("room_snapshot", { p_code: code });
  if (error) throw new Error(error.message);
  return data as Snapshot;
}

async function rpc(db: SupabaseClient, fn: string, args: Record<string, unknown>) {
  const { error } = await db.rpc(fn, args);
  if (error) throw new Error(error.message);
}

async function expectError(p: Promise<unknown>, message: string) {
  await expect(p).rejects.toThrow(message);
}

describe.skipIf(!URL || !KEY)("race database functions", () => {
  let host: Awaited<ReturnType<typeof player>>;
  let guest: Awaited<ReturnType<typeof player>>;
  let outsider: Awaited<ReturnType<typeof player>>;
  let code = "";

  beforeAll(async () => {
    [host, guest, outsider] = await Promise.all([player(), player(), player()]);
  }, 30_000);

  it("creates a room and validates the input", async () => {
    await expectError(rpc(host.db, "create_room", { p_nickname: "", p_rounds: 2, p_band: null }), "bad_nickname");
    await expectError(rpc(host.db, "create_room", { p_nickname: "Host", p_rounds: 3, p_band: null }), "bad_rounds");
    await expectError(rpc(host.db, "create_room", { p_nickname: "Host", p_rounds: 2, p_band: 9 }), "bad_band");

    const { data, error } = await host.db.rpc("create_room", { p_nickname: "Host", p_rounds: 2, p_band: 3 });
    expect(error).toBeNull();
    code = data as string;
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{5}$/);
    expect((await snap(host.db, code)).room.status).toBe("lobby");
  });

  it("only members can see a room, and clients cannot write tables directly", async () => {
    await expectError(snap(outsider.db, code), "room_not_found");
    const { data } = await outsider.db.from("rooms").select("*").eq("code", code);
    expect(data).toEqual([]);

    const insert = await outsider.db.from("rooms").insert({ code: "HACK1", host_id: outsider.id, rounds_total: 2 });
    expect(insert.error).not.toBeNull();
    const update = await host.db.from("rooms").update({ status: "finished" }).eq("code", code);
    expect(update.error).not.toBeNull();
  });

  it("the guest joins; a third player cannot; the coin flip picks one of the two", async () => {
    await rpc(guest.db, "join_room", { p_code: code.toLowerCase(), p_nickname: "Guest" });
    await expectError(rpc(outsider.db, "join_room", { p_code: code, p_nickname: "Late" }), "room_full");
    await expectError(rpc(guest.db, "join_room", { p_code: "ZZZZZ", p_nickname: "Guest" }), "room_not_found");

    const s = await snap(host.db, code);
    expect(s.room.status).toBe("picking");
    expect(s.room.round_no).toBe(1);
    expect([host.id, guest.id]).toContain(s.room.picker_id);
    expect(s.players.map((p) => p.nickname)).toEqual(["Host", "Guest"]);
  });

  it("only the picker can pick, with a valid category and pair, once per pair", async () => {
    const s = await snap(host.db, code);
    const [picker, other] = s.room.picker_id === host.id ? [host, guest] : [guest, host];

    await expectError(rpc(other.db, "pick_round", { p_code: code, p_category: "marvel", p_pair_key: "1-2" }), "not_your_pick");
    await expectError(rpc(picker.db, "pick_round", { p_code: code, p_category: "nonsense", p_pair_key: "1-2" }), "bad_category");
    await expectError(rpc(picker.db, "pick_round", { p_code: code, p_category: "marvel", p_pair_key: "x" }), "bad_pair");

    await rpc(picker.db, "pick_round", { p_code: code, p_category: "marvel", p_pair_key: "1-2" });
    const after = await snap(host.db, code);
    expect(after.room).toMatchObject({ status: "ready", category: "marvel", pair_key: "1-2" });
  });

  it("starts the race 4 s after both are ready, and plays a round with a simultaneous finish", async () => {
    await expectError(rpc(host.db, "finish_round", { p_code: code, p_moves: 2 }), "wrong_state");
    await rpc(host.db, "set_ready", { p_code: code });
    expect((await snap(guest.db, code)).room.status).toBe("ready");
    await rpc(guest.db, "set_ready", { p_code: code });

    const racing = await snap(host.db, code);
    expect(racing.room.status).toBe("racing");
    const startIn = new Date(racing.room.start_at as string).getTime() - new Date(racing.now).getTime();
    expect(startIn).toBeGreaterThan(2500);
    expect(startIn).toBeLessThanOrEqual(4000);

    // too early: the countdown hasn't finished, and the server clock decides
    await expectError(rpc(host.db, "finish_round", { p_code: code, p_moves: 2 }), "too_early");

    // the opponent sees only hop counts
    await rpc(host.db, "report_progress", { p_code: code, p_moves: 3 });
    const seen = await snap(guest.db, code);
    expect(seen.players.find((p) => p.player_id === host.id)?.moves).toBe(3);
    expect(JSON.stringify(seen)).not.toMatch(/path|route/i);

    // host takes the hint (+15 s), then both finish at the same moment
    await rpc(host.db, "use_hint", { p_code: code });
    await sleep(startIn + 400);
    const results = await Promise.allSettled([
      rpc(host.db, "finish_round", { p_code: code, p_moves: 3 }),
      rpc(guest.db, "finish_round", { p_code: code, p_moves: 2 }),
    ]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);

    const done = await snap(host.db, code);
    expect(done.room.status).toBe("round_over");
    expect(done.results).toHaveLength(2);
    const h = done.results.find((r) => r.player_id === host.id)!;
    const g = done.results.find((r) => r.player_id === guest.id)!;
    expect(h.hints).toBe(1);
    expect(h.ms!).toBeGreaterThanOrEqual(15_000); // hint penalty is added by the server
    expect(g.ms!).toBeLessThan(10_000);
    expect(done.room.first_finish_ms).not.toBeNull();

    // a finished player cannot be recorded twice
    await rpc(host.db, "finish_round", { p_code: code, p_moves: 3 }).catch(() => undefined);
    expect((await snap(host.db, code)).results).toHaveLength(2);
  }, 30_000);

  it("next_round is idempotent and the other player picks next", async () => {
    const before = await snap(host.db, code);
    await Promise.all([
      rpc(host.db, "next_round", { p_code: code, p_from_round: 1 }),
      rpc(guest.db, "next_round", { p_code: code, p_from_round: 1 }),
    ]);
    const after = await snap(host.db, code);
    expect(after.room.round_no).toBe(2);
    expect(after.room.status).toBe("picking");
    expect(after.room.picker_id).not.toBe(before.room.picker_id);
    // the snapshot keeps every round of the match (the scoreboard needs them); round 2 hasn't started yet
    expect(after.results.filter((r) => r.round_no === 1)).toHaveLength(2);
    expect(after.results.filter((r) => r.round_no === 2)).toEqual([]);
  });

  it("a gave-up player scores the cap, and an already-played pair is refused", async () => {
    const s = await snap(host.db, code);
    const [picker, other] = s.room.picker_id === host.id ? [host, guest] : [guest, host];
    await expectError(rpc(picker.db, "pick_round", { p_code: code, p_category: "dc", p_pair_key: "1-2" }), "pair_already_played");
    await rpc(picker.db, "pick_round", { p_code: code, p_category: null, p_pair_key: "3-4" });
    await rpc(host.db, "set_ready", { p_code: code });
    await rpc(guest.db, "set_ready", { p_code: code });
    const racing = await snap(host.db, code);
    const startIn = new Date(racing.room.start_at as string).getTime() - new Date(racing.now).getTime();
    await sleep(startIn + 400);

    await rpc(other.db, "finish_round", { p_code: code, p_moves: 2 });
    await rpc(picker.db, "give_up", { p_code: code });

    const done = await snap(host.db, code);
    expect(done.room.status).toBe("round_over");
    const round2 = done.results.filter((r) => r.round_no === 2);
    expect(round2).toHaveLength(2);
    const fin = round2.find((r) => r.player_id === other.id)!;
    const gaveUp = round2.find((r) => r.player_id === picker.id)!;
    expect(gaveUp.outcome).toBe("gaveup");
    expect(gaveUp.ms).toBe((done.room.first_finish_ms as number) + 60_000);
    expect(fin.ms!).toBeLessThan(gaveUp.ms!);
  }, 30_000);

  it("refuses a forfeit while the opponent is still active", async () => {
    await rpc(host.db, "touch", { p_code: code });
    await rpc(guest.db, "touch", { p_code: code });
    await expectError(rpc(host.db, "forfeit", { p_code: code }), "opponent_still_here");
  });

  it("finishes the match after the last round, then a rematch needs both players", async () => {
    await rpc(host.db, "next_round", { p_code: code, p_from_round: 2 });
    expect((await snap(host.db, code)).room.status).toBe("finished");

    await rpc(host.db, "rematch", { p_code: code });
    expect((await snap(host.db, code)).room.status).toBe("finished"); // waiting for the guest
    await rpc(guest.db, "rematch", { p_code: code });

    const fresh = await snap(host.db, code);
    expect(fresh.room.status).toBe("picking");
    expect(fresh.room.match_no).toBe(2);
    expect(fresh.room.round_no).toBe(1);
    expect(fresh.results).toEqual([]);
  });
});
