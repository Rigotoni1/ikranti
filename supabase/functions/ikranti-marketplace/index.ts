import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.116.0";

const categories = ["Property", "Motor Cars", "Boats", "Watches & Jewellery", "Art & Antiques", "Collectables"];
const jsonHeaders = { "content-type": "application/json", "cache-control": "private, no-store" };
const acceptedImages = new Set(["image/jpeg", "image/png", "image/webp"]);
const demoUsers = new Set(["buyer_01", "seller_01", "collector_01"]);

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
    sellerId: row.seller_id,
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
    highestBidderId: row.highest_bidder_id,
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

async function readMarketplace(supabase: ReturnType<typeof database>, userId: string) {
  const [userResult, auctionsResult, watchedResult, myLotsResult, eventsResult] = await Promise.all([
    supabase.from("ikranti_users").select("id,name,initials,email,role,verified").eq("id", userId).maybeSingle(),
    supabase.from("auctions").select("*,seller:ikranti_users!auctions_seller_id_fkey(name)").eq("status", "live").order("featured", { ascending: false }).order("end_at", { ascending: true }),
    supabase.from("watchlist").select("auction_id").eq("user_id", userId),
    supabase.from("auctions").select("*,seller:ikranti_users!auctions_seller_id_fkey(name)").eq("seller_id", userId).order("end_at", { ascending: false }),
    supabase.from("bid_events").select("auction_id,visible_amount,created_at,bidder:ikranti_users!bid_events_user_id_fkey(initials)").order("created_at", { ascending: false }).limit(24),
  ]);

  const failure = [userResult.error, auctionsResult.error, watchedResult.error, myLotsResult.error, eventsResult.error].find(Boolean);
  if (failure) throw new Error(failure.message);

  return {
    user: userResult.data,
    auctions: (auctionsResult.data || []).map((row) => serialiseAuction(row)),
    watched: (watchedResult.data || []).map((row) => row.auction_id),
    myLots: (myLotsResult.data || []).map((row) => serialiseAuction(row)),
    recentBids: (eventsResult.data || []).map((row) => {
      const bidder = row.bidder as { initials?: string } | { initials?: string }[] | null;
      return {
        auction_id: row.auction_id,
        visible_amount: Number(row.visible_amount),
        created_at: row.created_at,
        initials: (Array.isArray(bidder) ? bidder[0]?.initials : bidder?.initials) || "VB",
      };
    }),
    categories,
  };
}

async function uploadImage(request: Request, supabase: ReturnType<typeof database>) {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return json({ error: "Choose an image to upload." }, 400);
  if (!acceptedImages.has(file.type)) return json({ error: "Use a JPG, PNG or WebP image." }, 400);
  if (file.size > 4 * 1024 * 1024) return json({ error: "The image must be smaller than 4 MB." }, 400);

  const { data: buckets, error: listError } = await supabase.storage.listBuckets();
  if (listError) throw new Error(listError.message);
  if (!buckets?.some((bucket) => bucket.name === "listing-media")) {
    const { error: bucketError } = await supabase.storage.createBucket("listing-media", {
      public: true,
      fileSizeLimit: 4 * 1024 * 1024,
      allowedMimeTypes: [...acceptedImages],
    });
    if (bucketError && !/already exists/i.test(bucketError.message)) throw new Error(bucketError.message);
  }

  const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `lots/${crypto.randomUUID()}.${extension}`;
  const { error } = await supabase.storage.from("listing-media").upload(path, file, {
    contentType: file.type,
    cacheControl: "31536000",
    upsert: false,
  });
  if (error) throw new Error(error.message);
  const { data } = supabase.storage.from("listing-media").getPublicUrl(path);
  return json({ url: data.publicUrl });
}

Deno.serve(async (request: Request) => {
  try {
    if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
    const providedSecret = request.headers.get("x-ikranti-secret") || "";
    if (providedSecret.length < 32 || providedSecret.length > 128) return json({ error: "Unauthorized." }, 401);
    const supabase = database();
    const { data: config, error: configError } = await supabase.from("ikranti_config").select("value").eq("key", "gateway_sha256").single();
    if (configError || !config || !(await secretMatchesHash(providedSecret, config.value))) return json({ error: "Unauthorized." }, 401);
    if (request.headers.get("x-ikranti-operation") === "upload") return await uploadImage(request, supabase);

    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action || "");
    const userId = String(body.userId || "buyer_01");
    if (!demoUsers.has(userId)) return json({ error: "Choose one of the available demonstration accounts." }, 403);

    if (action === "read") return json(await readMarketplace(supabase, userId));

    const { data: user, error: userError } = await supabase.from("ikranti_users").select("id,seller:role").eq("id", userId).maybeSingle();
    if (userError) throw new Error(userError.message);
    if (!user) return json({ error: "Please sign in before continuing." }, 401);

    if (action === "watch") {
      const { error } = await supabase.rpc("ikranti_toggle_watch", {
        p_user_id: userId,
        p_auction_id: String(body.auctionId || ""),
      });
      if (error) return json({ error: error.message }, 400);
      return json(await readMarketplace(supabase, userId));
    }

    if (action === "bid") {
      const maximum = Number(body.maxAmount);
      if (!Number.isFinite(maximum) || maximum <= 0 || maximum > 999999999999) return json({ error: "Enter a valid maximum bid." }, 400);
      const { data: bid, error } = await supabase.rpc("ikranti_place_bid", {
        p_user_id: userId,
        p_auction_id: String(body.auctionId || ""),
        p_max_amount: maximum,
      });
      if (error) return json({ error: error.message.replace(/^P0001:\s*/i, "") }, 400);
      return json({ ...(await readMarketplace(supabase, userId)), bid });
    }

    if (action === "createListing") {
      const title = String(body.title || "").trim();
      const category = String(body.category || "");
      const location = String(body.location || "").trim();
      const description = String(body.description || "").trim();
      const imageUrl = String(body.imageUrl || "").trim();
      const startPrice = Number(body.startPrice);
      const reservePrice = body.reservePrice === "" || body.reservePrice == null ? 0 : Number(body.reservePrice);
      if (imageUrl && (!imageUrl.startsWith(`${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/listing-media/lots/`))) return json({ error: "Upload a listing photograph before continuing." }, 400);
      if (title.length > 160 || description.length > 10000 || location.length > 160 || startPrice > 999999999999 || reservePrice > 999999999999) return json({ error: "The listing exceeds the allowed length or price." }, 400);
      if (title.length < 5 || !categories.includes(category) || !location || description.length < 20 || !Number.isFinite(startPrice) || startPrice < 1 || !Number.isFinite(reservePrice) || reservePrice < 0) {
        return json({ error: "Complete every field and add a description of at least 20 characters." }, 400);
      }
      const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 42);
      const { error } = await supabase.from("auctions").insert({
        id: `${slug}-${crypto.randomUUID().slice(0, 6)}`,
        seller_id: userId,
        title,
        category,
        location,
        description,
        image_url: imageUrl || "https://images.unsplash.com/photo-1564540574859-0dfb63985953?auto=format&fit=crop&w=1600&q=90",
        start_price: startPrice,
        reserve_price: reservePrice,
        current_bid: startPrice,
        bid_count: 0,
        end_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        status: "under_review",
      });
      if (error) throw new Error(error.message);
      return json({ ...(await readMarketplace(supabase, userId)), message: "Your asset has been submitted for specialist review." });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (error) {
    console.error(error);
    return json({ error: "The marketplace service is temporarily unavailable." }, 500);
  }
});
