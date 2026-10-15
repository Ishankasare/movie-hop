import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-xl px-4 pt-24 pb-28 text-center">
      <p className="text-6xl font-black text-accent-soft">404</p>
      <h1 className="mt-3 text-2xl font-black">This scene was cut</h1>
      <p className="mt-2 text-muted">We couldn&apos;t find that page. Let&apos;s get you back to the movies.</p>
      <Link href="/" className="btn-glow mt-8 inline-block rounded-full px-8 py-3 font-bold text-accent-ink">
        Back to Home
      </Link>
    </main>
  );
}
