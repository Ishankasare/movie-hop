import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // e2e builds into its own folder so they never clobber a running `next dev`
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  images: { remotePatterns: [{ protocol: "https", hostname: "image.tmdb.org" }] },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    root: process.cwd(),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
