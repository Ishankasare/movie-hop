import Image from "next/image";
import { ALL_PAIRS } from "@/lib/pairs";
import { posterUrl } from "@/lib/format";

/** Tilted poster collage for the Home hero. Posters come from the pair data, picked deterministically. */
function collagePosters(count: number): { title: string; poster: string }[] {
  const seen = new Set<string>();
  const out: { title: string; poster: string }[] = [];
  for (const p of ALL_PAIRS) {
    for (const f of [p.goal, p.start]) {
      if (f.poster && !seen.has(f.poster) && out.length < count) {
        seen.add(f.poster);
        out.push({ title: f.title, poster: f.poster });
      }
    }
  }
  return out;
}

export default function Collage() {
  const posters = collagePosters(9);
  const columns = [posters.slice(0, 3), posters.slice(3, 6), posters.slice(6, 9)];
  return (
    <div
      aria-hidden
      className="relative -mx-4 h-[22rem] overflow-hidden [mask-image:linear-gradient(to_bottom,black_45%,transparent_98%)]"
    >
      <div className="absolute inset-x-0 -top-6 mx-auto flex w-[120%] -translate-x-[8%] -rotate-6 justify-center gap-3">
        {columns.map((col, c) => (
          <div key={c} className={`flex w-1/3 flex-col gap-3 ${c === 1 ? "mt-10" : c === 2 ? "mt-3" : ""}`}>
            {col.map((p) => (
              <Image
                key={p.poster}
                src={posterUrl(p.poster, "w342")}
                alt=""
                width={342}
                height={513}
                unoptimized
                className="aspect-[2/3] w-full rounded-2xl object-cover shadow-lg shadow-black/40 ring-1 ring-white/10"
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
