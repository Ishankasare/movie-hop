"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import Game from "@/components/Game";
import { cleanNickname, countdown, findPair, isPicker, msUntil, opponentPresence, randomNickname, seats } from "@/lib/race";
import type { Pair } from "@/lib/pairs";
import type { Room, RoomPlayer, RoundResult, Snapshot } from "@/lib/race";
import { supabaseConfigured } from "@/lib/supabase";
import { useNickname } from "./nickname";
import {
  AwayBanner,
  Card,
  CountdownPanel,
  FinishedPanel,
  LobbyPanel,
  PickPanel,
  PrimaryButton,
  ReadyPanel,
  RoundOverPanel,
  WaitingPanel,
} from "./Panels";
import { useRoom, type RoomApi } from "./useRoom";
import { useTicker } from "./useTicker";

const NEXT_ROUND_AFTER_S = 8;
const nowMs = () => Date.now();

/** performance.now() value at the server's start time, so the round timer matches the opponent's. */
function perfStart(startAtIso: string, offset: number): number {
  return performance.now() - (Date.now() + offset - new Date(startAtIso).getTime());
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-xl px-4 pt-8 pb-28">
      <h1 className="sr-only">Movie Hop race room</h1>
      {children}
    </main>
  );
}

export default function RoomClient({ code }: { code: string }) {
  const api = useRoom(code);
  const { load } = api;

  if (!supabaseConfigured) {
    return (
      <Shell>
        <Card>
          <h2 className="text-xl font-black">Race isn&apos;t set up yet</h2>
          <p className="mt-2 text-sm text-muted">
            This site has no Supabase settings. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local.
          </p>
        </Card>
      </Shell>
    );
  }
  if (load.phase === "loading") {
    return (
      <Shell>
        <p className="py-20 text-center text-muted" role="status">
          Connecting to the room…
        </p>
      </Shell>
    );
  }
  if (load.phase === "error") {
    return (
      <Shell>
        <Card className="text-center">
          <h2 className="text-xl font-black">Couldn&apos;t open the room</h2>
          <p className="mt-2 text-sm text-muted">{load.message}</p>
          <Link href="/race" className="mt-4 inline-block rounded-full border border-line px-5 py-2 font-semibold hover:bg-surface-hi">
            Back to Race
          </Link>
        </Card>
      </Shell>
    );
  }
  if (load.phase === "not_member") return <Shell><JoinPanel code={code} api={api} /></Shell>;

  return (
    <Shell>
      <RoomView api={api} myId={load.myId} snapshot={load.snapshot} offset={load.offset} />
    </Shell>
  );
}

// ---------------------------------------------------------------------------------------------

function JoinPanel({ code, api }: { code: string; api: RoomApi }) {
  const [nickname, setNickname] = useNickname();
  return (
    <Card className="text-center">
      <p className="text-xs font-semibold tracking-widest text-muted uppercase">You&apos;ve been invited</p>
      <p className="mt-1 text-4xl font-black tracking-[0.2em] text-accent-soft">{code}</p>
      <label htmlFor="nick" className="mt-5 block text-left text-sm font-semibold text-muted">
        Your nickname
      </label>
      <input
        id="nick"
        value={nickname}
        onChange={(e) => setNickname(e.target.value)}
        maxLength={16}
        placeholder="e.g. Ishan"
        className="mt-1 w-full rounded-lg border border-line bg-surface-hi px-3 py-2"
      />
      <div className="mt-4">
        <PrimaryButton onClick={() => void api.join(cleanNickname(nickname) || randomNickname())} disabled={api.busy} testId="join-room">
          Join room
        </PrimaryButton>
      </div>
      {api.error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {api.error}
        </p>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------

function RoomView({ api, myId, snapshot, offset }: { api: RoomApi; myId: string; snapshot: Snapshot; offset: number }) {
  const t = useTicker(250);
  const { room, players, results } = snapshot;
  const { me, opponent } = seats(players, myId);
  const pair = findPair(room.pair_key);
  const presence = opponentPresence(opponent, offset, t);
  const showAway = !!opponent && presence.away && room.status !== "lobby" && room.status !== "finished";

  return (
    <>
      <header className="mb-4 flex items-center justify-between text-sm">
        <Link href="/race" className="text-muted hover:text-foreground">
          ← Leave
        </Link>
        <span className="text-muted">
          Room <span className="font-bold tracking-widest text-foreground">{room.code}</span>
          {room.status !== "lobby" && room.status !== "finished" && ` · round ${room.round_no}/${room.rounds_total}`}
        </span>
      </header>

      {showAway && (
        <AwayBanner
          name={opponent!.nickname}
          silentMs={presence.silentMs}
          canForfeit={presence.canForfeit}
          onForfeit={() => void api.forfeit()}
          busy={api.busy}
        />
      )}

      {room.status === "lobby" && <LobbyPanel room={room} players={players} />}

      {room.status === "picking" && (
        <PickPanel
          key={`${room.match_no}-${room.round_no}`}
          room={room}
          isPicker={isPicker(room, myId)}
          pickerName={players.find((p) => p.player_id === room.picker_id)?.nickname ?? "Your opponent"}
          busy={api.busy}
          onPick={(category, p) => void api.pick(category, `${p.start.id}-${p.goal.id}`)}
        />
      )}

      {room.status === "ready" && (
        <ReadyPanel room={room} pair={pair} me={me} opponent={opponent} busy={api.busy} onReady={() => void api.ready()} />
      )}

      {room.status === "racing" && (
        <RacingView api={api} room={room} pair={pair} me={me} opponent={opponent} results={results} offset={offset} nowMs={t} />
      )}

      {room.status === "round_over" && (
        <RoundOverView key={room.round_no} api={api} room={room} players={players} results={results} myId={myId} />
      )}

      {room.status === "finished" && (
        <FinishedPanel
          room={room}
          players={players}
          results={results}
          myId={myId}
          rematchBusy={api.busy}
          onRematch={() => void api.rematch()}
        />
      )}

      {api.error && (
        <p role="alert" className="mt-3 text-center text-sm text-danger">
          {api.error}
        </p>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------------------------

function RacingView({
  api,
  room,
  pair,
  me,
  opponent,
  results,
  offset,
  nowMs: t,
}: {
  api: RoomApi;
  room: Room;
  pair: Pair | undefined;
  me: RoomPlayer | undefined;
  opponent: RoomPlayer | undefined;
  results: RoundResult[];
  offset: number;
  nowMs: number;
}) {
  const cd = room.start_at ? countdown(room.start_at, offset, t) : { phase: "wait" as const, n: 0 };
  const mine = results.find((r) => r.round_no === room.round_no && r.player_id === me?.player_id);
  const windowLeft = room.deadline_at && room.first_finish_ms !== null ? msUntil(room.deadline_at, offset, t) : null;
  const waiting = <WaitingPanel mine={mine} opponentName={opponent?.nickname ?? "your opponent"} windowLeftMs={windowLeft} />;

  if (!pair) {
    return (
      <Card>
        <p className="text-danger">This round&apos;s pair isn&apos;t in your data. Reload the page.</p>
      </Card>
    );
  }
  if (cd.phase !== "go") return <CountdownPanel pair={pair} count={cd} />;
  if (mine) return waiting; // reloaded after finishing: just wait for the round to close

  return (
    <RaceBoard
      key={`${room.match_no}-${room.round_no}`}
      api={api}
      room={room}
      pair={pair}
      opponent={opponent}
      offset={offset}
      waiting={waiting}
    />
  );
}

function RaceBoard({
  api,
  room,
  pair,
  opponent,
  offset,
  waiting,
}: {
  api: RoomApi;
  room: Room;
  pair: Pair;
  opponent: RoomPlayer | undefined;
  offset: number;
  waiting: React.ReactNode;
}) {
  // fixed at mount: the shared start, as seen on this device's clock
  const [startedAtPerf] = useState(() => perfStart(room.start_at!, offset));
  return (
    <div className="-mx-4 -mt-4">
      <Game
        pair={pair}
        onPlayAgain={() => undefined}
        race={{
          startedAtPerf,
          opponent: { name: opponent?.nickname ?? "Opponent", moves: opponent?.moves ?? 0 },
          onMoves: api.progress,
          onHint: () => void api.hint(),
          onFinish: (moves) => void api.finish(moves),
          onGiveUp: () => void api.giveUp(),
          waiting,
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

function RoundOverView({
  api,
  room,
  players,
  results,
  myId,
}: {
  api: RoomApi;
  room: Room;
  players: RoomPlayer[];
  results: RoundResult[];
  myId: string;
}) {
  const t = useTicker(500);
  const [mountedAt] = useState(nowMs);
  const secondsLeft = Math.max(0, NEXT_ROUND_AFTER_S - Math.floor((t - mountedAt) / 1000));
  const called = useRef(false);
  const round = room.round_no;
  const { nextRound } = api;

  // advance automatically (both players may call it: the database only moves on once)
  useEffect(() => {
    if (secondsLeft > 0 || called.current) return;
    called.current = true;
    void nextRound(round);
  }, [secondsLeft, nextRound, round]);

  return (
    <RoundOverPanel
      room={room}
      players={players}
      results={results}
      myId={myId}
      secondsLeft={secondsLeft}
      onNext={() => {
        called.current = true;
        void nextRound(round);
      }}
    />
  );
}
