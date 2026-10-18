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

  // needs supabase/migrations/0002_race_hardening.sql
  it("limits each player to 10 new rooms per hour, and players cannot run the cleanup", async () => {
    const spammer = await player(); // a fresh anonymous player, so the limit is theirs alone
    for (let i = 0; i < 10; i++) {
      const { error } = await spammer.db.rpc("create_room", { p_nickname: "Spam", p_rounds: 2, p_band: null });
      expect(error, `room ${i + 1}`).toBeNull();
    }
    await expectError(rpc(spammer.db, "create_room", { p_nickname: "Spam", p_rounds: 2, p_band: null }), "too_many_rooms");

    const { error } = await spammer.db.rpc("cleanup_old_rooms");
    expect(error).not.toBeNull();
  }, 60_000);
});

// needs supabase/migrations/0003_players_2_to_4.sql
describe.skipIf(!URL || !KEY)("race with 3 and 4 players", () => {
  type P = Awaited<ReturnType<typeof player>>;

  async function room(host: P, max: number, rounds = 4) {
    const { data, error } = await host.db.rpc("create_room", { p_nickname: "P0", p_rounds: rounds, p_band: null, p_max_players: max });
    expect(error).toBeNull();
    return data as string;
  }
  const seatOf = (s: Snapshot, id: string) => (s.players as unknown as { player_id: string; seat: number }[]).find((p) => p.player_id === id)!.seat;

  async function startRace(code: string, ps: P[]) {
    const s = await snap(ps[0].db, code);
    const picker = ps.find((p) => p.id === s.room.picker_id)!;
    await rpc(picker.db, "pick_round", { p_code: code, p_category: null, p_pair_key: `${100 + s.room.round_no}-${200 + s.room.round_no}` });
    for (const p of ps) await rpc(p.db, "set_ready", { p_code: code });
    const racing = await snap(ps[0].db, code);
    const startIn = new Date(racing.room.start_at as string).getTime() - new Date(racing.now).getTime();
    await sleep(startIn + 400);
    return { picker, racing };
  }

  it("validates the room size and rounds", async () => {
    const host = await player();
    await expectError(rpc(host.db, "create_room", { p_nickname: "H", p_rounds: 4, p_band: null, p_max_players: 5 }), "bad_players");
    await expectError(rpc(host.db, "create_room", { p_nickname: "H", p_rounds: 3, p_band: null, p_max_players: 4 }), "bad_rounds");
    const { error } = await host.db.rpc("create_room", { p_nickname: "H", p_rounds: 8, p_band: 3, p_max_players: 3 });
    expect(error).toBeNull(); // 8 rounds is allowed now
  });

  it("4 players: the lobby fills, the match starts by itself, everyone must be ready, picking rotates in seat order", async () => {
    const ps = await Promise.all([player(), player(), player(), player()]);
    const code = await room(ps[0], 4);

    for (let i = 1; i < 3; i++) {
      await rpc(ps[i].db, "join_room", { p_code: code, p_nickname: `P${i}` });
      expect((await snap(ps[0].db, code)).room.status).toBe("lobby"); // not full yet
    }
    const fifth = await player();
    await rpc(ps[3].db, "join_room", { p_code: code, p_nickname: "P3" });
    await expectError(rpc(fifth.db, "join_room", { p_code: code, p_nickname: "P4" }), "room_full");

    let s = await snap(ps[0].db, code);
    expect(s.room.status).toBe("picking");
    expect(s.players).toHaveLength(4);
    expect((s.players as unknown as { seat: number }[]).map((p) => p.seat).sort()).toEqual([0, 1, 2, 3]);
    const firstPicker = s.room.picker_id;

    // 3 of 4 ready is not enough
    const picker = ps.find((p) => p.id === firstPicker)!;
    await rpc(picker.db, "pick_round", { p_code: code, p_category: "marvel", p_pair_key: "101-201" });
    for (const p of ps.slice(0, 3)) await rpc(p.db, "set_ready", { p_code: code });
    expect((await snap(ps[0].db, code)).room.status).toBe("ready");
    await rpc(ps[3].db, "set_ready", { p_code: code });
    s = await snap(ps[0].db, code);
    expect(s.room.status).toBe("racing");
    const startIn = new Date(s.room.start_at as string).getTime() - new Date(s.now).getTime();
    await sleep(startIn + 400);

    // all four finish at the same moment, one of them with a hint
    await rpc(ps[2].db, "use_hint", { p_code: code });
    const results = await Promise.allSettled(ps.map((p) => rpc(p.db, "finish_round", { p_code: code, p_moves: 2 })));
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled", "fulfilled", "fulfilled"]);
    s = await snap(ps[0].db, code);
    expect(s.room.status).toBe("round_over");
    expect(s.results).toHaveLength(4);
    expect(s.results.find((r) => r.player_id === ps[2].id)!.ms!).toBeGreaterThanOrEqual(15_000);

    // the next round is picked by the next seat, wrapping around, for every round
    let prev = firstPicker;
    for (let round = 1; round <= 3; round++) {
      await Promise.all(ps.map((p) => rpc(p.db, "next_round", { p_code: code, p_from_round: round }))); // idempotent
      s = await snap(ps[0].db, code);
      expect(s.room.round_no).toBe(round + 1);
      expect(seatOf(s, s.room.picker_id)).toBe((seatOf(s, prev) + 1) % 4);
      prev = s.room.picker_id;
      if (round < 3) {
        await startRace(code, ps);
        await Promise.all(ps.map((p) => rpc(p.db, "give_up", { p_code: code })));
        expect((await snap(ps[0].db, code)).room.status).toBe("round_over");
      }
    }
  }, 120_000);

  it("3 players: only the host can start early; a player who leaves is scored at the cap and the others carry on", async () => {
    const ps = await Promise.all([player(), player(), player()]);
    const code = await room(ps[0], 4);
    await expectError(rpc(ps[0].db, "start_match", { p_code: code }), "need_more_players");
    await rpc(ps[1].db, "join_room", { p_code: code, p_nickname: "P1" });
    await rpc(ps[2].db, "join_room", { p_code: code, p_nickname: "P2" });
    expect((await snap(ps[0].db, code)).room.status).toBe("lobby");

    await expectError(rpc(ps[1].db, "start_match", { p_code: code }), "not_host");
    await rpc(ps[0].db, "start_match", { p_code: code });
    expect((await snap(ps[0].db, code)).room.status).toBe("picking");

    await startRace(code, ps);
    // P2 leaves mid-race; the round closes when the other two are done
    await rpc(ps[2].db, "leave_room", { p_code: code });
    expect((await snap(ps[0].db, code)).room.status).toBe("racing");
    await rpc(ps[0].db, "finish_round", { p_code: code, p_moves: 2 });
    await rpc(ps[1].db, "finish_round", { p_code: code, p_moves: 2 });
    const s = await snap(ps[0].db, code);
    expect(s.room.status).toBe("round_over");
    expect(s.results).toHaveLength(3);
    const leaver = s.results.find((r) => r.player_id === ps[2].id)!;
    expect(leaver.outcome).toBe("timeout");
    expect(leaver.ms).toBe((s.room.first_finish_ms as number) + 60_000);

    // the leaver never picks again, and the match goes on with two players
    await rpc(ps[0].db, "next_round", { p_code: code, p_from_round: 1 });
    expect((await snap(ps[0].db, code)).room.picker_id).not.toBe(ps[2].id);

    // when only one player is left, they win
    await rpc(ps[1].db, "leave_room", { p_code: code });
    const end = await snap(ps[0].db, code);
    expect(end.room.status).toBe("finished");
    expect(end.room.forfeit_winner).toBe(ps[0].id);
  }, 120_000);

  it("a lobby member can leave; if the host leaves, the room goes", async () => {
    const [host, guest, later] = await Promise.all([player(), player(), player()]);
    const code = await room(host, 3);
    await rpc(guest.db, "join_room", { p_code: code, p_nickname: "G" });
    await rpc(guest.db, "leave_room", { p_code: code });
    expect((await snap(host.db, code)).players).toHaveLength(1);
    await rpc(later.db, "join_room", { p_code: code, p_nickname: "L" }); // the seat is free again
    expect((await snap(host.db, code)).players).toHaveLength(2);

    await rpc(host.db, "leave_room", { p_code: code });
    await expectError(snap(later.db, code), "room_not_found");
  });

  it("a rematch needs every remaining player", async () => {
    const ps = await Promise.all([player(), player(), player()]);
    const code = await room(ps[0], 3, 2);
    await rpc(ps[1].db, "join_room", { p_code: code, p_nickname: "P1" });
    await rpc(ps[2].db, "join_room", { p_code: code, p_nickname: "P2" });
    for (let round = 1; round <= 2; round++) {
      await startRace(code, ps);
      await Promise.all(ps.map((p) => rpc(p.db, "give_up", { p_code: code })));
      await rpc(ps[0].db, "next_round", { p_code: code, p_from_round: round });
    }
    expect((await snap(ps[0].db, code)).room.status).toBe("finished");

    await rpc(ps[0].db, "rematch", { p_code: code });
    await rpc(ps[1].db, "rematch", { p_code: code });
    expect((await snap(ps[0].db, code)).room.status).toBe("finished"); // P2 hasn't asked yet
    await rpc(ps[2].db, "rematch", { p_code: code });
    const fresh = await snap(ps[0].db, code);
    expect(fresh.room).toMatchObject({ status: "picking", match_no: 2, round_no: 1 });
    expect(fresh.results).toEqual([]);
  }, 120_000);
});
