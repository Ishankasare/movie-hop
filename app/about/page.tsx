import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "About & credits · Movie Hop" };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-4 rounded-2xl border border-line bg-surface p-5">
      <h2 className="text-lg font-black">{title}</h2>
      <div className="mt-2 space-y-2 text-sm leading-relaxed text-muted">{children}</div>
    </section>
  );
}

export default function AboutPage() {
  return (
    <main className="mx-auto max-w-xl px-4 pt-14 pb-28">
      <h1 className="text-center text-4xl font-black tracking-tight">About &amp; credits</h1>

      <Section title="What is Movie Hop?">
        <p>
          A little movie game. You&apos;re given a start film and a goal film, and you hop between them through the
          actors and directors they share. Fewest hops wins. You can play solo or race a friend in real time.
        </p>
      </Section>

      <Section title="Where the movie data comes from">
        <p>
          Film, cast and poster information comes from{" "}
          <a href="https://www.themoviedb.org/" target="_blank" rel="noreferrer" className="text-accent-soft underline">
            The Movie Database (TMDB)
          </a>
          . This product uses the TMDB API but is not endorsed or certified by TMDB.
        </p>
        <p>
          We only use well-known films and recognisable cast and directors, and every route in the game is checked
          ahead of time so a shortest route always exists.
        </p>
      </Section>

      <Section title="What we store about you">
        <p>There are no accounts, no ads and no tracking. In a race we keep just:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>an anonymous player ID, created when you open a race room;</li>
          <li>the nickname you type;</li>
          <li>the room&apos;s results (times and hop counts, never your route).</li>
        </ul>
        <p>
          On your own device we remember your nickname, your last genre and hop-count choice, and the last few pairs you
          played. Clear your browser&apos;s site data to remove all of it. Old race rooms are deleted automatically.
        </p>
      </Section>

      <Section title="Good to know">
        <p>
          Movie Hop is a hobby project made for fun. It&apos;s free to play, and the free services it runs on are for
          non-commercial use.
        </p>
      </Section>

      <p className="mt-8 text-center">
        <Link href="/" className="rounded-full border border-line px-6 py-2 font-semibold hover:bg-surface-hi">
          Back to Home
        </Link>
      </p>
    </main>
  );
}
