"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { HopBand } from "@/lib/pairs";
import {
  cleanNickname,
  friendlyError,
  isValidCode,
  normalizeCode,
  PLAYER_OPTIONS,
  randomNickname,
  ROUNDS_OPTIONS,
} from "@/lib/race";
import { callRpc, ensureUser, supabaseConfigured } from "@/lib/supabase";
import { useNickname } from "./nickname";
import { Card, PrimaryButton } from "./Panels";

const BANDS: { value: HopBand | null; label: string }[] = [
  { value: 2, label: "2" },
  { value: 3, label: "3" },
  { value: 4, label: "4" },
  { value: null, label: "Any" },
];

function Segment<T extends string | number | null>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <fieldset className="mt-4">
      <legend className="text-sm font-semibold text-muted">{label}</legend>
      <div className="mt-2 grid gap-2" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
        {options.map((o) => (
          <button
            key={o.label}
            type="button"
            aria-pressed={value === o.value}
            onClick={() => onChange(o.value)}
            className={`rounded-lg border px-3 py-2 font-semibold ${
              value === o.value ? "border-accent bg-accent text-accent-ink" : "border-line bg-surface-hi hover:bg-surface"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export default function RaceHome() {
  const router = useRouter();
  const [nickname, setNickname] = useNickname();
  const [players, setPlayers] = useState<2 | 3 | 4>(4);
  const [rounds, setRounds] = useState<2 | 4 | 8>(4);
  const [band, setBand] = useState<HopBand | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!supabaseConfigured) {
    return (
      <Card className="mt-8 text-left">
        <p className="text-xs font-semibold tracking-widest text-accent-soft uppercase">Not set up yet</p>
        <p className="mt-2 text-sm">
          Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local, then restart the app.
        </p>
      </Card>
    );
  }

  const nick = () => cleanNickname(nickname) || randomNickname();

  async function create() {
    setBusy(true);
    setError(null);
    try {
      await ensureUser();
      const newCode = await callRpc<string>("create_room", {
        p_nickname: nick(),
        p_rounds: rounds,
        p_band: band,
        p_max_players: players,
      });
      router.push(`/race/${newCode}`);
    } catch (e) {
      setError(friendlyError(e instanceof Error ? e.message : ""));
      setBusy(false);
    }
  }

  async function join() {
    const c = normalizeCode(code);
    if (!isValidCode(c)) {
      setError("Room codes have 5 letters or numbers.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await ensureUser();
      await callRpc("join_room", { p_code: c, p_nickname: nick() });
      router.push(`/race/${c}`);
    } catch (e) {
      setError(friendlyError(e instanceof Error ? e.message : ""));
      setBusy(false);
    }
  }

  return (
    <div className="mt-8 space-y-4 text-left">
      <Card>
        <label htmlFor="nickname" className="text-sm font-semibold text-muted">
          Your nickname
        </label>
        <input
          id="nickname"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          maxLength={16}
          placeholder="e.g. Ishan"
          autoComplete="nickname"
          className="mt-1 w-full rounded-lg border border-line bg-surface-hi px-3 py-2"
        />
      </Card>

      <Card>
        <h2 className="text-lg font-black">Host a match</h2>
        <Segment
          label="Players (the host can start early with 2 or more)"
          options={PLAYER_OPTIONS.map((n) => ({ value: n, label: `${n} players` }))}
          value={players}
          onChange={setPlayers}
        />
        <Segment
          label="Rounds (each player takes turns picking the genre)"
          options={ROUNDS_OPTIONS.map((n) => ({ value: n, label: `${n} rounds` }))}
          value={rounds}
          onChange={setRounds}
        />
        <Segment label="Hops (movies to reach, at best)" options={BANDS} value={band} onChange={setBand} />
        <div className="mt-5">
          <PrimaryButton onClick={() => void create()} disabled={busy} testId="create-room">
            Create room
          </PrimaryButton>
        </div>
      </Card>

      <Card>
        <h2 className="text-lg font-black">Join a friend</h2>
        <label htmlFor="code" className="mt-2 block text-sm font-semibold text-muted">
          Room code
        </label>
        <input
          id="code"
          value={code}
          onChange={(e) => setCode(normalizeCode(e.target.value))}
          inputMode="text"
          autoCapitalize="characters"
          autoComplete="off"
          maxLength={5}
          placeholder="ABC12"
          className="mt-1 w-full rounded-lg border border-line bg-surface-hi px-3 py-2 text-center text-2xl font-bold tracking-[0.3em] uppercase"
        />
        <div className="mt-4">
          <PrimaryButton onClick={() => void join()} disabled={busy || code.length < 5} testId="join-by-code">
            Join room
          </PrimaryButton>
        </div>
      </Card>

      {error && (
        <p role="alert" className="text-center text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
