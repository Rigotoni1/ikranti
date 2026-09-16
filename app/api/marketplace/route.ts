export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const demoUsers = new Set(["buyer_01", "seller_01", "collector_01"]);
const actions = new Set(["read", "watch", "bid", "createListing"]);

function configuration() {
  const baseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const secret = process.env.IKRANTI_EDGE_SECRET;
  if (!baseUrl || !secret) return null;
  return { endpoint: `${baseUrl}/functions/v1/ikranti-marketplace`, secret };
}

async function callMarketplace(payload: Record<string, unknown>) {
  if (typeof payload.userId !== "string" || !demoUsers.has(payload.userId)) {
    return Response.json({ error: "Choose one of the available demonstration accounts." }, { status: 403 });
  }
  if (typeof payload.action !== "string" || !actions.has(payload.action)) {
    return Response.json({ error: "Unknown action." }, { status: 400 });
  }
  const config = configuration();
  if (!config) {
    return Response.json({ error: "The marketplace service is not configured yet." }, { status: 503 });
  }

  const started = Date.now();
  console.info(JSON.stringify({ route: "/api/marketplace", event: "start", action: payload.action }));
  try {
    const response = await fetch(config.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-ikranti-secret": config.secret,
      },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: AbortSignal.timeout(35_000),
    });
    const body = await response.text();
    console.info(JSON.stringify({ route: "/api/marketplace", event: "done", action: payload.action, status: response.status, ms: Date.now() - started }));
    return new Response(body, {
      status: response.status,
      headers: {
        "content-type": response.headers.get("content-type") || "application/json",
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    console.error(JSON.stringify({ route: "/api/marketplace", event: "failed", action: payload.action, type: error instanceof Error ? error.name : "UnknownError", ms: Date.now() - started }));
    return Response.json({ error: payload.action === "read"
      ? "The marketplace service is temporarily unavailable. Please refresh shortly."
      : "The result could not be confirmed. Refresh your account activity before trying again." }, { status: timedOut ? 504 : 502 });
  }
}

export async function GET(request: Request) {
  const userId = new URL(request.url).searchParams.get("user") || "buyer_01";
  return callMarketplace({ action: "read", userId });
}

export async function POST(request: Request) {
  let payload: unknown;
  try {
    const raw = await request.text();
    if (raw.length > 32_000) return Response.json({ error: "The request is too large." }, { status: 413 });
    payload = JSON.parse(raw);
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  return callMarketplace(payload as Record<string, unknown>);
}
