import { ImageResponse } from "next/og";

export const alt = "Movie Hop: hop from film to film through the actors and directors they share";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const chip = (text: string, accent = false) => (
  <div
    style={{
      display: "flex",
      padding: "14px 26px",
      borderRadius: 999,
      fontSize: 34,
      fontWeight: 700,
      color: accent ? "#c4b0ff" : "#f3efff",
      background: accent ? "rgba(124,77,255,0.25)" : "rgba(255,255,255,0.10)",
      border: accent ? "2px solid rgba(196,176,255,0.6)" : "2px solid rgba(255,255,255,0.18)",
    }}
  >
    {text}
  </div>
);

const arrow = (
  <div style={{ display: "flex", fontSize: 38, color: "#a99ed3" }}>→</div>
);

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "0 90px",
          background: "linear-gradient(135deg, #0c0720 0%, #1d1050 55%, #3b1fa8 100%)",
          color: "#f3efff",
        }}
      >
        <div style={{ display: "flex", fontSize: 150, fontWeight: 900, letterSpacing: -4 }}>
          <span>Movie</span>
          <span style={{ color: "#c4b0ff", marginLeft: 36 }}>Hop</span>
        </div>
        <div style={{ display: "flex", fontSize: 42, color: "#a99ed3", marginTop: 8 }}>
          Hop from film to film through the actors and directors they share.
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 18, marginTop: 64 }}>
          {chip("Inception")}
          {arrow}
          {chip("Leonardo DiCaprio", true)}
          {arrow}
          {chip("Titanic")}
        </div>
        <div style={{ display: "flex", fontSize: 32, color: "#a99ed3", marginTop: 48 }}>
          Fewest hops wins · Play solo or race a friend
        </div>
      </div>
    ),
    { ...size },
  );
}
