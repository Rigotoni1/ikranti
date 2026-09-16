export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const accepted = new Set(["image/jpeg", "image/png", "image/webp"]);
const maximumBytes = 4 * 1024 * 1024;

export async function POST(request: Request) {
  const baseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const secret = process.env.IKRANTI_EDGE_SECRET;
  if (!baseUrl || !secret) {
    return Response.json({ error: "Image storage is not configured yet." }, { status: 503 });
  }

  let form: FormData;
  try { form = await request.formData(); }
  catch { return Response.json({ error: "Choose an image to upload." }, { status: 400 }); }
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "Choose an image to upload." }, { status: 400 });
  if (!accepted.has(file.type)) return Response.json({ error: "Use a JPG, PNG or WebP image." }, { status: 400 });
  if (file.size > maximumBytes) return Response.json({ error: "The image must be smaller than 4 MB." }, { status: 400 });

  const outbound = new FormData();
  outbound.set("file", file, file.name);
  const started = Date.now();
  console.info(JSON.stringify({ route: "/api/media", event: "start", bytes: file.size }));
  try {
    const response = await fetch(`${baseUrl}/functions/v1/ikranti-marketplace`, {
      method: "POST",
      headers: {
        "x-ikranti-secret": secret,
        "x-ikranti-operation": "upload",
      },
      body: outbound,
      cache: "no-store",
      signal: AbortSignal.timeout(45_000),
    });
    const body = await response.text();
    console.info(JSON.stringify({ route: "/api/media", event: "done", status: response.status, ms: Date.now() - started }));
    return new Response(body, {
      status: response.status,
      headers: {
        "content-type": response.headers.get("content-type") || "application/json",
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    console.error(JSON.stringify({ route: "/api/media", event: "failed", type: error instanceof Error ? error.name : "UnknownError", ms: Date.now() - started }));
    return Response.json({ error: "Image storage is temporarily unavailable." }, { status: 502 });
  }
}
