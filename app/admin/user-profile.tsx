"use client";
import { useEffect, useState } from "react";
import { browserClient } from "@/lib/supabase/browser";
import { decisionLabels, StaffDecisions } from "./staff-decisions";
type Row=Record<string,unknown>;
type Detail={onboarding:Row[];application:Row|null;documents:Row[];listings:Row[];orders:Row[];activity:Row[]};
const text=(value:unknown)=>String(value??"—").replaceAll("_"," ");
export const roles=(row:Row)=>[row.buyer_role?"Buyer":null,row.role==="admin"?"Admin":null].filter(Boolean).join(" · ")||"Buyer · setup not started";
export const identity=(row:Row)=>row.identity_approved?"Approved":row.identity_changes_requested?"Changes requested":row.identity_submitted?"Awaiting review":"Not submitted";
export function UserProfile({user,users,download,busy,onBusy,onSaved,initialTab="Overview"}:{user:Row;users:Row[];download:(path:string)=>void;busy:boolean;onBusy:(busy:boolean)=>void;onSaved:()=>Promise<void>;initialTab?:string}){
 const [tab,setTab]=useState(initialTab);
 const [detail,setDetail]=useState<Detail|null>(null);
 const [error,setError]=useState("");
 useEffect(()=>{
  let active=true;
  void browserClient().rpc("ir_admin_user_detail",{p_user:user.id}).then(({data,error})=>{
   if(!active)return;
   if(error)setError(error.message);else {setDetail(data as Detail);setError("");}
  });
  return ()=>{active=false;};
 },[user]);
 return <><h2>{String(user.name||"Member")}</h2><p>{String(user.email||"")} · {roles(user)}</p>
 <nav className="portalTabs" aria-label="User profile sections">{["Overview","Verification","Staff decisions","Orders","Activity"].map(t=><button key={t} disabled={busy} aria-pressed={tab===t} className={tab===t?"active":""} onClick={()=>setTab(t)}>{t}</button>)}</nav>
 {error?<p role="alert">{error}</p>:!detail?<p>Loading user details…</p>:<>
 {tab==="Overview"&&<><dl>{Object.entries({"Email verified":user.email_verified?"Yes":"No","Buyer setup":user.buyer_complete?"Complete":"Not complete","Identity":identity(user),"Account":user.suspended?"Suspended":"Active","Joined":String(user.created_at).slice(0,10)}).map(([k,v])=><div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
 <button className="goldButton" disabled={busy} onClick={()=>setTab("Staff decisions")}>Review & make a staff decision →</button>
 {!!user.last_staff_decision&&<div className="record"><strong>Latest staff decision: {decisionLabels[String((user.last_staff_decision as Row).action)]||text((user.last_staff_decision as Row).action)}</strong><p>{String((user.last_staff_decision as Row).note||"")}</p><button onClick={()=>setTab("Activity")}>View decision history</button></div>}
 {detail.onboarding.filter(o=>o.account_type==="buyer").map(o=><section key={String(o.account_type)}><h3>{text(o.account_type)} details</h3><dl>{Object.entries((o.details||{}) as Row).map(([k,v])=><div key={k}><dt>{text(k)}</dt><dd>{typeof v==="boolean"?(v?"Yes":"No"):Array.isArray(v)?v.map(text).join(", "):text(v)}</dd></div>)}</dl></section>)}</>}
 {tab==="Verification"&&<><p>Email: {user.email_verified?"Verified":"Not verified"} · Identity: {identity(user)}</p>{detail.documents.length?detail.documents.map(d=><p key={String(d.id)}>{text(d.kind)} <button disabled={busy} onClick={()=>download(String(d.path))}>Download private document</button></p>):<p>No identity or supporting documents submitted.</p>}<button disabled={busy} className="goldButton" onClick={()=>setTab("Staff decisions")}>Make a staff decision →</button></>}
 <div hidden={tab!=="Staff decisions"}><StaffDecisions user={user} documents={detail.documents} onboarding={detail.onboarding} busy={busy} onBusy={onBusy} onSaved={onSaved}/></div>
 {tab==="Orders"&&<><p>Latest buyer orders.</p>{detail.orders.filter(o=>o.buyer_id===user.id).length?detail.orders.filter(o=>o.buyer_id===user.id).map(o=><div className="record" key={String(o.id)}><strong>Order {String(o.id).slice(0,8)}</strong><p>Buyer · {text(o.status)} · €{Number(o.amount).toLocaleString("en-MT")}</p></div>):<p>No orders.</p>}</>}
 {tab==="Activity"&&<><p>Latest 200 recorded account and listing actions.</p>{detail.activity.length?detail.activity.map(a=><div className="record" key={String(a.id)}><strong>{decisionLabels[String(a.action)]||text(a.action)}</strong><p>{new Date(String(a.created_at)).toLocaleString("en-MT")} · {String(users.find(u=>u.id===a.actor)?.name||"Staff / system")}</p>{!!(a.detail as Row)?.note&&<p>{String((a.detail as Row).note)}</p>}{!!(a.detail as Row)?.document_id&&<small>Decision includes reviewed identity evidence.</small>}{!!(a.detail as Row)?.linked_user_id&&<p>Linked to existing account: {String(users.find(u=>u.id===(a.detail as Row).linked_user_id)?.email||"Verified account")}</p>}</div>):<p>No recorded activity.</p>}</>}
 </>}</>;
}
