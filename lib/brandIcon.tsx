/** The app icon (a violet tile with an "H"), drawn for next/og's ImageResponse at any size. */
export function BrandIcon({ size }: { size: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(135deg, #8f63ff, #4b23c9)",
        borderRadius: Math.round(size * 0.22),
        color: "#ffffff",
        fontSize: Math.round(size * 0.66),
        fontWeight: 900,
        lineHeight: 1,
      }}
    >
      H
    </div>
  );
}
