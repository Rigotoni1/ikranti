"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { listingImageUrl } from "@/lib/listing-image";
import "./dashboard.css";
import { browserClient } from "@/lib/supabase/browser";
type Row = Record<string, unknown>;
const client=browserClient();
const field=(form:FormData,key:string)=>String(form.get(key)||"");
const label=(value:unknown)=>String(value||"").replaceAll("_"," ");
const tables=["ir_seller_applications","ir_account_onboarding","ir_auctions","ir_profiles","ir_disputes","ir_risk_flags","ir_audit","ir_documents"];
function ListingPhoto({row,large=false}:{row:Row;large?:boolean}){
 const [failed,setFailed]=useState(false);
 const path=typeof row.image_path==="string"?row.image_path:"";
 return <div className={large?"adminPhoto adminPhotoLarge":"adminPhoto"}>{path&&!failed?<Image unoptimized src={listingImageUrl(path)} alt={String(row.title||"Listing photograph")} width={large?640:80} height={large?400:80} onError={()=>setFailed(true)}/>:<span>{path?"Image unavailable":"No photo"}</span>}</div>;
}
export default function AdminConsole(){
 const [staff,setStaff]=useState<Record<string,Row[]>>({});
 const [delivery,setDelivery]=useState<Record<string,number>|null>(null);
 const [message,setMessage]=useState("");
 const [busy,setBusy]=useState(false);
 const [allowed,setAllowed]=useState(false);
 const [section,setSection]=useState<"pending"|"listings"|"sellers"|"buyers">("pending");
 const [selected,setSelected]=useState<string|null>(null);
 const listings=staff.ir_auctions||[];
 const pending=listings.filter(row=>row.status==="under_review");
 const sellerIds=new Set([...(staff.ir_seller_applications||[]).map(r=>r.user_id),...(staff.ir_account_onboarding||[]).filter(r=>r.account_type==="seller").map(r=>r.user_id)]);
 const sellers=(staff.ir_profiles||[]).filter(r=>sellerIds.has(r.id)||r.seller_status!=="not_started");
 const buyerOnboarding=(staff.ir_account_onboarding||[]).filter(r=>r.account_type==="buyer");
 const buyerIds=new Set(buyerOnboarding.map(r=>r.user_id));
 const buyers=(staff.ir_profiles||[]).filter(r=>buyerIds.has(r.id)||r.active_account==="buyer");
 const accountSection=section==="sellers"||section==="buyers";
 const buyerStatus=(id:unknown)=>buyerOnboarding.find(r=>r.user_id===id)?.completed_at?"Setup complete":"Setup in progress";
 const sellerName=(id:unknown)=>String((staff.ir_profiles||[]).find(r=>r.id===id)?.name||"Seller");
 const applicationName=(id:unknown)=>String((staff.ir_seller_applications||[]).find(r=>r.user_id===id)?.business_name||"Individual seller");
 const rows=section==="buyers"?buyers:section==="sellers"?sellers:section==="pending"?pending:listings;
 const current=rows.find(r=>r.id===selected);
 const owner=current&&(accountSection?current.id:current.seller_id);
 const application=(staff.ir_seller_applications||[]).find(r=>r.user_id===owner);
 const onboarding=(staff.ir_account_onboarding||[]).find(r=>r.user_id===owner&&r.account_type===(section==="buyers"?"buyer":"seller"));
 const evidence=(staff.ir_documents||[]).filter(r=>r.user_id===owner&&(accountSection?!r.auction_id:r.auction_id===current?.id||!r.auction_id));
 const seller=(staff.ir_profiles||[]).find(r=>r.id===owner);
 const approvalChecks=current&&!accountSection?[
  {title:"Listing photograph",ok:!!current.image_path},
  {title:"Approved, active seller",ok:seller?.seller_status==="approved"&&!seller?.suspended},
  {title:"Closing time more than one hour away",ok:new Date(String(current.end_at)).getTime()>Date.now()+3600000}
 ]:[];
 const canApprove=approvalChecks.every(check=>check.ok);
 const choose=(next:typeof section)=>{setSection(next);setSelected(null);};
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
 return <main className="portal"><header className="portalHeader"><Link className="brand" href="/">IRKANTI</Link><span>ADMINISTRATION</span><Link href="/account">My account →</Link></header><div className="portalBody"><h1>Admin dashboard</h1><p>Staff tools · Showing the latest 200 records per section</p><button disabled={busy} onClick={()=>void run(refresh,"Staff records refreshed")}>Refresh records</button>{message&&<p className="portalMessage" role="status">{message}</p>}{!allowed?<section className="portalPanel"><p>Checking your verified administrator account and active session.</p><Link href="/account?tab=security">Account security</Link></section>:<>

<div className="adminStats" aria-label="Dashboard sections">
{([["pending","Pending approval",pending.length],["listings","Submitted listings",listings.length],["sellers","Sellers",sellers.length],["buyers","Buyers",buyers.length]] as const).map(([key,title,count])=><button key={key} aria-pressed={section===key} onClick={()=>choose(key)}><span>{title}</span><strong>{count}</strong><span>{key==="buyers"?"View buyer details":key==="sellers"?"View seller details":"Review submissions"} →</span></button>)}
</div>
<div className="adminWorkspace">
<section className="portalPanel"><h2>{section==="buyers"?"Buyer directory":section==="sellers"?"Seller directory":section==="pending"?"Awaiting your review":"All submitted listings"}</h2>
{!rows.length?<p className="muted">{section==="pending"?"You're up to date. No listings awaiting approval.":"No records yet."}</p>:<ul className="adminRecords">{rows.map(row=><li key={String(row.id)}>{!accountSection&&<ListingPhoto key={String(row.image_path)} row={row}/>}<div><strong>{String(accountSection?row.name:row.title)}</strong><span>{section==="buyers"?buyerStatus(row.id):section==="sellers"?(applicationName(row.id)):String(row.category)+" · "+sellerName(row.seller_id)}</span><span className="adminBadge">{row.suspended?"Suspended":section==="buyers"?"Active":label(section==="sellers"?row.seller_status:row.status)}</span></div><button aria-pressed={selected===row.id} onClick={()=>setSelected(String(row.id))}>{section==="buyers"?"View buyer":section==="sellers"?"View seller":"Review listing"} →</button></li>)}</ul>}
</section>
<section className="portalPanel adminDetail" aria-label="Selected record details" aria-live="polite">
{!current?<><h2>Select {section==="buyers"?"a buyer":section==="sellers"?"a seller":"a listing"}</h2><p>Open a record to see its details, supporting documents and review actions.</p></>:<>
<h2>{String(accountSection?current.name:current.title)}</h2><p className="adminBadge">{section==="buyers"?buyerStatus(current.id):label(section==="sellers"?current.seller_status:current.status)}</p>
{!accountSection&&<><ListingPhoto key={String(current.id)+String(current.image_path)} row={current} large/><p>{String(current.description)}</p><dl>{["category","location","start_price","reserve_price","end_at","review_note"].map(key=><div key={key}><dt>{label(key)}</dt><dd>{String(current[key]??"—")}</dd></div>)}</dl><p>Submitted by {sellerName(owner)}</p></>}
{accountSection&&<><h3>Account & onboarding</h3><dl><div><dt>Account</dt><dd>{current.suspended?"Suspended":"Active"}</dd></div><div><dt>Onboarding</dt><dd>{onboarding?.completed_at?"Complete":"In progress"}</dd></div><div><dt>Joined</dt><dd>{String(current.created_at||"—").slice(0,10)}</dd></div></dl>
{section==="sellers"&&application&&<dl>{["legal_name","business_name","registration_number","address","review_note"].map(key=><div key={key}><dt>{label(key)}</dt><dd>{String(application[key]||"—")}</dd></div>)}</dl>}
{onboarding?.details&&typeof onboarding.details==="object"?<dl>{Object.entries(onboarding.details as Row).map(([key,value])=><div key={key}><dt>{label(key)}</dt><dd>{String(value??"—")}</dd></div>)}</dl>:null}
{section==="sellers"&&<p>{listings.filter(r=>r.seller_id===owner).length} listings in loaded records</p>}</>}
<h3>Supporting documents</h3>{evidence.length?evidence.map(doc=><button key={String(doc.id)} disabled={busy} onClick={()=>void download(String(doc.path))}>{label(doc.kind)} ↓</button>):<p className="muted">No supporting documents submitted.</p>}
{!accountSection&&current.status==="under_review"&&<div className="adminChecklist"><h3>Approval checklist</h3><ul>{approvalChecks.map(check=><li key={check.title}><span>{check.ok?"✓ Ready":"Missing"}</span> {check.title}</li>)}</ul>{!canApprove&&<p>The seller must add the missing information before this listing can go live.</p>}</div>}
{message&&<p className="portalMessage" role="status">{message}</p>}
{section!=="buyers"&&<form key={String(current.id)+section} onSubmit={e=>{e.preventDefault();const data=new FormData(e.currentTarget);const submitter=(e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement|null;if(submitter?.name==="action")data.set("action",submitter.value);void run(async()=>{await rpc("ir_admin_action",{p_action:field(data,"action"),p_target:String(current.id),p_note:field(data,"note"),p_fingerprint:field(data,"fingerprint")||null});},"Decision saved");}}>
{section==="sellers"&&<label>Decision<select name="action">{(section==="sellers"?[...(application?["approve_seller","reject_seller"]:[]),current.suspended?"reinstate":"suspend"]:current.status==="under_review"?["approve_listing","reject_listing"]:[]).map(action=><option key={action} value={action}>{label(action)}</option>)}</select></label>}
{section==="sellers"&&application&&<label>Identity fingerprint (approval only)<input name="fingerprint"/><small>Use the verified pseudonymous fingerprint, never a raw document number.</small></label>}
<label>Review note<textarea name="note" required minLength={5} maxLength={2000}/></label>
{section==="sellers"?<button className="goldButton" disabled={busy}>Save decision</button>:current.status==="under_review"?<div className="portalLinks"><button name="action" value="approve_listing" className="goldButton" disabled={busy||!canApprove}>{busy?"Saving…":"Approve listing"}</button><button name="action" value="reject_listing" disabled={busy}>Reject listing</button></div>:<p>This listing has already been reviewed.</p>}</form>}
</>}
</section></div>
<details className="adminAdvanced"><summary>Other administration tools & audit records</summary>

<section className="portalPanel"><h2>Verify a buyer</h2><p>Review the private identity evidence before recording approval. Use the same pseudonymous identity fingerprint for this person across buyer and seller accounts.</p><form onSubmit={e=>{e.preventDefault();const d=new FormData(e.currentTarget);void run(async()=>{await rpc("ir_verify_buyer",{p_user:field(d,"user"),p_fingerprint:field(d,"fingerprint"),p_note:field(d,"note")});},"Buyer identity verified");}}><label>Buyer account ID<input name="user" required pattern="[0-9a-fA-F-]{36}"/></label><label>Verified identity fingerprint<input name="fingerprint" required minLength={8}/></label><label>Review note<textarea name="note" required minLength={5}/></label><button disabled={busy}>Record buyer verification</button></form></section>
          <div className="portalPanel"><h2>Staff decision</h2>{delivery&&<p>Email queue: {delivery.pending} pending · {delivery.sending} sending · {delivery.sent} sent · {delivery.failed} require review. Delivery requires Resend setup.</p>}<p>Review the records and private evidence below before deciding. Every action requires a note and is recorded in the audit trail.</p><form onSubmit={e=>{e.preventDefault();const d=new FormData(e.currentTarget);void run(async()=>{await rpc("ir_admin_action",{p_action:field(d,"action"),p_target:field(d,"target"),p_note:field(d,"note"),p_fingerprint:field(d,"fingerprint")||null});},"Staff decision recorded");}}>
            <label>Action<select name="action">{["approve_seller","reject_seller","approve_listing","reject_listing","suspend","reinstate","resolve_dispute","dismiss_dispute"].map(a=><option key={a} value={a}>{label(a)}</option>)}</select></label><label>Target account / listing / dispute ID<input name="target" required pattern="[0-9a-fA-F-]{36}"/></label><label>Decision note<textarea name="note" minLength={5} maxLength={2000} required/></label><label>Verified identity fingerprint (seller approval only)<input name="fingerprint" autoComplete="off"/><small>Use the same pseudonymous fingerprint for the same verified person/entity. Never enter a raw identity document number here.</small></label><button disabled={busy} className="goldButton">Record decision</button>
          </form></div><div className="portalGrid">{Object.entries(staff).map(([table,rows])=><div key={table} className="portalPanel"><h2>{label(table.replace("ir_",""))}</h2>{rows.length?rows.map((row,i)=><div className="record" key={String(row.id||row.user_id||i)}><dl>{Object.entries(row).filter(([k])=>!["path"].includes(k)).map(([k,v])=><div key={k}><dt>{label(k)}</dt><dd>{typeof v==="object"?JSON.stringify(v):String(v??"—")}</dd></div>)}</dl>{table==="ir_documents"&&<button onClick={()=>void download(String(row.path))}>Download private evidence</button>}</div>):<p>No records.</p>}</div>)}</div>

</details></>}</div></main>;
}
