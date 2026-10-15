import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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

export const metadata: Metadata = {
  title: "Movie Hop",
  description: "Hop from one film to another through similar movies. Fewest hops wins.",
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
        <TabBar />
      </body>
    </html>
  );
}
