export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const accepted = new Set(["image/jpeg", "image/png", "image/webp"]);
const maximumBytes = 4 * 1024 * 1024;

export async function POST(request: Request) {
  const baseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const secret = process.env.IKRANTI_EDGE_SECRET;
  if (!baseUrl || !secret) {
    return Response.json({ error: "Image storage is not configured yet." }, { status: 503 });
  }

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "Choose an image to upload." }, { status: 400 });
  if (!accepted.has(file.type)) return Response.json({ error: "Use a JPG, PNG or WebP image." }, { status: 400 });
  if (file.size > maximumBytes) return Response.json({ error: "The image must be smaller than 4 MB." }, { status: 400 });

  const outbound = new FormData();
  outbound.set("file", file, file.name);
  try {
    const response = await fetch(`${baseUrl}/functions/v1/ikranti-marketplace`, {
      method: "POST",
      headers: {
        "x-ikranti-secret": secret,
        "x-ikranti-operation": "upload",
      },
      body: outbound,
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    return new Response(response.body, {
      status: response.status,
      headers: {
        "content-type": response.headers.get("content-type") || "application/json",
        "cache-control": "private, no-store",
      },
    });
  } catch {
    return Response.json({ error: "Image storage is temporarily unavailable." }, { status: 502 });
  }
}
