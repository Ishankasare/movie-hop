import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Movie Hop",
    short_name: "Movie Hop",
    description: "Hop from film to film through the actors and directors they share.",
    start_url: "/",
    display: "standalone",
    background_color: "#0c0720",
    theme_color: "#0c0720",
    icons: [
      { src: "/pwa-icon/192", sizes: "192x192", type: "image/png" },
      { src: "/pwa-icon/512", sizes: "512x512", type: "image/png" },
    ],
  };
}
