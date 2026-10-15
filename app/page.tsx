import Link from "next/link";
import Collage from "@/components/Collage";

export default function Home() {
  return (
    <main className="mx-auto max-w-xl px-4 pb-24 text-center">
      <Collage />
      <div className="relative -mt-14">
        <h1 className="text-5xl font-black tracking-tight">
          Movie <span className="text-accent-soft">Hop</span>
        </h1>
        <p className="mt-3 text-lg text-muted">
          Hop from one film to another through the actors and directors they share. Fewest hops wins.
        </p>
        <div className="mt-8 flex flex-col gap-3">
          <Link
            href="/solo"
            className="btn-glow rounded-full px-8 py-3.5 text-lg font-bold text-accent-ink"
          >
            Play solo
          </Link>
          <Link
            href="/race"
            className="rounded-full border border-line bg-surface/70 px-8 py-3.5 text-lg font-semibold hover:bg-surface-hi"
          >
            Race a friend
          </Link>
        </div>
      </div>
    </main>
  );
}
