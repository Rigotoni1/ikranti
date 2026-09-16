import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";

const categories = ["Property", "Motor Cars", "Boats", "Watches & Jewellery", "Art & Antiques", "Collectables"];
const jsonHeaders = { "content-type": "application/json", "cache-control": "private, no-store" };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

async function secretMatchesHash(provided: string, expectedHash: string) {
  const encoder = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(provided));
  const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const a = encoder.encode(hash);
  const b = encoder.encode(expectedHash);
  let difference = a.length ^ b.length;
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

function serialiseAuction(row: Record<string, unknown>) {
  const seller = row.seller as { name?: string } | { name?: string }[] | null;
  const sellerName = Array.isArray(seller) ? seller[0]?.name : seller?.name;
  return {
    id: row.id,
    sellerId: "",
    sellerName: sellerName || "Verified seller",
    title: row.title,
    category: row.category,
    location: row.location,
    description: row.description,
    image: row.image_url,
    startPrice: Number(row.start_price),
    hasReserve: Number(row.reserve_price) > 0,
    reserveMet: Number(row.current_bid) >= Number(row.reserve_price),
    currentBid: Number(row.current_bid),
    highestBidderId: null,
    bidCount: Number(row.bid_count),
    endAt: row.end_at,
    status: row.status,
    featured: Boolean(row.featured),
    views: Number(row.views),
    watchCount: Number(row.watch_count),
  };
}

function database() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Supabase runtime credentials are unavailable.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

Deno.serve(async (request: Request) => {
  try {
    if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
    const providedSecret = request.headers.get("x-ikranti-secret") || "";
    if (providedSecret.length < 32 || providedSecret.length > 128) return json({ error: "Unauthorized." }, 401);
    const supabase = database();
    const { data: config, error: configError } = await supabase.from("ikranti_config").select("value").eq("key", "gateway_sha256").single();
    if (configError || !config || !(await secretMatchesHash(providedSecret, config.value))) return json({ error: "Unauthorized." }, 401);
    if (request.headers.get("x-ikranti-operation") === "upload") return json({error:"Demo uploads retired"},410);
    const body=await request.json() as {action?:string};
    if(body.action!=="read") return json({error:"Demo account writes retired. Sign in at /account."},410);
    const {data,error}=await supabase.from("auctions").select("*,seller:ikranti_users!auctions_seller_id_fkey(name)").eq("status","live").order("featured",{ascending:false}).order("end_at");
    if(error) throw error;
    return json({user:null,auctions:(data||[]).map(serialiseAuction),watched:[],myLots:[],recentBids:[],categories,isPreview:true});
  } catch { return json({error:"Sample catalogue unavailable"},503); }
});
