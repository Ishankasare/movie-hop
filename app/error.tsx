"use client";

import Link from "next/link";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto max-w-xl px-4 pt-24 pb-28 text-center">
      <h1 className="text-2xl font-black">Something went wrong</h1>
      <p className="mt-2 text-muted">The page hit a snag. You can try again, or head back home.</p>
      <div className="mt-8 flex flex-col gap-3">
        <button type="button" onClick={reset} className="btn-glow rounded-full px-8 py-3 font-bold text-accent-ink">
          Try again
        </button>
        <Link href="/" className="rounded-full border border-line px-8 py-3 font-semibold hover:bg-surface-hi">
          Back to Home
        </Link>
      </div>
    </main>
  );
}
