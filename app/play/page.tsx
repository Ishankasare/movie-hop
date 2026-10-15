import type { Metadata } from "next";
import { Suspense } from "react";
import PlayClient, { PlayLoading } from "@/components/PlayClient";

export const metadata: Metadata = { title: "Play · Movie Hop" };

export default function PlayPage() {
  return (
    <Suspense fallback={<PlayLoading />}>
      <PlayClient />
    </Suspense>
  );
}
