import type { Metadata } from "next";
import RaceHome from "@/components/race/RaceHome";

export const metadata: Metadata = { title: "Race · Movie Hop" };

export default function RacePage() {
  return (
    <main className="mx-auto max-w-xl px-4 pt-14 pb-28 text-center">
      <h1 className="text-4xl font-black tracking-tight">Race a friend</h1>
      <p className="mt-3 text-muted">Same start, same goal, two players. Lowest total time wins the match.</p>

      <RaceHome />

      <section className="mt-8 rounded-2xl border border-line bg-surface p-5 text-left">
        <p className="text-xs font-semibold tracking-widest text-accent-soft uppercase">How a match works</p>
        <ul className="mt-3 space-y-2 text-sm">
          <li>The host shares a room code. Both players get the same start and goal film.</li>
          <li>Players take turns choosing the genre of the goal film.</li>
          <li>Both tap Ready, then a 3-2-1 countdown starts the round.</li>
          <li>You only see your opponent&apos;s hop count, never their route.</li>
          <li>Once someone finishes, the other has 60 seconds. A hint adds 15 seconds to your time.</li>
        </ul>
      </section>
    </main>
  );
}
