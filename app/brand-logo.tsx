import Image from "next/image";

type BrandTone = "light" | "dark";

// The kit names the artwork colour: light artwork belongs on dark surfaces.
export function BrandLogo({ tone = "light", eager = false }: { tone?: BrandTone; eager?: boolean }) {
  return <Image
    className="brandLogo"
    src={`/brand/irkanti-wordmark-${tone}.svg`}
    alt="Irkanti"
    width={3100}
    height={890}
    loading={eager ? "eager" : "lazy"}
    unoptimized
  />;
}

export function BrandMark({ tone = "dark" }: { tone?: BrandTone }) {
  return <Image
    className="brandMark"
    src={`/brand/irkanti-favicon-${tone}.svg`}
    alt=""
    aria-hidden="true"
    width={512}
    height={512}
    unoptimized
  />;
}
