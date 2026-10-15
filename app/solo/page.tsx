import type { Metadata } from "next";
import PlayPicker from "@/components/PlayPicker";

export const metadata: Metadata = { title: "Solo · Movie Hop" };

export default function SoloPage() {
  return (
    <main className="mx-auto flex max-w-xl flex-col items-center px-4 pt-14 pb-28 text-center">
      <h1 className="text-4xl font-black tracking-tight">Solo</h1>
      <p className="mt-3 text-muted">
        Hop from the start film to the goal film through the cast and directors they share.
      </p>
      <PlayPicker />
    </main>
  );
}
