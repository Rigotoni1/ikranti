"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { listingImageUrl } from "@/lib/listing-image";
import "./dashboard.css";
import { UserProfile, roles, identity } from "./user-profile";
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
 const [section,setSection]=useState<"pending"|"listings"|"sellers"|"buyers"|"users">("pending");
 const [selected,setSelected]=useState<string|null>(null);
 const [reviewNote,setReviewNote]=useState("");
 const [reviewed,setReviewed]=useState(false);
 const [checkedAt,setCheckedAt]=useState(0);
 const queue=useRef<string[]>([]);
 const listings=staff.ir_auctions||[];
 const pending=listings.filter(row=>row.status==="under_review");
 const sellers=(staff.ir_profiles||[]).filter(r=>r.seller_role);
 const buyers=(staff.ir_profiles||[]).filter(r=>r.buyer_role);
 const accountSection=section==="sellers"||section==="buyers"||section==="users";
 const sellerName=(id:unknown)=>String((staff.ir_profiles||[]).find(r=>r.id===id)?.name||"Seller");
 const rows=section==="users"?(staff.ir_profiles||[]):section==="buyers"?buyers:section==="sellers"?sellers:section==="pending"?pending:listings;
 const current=(accountSection?(staff.ir_profiles||[]):listings).find(r=>r.id===selected);
 const owner=current&&(accountSection?current.id:current.seller_id);
 const application=(staff.ir_seller_applications||[]).find(r=>r.user_id===owner);
 const evidence=(staff.ir_documents||[]).filter(r=>r.user_id===owner&&(accountSection?!r.auction_id:r.auction_id===current?.id||!r.auction_id));
 const seller=(staff.ir_profiles||[]).find(r=>r.id===owner);
 const approvalChecks=current&&!accountSection?[
  {title:"Listing photograph",ok:!!current.image_path},
  {title:"Approved, active seller",ok:seller?.seller_status==="approved"&&!seller?.suspended},
  {title:"Closing time more than one hour away",ok:new Date(String(current.end_at)).getTime()>checkedAt+3600000}
 ]:[];
 const canApprove=approvalChecks.every(check=>check.ok);
 const choose=(next:typeof section)=>{setSection(next);setSelected(null);setReviewed(false);setReviewNote("");};
 const select=(id:string)=>{setSelected(id);setReviewed(false);setReviewNote("");queue.current=pending.map(r=>String(r.id));window.setTimeout(()=>document.querySelector(".adminDetail")?.scrollIntoView({behavior:"smooth",block:"start"}),0);};
 const nextPending=()=>{const index=queue.current.indexOf(selected||"");const candidates=[...queue.current.slice(index+1),...queue.current.slice(0,index)];const next=candidates.find(id=>pending.some(r=>r.id===id))||pending.find(r=>r.id!==selected)?.id; if(next)select(String(next));else{setSelected(null);setReviewed(false);}};
 const version=useRef(0);
 const mutation=useRef(false);
 const refresh=useCallback(async()=>{
  const request=++version.current;
  const health=await client.rpc("ir_delivery_health");
  if(request!==version.current)return;
  if(health.error){setAllowed(false);setStaff({});setDelivery(null);throw new Error("Administrator access could not be verified. Check Account Security and sign in again if needed.");}
  const values=await Promise.all(tables.map(t=>t==="ir_profiles"?client.rpc("ir_admin_users"):client.from(t).select("*").order(t==="ir_seller_applications"?"submitted_at":t==="ir_account_onboarding"?"updated_at":"created_at",{ascending:false}).limit(200)));
  if(request!==version.current)return;
  if(values.some(v=>v.error)){setAllowed(false);setStaff({});throw new Error("Staff records could not be loaded. Please refresh.");}
  setStaff(Object.fromEntries(tables.map((t,i)=>[t,values[i].data||[]])));
  setCheckedAt(Date.now());setDelivery(health.data);setAllowed(true);
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
{([["users","All users",(staff.ir_profiles||[]).length],["pending","Pending approval",pending.length],["listings","Submitted listings",listings.length],["sellers","Sellers",sellers.length],["buyers","Buyers",buyers.length]] as const).map(([key,title,count])=><button key={key} aria-pressed={section===key} onClick={()=>choose(key)}><span>{title}</span><strong>{count}</strong><span>{key==="users"?"View all users":key==="buyers"?"View buyer details":key==="sellers"?"View seller details":"Review submissions"} →</span></button>)}
</div>
<div className={`adminWorkspace ${accountSection?"userWorkspace":""}`}>
<section className="portalPanel"><h2>{section==="users"?"User directory":section==="buyers"?"Buyer directory":section==="sellers"?"Seller directory":section==="pending"?"Awaiting your review":"All submitted listings"}</h2>
{accountSection?<div className="userDirectory"><table><thead><tr>{["Name","Roles","Email verified","Identity status","Account status","Joined","View"].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map(row=><tr key={String(row.id)}><td data-label="Name"><strong>{String(row.name||"Member")}</strong><small>{String(row.email||"")}</small></td><td data-label="Roles">{roles(row)}</td><td data-label="Email verified">{row.email_verified?"Yes":"No"}</td><td data-label="Identity status">{identity(row)}</td><td data-label="Account status">{row.suspended?"Suspended":"Active"}</td><td data-label="Joined">{String(row.created_at).slice(0,10)}</td><td><button onClick={()=>select(String(row.id))} aria-pressed={selected===row.id}>View</button></td></tr>)}</tbody></table>{!rows.length&&<p>No users in this view.</p>}</div>:!rows.length?<p className="muted">{section==="pending"?"You're up to date. No listings awaiting approval.":"No records yet."}</p>:<ul className="adminRecords">{rows.map(row=><li key={String(row.id)}>{!accountSection&&<ListingPhoto key={String(row.image_path)} row={row}/>}<div><strong>{String(accountSection?row.name:row.title)}</strong><span>{String(row.category)+" · "+sellerName(row.seller_id)}</span><span className="adminBadge">{label(row.status)}</span></div><button aria-pressed={selected===row.id} onClick={()=>select(String(row.id))}>{"Review listing"} →</button></li>)}</ul>}
</section>
<section className="portalPanel adminDetail" aria-label="Selected record details" aria-live="polite">
{!current?<><h2>Select {section==="buyers"?"a buyer":section==="sellers"?"a seller":"a listing"}</h2><p>Open a record to see its details, supporting documents and review actions.</p></>:<>
{accountSection?<UserProfile key={String(current.id)+String(current.suspended)+String(current.seller_status)+String(current.identity_approved)} user={current} download={path=>void download(path)} busy={busy}/>:<><h2>{String(current.title)}</h2><p className="adminBadge">{label(current.status)}</p></>}
{!accountSection&&<><ListingPhoto key={String(current.id)+String(current.image_path)} row={current} large/><p>{String(current.description)}</p><dl>{["category","location","start_price","reserve_price","end_at","review_note"].map(key=><div key={key}><dt>{label(key)}</dt><dd>{String(current[key]??"—")}</dd></div>)}</dl><p>Submitted by {sellerName(owner)}</p></>}

{!accountSection&&<><h3>Supporting documents</h3>{evidence.length?evidence.map(doc=><button key={String(doc.id)} disabled={busy} onClick={()=>void download(String(doc.path))}>{label(doc.kind)} ↓</button>):<p className="muted">No supporting documents submitted.</p>}</>}
{!accountSection&&current.status==="under_review"&&<div className="adminChecklist"><h3>Approval checklist</h3><ul>{approvalChecks.map(check=><li key={check.title}><span>{check.ok?"✓ Ready":"Missing"}</span> {check.title}</li>)}</ul>{!canApprove&&<p>The seller must add the missing information before this listing can go live.</p>}</div>}
{message&&<p className="portalMessage" role="status">{message}</p>}
{(accountSection||current.status==="under_review")&&<form key={String(current.id)+section} onSubmit={e=>{e.preventDefault();const data=new FormData(e.currentTarget);const submitter=(e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement|null;if(submitter?.name==="action")data.set("action",submitter.value);void run(async()=>{if(field(data,"action")==="verify_buyer"){await rpc("ir_verify_buyer",{p_user:String(current.id),p_note:field(data,"note"),p_fingerprint:field(data,"fingerprint")});}else{await rpc("ir_admin_action",{p_action:field(data,"action"),p_target:String(current.id),p_note:field(data,"note"),p_fingerprint:field(data,"fingerprint")||null});}setReviewed(true);},accountSection?"Account decision saved.":"Decision saved. The seller has been notified in their account.");}}>
{accountSection&&<label>Decision<select name="action">{(accountSection?[...(current.buyer_complete?["verify_buyer"]:[]),...(application?["approve_seller","reject_seller"]:[]),current.suspended?"reinstate":"suspend"]:current.status==="under_review"?["approve_listing","reject_listing"]:[]).map(action=><option key={action} value={action}>{label(action)}</option>)}</select></label>}
{accountSection&&Boolean(application||current.buyer_complete)&&<label>Identity fingerprint (approval only)<input name="fingerprint"/><small>Use the verified pseudonymous fingerprint, never a raw document number.</small></label>}
{!accountSection&&current.status==="under_review"&&<label>Reason template<select defaultValue="" onChange={e=>{if(e.target.value)setReviewNote(e.target.value);}}><option value="">Choose a template (optional)</option>{["Photograph unclear.","Description incomplete.","Please clarify condition.","Supporting information required."].map(t=><option key={t}>{t}</option>)}</select></label>}
<label>Review note<textarea name="note" required minLength={5} maxLength={2000} value={reviewNote} onChange={e=>setReviewNote(e.target.value)}/><small>Editable message. Listing decisions are sent to the seller and recorded in the audit trail. Unsaved text stays only while this record is open.</small></label>
{accountSection?<button className="goldButton" disabled={busy}>Save decision</button>:current.status==="under_review"?<div className="portalLinks"><button name="action" value="approve_listing" className="goldButton" disabled={busy||!canApprove}>{busy?"Saving…":"Approve listing"}</button><button name="action" value="request_listing_changes" disabled={busy}>Request changes</button><button className="dangerButton" name="action" value="reject_listing" disabled={busy}>Reject</button></div>:<p>This listing has already been reviewed.</p>}</form>}
{reviewed&&!accountSection&&<button className="goldButton" disabled={busy} onClick={nextPending}>Next pending submission →</button>}
</>}
</section></div>
<details className="adminAdvanced"><summary>Other administration tools & audit records</summary>

<section className="portalPanel"><h2>Verify a buyer</h2><p>Review the private identity evidence before recording approval. Use the same pseudonymous identity fingerprint for this person across buyer and seller accounts.</p><form onSubmit={e=>{e.preventDefault();const d=new FormData(e.currentTarget);void run(async()=>{await rpc("ir_verify_buyer",{p_user:field(d,"user"),p_fingerprint:field(d,"fingerprint"),p_note:field(d,"note")});},"Buyer identity verified");}}><label>Buyer account ID<input name="user" required pattern="[0-9a-fA-F-]{36}"/></label><label>Verified identity fingerprint<input name="fingerprint" required minLength={8}/></label><label>Review note<textarea name="note" required minLength={5}/></label><button disabled={busy}>Record buyer verification</button></form></section>
          <div className="portalPanel"><h2>Staff decision</h2>{delivery&&<p>Email queue: {delivery.pending} pending · {delivery.sending} sending · {delivery.sent} sent · {delivery.failed} require review. Delivery requires Resend setup.</p>}<p>Review the records and private evidence below before deciding. Every action requires a note and is recorded in the audit trail.</p><form onSubmit={e=>{e.preventDefault();const d=new FormData(e.currentTarget);void run(async()=>{await rpc("ir_admin_action",{p_action:field(d,"action"),p_target:field(d,"target"),p_note:field(d,"note"),p_fingerprint:field(d,"fingerprint")||null});},"Staff decision recorded");}}>
            <label>Action<select name="action">{["approve_seller","reject_seller","approve_listing","reject_listing","suspend","reinstate","resolve_dispute","dismiss_dispute"].map(a=><option key={a} value={a}>{label(a)}</option>)}</select></label><label>Target account / listing / dispute ID<input name="target" required pattern="[0-9a-fA-F-]{36}"/></label><label>Decision note<textarea name="note" minLength={5} maxLength={2000} required/></label><label>Verified identity fingerprint (seller approval only)<input name="fingerprint" autoComplete="off"/><small>Use the same pseudonymous fingerprint for the same verified person/entity. Never enter a raw identity document number here.</small></label><button disabled={busy} className="goldButton">Record decision</button>
          </form></div><div className="portalGrid">{Object.entries(staff).map(([table,rows])=><div key={table} className="portalPanel"><h2>{label(table.replace("ir_",""))}</h2>{rows.length?rows.map((row,i)=><div className="record" key={String(row.id||row.user_id||i)}><dl>{Object.entries(row).filter(([k])=>!["path"].includes(k)).map(([k,v])=><div key={k}><dt>{label(k)}</dt><dd>{typeof v==="object"?JSON.stringify(v):String(v??"—")}</dd></div>)}</dl>{table==="ir_documents"&&<button onClick={()=>void download(String(row.path))}>Download private evidence</button>}</div>):<p>No records.</p>}</div>)}</div>

</details></>}</div></main>;
}
