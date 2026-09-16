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
  <h2>{steps[step]}</h2><p>Your progress is saved when you continue. You can come back to finish.</p>
  {message&&<p className="portalMessage" role="status">{message}</p>}
  <form onSubmit={save}>
   {step===0&&<>{input("legal_name","Full legal name")}{input("phone","Contact phone",true,"tel")}{input("country","Country of residence")}{input("address","Residential address")}</>}
   {step===1&&(type==="seller"?<><p>Leave business details blank if you are selling privately.</p>{input("business_name","Business / trading name",false)}{input("registration_number","Business registration number",Boolean(details.business_name))}<p>Ownership and category-specific evidence will be collected separately for each asset.</p></>:<>{input("interests","Categories you are interested in",false)}<p>Save favourites for inspiration. Use your watchlist to follow auctions you may bid on.</p></>)}
   {step===2&&<><p>Your email must be verified before you can complete setup.</p><p>{type==="seller"?"Upload identity evidence below, plus business registration evidence if you sell as a business. Staff review is required before you can submit inventory.":"Your buyer account lets you browse, watch and save assets. Identity verification and bidder eligibility checks are still required before bidding. You can upload identity evidence below for staff review."}</p><label className="checkLabel"><input type="checkbox" required checked={details.adult==="true"} onChange={e=>setDetails({...details,adult:String(e.target.checked)})}/>I confirm I am at least 18 years old.</label></>}
   {step===3&&<><p>Check your details before completing your {type} account.</p><dl>{Object.entries(details).filter(([k])=>k!=="adult").map(([k,v])=><div key={k}><dt>{k.replaceAll("_"," ")}</dt><dd>{v||"—"}</dd></div>)}</dl><p>{type==="seller"?"Your application will be submitted for staff review. Completing setup does not approve you to sell.":"Setup does not automatically approve you to bid or remove the marketplace’s pre-launch restrictions."}</p></>}
   <div className="portalLinks">{step>0&&<button type="button" disabled={busy} onClick={()=>setStep(step-1)}>Back</button>}<button className="goldButton" disabled={busy}>{busy?"Saving…":step===3?`Complete ${type} setup`:"Save & continue"}</button></div>
  </form>
  {step===2&&<form onSubmit={upload}><h3>Private verification documents</h3><label>Evidence type<select name="kind"><option value="identity">Identity document</option>{type==="seller"&&<option value="business">Business registration</option>}</select></label><label>Document<input type="file" name="file" accept="application/pdf,image/jpeg,image/png" required/></label><small>PDF, JPEG or PNG · maximum 8 MB. Only you and authorised staff can access these documents.</small><button disabled={busy}>Upload privately</button>{uploaded.length>0&&<p>Uploaded this visit: {uploaded.join(", ")}</p>}</form>}
  <button disabled={busy} onClick={onCancel}>Return to account settings</button>
 </section>;
}
