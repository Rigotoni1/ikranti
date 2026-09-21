"use client";
import { FormEvent, useState } from "react";
import { browserClient } from "@/lib/supabase/browser";
import { supabaseUrl } from "@/lib/supabase/config";

export type AccountType = "buyer" | "seller";
export type OnboardingRecord = { account_type:AccountType; details:Record<string,string>; step:number; completed_at:string|null };

export function Onboarding({type,record,onComplete,onCancel}:{type:AccountType;record?:OnboardingRecord;onComplete:()=>Promise<void>;onCancel:()=>void}) {
 const [step,setStep]=useState(record?.completed_at?0:record?.step||0);
 const [details,setDetails]=useState<Record<string,string>>(record?.details||{country:"Malta"});
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState("");
 const [uploaded,setUploaded]=useState<string[]>([]);
 const [showUpload,setShowUpload]=useState(false);
 const client=browserClient();
 const steps=["About you",type==="seller"?"Your business":"Your interests","Verification","Review"];
 function input(key:string,title:string,required=true,kind="text") {return <label>{title}<input type={kind} value={details[key]||""} required={required} maxLength={key==="address"?1000:160} onChange={e=>setDetails({...details,[key]:e.target.value})}/></label>;}
 async function save(event:FormEvent) {
  event.preventDefault(); if(busy)return;setBusy(true);setMessage("");
  try {
   const {error}=await client.rpc("ir_save_onboarding",{p_type:type,p_details:details,p_step:Math.min(3,step+1),p_complete:step===3});
   if(error)throw error;
   if(step===3)await onComplete();else setStep(step+1);
  }catch(e){setMessage(e instanceof Error?e.message:String((e as {message?:string}).message||"Could not save. Please retry."));}finally{setBusy(false);}
 }
 async function upload(event:FormEvent<HTMLFormElement>) {
  event.preventDefault();if(busy)return;const form=new FormData(event.currentTarget);setBusy(true);setMessage("");
  try {
   const {data:{session}}=await client.auth.getSession();if(!session)throw new Error("Sign in again to continue.");
   const response=await fetch(`${supabaseUrl}/functions/v1/ir-launch-worker`,{method:"POST",headers:{Authorization:`Bearer ${session.access_token}`},body:form});
   const result=await response.json() as {error?:string};if(!response.ok)throw new Error(result.error||"Upload failed");
   setUploaded(current=>[...current,String(form.get("kind"))]);setMessage("Document uploaded privately. Uploading is not the same as verification approval.");
  }catch(e){setMessage(e instanceof Error?e.message:"Upload failed");}finally{setBusy(false);}
 }
 return <section className="onboardingShell portalPanel">
  <p className="eyebrow">{type.toUpperCase()} ACCOUNT · STEP {step+1} OF 4</p>
  <ol className="onboardingSteps" aria-label="Onboarding progress">{steps.map((name,i)=><li key={name} aria-current={step===i?"step":undefined} className={i<=step?"reached":""}>{i+1}. {name}</li>)}</ol>
  <h2>{step===2?"Upload your ID":steps[step]}</h2>{step!==2&&<p>Your progress is saved when you continue. You can come back to finish.</p>}
  {step===2&&<div className="identityPrompt"><p>Help us verify your identity with a clear copy of your passport or national identity card. Your document is private and will be reviewed by our team.</p><p className="muted">Uploading your ID starts the review—it does not automatically verify your account. {type==="seller"?"Seller approval is required before submitting listings.":"You can browse and save items while you wait. Approval is required before bidding."}</p><div className="portalLinks"><button type="button" className="goldButton" disabled={busy} aria-expanded={showUpload} aria-controls="identity-upload" onClick={()=>setShowUpload(true)}>{uploaded.includes("identity")?"Upload another ID":"Upload ID"}</button><button type="button" disabled={busy} onClick={onCancel}>Maybe later</button></div><small>You can return to verification from Account settings. Your saved setup progress will be kept.</small></div>}
  {step===2&&showUpload&&<form id="identity-upload" onSubmit={upload}><h3>Private document upload</h3><label>Document type<select name="kind"><option value="identity">Passport / national identity card</option>{type==="seller"&&<option value="business">Business registration</option>}</select></label><label>Choose a document<input type="file" name="file" accept="application/pdf,image/jpeg,image/png" required/></label><small>PDF, JPEG or PNG · maximum 8 MB. Only you and authorised staff can access these documents.</small><button className="goldButton" disabled={busy}>{busy?"Uploading…":"Submit for review"}</button>{uploaded.length>0&&<p>Uploaded this visit: {uploaded.join(", ")}. Pending staff review.</p>}</form>}
  {message&&<p className="portalMessage" role="status">{message}</p>}
  <form onSubmit={save}>
   {step===0&&<>{input("legal_name","Full legal name")}{input("phone","Contact phone",true,"tel")}{input("country","Country of residence")}{input("address","Residential address")}</>}
   {step===1&&(type==="seller"?<><p>Leave business details blank if you are selling privately.</p>{input("business_name","Business / trading name",false)}{input("registration_number","Business registration number",Boolean(details.business_name))}<p>Ownership and category-specific evidence will be collected separately for each asset.</p></>:<>{input("interests","Categories you are interested in",false)}<p>Use your watchlist to save items and follow auctions you may bid on.</p></>)}
   {step===2&&<>{type==="seller"&&details.business_name&&<p>Business sellers also need to upload their business registration above.</p>}<label className="checkLabel"><input type="checkbox" required checked={details.adult==="true"} onChange={e=>setDetails({...details,adult:String(e.target.checked)})}/>I confirm I am at least 18 years old.</label></>}
   {step===3&&<><p>Check your details before completing your {type} account.</p><dl>{Object.entries(details).filter(([k])=>k!=="adult").map(([k,v])=><div key={k}><dt>{k.replaceAll("_"," ")}</dt><dd>{v||"—"}</dd></div>)}</dl><p>{type==="seller"?"Your application will be submitted for staff review. Completing setup does not approve you to sell.":"Setup does not automatically approve you to bid or remove the marketplace’s pre-launch restrictions."}</p></>}
   <div className="portalLinks">{step>0&&<button type="button" disabled={busy} onClick={()=>setStep(step-1)}>Back</button>}<button className="goldButton" disabled={busy}>{busy?"Saving…":step===3?`Complete ${type} setup`:"Save & continue"}</button></div>
  </form>
  <button disabled={busy} onClick={onCancel}>Return to account settings</button>
 </section>;
}
