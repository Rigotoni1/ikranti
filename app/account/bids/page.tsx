"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { browserClient } from "@/lib/supabase/browser";
import "../portal.css";

type Bid={auction_id:string;title:string;category:string;current_bid:number;my_maximum:number;end_at:string;bid_status:string;bid_count:number;order_id:string|null;order_status:string|null};
const money=(v:number)=>new Intl.NumberFormat("en-MT",{style:"currency",currency:"EUR"}).format(v);
const names:Record<string,string>={leading:"You’re leading",outbid:"Outbid",awaiting_result:"Awaiting final result",won:"Won",lost:"Not won",reserve_not_met:"Reserve not met",withdrawn:"Withdrawn",closed:"Closed"};
const active=(b:Bid)=>["leading","outbid","awaiting_result"].includes(b.bid_status);
export default function MyBids(){
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
  const {data,error}=await client.rpc("ir_my_bids");
  if(version!==generation.current)return;
  setReady(true);
  if(error){setBids([]);setError(error.message);return;}
  setError("");setBids((data||[]) as Bid[]);setUpdated(new Date().toLocaleTimeString("en-MT"));
 },[client]);
 useEffect(()=>{
  let alive=true;
  const update=()=>{if(alive)void refresh().catch(()=>{if(alive){setReady(true);setError("Updates are unavailable. Reconnect and refresh before relying on these prices.");}});};
  update();
  const {data:{subscription}}=client.auth.onAuthStateChange(()=>{setBids([]);window.setTimeout(update,0);});
  const channel=client.channel("my-bids")
   .on("postgres_changes",{event:"*",schema:"public",table:"ir_public_auctions"},update)
   .on("postgres_changes",{event:"INSERT",schema:"public",table:"ir_notifications"},update)
   .subscribe(status=>{if(alive){setConnected(status==="SUBSCRIBED");if(status==="SUBSCRIBED")update();}});
  const visible=()=>{if(document.visibilityState==="visible")update();};
  window.addEventListener("online",update);document.addEventListener("visibilitychange",visible);
  // The clock updates labels only; auction data arrives through Realtime.
  const timer=window.setInterval(()=>setNow(Date.now()),1000);
  return()=>{alive=false;subscription.unsubscribe();void client.removeChannel(channel);window.clearInterval(timer);window.removeEventListener("online",update);document.removeEventListener("visibilitychange",visible);};
 },[client,refresh]);
 const shown=bids.filter(b=>filter==="All"||filter==="Active"&&active(b)||filter==="Outbid"&&b.bid_status==="outbid"||filter==="Won"&&b.bid_status==="won"||filter==="Closed"&&!active(b));
 return <main className="portal"><header className="portalHeader"><Link className="brand" href="/">IRKANTI</Link><span>BUYER ACCOUNT</span><Link href="/account">My account →</Link></header><div className="portalBody">
  <p className="eyebrow">YOUR AUCTION ACTIVITY</p><h1>My bids</h1><p>Track every auction you’ve bid on. Your maximum is private; the current price is what the auction has reached.</p>
  <div className="sectionHeading"><p role="status">{connected?"Live updates connected":"Reconnecting live updates…"}{updated?` · Updated ${updated}`:""}</p><button onClick={()=>void refresh().catch(()=>setError("Could not refresh. Please try again."))}>Refresh bids</button></div>
  {error?<section className="portalPanel" role="alert"><p>{error}</p><Link href="/account">Sign in or complete buyer setup →</Link></section>:!ready?<p>Loading your bids…</p>:<>
  <nav className="portalTabs" aria-label="Filter bids">{["All","Active","Outbid","Won","Closed"].map(f=><button key={f} className={filter===f?"active":""} aria-pressed={filter===f} onClick={()=>setFilter(f)}>{f}</button>)}</nav>
  {!shown.length?<section className="portalPanel"><h2>{bids.length?"No bids in this view":"You haven’t placed a bid yet"}</h2><p>Accepted bids on real auctions will appear here. Sample listings do not accept bids.</p><Link href="/account">Browse auctions →</Link></section>:<section className="portalGrid">{shown.map(b=>{
   const expired=active(b)&&now>0&&new Date(b.end_at).getTime()<=now;
   return <article className="portalPanel" key={b.auction_id}><p className="eyebrow">{b.category}</p><h2>{b.title}</h2><p><strong>{expired?"Awaiting final result":names[b.bid_status]||"Closed"}</strong>{!connected?" · Status may be outdated":""}</p><dl><div><dt>Current price</dt><dd>{money(b.current_bid)}</dd></div><div><dt>Your maximum</dt><dd>{money(b.my_maximum)}</dd></div><div><dt>Total bids</dt><dd>{b.bid_count}</dd></div><div><dt>{active(b)?"Closes":"Closed"}</dt><dd>{new Date(b.end_at).toLocaleString("en-MT")}</dd></div></dl>{b.order_id?<><p>Order: {b.order_status?.replaceAll("_"," ")}</p><Link href="/account?tab=orders">View your order →</Link></>:active(b)&&!expired?<Link href={`/?lot=${encodeURIComponent(b.auction_id)}#auctions`}>View auction / increase maximum →</Link>:null}</article>;
  })}</section>}</>}</div></main>;
}
