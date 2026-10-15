import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Suspense } from "react";
import TabBar from "@/components/TabBar";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Absolute base for share-link metadata: Vercel provides the production domain; set NEXT_PUBLIC_SITE_URL to override.
const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000");

const description = "Hop from one film to another through the actors and directors they share. Fewest hops wins. Play solo or race a friend.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: "Movie Hop", template: "%s" },
  description,
  openGraph: { title: "Movie Hop", description, siteName: "Movie Hop", type: "website" },
  twitter: { card: "summary_large_image", title: "Movie Hop", description },
};

export const viewport: Viewport = {
  themeColor: "#0c0720",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <div className="flex-1">{children}</div>
        <footer className="px-4 pt-6 pb-24 text-center text-xs text-muted">
          This product uses the TMDB API but is not endorsed or certified by{" "}
          <a
            href="https://www.themoviedb.org/"
            className="underline hover:text-foreground"
            target="_blank"
            rel="noreferrer"
          >
            TMDB
          </a>
          .
        </footer>
        {/* the current path isn't known when a dynamic page (/race/<code>) is prerendered */}
        <Suspense fallback={null}>
          <TabBar />
        </Suspense>
      </body>
    </html>
  );
}
