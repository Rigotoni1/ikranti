import Image from "next/image";

type BrandTone = "light" | "dark";

// The kit names the artwork colour: light artwork belongs on dark surfaces.
export function BrandLogo({ tone = "light", eager = false }: { tone?: BrandTone; eager?: boolean }) {
  return <Image
    className="brandLogo"
    src={`/brand/irkanti-wordmark-${tone}.svg?v=2`}
    alt="Irkanti"
    width={976}
    height={318}
    loading={eager ? "eager" : "lazy"}
    unoptimized
  />;
}

export function BrandMark({ tone = "dark" }: { tone?: BrandTone }) {
  return <Image
    className="brandMark"
    src={`/brand/irkanti-favicon-${tone}.svg?v=2`}
    alt=""
    aria-hidden="true"
    width={340}
    height={340}
    unoptimized
  />;
}
