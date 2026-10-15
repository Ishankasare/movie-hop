import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import RoomClient from "@/components/race/RoomClient";
import { isValidCode, normalizeCode } from "@/lib/race";

export const metadata: Metadata = { title: "Race room · Movie Hop" };

export default function RoomPage(props: PageProps<"/race/[code]">) {
  return (
    <Suspense
      fallback={
        <p className="py-24 text-center text-muted" role="status">
          Connecting to the room…
        </p>
      }
    >
      <Room params={props.params} />
    </Suspense>
  );
}

async function Room({ params }: { params: PageProps<"/race/[code]">["params"] }) {
  const code = normalizeCode((await params).code);
  if (!isValidCode(code)) {
    return (
      <main className="mx-auto max-w-xl px-4 pt-14 pb-28 text-center">
        <h1 className="text-2xl font-black">That isn&apos;t a room code</h1>
        <p className="mt-2 text-muted">Room codes have 5 letters or numbers.</p>
        <Link href="/race" className="mt-6 inline-block rounded-full border border-line px-5 py-2 font-semibold hover:bg-surface-hi">
          Back to Race
        </Link>
      </main>
    );
  }
  return <RoomClient code={code} />;
}
