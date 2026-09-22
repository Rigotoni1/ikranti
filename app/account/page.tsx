"use client";
/* eslint-disable @next/next/no-img-element -- Supabase storage and locally generated TOTP QR codes */
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { User } from "@supabase/supabase-js";
import Link from "next/link";
import { browserClient } from "@/lib/supabase/browser";
import { supabaseUrl } from "@/lib/supabase/config";
import "./portal.css";
import { UploadFile } from "./upload-file";
import { Onboarding, AccountType, OnboardingRecord } from "./onboarding";
import { CheckEmail, type PendingVerification } from "./check-email";

type Row = Record<string, string | number | boolean | null>;
const categories = ["Property","Motor Cars","Boats","Watches & Jewellery","Art & Antiques","Collectables"];
const currency = (value: unknown) => new Intl.NumberFormat("en-MT",{style:"currency",currency:"EUR"}).format(Number(value));
const field = (form: FormData,key:string) => String(form.get(key)||"");
const label = (value:unknown) => String(value||"").replaceAll("_"," ");
const client = browserClient();

export default function Account() {
  const [user,setUser] = useState<User|null>(null);
  const [ready,setReady] = useState(false);
  const [mode,setMode] = useState("signin");
  const [signupType,setSignupType] = useState<AccountType|null>(null);
  const [pendingVerification,setPendingVerification] = useState<PendingVerification|null>(null);
  const [authEmail,setAuthEmail] = useState("");
  const [authName,setAuthName] = useState("");
  const [onboardingType,setOnboardingType] = useState<AccountType|null>(null);
  const [onboarding,setOnboarding] = useState<OnboardingRecord[]>([]);
  const [tab,setTab] = useState("Watchlist");
  const [sellerForm,setSellerForm] = useState<"asset"|"verification"|"documents"|null>(null);
  const [uploadVersion,setUploadVersion] = useState(0);
  const [message,setMessage] = useState("");
  const [busy,setBusy] = useState(false);
  const [connected,setConnected] = useState(false);
  const [profile,setProfile] = useState<Row|null>(null);
  const [catalogue,setCatalogue] = useState<Row[]>([]);
  const [lots,setLots] = useState<Row[]>([]);
  const [documents,setDocuments] = useState<Row[]>([]);
  const [notifications,setNotifications] = useState<Row[]>([]);
  const [orders,setOrders] = useState<Row[]>([]);
  const [maxima,setMaxima] = useState<Row[]>([]);
  const [watched,setWatched] = useState<string[]>([]);
  const [application,setApplication] = useState<Row|null>(null);
  const [aal,setAal] = useState("aal1");
  const [factor,setFactor] = useState("");
  const [qr,setQr] = useState("");
  const [trading,setTrading] = useState(false);
  const [adminInvite,setAdminInvite] = useState(false);
  const loading = useRef(0);
  const initialOnboardingUser = useRef<string|null>(null);
  const mutation = useRef(false);
  const pendingBid = useRef<{auction:string;amount:number;id:string}|null>(null);

  const refresh = useCallback(async () => {
    const version = ++loading.current;
    const { data: { user: current } } = await client.auth.getUser();
    const [catalog, status] = await Promise.all([
      client.from("ir_public_auctions").select("*").order("end_at"),
      client.rpc("ir_launch_status"),
    ]);
    if (version!==loading.current) return;
    if (catalog.error) throw new Error(catalog.error.message);
    setCatalogue(catalog.data||[]); setTrading(Boolean(status.data?.tradingEnabled)); setUser(current);
    if (current?.email_confirmed_at) setPendingVerification(null);
    if (!current) { setProfile(null); setReady(true); return; }
    const results = await Promise.all([
      client.from("ir_profiles").select("*").eq("id",current.id).single(),
      client.from("ir_auctions").select("*").eq("seller_id",current.id).order("created_at",{ascending:false}),
      client.from("ir_documents").select("*").eq("user_id",current.id),
      client.from("ir_notifications").select("*").eq("user_id",current.id).order("created_at",{ascending:false}).limit(100),
      client.from("ir_orders").select("*").or(`buyer_id.eq.${current.id},seller_id.eq.${current.id}`).order("created_at",{ascending:false}),
      client.from("ir_max_bids").select("*").eq("user_id",current.id),
      client.from("ir_watchlist").select("auction_id").eq("user_id",current.id),
      client.from("ir_seller_applications").select("*").eq("user_id",current.id).maybeSingle(),
      client.auth.mfa.getAuthenticatorAssuranceLevel(),
      client.auth.mfa.listFactors(),
      client.rpc("ir_admin_invitation_status"),
      client.from("ir_account_onboarding").select("*").eq("user_id",current.id),
    ]);
    if (version!==loading.current) return;
    const error = results.find(r=>r.error)?.error;
    if (error) throw new Error(error.message);
    setProfile(results[0].data); setLots(results[1].data||[]); setDocuments(results[2].data||[]);
    setNotifications(results[3].data||[]); setOrders((results[4].data||[]).filter(o=>results[0].data?.active_account==="seller"?o.seller_id===current.id:results[0].data?.active_account==="buyer"?o.buyer_id===current.id:false)); setMaxima(results[5].data||[]);
    setWatched((results[6].data||[]).map(r=>r.auction_id)); setApplication(results[7].data);
    setAal(results[8].data?.currentLevel||"aal1");
    setAdminInvite(Boolean(results[10].data));
    setOnboarding((results[11].data||[]) as OnboardingRecord[]);
    if(initialOnboardingUser.current!==current.id){
      initialOnboardingUser.current=current.id;
      const intent=current.user_metadata?.onboarding_intent;
      // User-editable metadata is only a navigation hint, never an access grant.
      if((intent==="buyer"||intent==="seller")&&!(results[11].data||[]).some(o=>o.completed_at))setOnboardingType(intent);
    }
    setFactor(current=>results[9].data?.totp.find(f=>f.status==="verified")?.id||current||results[9].data?.all.find(f=>f.factor_type==="totp")?.id||"");
    setReady(true);
  },[]);

  useEffect(() => {
    const safeRefresh = () => { void refresh().catch(e=>{setMessage(e.message);setReady(true);}); };
    const initial = window.setTimeout(()=>{
      if(new URLSearchParams(window.location.search).get("tab")==="security") setTab("Security");
      if(new URLSearchParams(window.location.search).get("tab")==="orders") setTab("Orders");
      if(new URLSearchParams(window.location.search).get("tab")==="settings") setTab("Settings");
      if(new URLSearchParams(window.location.search).get("recovery")==="1") setMode("password");
      if(new URLSearchParams(window.location.search).has("authError")) setMessage("This email link is invalid or expired. Request a new link.");
    },0);
    safeRefresh();
    const { data: { subscription } } = client.auth.onAuthStateChange((event) => {
      if (event==="PASSWORD_RECOVERY") setMode("password");
      if (event==="SIGNED_OUT") { setFactor(""); setQr(""); setOnboardingType(null);setOnboarding([]);initialOnboardingUser.current=null; }
      // Avoid invoking auth methods inside Supabase's synchronous auth callback.
      window.setTimeout(safeRefresh,0);
    });
    return () => { subscription.unsubscribe(); window.clearTimeout(initial); };
  },[refresh]);

  useEffect(() => {
    const update = () => { void refresh().catch(()=>setMessage("Updates delayed. Reconnect before bidding.")); };
    const userId=user?.id;
    const channel = client.channel(`ir-account-${userId||"public"}`)
      .on("postgres_changes",{event:"*",schema:"public",table:"ir_public_auctions"},update);
    if (userId) channel.on("postgres_changes",{event:"INSERT",schema:"public",table:"ir_notifications",filter:`user_id=eq.${userId}`},update);
    channel.subscribe(status=>{ setConnected(status==="SUBSCRIBED"); if(status==="SUBSCRIBED") update(); });
    const visible = () => { if(document.visibilityState==="visible") update(); };
    window.addEventListener("online",update); document.addEventListener("visibilitychange",visible);
    return () => { void client.removeChannel(channel); window.removeEventListener("online",update); document.removeEventListener("visibilitychange",visible); };
  },[user?.id,refresh]); // Supabase reconnects with backoff; every subscription refreshes a full snapshot.

  async function run(work:()=>Promise<void>,success="Saved") {
    if(mutation.current) return;
    mutation.current=true; setBusy(true); setMessage("");
    try { await work(); setMessage(success); await refresh(); }
    catch(e) { setMessage(e instanceof Error ? e.message : "Please try again."); }
    finally { mutation.current=false; setBusy(false); }
  }
  async function rpc(name:string,args:Record<string,unknown>={}) {
    const result = await client.rpc(name,args); if(result.error) throw new Error(result.error.message);
    if(result.data && typeof result.data==='object' && 'error' in result.data) throw new Error(String(result.data.error));
    return result.data;
  }
  function auth(event:FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form=event.currentTarget; const data = new FormData(form);
    void run(async()=>{
      const email=field(data,"email").trim(); const password=field(data,"password");
      const redirect = `${window.location.origin}/auth/confirm`;
      if(mode==="signup") {
        if(!signupType)throw new Error("Choose a buyer or seller account first.");
        const result=await client.auth.signUp({email,password,options:{data:{name:field(data,"name"),onboarding_intent:signupType},emailRedirectTo:redirect}});
        if(result.error)throw result.error;
        // A successful send request is not proof of inbox delivery or verification.
        // Do not retain the password while the user checks their email.
        const passwordInput=form.elements.namedItem("password");
        if(passwordInput instanceof HTMLInputElement)passwordInput.value="";
        if(!result.data.session?.user.email_confirmed_at)setPendingVerification({email,accountType:signupType,requestedAt:Date.now()});
        return;
      }
      const result = mode==="recovery" ? await client.auth.resetPasswordForEmail(email,{redirectTo:`${redirect}?recovery=1`})
        : mode==="password" ? await client.auth.updateUser({password}) : await client.auth.signInWithPassword({email,password});
      if(result.error) throw new Error(result.error.message);
      if(mode==="password") setMode("signin");
    },mode==="signup" ? "" : mode==="recovery" ? "If the address is registered, a recovery email will be sent." : "Account updated");
  }

  async function resendVerification() {
    if(!pendingVerification)return;
    const {error}=await client.auth.resend({type:"signup",email:pendingVerification.email,options:{emailRedirectTo:`${window.location.origin}/auth/confirm`}});
    if(error)throw error;
  }
  async function checkVerification() {
    const {data,error}=await client.auth.getUser();
    if(error&&error.name!=="AuthSessionMissingError")throw error;
    if(!data.user?.email_confirmed_at)return false;
    await refresh();
    return true;
  }
  function leaveVerification(nextMode:"signup"|"signin") {
    setPendingVerification(null);setMessage("");setMode(nextMode);
    window.requestAnimationFrame(()=>document.getElementById("account-email")?.focus());
  }
  function validateListing(data:FormData) {
    const end=new Date(field(data,"end")).getTime();
    if(!Number.isFinite(end)||end<Date.now()+86400000||end>Date.now()+90*86400000) throw new Error("Choose a closing time between 1 and 90 days from now. Your form has not been cleared.");
    const start=Number(data.get("start")), reserve=Number(data.get("reserve"));
    if(!Number.isFinite(start)||!Number.isFinite(reserve)||start<=0||reserve<0) throw new Error("Enter a positive starting price and a reserve of zero or more.");
  }
  async function upload(event:FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data=new FormData(event.currentTarget);
    void run(async()=>{
      const {data:{session}}=await client.auth.getSession();
      if(!session) throw new Error("Sign in first");
      // Direct authenticated upload avoids Vercel's function request-size limit.
      // The worker independently validates the JWT, account, bytes and quota.
      const response=await fetch(`${supabaseUrl}/functions/v1/ir-launch-worker`,{method:"POST",headers:{Authorization:`Bearer ${session.access_token}`},body:data});
      const result=await response.json() as {error?:string}; if(!response.ok) throw new Error(result.error||"Upload failed");
      setUploadVersion(v=>v+1);
    },"Document uploaded securely");
  }
  async function download(path:string) {
    void run(async()=>{
      const {data,error}=await client.storage.from("ir-private-documents").createSignedUrl(path,60,{download:true});
      if(error) throw new Error(error.message); window.location.assign(data.signedUrl);
    },"Download prepared (link expires in 60 seconds)");
  }
  function bid(event:FormEvent<HTMLFormElement>,auction:string) {
    event.preventDefault(); const amount=Number(new FormData(event.currentTarget).get("amount"));
    if(!window.confirm(`Submit a maximum bid of ${currency(amount)}? Your maximum is private; accepted bids cannot be withdrawn here.`)) return;
    if(!pendingBid.current || pendingBid.current.auction!==auction || pendingBid.current.amount!==amount) pendingBid.current={auction,amount,id:crypto.randomUUID()};
    const request=pendingBid.current;
    void run(async()=>{
      const result=await rpc("ir_submit_bid",{p_auction:auction,p_max:amount,p_request:request.id}) as {leading:boolean};
      pendingBid.current=null; window.alert(result.leading?"Your bid was accepted and you are leading.":"Accepted. Another bidder’s maximum remains higher.");
    },"Bid confirmed");
  }
  const activeType=profile?.active_account as AccountType|undefined;
  const activeReady=onboarding.some(o=>o.account_type===activeType&&o.completed_at);
  const tabs=[...(activeReady?(activeType==="seller"?["Selling"]:["Watchlist"]):[]),"Orders","Notifications","Settings","Security"];
  const visibleTab=tabs.includes(tab)?tab:(activeReady?(activeType==="seller"?"Selling":"Watchlist"):"Settings");
  const catalogueView=catalogue.filter(l=>watched.includes(String(l.id)));
  async function switchAccount(type:AccountType) {
    if(!onboarding.some(o=>o.account_type===type&&o.completed_at)){setOnboardingType(type);return;}
    await run(async()=>{await rpc("ir_switch_account",{p_type:type});setTab(type==="seller"?"Selling":"Watchlist");},`Switched to ${type} account`);
  }

  return <main className="portal">
    <header className="portalHeader"><Link href="/" className="brand">IRKANTI</Link><Link className="activeAccount" href="/account?tab=settings" onClick={()=>setTab("Settings")}>{user?(activeReady?`${activeType === "seller" ? "Seller" : "Buyer"} account · Switch`:"Account setup"):"Your account"}</Link>{profile?.role==="admin"&&<Link href="/admin">Administration →</Link>}{user&&<button disabled={busy} onClick={()=>void run(async()=>{const {error}=await client.auth.signOut();if(error)throw error;setDocuments([]);setNotifications([]);setOrders([]);},"Signed out")}>Sign out</button>}</header>
    {!pendingVerification&&<div className="portalNotice">{trading?"Live marketplace":"Bidding is currently paused"} · <span className={connected?"online":"offline"}>{connected?"Live updates connected":"Reconnecting live updates…"}</span></div>}
    <div className={`portalBody${pendingVerification?" verificationBody":""}`}>
      {!pendingVerification&&<><p className="eyebrow">MALTA · EXCEPTIONAL ASSETS</p><h1>{user?`Welcome, ${profile?.name||"member"}`:"Your next chapter starts here."}</h1></>}
      {message&&<p className="portalMessage" role="status">{message}</p>}
      {pendingVerification?<CheckEmail pending={pendingVerification} onResend={resendVerification} onCheck={checkVerification} onEditEmail={()=>leaveVerification("signup")} onSignIn={()=>leaveVerification("signin")}/>:!ready?<p>Loading your secure account…</p>:(!user||mode==="password")?<section className="portalPanel authPanel">
        <h2>{mode==="signup"?"Create your account":mode==="recovery"?"Recover your password":mode==="password"?"Set a new password":"Sign in"}</h2>
        {mode==="signup"&&<fieldset className="roleChoice"><legend>How would you like to start?</legend>{(["buyer","seller"] as const).map(t=><button type="button" key={t} aria-pressed={signupType===t} className={signupType===t?"goldButton":""} onClick={()=>setSignupType(t)}><strong>{t==="buyer"?"Buy & collect":"Sell your assets"}</strong><span>{t==="buyer"?"Explore auctions and build your watchlist.":"Verify your seller profile and submit your inventory."}</span></button>)}</fieldset>}
        {(mode!=="signup"||signupType)&&<form onSubmit={auth}>
          {mode==="signup"&&<label>Your name<input name="name" required maxLength={120} autoComplete="name" value={authName} onChange={e=>setAuthName(e.target.value)}/></label>}
          {mode!=="password"&&<label>Email address<input id="account-email" name="email" type="email" required autoComplete="email" value={authEmail} onChange={e=>setAuthEmail(e.target.value)}/></label>}
          {mode!=="recovery"&&<label>Password<input name="password" type="password" required minLength={12} autoComplete={mode==="signin"?"current-password":"new-password"}/><small>Use at least 12 characters and a unique password.</small></label>}
          <button className="goldButton" disabled={busy}>{busy?"Please wait…":mode==="signup"?"Register & verify email":mode==="recovery"?"Send recovery email":mode==="password"?"Save password":"Sign in"}</button>
        </form>}
        <div className="portalLinks"><button disabled={busy} onClick={()=>setMode(mode==="signup"?"signin":"signup")}>{mode==="signup"?"Already registered? Sign in":"Create an account"}</button><button disabled={busy} onClick={()=>setMode("recovery")}>Forgot password?</button></div>
        <p className="muted">Email verification is required. Seller documents are private and reviewed before listing approval. Administrator access requires a verified, authorised account.</p>
      </section>:onboardingType?<Onboarding key={onboardingType} type={onboardingType} record={onboarding.find(o=>o.account_type===onboardingType)} documents={documents.map(d=>({kind:String(d.kind),auction_id:d.auction_id}))} onDocumentsSaved={async()=>{const {data,error}=await client.from("ir_documents").select("*").eq("user_id",user.id);if(error)throw error;setDocuments((data||[]) as Row[]);}} onCancel={()=>{setOnboardingType(null);setTab("Settings");}} onComplete={async()=>{await refresh();setTab(onboardingType==="seller"?"Selling":"Watchlist");setOnboardingType(null);}}/>:<>
        <p className="accountContext">{activeReady?`${activeType} account`:"Complete your account setup"}</p>
        {activeReady&&activeType==="buyer"&&<p><Link href="/account/bids">My bids — track your auctions →</Link></p>}
        <nav className="portalTabs" aria-label="Account sections">{tabs.map(t=><button className={visibleTab===t?"active":""} key={t} onClick={()=>setTab(t)}>{t}{t==="Notifications"&&notifications.some(n=>!n.read_at)?" •":""}</button>)}</nav>
        {visibleTab==="Settings"&&<section className="portalGrid">{(["buyer","seller"] as const).map(t=><div className="portalPanel" key={t}><p className="eyebrow">{t.toUpperCase()} ACCOUNT</p><h2>{t==="buyer"?"Find your next acquisition":"Bring your assets to market"}</h2><p>{t==="buyer"?"Browse auctions and manage your watchlist.":"Manage inventory and submit listings and feature requests for review."}</p><p>{onboarding.some(o=>o.account_type===t&&o.completed_at)?"Setup complete":onboarding.some(o=>o.account_type===t)?"Setup in progress":"Separate setup required"}{user.user_metadata?.onboarding_intent===t?" · Your signup choice":""}</p><button className="goldButton" disabled={busy||activeReady&&activeType===t} onClick={()=>void switchAccount(t)}>{activeReady&&activeType===t?"Current account":onboarding.some(o=>o.account_type===t&&o.completed_at)?`Switch to ${t}`:`Set up ${t} account`}</button></div>)}</section>}
        {profile?.suspended&&<p role="alert" className="portalMessage">Your account is suspended. Bidding, listing and uploading are disabled.</p>}
        {visibleTab==="Selling"&&activeReady&&activeType==="seller"&&<section className="sellerTools" aria-label="Seller tools"><div className="sellerActions">{([["asset","Submit an asset","Create a new auction listing"],["verification","Seller verification",`Status: ${label(profile?.seller_status)}`],["documents","Documents & photos","Manage private evidence and listing images"]] as const).map(([key,title,description])=><button key={key} type="button" disabled={busy} aria-expanded={sellerForm===key} aria-controls={`seller-form-${key}`} onClick={()=>setSellerForm(sellerForm===key?null:key)}><strong>{title}</strong><span>{description}</span><span>{sellerForm===key?"Close form −":"Open form +"}</span></button>)}</div><div id="seller-form-verification" hidden={sellerForm!=="verification"} className="portalPanel"><button type="button" disabled={busy} onClick={()=>setSellerForm(null)}>Close form</button><h2>Seller verification</h2><p>Status: <b>{label(profile?.seller_status)}</b></p>{application?.review_note&&<p>Review: {application.review_note}</p>}
          <form onSubmit={e=>{e.preventDefault();const d=new FormData(e.currentTarget);void run(async()=>{await rpc("ir_submit_seller",{p_legal_name:field(d,"legal"),p_business_name:field(d,"business"),p_registration_number:field(d,"registration"),p_address:field(d,"address")});},"Application submitted. Upload your supporting documents below.");}}>
            <label>Full legal name<input name="legal" required minLength={2} maxLength={160} defaultValue={String(application?.legal_name||"")}/></label><label>Business name (if applicable)<input name="business" maxLength={160} defaultValue={String(application?.business_name||"")}/></label><label>Business registration number<input name="registration" maxLength={80} defaultValue={String(application?.registration_number||"")}/></label><label>Residential / registered address<textarea name="address" required minLength={8} maxLength={1000} defaultValue={String(application?.address||"")}/></label><button disabled={busy} className="goldButton">Submit for review</button>
          </form>
        </div><div id="seller-form-documents" hidden={sellerForm!=="documents"} className="portalPanel"><button type="button" disabled={busy} onClick={()=>setSellerForm(null)}>Close form</button><h2>Private documents & photos</h2><p>Identity and business documents belong to your account. Ownership evidence and category documents belong to a listing. Listing photos are public; never upload identity documents as listing photos.</p>
          <form onSubmit={upload}><label>Document type<select name="kind"><option value="identity">Identity document — private</option><option value="business">Business document — private</option><option value="ownership">Ownership evidence — private</option><option value="property_title">Property title / legal pack — private</option><option value="vehicle_registration">Vehicle registration — private</option><option value="boat_registration">Boat registration — private</option><option value="provenance">Authenticity / provenance — private</option><option value="condition">Condition report — private</option><option value="listing_image">Listing photograph — PUBLIC</option></select></label><label>Related listing<select name="auctionId"><option value="">Account identity / business</option>{lots.filter(l=>l.status==="under_review").map(l=><option value={String(l.id)} key={String(l.id)}>{l.title}</option>)}</select></label><UploadFile key={uploadVersion}/><small>Documents: PDF/JPEG/PNG, up to 8 MB. Public photos: JPEG/PNG/WebP, up to 4 MB. Up to 30 upload attempts/day.</small><button className="goldButton" disabled={busy}>Upload securely</button></form>
          <ul className="recordList">{documents.map(d=><li key={String(d.id)}><span>{label(d.kind)} · {Math.ceil(Number(d.size)/1024)} KB</span><button onClick={()=>void download(String(d.path))}>Download</button></li>)}</ul>
        </div><div id="seller-form-asset" hidden={sellerForm!=="asset"} className="portalPanel"><button type="button" disabled={busy} onClick={()=>setSellerForm(null)}>Close form</button><h2>Submit an asset</h2><p className="muted">Not saved yet. Form values stay only while this form is open. Submit to save your listing for review.</p><p>Submit your asset for staff review. An approved seller account and a listing photograph are required before it can go live.</p><form onSubmit={e=>{e.preventDefault();const d=new FormData(e.currentTarget);void run(async()=>{validateListing(d);await rpc("ir_create_listing",{p_title:field(d,"title"),p_description:field(d,"description"),p_category:field(d,"category"),p_location:field(d,"location"),p_start:Number(d.get("start")),p_reserve:Number(d.get("reserve")),p_end:new Date(field(d,"end")).toISOString()});},"Listing submitted. Open Documents & photos to add a listing photograph.");}}>
          <label>Title<input name="title" required minLength={5} maxLength={160}/></label><label>Category<select name="category">{categories.map(c=><option key={c}>{c}</option>)}</select></label><label>Location<input name="location" required minLength={2} maxLength={160}/></label><label>Description & condition<textarea name="description" required minLength={20} maxLength={10000}/></label><div className="formPair"><label>Starting price (€)<input name="start" type="number" min="0.01" step="0.01" required/></label><label>Reserve (€; 0 for none)<input name="reserve" type="number" min="0" step="0.01" defaultValue="0" required/></label></div><label>Proposed closing time (your local time)<input name="end" type="datetime-local" required/></label><button disabled={busy||profile?.seller_status!=="approved"} className="goldButton">Submit for approval</button>
        </form></div></section>}
        {visibleTab==="Selling"&&activeReady&&activeType==="seller"&&<section className="portalPanel"><h2>Your listings</h2><p>Manage your submissions. Changes return a listing to staff review. Auctions with bids cannot be edited.</p>{lots.length?lots.map(l=><article className="record sellerListing" key={String(l.id)}>
{l.image_path?<img className="lotImage" src={listingImageUrl(l.image_path)} alt={String(l.title)}/>:<span className="muted">No photo</span>}
<div className="listingSummary"><h3>{l.title}</h3><p>{label(l.status)} · {currency(l.current_bid)} · {Number(l.bid_count)} bids</p><small>Ends {new Date(String(l.end_at)).toLocaleString("en-MT")}</small>{l.review_note&&<p>Review: {l.review_note}</p>}</div>
{["under_review","changes_requested","rejected","live"].includes(String(l.status))&&Number(l.bid_count)===0?<details><summary>Edit listing</summary><p className="muted">Unsaved edits stay while this form is open, including after an error. Save to keep them in your account.</p>
<form onSubmit={e=>{e.preventDefault();const d=new FormData(e.currentTarget);const panel=e.currentTarget.closest("details");void run(async()=>{validateListing(d);await rpc("ir_edit_listing",{p_auction:l.id,p_title:field(d,"title"),p_description:field(d,"description"),p_category:field(d,"category"),p_location:field(d,"location"),p_start:Number(d.get("start")),p_reserve:Number(d.get("reserve")),p_end:new Date(field(d,"end")).toISOString()});if(panel)panel.open=false;},"Listing updated and sent for review");}}>
<label>Title<input name="title" required minLength={5} maxLength={160} defaultValue={String(l.title)}/></label>
<label>Category<select name="category" defaultValue={String(l.category)}>{categories.map(c=><option key={c}>{c}</option>)}</select></label>
<label>Location<input name="location" required minLength={2} maxLength={160} defaultValue={String(l.location)}/></label>
<label>Description & condition<textarea name="description" required minLength={20} maxLength={10000} defaultValue={String(l.description)}/></label>
<div className="formPair"><label>Starting price (€)<input name="start" type="number" min="0.01" step="0.01" required defaultValue={Number(l.start_price)}/></label><label>Reserve (€; 0 for none)<input name="reserve" type="number" min="0" step="0.01" required defaultValue={Number(l.reserve_price)}/></label></div>
<label>Closing time (your local time)<input name="end" type="datetime-local" required defaultValue={new Date(new Date(String(l.end_at)).getTime()-new Date(String(l.end_at)).getTimezoneOffset()*60000).toISOString().slice(0,16)}/></label>
<p className="muted">To replace the photograph, save your changes and open “Documents & photos” above.</p>
<button className="goldButton" disabled={busy||Boolean(profile?.suspended)}>Save changes & submit for review</button>
{message&&<p role="status">{message}</p>}
</form></details>:<p className="muted">Editing is locked once bids are placed or the auction is closed.</p>}
</article>):<p>No listings yet. Use “Submit an asset” above.</p>}</section>}
        {visibleTab==="Settings"&&activeReady&&activeType==="buyer"&&<section className="portalPanel"><h2>Bidder verification</h2><p>Buyer setup unlocks browsing and saved lists. Staff must verify your identity before bidding. You can revisit verification to upload evidence.</p><button onClick={()=>setOnboardingType("buyer")}>Update buyer details & verification</button></section>}
        {["Watchlist"].includes(visibleTab)&&activeReady&&activeType==="buyer"&&<section><div className="sectionHeading"><h2>{visibleTab}</h2><button onClick={()=>void run(refresh,"Saved items refreshed")}>Refresh</button></div>{!catalogueView.length?<div className="portalPanel"><h3>Nothing saved here yet.</h3><p>Browse auctions and save the assets that interest you.</p><Link href="/#auctions">Browse auctions →</Link></div>:<div className="portalGrid">{catalogueView.map(lot=><article className="portalPanel" key={String(lot.id)}>
          {lot.image_path&&<img className="lotImage" src={listingImageUrl(lot.image_path)} alt={String(lot.title)}/>}
          <p className="eyebrow">{lot.category} · {label(lot.status)}</p><h3>{lot.title}</h3><p>{lot.description}</p><p>{lot.location}</p><strong className="price">{currency(lot.current_bid)}</strong><p>{lot.bid_count} bids · {lot.has_reserve?(lot.reserve_met?"Reserve met":"Reserve not met"):"No reserve"}</p><p>Ends {new Date(String(lot.end_at)).toLocaleString("en-MT")}</p>
          {maxima.find(m=>m.auction_id===lot.id)&&<p>Your private maximum: {currency(maxima.find(m=>m.auction_id===lot.id)?.amount)}</p>}
          <button disabled={busy} onClick={()=>void run(async()=>{await rpc("ir_watch",{p_auction:lot.id,p_watch:!watched.includes(String(lot.id))});},"Watchlist updated")}>{watched.includes(String(lot.id))?"Remove from watchlist":"Watch this auction"}</button>
          {lot.status==="live"&&<form onSubmit={e=>bid(e,String(lot.id))}><label>Your maximum (€)<input name="amount" type="number" min={Number(lot.current_bid)} step="0.01" required/></label><button className="goldButton" disabled={busy||!connected||!trading||Boolean(profile?.suspended)}>Confirm maximum bid</button><small>Proxy bidding applies. Bids in the last two minutes extend the end time.</small></form>}
        </article>)}</div>}</section>}

        {tab==="Orders"&&<section className="portalPanel"><h2>Your orders</h2><p>Orders appear after an auction closes successfully. Online payment collection is not enabled.</p>{orders.map(o=><div className="record" key={String(o.id)}><h3>Order {String(o.id).slice(0,8)}</h3><p>{currency(o.amount)} · {label(o.status)} · {o.buyer_id===user.id?"You are the buyer":"You are the seller"}</p><form onSubmit={e=>{e.preventDefault();const d=new FormData(e.currentTarget);void run(async()=>{await rpc("ir_open_dispute",{p_order:o.id,p_reason:field(d,"reason")});},"Dispute submitted for staff review");}}><label>Report a problem<textarea name="reason" minLength={20} maxLength={5000} required/></label><button disabled={busy}>Open dispute</button></form></div>)}</section>}
        {tab==="Notifications"&&<section className="portalPanel"><h2>Account notifications</h2><p>In-app notifications are available here. Email delivery is pending Resend domain setup.</p>{notifications.length?notifications.map(n=><div className="record" key={String(n.id)}><strong>{label(n.kind)}</strong><p>{n.message}</p><small>{new Date(String(n.created_at)).toLocaleString("en-MT")}</small>{!n.read_at&&<button onClick={()=>void run(async()=>{await rpc("ir_mark_read",{p_id:n.id});},"Marked as read")}>Mark read</button>}</div>):<p>You’re all caught up.</p>}</section>}
        {tab==="Security"&&<section className="portalGrid"><div className="portalPanel"><h2>Account security</h2><p>{user.email} · {user.email_confirmed_at?"Email verified":"Email verification required"}</p><p>Current session: {aal==="aal2"?"Two-factor authenticated":"Password authenticated"}</p><button onClick={()=>setMode("password")}>Change password</button><h3>Authenticator app</h3><p>Two-factor authentication is optional. Keep access to your authenticator; do not share the QR code.</p>
          {!factor&&!qr&&<button disabled={busy} onClick={()=>void run(async()=>{const {data,error}=await client.auth.mfa.enroll({factorType:"totp",friendlyName:`Irkanti ${new Date().toISOString()}`});if(error)throw error;setFactor(data.id);setQr(data.totp.qr_code);},"Scan the QR code and enter a six-digit code")}>Set up two-factor authentication</button>}
          {qr&&<img className="totpQr" src={qr} alt="Scan this private authenticator QR code"/>}
          {(factor||qr)&&aal!=="aal2"&&<form onSubmit={e=>{e.preventDefault();const code=field(new FormData(e.currentTarget),"code");void run(async()=>{const {error}=await client.auth.mfa.challengeAndVerify({factorId:factor,code});if(error)throw error;setQr("");},"Two-factor verification successful");}}><label>Authenticator code<input name="code" inputMode="numeric" pattern="[0-9]{6}" autoComplete="one-time-code" required/></label><button className="goldButton" disabled={busy}>Verify code</button></form>}
        </div>{adminInvite&&profile?.role!=="admin"&&<div className="portalPanel"><h2>Administrator invitation</h2><p>Verify your email first. This invitation is checked securely against the verified account.</p><button className="goldButton" disabled={busy||!user.email_confirmed_at} onClick={()=>void run(async()=>{await rpc("ir_claim_admin");},"Administrator access activated")}>Accept administrator invitation</button></div>}</section>}

      </>}
    </div><footer className="portalFooter">IRKANTI · Malta’s high-value auction marketplace · <Link href="/">Return to homepage</Link></footer>
  </main>;
}
import { listingImageUrl } from "@/lib/listing-image";
