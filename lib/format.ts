export function formatTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function posterUrl(path: string, size: "w185" | "w342" = "w185"): string {
  return `https://image.tmdb.org/t/p/${size}${path}`;
}
