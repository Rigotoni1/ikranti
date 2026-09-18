"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { browserClient } from "@/lib/supabase/browser";
type Row = Record<string, unknown>;
const client=browserClient();
const field=(form:FormData,key:string)=>String(form.get(key)||"");
const label=(value:unknown)=>String(value||"").replaceAll("_"," ");
const tables=["ir_seller_applications","ir_account_onboarding","ir_auctions","ir_profiles","ir_disputes","ir_risk_flags","ir_audit","ir_documents"];
export default function AdminConsole(){
 const [staff,setStaff]=useState<Record<string,Row[]>>({});
 const [delivery,setDelivery]=useState<Record<string,number>|null>(null);
 const [message,setMessage]=useState("");
 const [busy,setBusy]=useState(false);
 const [allowed,setAllowed]=useState(false);
 const version=useRef(0);
 const mutation=useRef(false);
 const refresh=useCallback(async()=>{
  const request=++version.current;
  const health=await client.rpc("ir_delivery_health");
  if(request!==version.current)return;
  if(health.error){setAllowed(false);setStaff({});setDelivery(null);throw new Error("Administrator access could not be verified. Check Account Security and sign in again if needed.");}
  const values=await Promise.all(tables.map(t=>client.from(t).select("*").order(t==="ir_seller_applications"?"submitted_at":t==="ir_account_onboarding"?"updated_at":"created_at",{ascending:false}).limit(200)));
  if(request!==version.current)return;
  if(values.some(v=>v.error)){setAllowed(false);setStaff({});throw new Error("Staff records could not be loaded. Please refresh.");}
  setStaff(Object.fromEntries(tables.map((t,i)=>[t,values[i].data||[]])));
  setDelivery(health.data);setAllowed(true);
 },[]);
 useEffect(()=>{
  const update=()=>{void refresh().catch(e=>setMessage(e.message));};
  update();
  const {data:{subscription}}=client.auth.onAuthStateChange(()=>{
   ++version.current;setAllowed(false);setStaff({});setDelivery(null);
   window.setTimeout(update,0);
  });
  const visible=()=>{if(document.visibilityState==="visible")update();};
  window.addEventListener("online",update);document.addEventListener("visibilitychange",visible);
  // Invalidate the latest request generation, not a captured DOM ref.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return()=>{++version.current;subscription.unsubscribe();window.removeEventListener("online",update);document.removeEventListener("visibilitychange",visible);};
 },[refresh]);
 async function rpc(name:string,args:Record<string,unknown>){
  const result=await client.rpc(name,args);if(result.error)throw new Error(result.error.message);return result.data;
 }
 async function run(work:()=>Promise<void>,success:string){
  if(mutation.current)return;mutation.current=true;setBusy(true);setMessage("");
  try{await work();setMessage(success);await refresh();}catch(e){setMessage(e instanceof Error?e.message:"Please retry.");}
  finally{mutation.current=false;setBusy(false);}
 }
 async function download(path:string){
  await run(async()=>{const {data,error}=await client.storage.from("ir-private-documents").createSignedUrl(path,60,{download:true});if(error)throw error;window.location.assign(data.signedUrl);},"Private download prepared");
 }
 return <main className="portal"><header className="portalHeader"><Link className="brand" href="/">IRKANTI</Link><span>ADMINISTRATION</span><Link href="/account">My account →</Link></header><div className="portalBody"><h1>Marketplace administration</h1><p>Staff tools · Latest 200 records per section</p><button disabled={busy} onClick={()=>void run(refresh,"Staff records refreshed")}>Refresh records</button>{message&&<p className="portalMessage" role="status">{message}</p>}{!allowed?<section className="portalPanel"><p>Checking your verified administrator account and active session.</p><Link href="/account?tab=security">Account security</Link></section>:<>
<section className="portalPanel"><h2>Verify a buyer</h2><p>Review the private identity evidence before recording approval. Use the same pseudonymous identity fingerprint for this person across buyer and seller accounts.</p><form onSubmit={e=>{e.preventDefault();const d=new FormData(e.currentTarget);void run(async()=>{await rpc("ir_verify_buyer",{p_user:field(d,"user"),p_fingerprint:field(d,"fingerprint"),p_note:field(d,"note")});},"Buyer identity verified");}}><label>Buyer account ID<input name="user" required pattern="[0-9a-fA-F-]{36}"/></label><label>Verified identity fingerprint<input name="fingerprint" required minLength={8}/></label><label>Review note<textarea name="note" required minLength={5}/></label><button disabled={busy}>Record buyer verification</button></form></section>
          <div className="portalPanel"><h2>Staff decision</h2>{delivery&&<p>Email queue: {delivery.pending} pending · {delivery.sending} sending · {delivery.sent} sent · {delivery.failed} require review. Delivery requires Resend setup.</p>}<p>Review the records and private evidence below before deciding. Every action requires a note and is recorded in the audit trail.</p><form onSubmit={e=>{e.preventDefault();const d=new FormData(e.currentTarget);void run(async()=>{await rpc("ir_admin_action",{p_action:field(d,"action"),p_target:field(d,"target"),p_note:field(d,"note"),p_fingerprint:field(d,"fingerprint")||null});},"Staff decision recorded");}}>
            <label>Action<select name="action">{["approve_seller","reject_seller","approve_listing","reject_listing","suspend","reinstate","resolve_dispute","dismiss_dispute"].map(a=><option key={a} value={a}>{label(a)}</option>)}</select></label><label>Target account / listing / dispute ID<input name="target" required pattern="[0-9a-fA-F-]{36}"/></label><label>Decision note<textarea name="note" minLength={5} maxLength={2000} required/></label><label>Verified identity fingerprint (seller approval only)<input name="fingerprint" autoComplete="off"/><small>Use the same pseudonymous fingerprint for the same verified person/entity. Never enter a raw identity document number here.</small></label><button disabled={busy} className="goldButton">Record decision</button>
          </form></div><div className="portalGrid">{Object.entries(staff).map(([table,rows])=><div key={table} className="portalPanel"><h2>{label(table.replace("ir_",""))}</h2>{rows.length?rows.map((row,i)=><div className="record" key={String(row.id||row.user_id||i)}><dl>{Object.entries(row).filter(([k])=>!["path"].includes(k)).map(([k,v])=><div key={k}><dt>{label(k)}</dt><dd>{typeof v==="object"?JSON.stringify(v):String(v??"—")}</dd></div>)}</dl>{table==="ir_documents"&&<button onClick={()=>void download(String(row.path))}>Download private evidence</button>}</div>):<p>No records.</p>}</div>)}</div>

</>}</div></main>;
}
