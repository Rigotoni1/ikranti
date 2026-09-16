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

export async function GET() {
  const client = createClient(supabaseUrl,supabaseKey,{auth:{persistSession:false}});
  const {data,error}=await client.from("ir_public_auctions").select("*").eq("status","live").order("end_at");
  if(error) return Response.json({error:"Catalogue unavailable"},{status:503});
  const common={user:null,watched:[],myLots:[],recentBids:[],categories:["Property","Motor Cars","Boats","Watches & Jewellery","Art & Antiques","Collectables"]};
  if(data?.length) return Response.json({...common,isPreview:false,auctions:data.map(l=>({
    id:l.id,sellerId:"",sellerName:"Verified Irkanti seller",title:l.title,description:l.description,category:l.category,location:l.location,
    image:l.image_path?`${supabaseUrl}/storage/v1/object/public/ir-auction-images/${l.image_path}`:"/og.png",startPrice:Number(l.start_price),currentBid:Number(l.current_bid),
    hasReserve:l.has_reserve,reserveMet:l.reserve_met,highestBidderId:null,bidCount:l.bid_count,endAt:l.end_at,status:l.status,featured:false,views:0,watchCount:0,
  }))},{headers:{"Cache-Control":"no-store"}});
  const preview=await callMarketplace({action:"read",userId:"buyer_01"});
  if(!preview.ok) return preview;
  const body=await preview.json() as {auctions:unknown[]};
  return Response.json({...common,isPreview:true,auctions:body.auctions},{headers:{"Cache-Control":"no-store"}});
}

export async function POST() {
  return Response.json({ error: "Shared demonstration accounts have been retired. Sign in at /account." }, { status: 410 });
}
import { createClient } from "@supabase/supabase-js";
import { supabaseKey, supabaseUrl } from "@/lib/supabase/config";
