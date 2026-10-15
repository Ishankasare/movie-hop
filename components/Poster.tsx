import Image from "next/image";
import { posterUrl } from "@/lib/format";

type Props = {
  title: string;
  poster: string | null;
  size?: "w185" | "w342";
  /** Alt text; defaults to "<title> poster". */
  alt?: string;
  className?: string;
};

export default function Poster({ title, poster, size = "w185", alt, className = "" }: Props) {
  if (!poster) {
    return (
      <div
        className={`flex aspect-[2/3] items-center justify-center rounded-md bg-surface-hi p-2 text-center text-xs text-muted ${className}`}
      >
        {title}
      </div>
    );
  }
  return (
    <Image
      src={posterUrl(poster, size)}
      alt={alt ?? `${title} poster`}
      width={size === "w342" ? 342 : 185}
      height={size === "w342" ? 513 : 278}
      unoptimized
      className={`aspect-[2/3] rounded-md bg-surface-hi object-cover ${className}`}
    />
  );
}
