import type { Metadata } from "next";
import { Cormorant_Garamond, Manrope } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const display = Cormorant_Garamond({ variable: "--font-display", subsets: ["latin"], weight: ["400", "500", "600"] });
const sans = Manrope({ variable: "--font-sans", subsets: ["latin"], weight: ["400", "500", "600", "700"] });

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("host") || "irkanti.com";
  const protocol = requestHeaders.get("x-forwarded-proto") || (host.includes("localhost") ? "http" : "https");
  const image = `${protocol}://${host}/opengraph-image`;
  const title = "Irkanti — Malta's Premier Auction Marketplace";
  const description = "Bid on exceptional property, vehicles, boats, watches, art and antiques in Malta.";
  return {
    title,
    description,
    icons: {
      icon: [
        { url: "/brand/irkanti-favicon-dark-32.png", type: "image/png", sizes: "32x32" },
        { url: "/brand/irkanti-favicon-dark.svg", type: "image/svg+xml", sizes: "any", media: "(prefers-color-scheme: light)" },
        { url: "/brand/irkanti-favicon-light.svg", type: "image/svg+xml", sizes: "any", media: "(prefers-color-scheme: dark)" },
      ],
      apple: [{ url: "/brand/irkanti-favicon-dark.png", type: "image/png", sizes: "512x512" }],
    },
    openGraph: { title, description, type: "website", siteName: "Irkanti", images: [{ url:image, width:1200, height:630, alt:"Irkanti — remarkable assets, exceptional outcomes" }] },
    twitter: { card:"summary_large_image", title, description, images:[image] },
  };
}

export default function RootLayout({ children }: Readonly<{children: React.ReactNode}>) {
  return <html lang="en"><body className={`${display.variable} ${sans.variable}`}>{children}</body></html>;
}
