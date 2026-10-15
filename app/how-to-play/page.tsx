import type { Metadata } from "next";

export const metadata: Metadata = { title: "How to play · Movie Hop" };

const STEPS = [
  {
    title: "Get a start and a goal",
    body: "Each round gives you two films. You begin on the start film and need to reach the goal film.",
  },
  {
    title: "Pick someone from the film",
    body: "Every film shows its main cast and director. Choose one: they lead you to their other films.",
  },
  {
    title: "Hop to another film",
    body: "Tap one of their films to move there. Keep going — person, film, person, film — until you land on the goal.",
  },
  {
    title: "Fewest hops, fastest time",
    body: "Every film you reach counts as a hop, and so does Back. The result screen shows the shortest routes.",
  },
];

export default function HowToPlayPage() {
  return (
    <main className="mx-auto max-w-xl px-4 pt-14 pb-28">
      <h1 className="text-center text-4xl font-black tracking-tight">How to play</h1>

      <ol className="mt-8 space-y-3">
        {STEPS.map((s, i) => (
          <li key={s.title} className="flex gap-4 rounded-2xl border border-line bg-surface p-4">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent font-bold text-accent-ink">
              {i + 1}
            </span>
            <div>
              <h2 className="font-bold">{s.title}</h2>
              <p className="mt-1 text-sm text-muted">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>

      <section className="mt-6 rounded-2xl border border-line bg-surface-hi p-4 text-sm">
        <h2 className="font-bold">Stuck? Use the hint</h2>
        <p className="mt-1 text-muted">
          Once per round you can ask for a vague hint about the film just before the goal. It costs one hop
          (and in a race, 15 seconds).
        </p>
      </section>

      <section className="mt-3 rounded-2xl border border-line bg-surface-hi p-4 text-sm">
        <h2 className="font-bold">An example</h2>
        <p className="mt-1 leading-relaxed text-muted">
          <span className="font-semibold text-foreground">The Holiday</span> →{" "}
          <span className="text-accent-soft">Kate Winslet</span> →{" "}
          <span className="font-semibold text-foreground">Titanic</span> →{" "}
          <span className="text-accent-soft">Leonardo DiCaprio</span> →{" "}
          <span className="font-semibold text-foreground">Inception</span>
        </p>
      </section>
    </main>
  );
}
