import type { Metadata } from "next";

export const metadata: Metadata = { title: "Race · Movie Hop" };

export default function RacePage() {
  return (
    <main className="mx-auto max-w-xl px-4 pt-14 pb-28 text-center">
      <h1 className="text-4xl font-black tracking-tight">Race a friend</h1>
      <p className="mt-3 text-muted">Same start, same goal, two players. Lowest total time wins the match.</p>

      <section className="mt-8 rounded-2xl border border-line bg-surface p-6 text-left">
        <p className="text-xs font-semibold tracking-widest text-accent-soft uppercase">Coming soon</p>
        <ul className="mt-3 space-y-2 text-sm">
          <li>Host creates a room and shares a short code.</li>
          <li>2 or 4 rounds; players take turns picking the genre of the goal film.</li>
          <li>Both tap Ready, then a 3-2-1 countdown starts the round.</li>
          <li>You only see your opponent&apos;s hop count, never their route.</li>
        </ul>
      </section>
    </main>
  );
}
