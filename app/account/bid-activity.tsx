"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { browserClient } from "@/lib/supabase/browser";


type Bid={auction_id:string;title:string;category:string;current_bid:number;my_maximum:number;end_at:string;bid_status:string;bid_count:number;order_id:string|null;order_status:string|null};
const money=(v:number)=>new Intl.NumberFormat("en-MT",{style:"currency",currency:"EUR"}).format(v);
const names:Record<string,string>={leading:"You’re leading",outbid:"Outbid",awaiting_result:"Awaiting final result",won:"Won",lost:"Not won",reserve_not_met:"Reserve not met",withdrawn:"Withdrawn",closed:"Closed"};
const active=(b:Bid)=>["leading","outbid","awaiting_result"].includes(b.bid_status);
export default function BidActivity({standalone=false,onAccountTabChange}:{standalone?:boolean;onAccountTabChange?:(tab:"Orders"|"Settings")=>void}){
 const [bids,setBids]=useState<Bid[]>([]);
 const [filter,setFilter]=useState("All");
 const [error,setError]=useState("");
 const [ready,setReady]=useState(false);
 const [connected,setConnected]=useState(false);
 const [updated,setUpdated]=useState("");
 const [now,setNow]=useState(0);
 const generation=useRef(0);
 const client=browserClient();
 const refresh=useCallback(async()=>{
  const version=++generation.current;
  try {
  // The RPC resolves identity from the secure session; no user ID is supplied.
  const {data,error}=await client.rpc("ir_my_bids");
  if(version!==generation.current)return;
  setReady(true);
  if(error){setBids([]);setError(error.message);return;}
  setError("");setBids((data||[]) as Bid[]);setUpdated(new Date().toLocaleTimeString("en-MT"));
  } catch {
   if(version!==generation.current)return;
   setReady(true);setBids([]);setError("Your bids couldn’t be refreshed. Check your connection and try again.");
  }
 },[client]);
 useEffect(()=>{
  let alive=true;
  const update=()=>{if(alive)void refresh();};
  update();
  const {data:{subscription}}=client.auth.onAuthStateChange(()=>{
   if(!alive)return;
   // Discard in-flight reads immediately when the session changes.
   ++generation.current;setBids([]);setReady(false);setUpdated("");setError("");
   window.setTimeout(update,0);
  });
  const channel=client.channel("my-bids")
   .on("postgres_changes",{event:"*",schema:"public",table:"ir_public_auctions"},update)
   .on("postgres_changes",{event:"INSERT",schema:"public",table:"ir_notifications"},update)
   .subscribe(status=>{if(alive){setConnected(status==="SUBSCRIBED");if(status==="SUBSCRIBED")update();}});
  const visible=()=>{if(document.visibilityState==="visible")update();};
  const offline=()=>setConnected(false);
  window.addEventListener("online",update);window.addEventListener("offline",offline);document.addEventListener("visibilitychange",visible);
  setNow(Date.now());
  // The clock updates labels only; auction data arrives through Realtime.
  const timer=window.setInterval(()=>setNow(Date.now()),1000);
  return()=>{alive=false;++generation.current;subscription.unsubscribe();void client.removeChannel(channel);window.clearInterval(timer);window.removeEventListener("online",update);window.removeEventListener("offline",offline);document.removeEventListener("visibilitychange",visible);};
 },[client,refresh]);
 const shown=bids.filter(b=>filter==="All"||filter==="Active"&&active(b)||filter==="Outbid"&&b.bid_status==="outbid"||filter==="Won"&&b.bid_status==="won"||filter==="Closed"&&!active(b));
 const Heading=standalone?"h1":"h2";
 const CardHeading=standalone?"h2":"h3";
 return <section className="bidActivity" aria-label="My bids">
  <p className="eyebrow">YOUR AUCTION ACTIVITY</p><Heading>My bids</Heading><p>Track every auction you’ve bid on. Your maximum is private; the current price is what the auction has reached.</p>
  <div className="sectionHeading"><p role="status">{connected?"Live updates connected":"Reconnecting live updates…"}{updated?` · Updated ${updated}`:""}</p><button type="button" onClick={()=>void refresh()}>Refresh bids</button></div>
  {error?<section className="portalPanel" role="alert"><p>{error}</p><Link href="/account?tab=settings" onClick={()=>onAccountTabChange?.("Settings")}>Sign in or complete buyer setup →</Link></section>:!ready?<p role="status">Loading your bids…</p>:<>
  <nav className="portalTabs" aria-label="Filter bids">{["All","Active","Outbid","Won","Closed"].map(f=><button key={f} className={filter===f?"active":""} aria-pressed={filter===f} onClick={()=>setFilter(f)}>{f}</button>)}</nav>
  {!shown.length?<section className="portalPanel"><CardHeading>{bids.length?"No bids in this view":"You haven’t placed a bid yet"}</CardHeading><p>Your accepted bids will appear here, with your latest position in each auction.</p><Link href="/#auctions">Browse auctions →</Link></section>:<section className="portalGrid">{shown.map(b=>{
   const expired=active(b)&&now>0&&new Date(b.end_at).getTime()<=now;
   return <article className="portalPanel" key={b.auction_id}><p className="eyebrow">{b.category}</p><CardHeading>{b.title}</CardHeading><p><strong>{expired?"Awaiting final result":names[b.bid_status]||"Closed"}</strong>{!connected?" · Status may be outdated":""}</p><dl><div><dt>Current price</dt><dd>{money(b.current_bid)}</dd></div><div><dt>Your maximum</dt><dd>{money(b.my_maximum)}</dd></div><div><dt>Total bids</dt><dd>{b.bid_count}</dd></div><div><dt>{active(b)?"Closes":"Closed"}</dt><dd>{new Date(b.end_at).toLocaleString("en-MT")}</dd></div></dl>{b.order_id?<><p>Order: {b.order_status?.replaceAll("_"," ")}</p><Link href="/account?tab=orders" onClick={()=>onAccountTabChange?.("Orders")}>View your order →</Link></>:active(b)&&!expired?<Link href={`/?lot=${encodeURIComponent(b.auction_id)}#auctions`}>View auction / increase maximum →</Link>:null}</article>;
  })}</section>}</>}</section>;
}
