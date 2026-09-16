import { ImageResponse } from "next/og";

export const alt = "Irkanti — Malta's auction marketplace";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", width: "100%", height: "100%", background: "#090a0b", color: "#eee8dc", padding: 80 }}>
      <div style={{ display: "flex", color: "#c7a15e", fontSize: 64, letterSpacing: 14 }}>IRKANTI</div>
      <div style={{ display: "flex", fontSize: 48, marginTop: 48 }}>Remarkable assets.</div>
      <div style={{ display: "flex", fontSize: 48, color: "#c7a15e" }}>Exceptional outcomes.</div>
      <div style={{ display: "flex", fontSize: 24, marginTop: 48 }}>irkanti.com · Malta’s auction marketplace</div>
    </div>,
    size,
  );
}
