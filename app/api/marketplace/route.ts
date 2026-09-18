export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const client = createClient(supabaseUrl,supabaseKey,{auth:{persistSession:false}});
  const {data,error}=await client.from("ir_public_auctions").select("*").eq("status","live").order("end_at");
  if(error) return Response.json({error:"Catalogue unavailable"},{status:503});
  const common={user:null,watched:[],myLots:[],recentBids:[],categories:["Property","Motor Cars","Boats","Watches & Jewellery","Art & Antiques","Collectables"]};
  return Response.json({...common,isPreview:false,auctions:(data||[]).map(l=>({
    id:l.id,sellerId:"",sellerName:"Verified Irkanti seller",title:l.title,description:l.description,category:l.category,location:l.location,
    image:l.image_path?listingImageUrl(l.image_path):"/og.png",startPrice:Number(l.start_price),currentBid:Number(l.current_bid),
    hasReserve:l.has_reserve,reserveMet:l.reserve_met,highestBidderId:null,bidCount:l.bid_count,endAt:l.end_at,status:l.status,featured:false,views:0,watchCount:0,
  }))},{headers:{"Cache-Control":"no-store"}});

}

export async function POST() {
  return Response.json({ error: "Shared demonstration accounts have been retired. Sign in at /account." }, { status: 410 });
}
import { createClient } from "@supabase/supabase-js";
import { supabaseKey, supabaseUrl } from "@/lib/supabase/config";
import { listingImageUrl } from "@/lib/listing-image";
