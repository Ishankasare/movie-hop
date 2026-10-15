"use client";

import Image from "next/image";
import { UNIVERSES } from "@/lib/categories";
import { posterUrl } from "@/lib/format";
import type { CategoryOption } from "@/lib/pairs";

function Tile({
  option,
  count,
  selected,
  onSelect,
}: {
  option: CategoryOption;
  count: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const blurb = UNIVERSES.find((u) => u.key === option.key)?.blurb;
  const posters = option.universe ? option.posters : option.posters.slice(0, 1);
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={`${option.name}, ${count} pairs`}
      disabled={count === 0}
      onClick={onSelect}
      className={`group relative block w-full overflow-hidden rounded-2xl text-left ring-2 transition disabled:opacity-40 ${
        selected ? "ring-accent" : "ring-transparent hover:ring-line"
      } ${option.universe ? "aspect-[4/3]" : "aspect-[3/4]"}`}
    >
      <span aria-hidden className="absolute inset-0 flex bg-surface-hi">
        {posters.map((p) => (
          <Image
            key={p}
            src={posterUrl(p, "w185")}
            alt=""
            width={185}
            height={278}
            unoptimized
            className="h-full min-w-0 flex-1 object-cover"
          />
        ))}
      </span>
      <span aria-hidden className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent" />
      <span className="absolute inset-x-0 bottom-0 p-2.5">
        <span className={`block font-bold leading-tight ${option.universe ? "text-lg" : "text-sm"}`}>{option.name}</span>
        <span className="block text-[11px] text-muted">{blurb ?? `${count} pairs`}</span>
      </span>
      {selected && (
        <span
          aria-hidden
          className="absolute top-2 right-2 flex h-6 w-6 items-center justify-center rounded-full bg-accent text-sm font-bold text-accent-ink"
        >
          ✓
        </span>
      )}
    </button>
  );
}

type Props = {
  categories: CategoryOption[];
  /** pairs each tile would give right now (tiles with 0 are disabled) */
  counts: Map<string, number>;
  selected: string | undefined;
  onSelect: (key: string) => void;
};

/** Universe tiles (Marvel, DC, …) on top, then the genre tiles. Used by the solo picker and the race pick screen. */
export default function CategoryTiles({ categories, counts, selected, onSelect }: Props) {
  const universes = categories.filter((c) => c.universe);
  const genres = categories.filter((c) => !c.universe);
  const tile = (c: CategoryOption) => (
    <Tile key={c.key} option={c} count={counts.get(c.key) ?? 0} selected={selected === c.key} onSelect={() => onSelect(c.key)} />
  );
  return (
    <>
      <h3 className="mt-4 text-xs font-semibold tracking-widest text-accent-soft uppercase">Universes</h3>
      <div className="mt-2 grid grid-cols-2 gap-3">{universes.map(tile)}</div>
      <h3 className="mt-5 text-xs font-semibold tracking-widest text-accent-soft uppercase">Genres</h3>
      <div className="mt-2 grid grid-cols-3 gap-2.5">{genres.map(tile)}</div>
    </>
  );
}
