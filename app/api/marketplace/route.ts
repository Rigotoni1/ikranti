export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function configuration() {
  const baseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const secret = process.env.IKRANTI_EDGE_SECRET;
  if (!baseUrl || !secret) return null;
  return { endpoint: `${baseUrl}/functions/v1/ikranti-marketplace`, secret };
}

async function callMarketplace(payload: Record<string, unknown>) {
  const config = configuration();
  if (!config) {
    return Response.json({ error: "The marketplace service is not configured yet." }, { status: 503 });
  }

  try {
    const response = await fetch(config.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-ikranti-secret": config.secret,
      },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    return new Response(response.body, {
      status: response.status,
      headers: {
        "content-type": response.headers.get("content-type") || "application/json",
        "cache-control": "private, no-store",
      },
    });
  } catch {
    return Response.json({ error: "The marketplace service is temporarily unavailable." }, { status: 502 });
  }
}

export async function GET(request: Request) {
  const userId = new URL(request.url).searchParams.get("user") || "buyer_01";
  return callMarketplace({ action: "read", userId });
}

export async function POST(request: Request) {
  let payload: Record<string, unknown>;
  try {
    payload = await request.json() as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  return callMarketplace(payload);
}
