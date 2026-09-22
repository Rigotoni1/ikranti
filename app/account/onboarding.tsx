"use client";
import { FormEvent, useRef, useState } from "react";
import { browserClient } from "@/lib/supabase/browser";
import { supabaseUrl } from "@/lib/supabase/config";
import { TERMS_PATH, TERMS_VERSION } from "@/lib/terms";
import "./onboarding.css";

export type AccountType = "buyer";
export type OnboardingRecord = { account_type:AccountType; details:Record<string,string>; step:number; completed_at:string|null };
const interestCategories = ["All categories", "Property", "Motor Cars", "Boats", "Watches & Jewellery", "Art & Antiques", "Collectables"];

export function Onboarding({type,record,documents=[],onDocumentsSaved,onComplete,onCancel}:{type:AccountType;record?:OnboardingRecord;documents?:{kind:string;auction_id?:unknown}[];onDocumentsSaved?:()=>Promise<void>;onComplete:()=>Promise<void>;onCancel:()=>void}) {
 const [step,setStep]=useState(record?.completed_at?0:record?.step||0);
 const [details,setDetails]=useState<Record<string,string>>(record?.details||{country:"Malta"});
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState("");
 const [savedKinds,setSavedKinds]=useState<string[]>([]);
 const [termsAccepted,setTermsAccepted]=useState(record?.details.terms_version===TERMS_VERSION&&record?.details.terms_accepted==="true");
 const [uploading,setUploading]=useState(false);
 const [uploadError,setUploadError]=useState("");
 const [pendingFile,setPendingFile]=useState<{file:File;kind:string}|null>(null);
 const [savedFileName,setSavedFileName]=useState("");
 const inFlight=useRef(false);
 const fileInput=useRef<HTMLInputElement>(null);
 const uploaded=new Set([...documents.filter(d=>!d.auction_id).map(d=>d.kind),...savedKinds]);
 const documentsReady=uploaded.has("identity");
 const verificationReady=documentsReady&&termsAccepted&&!pendingFile;
 const client=browserClient();
 const steps=["About you","Your interests","Verification","Review"];
 function input(key:string,title:string,required=true,kind="text") {return <label>{title}<input type={kind} value={details[key]||""} required={required} disabled={busy} maxLength={key==="address"?1000:160} onChange={e=>setDetails({...details,[key]:e.target.value})}/></label>;}
 async function save(event:FormEvent) {
  event.preventDefault();if(inFlight.current)return;
  if(step>=2&&!verificationReady){setMessage("Save your required documents and accept the Terms & Conditions before continuing.");setStep(2);return;}
  inFlight.current=true;setBusy(true);setMessage("");
  try {
   const {error}=await client.rpc("ir_save_onboarding",{p_type:"buyer",p_details:{...details,terms_accepted:String(termsAccepted),terms_version:TERMS_VERSION},p_step:Math.min(3,step+1),p_complete:step===3});
   if(error)throw error;
   if(step===3)await onComplete();else setStep(step+1);
  }catch(e){setMessage(e instanceof Error?e.message:String((e as {message?:string}).message||"Could not save. Please retry."));}finally{inFlight.current=false;setBusy(false);}
 }
 async function upload(file:File,documentKind:string) {
  if(inFlight.current)return;
  setPendingFile({file,kind:documentKind});setUploadError("");setSavedFileName("");
  if(!["application/pdf","image/jpeg","image/png"].includes(file.type)||file.size===0||file.size>8*1024*1024){setUploadError("Choose a non-empty PDF, JPEG or PNG no larger than 8 MB. This file has not been saved.");return;}
  inFlight.current=true;setBusy(true);setUploading(true);setMessage("");
  try {
   const {data:{session}}=await client.auth.getSession();if(!session)throw new Error("Sign in again to continue.");
   const form=new FormData();form.set("kind",documentKind);form.set("file",file);
   const response=await fetch(`${supabaseUrl}/functions/v1/ir-launch-worker`,{method:"POST",headers:{Authorization:`Bearer ${session.access_token}`},body:form,signal:AbortSignal.timeout(60000)});
   const result=await response.json() as {error?:string;ok?:boolean};if(!response.ok||!result.ok)throw new Error(result.error||"Upload could not be confirmed. Please retry.");
   setSavedKinds(current=>Array.from(new Set([...current,documentKind])));setPendingFile(null);setSavedFileName(file.name);
   if(fileInput.current)fileInput.current.value="";
   // Upload success is authoritative even if refreshing the account document list fails.
   try{await onDocumentsSaved?.();}catch{setMessage("Your document was saved. The document list will refresh when you reopen your account.");}
  }catch(e){setUploadError(e instanceof Error?e.message:"Upload could not be confirmed. Please retry.");}finally{inFlight.current=false;setUploading(false);setBusy(false);}
 }
 return <section className="onboardingShell portalPanel" aria-busy={busy}>
  <p className="eyebrow">BUYER ACCOUNT · STEP {step+1} OF 4</p>
  <ol className="onboardingSteps" aria-label="Onboarding progress">{steps.map((name,i)=><li key={name} aria-current={step===i?"step":undefined} className={i<=step?"reached":""}>{i+1}. {name}</li>)}</ol>
  <h2>{step===2?"Upload your ID":steps[step]}</h2>{step!==2&&<p>Your progress is saved when you continue. You can come back to finish.</p>}
  {step===2&&<>
   <div className="identityPrompt"><p>Choose a clear copy of your passport or national identity card. It saves privately as soon as you select it—no separate submission needed.</p><p className="muted">Only you and authorised staff can access your document. Saving it starts the review; staff approval is still required before bidding.</p></div>
   <div className="identityAutoUpload">
    <label>Upload ID<input ref={fileInput} type="file" name="file" accept="application/pdf,image/jpeg,image/png" disabled={busy} aria-describedby="identity-upload-help" onChange={e=>{const file=e.currentTarget.files?.[0];if(file)void upload(file,"identity");}}/></label>
    <small id="identity-upload-help">PDF, JPEG or PNG · maximum 8 MB. Selecting a file uploads it immediately.</small>
    <div role="status" aria-live="polite">{uploading?<p>Uploading securely… Keep this page open.</p>:savedFileName&&<p className="savedDocument">Saved privately: {savedFileName}</p>}<p>{uploaded.has("identity")?"ID document saved privately":"ID document required"}</p></div>
    {uploadError&&<div className="portalMessage" role="alert"><p>{uploadError}</p>{pendingFile&&<button type="button" disabled={busy} onClick={()=>void upload(pendingFile.file,pendingFile.kind)}>Retry upload</button>}<p>You can also choose another file.</p></div>}
   </div>
  </>}
  {message&&<p className="portalMessage" role="status">{message}</p>}
  <form onSubmit={save}>
   {step===0&&<>{input("legal_name","Full legal name")}{input("phone","Contact phone",true,"tel")}{input("country","Country of residence")}{input("address","Residential address")}</>}
   {step===1&&<><label>Categories you are interested in<select name="interests" value={details.interests||""} disabled={busy} onChange={e=>setDetails({...details,interests:e.target.value})}><option value="">Choose a category (optional)</option>{details.interests&&!interestCategories.includes(details.interests)&&<option value={details.interests}>Previously saved: {details.interests}</option>}{interestCategories.map(category=><option key={category} value={category}>{category}</option>)}</select></label><p>Use your watchlist to save items and follow auctions you may bid on.</p></>}
   {step===2&&<div className="onboardingTerms"><label className="checkLabel"><input type="checkbox" required disabled={busy} checked={termsAccepted} onChange={e=>setTermsAccepted(e.target.checked)}/><span>I confirm I have read the <a href={TERMS_PATH} target="_blank" rel="noopener noreferrer">Terms & Conditions</a> and agree to them.</span></label><p>For a winning bid in a live auction: a 10% deposit is due on the day the auction closes, and full payment within 30 calendar days. Read the terms for fees, consumer rights and the separate property-sale process.</p><small>The terms open in a new tab, so your progress stays here. Acceptance is recorded when you continue.</small></div>}
   {step===3&&<><p>Check your details before completing your {type} account.</p><dl>{Object.entries(details).filter(([k])=>!["adult","terms_accepted","terms_version"].includes(k)).map(([k,v])=><div key={k}><dt>{k.replaceAll("_"," ")}</dt><dd>{v||"—"}</dd></div>)}</dl><p>{documentsReady?"Required documents saved privately":"Documents required—return to Verification"} · <a href={TERMS_PATH} target="_blank" rel="noopener noreferrer">{termsAccepted?`Terms accepted (version ${TERMS_VERSION})`:"Terms acceptance required—return to Verification"}</a></p><p>Completing setup does not approve your identity. Staff approval is required before bidding.</p></>}
   {step===2&&!documentsReady&&<p className="muted">Upload the required document to continue.</p>}
   <div className="portalLinks">{step>0&&<button type="button" disabled={busy} onClick={()=>{setMessage("");setStep(step-1);}}>Back</button>}<button className="goldButton" disabled={busy||(step>=2&&!verificationReady)}>{uploading?"Uploading…":busy?"Saving…":step===3?`Complete ${type} setup`:"Save & continue"}</button></div>
  </form>
  <button disabled={busy} onClick={onCancel}>Return to account settings</button>
 </section>;
}
