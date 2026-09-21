"use client";
import { useEffect, useState } from "react";
import { browserClient } from "@/lib/supabase/browser";
type Row=Record<string,unknown>;
type Detail={onboarding:Row[];application:Row|null;documents:Row[];listings:Row[];orders:Row[];activity:Row[]};
const text=(value:unknown)=>String(value??"—").replaceAll("_"," ");
export const roles=(row:Row)=>[row.buyer_role?"Buyer":null,row.seller_role?"Seller":null,row.role==="admin"?"Admin":null].filter(Boolean).join(" · ")||"Setup not started";
export const identity=(row:Row)=>row.identity_approved?"Approved":row.identity_submitted?"Awaiting review":"Not submitted";
export function UserProfile({user,download,busy}:{user:Row;download:(path:string)=>void;busy:boolean}){
 const [tab,setTab]=useState("Overview");
 const [detail,setDetail]=useState<Detail|null>(null);
 const [error,setError]=useState("");
 useEffect(()=>{
  let active=true;
  void browserClient().rpc("ir_admin_user_detail",{p_user:user.id}).then(({data,error})=>{
   if(!active)return;
   if(error)setError(error.message);else setDetail(data as Detail);
  });
  return ()=>{active=false;};
 },[user.id]);
 return <><h2>{String(user.name||"Member")}</h2><p>{String(user.email||"")} · {roles(user)}</p>
 <nav className="portalTabs" aria-label="User profile sections">{["Overview","Verification","Listings","Orders","Activity"].map(t=><button key={t} className={tab===t?"active":""} onClick={()=>setTab(t)}>{t}</button>)}</nav>
 {error?<p role="alert">{error}</p>:!detail?<p>Loading user details…</p>:<>
 {tab==="Overview"&&<><dl>{Object.entries({"Email verified":user.email_verified?"Yes":"No","Buyer setup":user.buyer_complete?"Complete":"Not complete","Identity":identity(user),"Seller approval":text(user.seller_status),"Account":user.suspended?"Suspended":"Active","Joined":String(user.created_at).slice(0,10)}).map(([k,v])=><div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
 {detail.onboarding.map(o=><section key={String(o.account_type)}><h3>{text(o.account_type)} details</h3><dl>{Object.entries((o.details||{}) as Row).map(([k,v])=><div key={k}><dt>{text(k)}</dt><dd>{text(v)}</dd></div>)}</dl></section>)}</>}
 {tab==="Verification"&&<><p>Email: {user.email_verified?"Verified":"Not verified"} · Identity: {identity(user)} · Seller: {text(user.seller_status)}</p>{detail.application&&<dl>{["legal_name","business_name","registration_number","address","review_note"].map(k=><div key={k}><dt>{text(k)}</dt><dd>{text(detail.application?.[k])}</dd></div>)}</dl>}{detail.documents.length?detail.documents.map(d=><p key={String(d.id)}>{text(d.kind)} <button disabled={busy} onClick={()=>download(String(d.path))}>Download private document</button></p>):<p>No identity or supporting documents submitted.</p>}</>}
 {tab==="Listings"&&<><p>Latest 200 seller listings for this same account.</p>{detail.listings.length?detail.listings.map(l=><div className="record" key={String(l.id)}><strong>{text(l.title)}</strong><p>{text(l.status)} · €{Number(l.current_bid).toLocaleString("en-MT")} · {Number(l.bid_count)} bids</p></div>):<p>No listings.</p>}</>}
 {tab==="Orders"&&<><p>Latest 200 orders across both roles.</p>{detail.orders.length?detail.orders.map(o=><div className="record" key={String(o.id)}><strong>Order {String(o.id).slice(0,8)}</strong><p>{o.buyer_id===user.id?"Buyer":"Seller"} · {text(o.status)} · €{Number(o.amount).toLocaleString("en-MT")}</p></div>):<p>No orders.</p>}</>}
 {tab==="Activity"&&<><p>Latest 200 recorded account and listing actions.</p>{detail.activity.length?detail.activity.map(a=><div className="record" key={String(a.id)}><strong>{text(a.action)}</strong><p>{new Date(String(a.created_at)).toLocaleString("en-MT")}</p>{!!(a.detail as Row)?.note&&<p>{String((a.detail as Row).note)}</p>}</div>):<p>No recorded activity.</p>}</>}
 </>}</>;
}
