"use client";
/* eslint-disable @next/next/no-img-element -- Supabase storage and locally generated TOTP QR codes */
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { User } from "@supabase/supabase-js";
import Link from "next/link";
import { BrandLogo } from "../brand-logo";
import { browserClient } from "@/lib/supabase/browser";
import "./portal.css";
import { Onboarding, AccountType, OnboardingRecord } from "./onboarding";
import { CheckEmail, type PendingVerification } from "./check-email";
import BidActivity from "./bid-activity";

type Row = Record<string, string | number | boolean | null>;
const currency = (value: unknown) => new Intl.NumberFormat("en-MT",{style:"currency",currency:"EUR"}).format(Number(value));
const field = (form: FormData,key:string) => String(form.get(key)||"");
const label = (value:unknown) => String(value||"").replaceAll("_"," ");
const client = browserClient();

export default function Account() {
  const [user,setUser] = useState<User|null>(null);
  const [ready,setReady] = useState(false);
  const [mode,setMode] = useState("signin");
  const [pendingVerification,setPendingVerification] = useState<PendingVerification|null>(null);
  const [authEmail,setAuthEmail] = useState("");
  const [authName,setAuthName] = useState("");
  const [onboardingType,setOnboardingType] = useState<AccountType|null>(null);
  const [onboarding,setOnboarding] = useState<OnboardingRecord[]>([]);
  const [tab,setTab] = useState("My bids");
  const [message,setMessage] = useState("");
  const [busy,setBusy] = useState(false);
  const [connected,setConnected] = useState(false);
  const [profile,setProfile] = useState<Row|null>(null);
  const [catalogue,setCatalogue] = useState<Row[]>([]);
  const [documents,setDocuments] = useState<Row[]>([]);
  const [notifications,setNotifications] = useState<Row[]>([]);
  const [orders,setOrders] = useState<Row[]>([]);
  const [maxima,setMaxima] = useState<Row[]>([]);
  const [watched,setWatched] = useState<string[]>([]);
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
      client.from("ir_documents").select("*").eq("user_id",current.id),
      client.from("ir_notifications").select("*").eq("user_id",current.id).order("created_at",{ascending:false}).limit(100),
      client.from("ir_orders").select("*").eq("buyer_id",current.id).order("created_at",{ascending:false}),
      client.from("ir_max_bids").select("*").eq("user_id",current.id),
      client.from("ir_watchlist").select("auction_id").eq("user_id",current.id),
      client.auth.mfa.getAuthenticatorAssuranceLevel(),
      client.auth.mfa.listFactors(),
      client.rpc("ir_admin_invitation_status"),
      client.from("ir_account_onboarding").select("*").eq("user_id",current.id).eq("account_type","buyer"),
    ]);
    if (version!==loading.current) return;
    const error = results.find(r=>r.error)?.error;
    if (error) throw new Error(error.message);
    setProfile(results[0].data); setDocuments(results[1].data||[]);
    setNotifications((results[2].data||[]).filter(n=>!["listing_review","seller_review","seller_approved","seller_rejected","auction_result"].includes(String(n.kind))));
    setOrders(results[3].data||[]); setMaxima(results[4].data||[]);
    setWatched((results[5].data||[]).map(r=>r.auction_id));
    setAal(results[6].data?.currentLevel||"aal1");
    setAdminInvite(Boolean(results[8].data));
    setOnboarding((results[9].data||[]) as OnboardingRecord[]);
    if(initialOnboardingUser.current!==current.id){
      initialOnboardingUser.current=current.id;
      // Legacy seller selection and user-editable metadata never choose the public journey.
      if(!(results[9].data||[]).some(o=>o.completed_at))setOnboardingType("buyer");
    }
    setFactor(current=>results[7].data?.totp.find(f=>f.status==="verified")?.id||current||results[7].data?.all.find(f=>f.factor_type==="totp")?.id||"");
    setReady(true);
  },[]);

  useEffect(() => {
    const safeRefresh = () => { void refresh().catch(e=>{setMessage(e.message);setReady(true);}); };
    const initial = window.setTimeout(()=>{
      if(new URLSearchParams(window.location.search).get("tab")==="security") setTab("Security");
      if(new URLSearchParams(window.location.search).get("tab")==="orders") setTab("Orders");
      if(new URLSearchParams(window.location.search).get("tab")==="settings") setTab("Settings");
      if(new URLSearchParams(window.location.search).get("tab")==="bids") setTab("My bids");
      if(new URLSearchParams(window.location.search).get("tab")==="watchlist") setTab("Watchlist");
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
        const result=await client.auth.signUp({email,password,options:{data:{name:field(data,"name"),onboarding_intent:"buyer"},emailRedirectTo:redirect}});
        if(result.error)throw result.error;
        // A successful send request is not proof of inbox delivery or verification.
        // Do not retain the password while the user checks their email.
        const passwordInput=form.elements.namedItem("password");
        if(passwordInput instanceof HTMLInputElement)passwordInput.value="";
        if(!result.data.session?.user.email_confirmed_at)setPendingVerification({email,accountType:"buyer",requestedAt:Date.now()});
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
  const activeReady=onboarding.some(o=>o.account_type==="buyer"&&o.completed_at);
  const tabs=[...(activeReady?["My bids","Watchlist"]:[]),"Orders","Notifications","Settings","Security"];
  const visibleTab=tabs.includes(tab)?tab:(activeReady?"My bids":"Settings");
  const catalogueView=catalogue.filter(l=>watched.includes(String(l.id)));

  return <main className="portal">
    <header className="portalHeader"><Link href="/" className="brand" aria-label="Irkanti home"><BrandLogo eager /></Link><Link className="activeAccount" href="/account?tab=settings" onClick={()=>setTab("Settings")}>{user?(activeReady?"Your account":"Account setup"):"Your account"}</Link>{profile?.role==="admin"&&<Link href="/admin">Administration →</Link>}{user&&<button disabled={busy} onClick={()=>void run(async()=>{const {error}=await client.auth.signOut();if(error)throw error;setDocuments([]);setNotifications([]);setOrders([]);},"Signed out")}>Sign out</button>}</header>
    {!pendingVerification&&<div className="portalNotice">{trading?"Live marketplace":"Bidding is currently paused"} · <span className={connected?"online":"offline"}>{connected?"Live updates connected":"Reconnecting live updates…"}</span></div>}
    <div className={`portalBody${pendingVerification?" verificationBody":""}`}>
      {!pendingVerification&&<><p className="eyebrow">MALTA · EXCEPTIONAL ASSETS</p><h1>{user?`Welcome, ${profile?.name||"member"}`:"Your next chapter starts here."}</h1></>}
      {message&&<p className="portalMessage" role="status">{message}</p>}
      {pendingVerification?<CheckEmail pending={pendingVerification} onResend={resendVerification} onCheck={checkVerification} onEditEmail={()=>leaveVerification("signup")} onSignIn={()=>leaveVerification("signin")}/>:!ready?<p>Loading your secure account…</p>:(!user||mode==="password")?<section className="portalPanel authPanel">
        <h2>{mode==="signup"?"Create your account":mode==="recovery"?"Recover your password":mode==="password"?"Set a new password":"Sign in"}</h2>
        {mode==="signup"&&<p>Browse exceptional assets, save your watchlist and get verified to bid.</p>}
        <form onSubmit={auth}>
          {mode==="signup"&&<label>Your name<input name="name" required maxLength={120} autoComplete="name" value={authName} onChange={e=>setAuthName(e.target.value)}/></label>}
          {mode!=="password"&&<label>Email address<input id="account-email" name="email" type="email" required autoComplete="email" value={authEmail} onChange={e=>setAuthEmail(e.target.value)}/></label>}
          {mode!=="recovery"&&<label>Password<input name="password" type="password" required minLength={12} autoComplete={mode==="signin"?"current-password":"new-password"}/><small>Use at least 12 characters and a unique password.</small></label>}
          <button className="goldButton" disabled={busy}>{busy?"Please wait…":mode==="signup"?"Register & verify email":mode==="recovery"?"Send recovery email":mode==="password"?"Save password":"Sign in"}</button>
        </form>
        <div className="portalLinks"><button disabled={busy} onClick={()=>setMode(mode==="signup"?"signin":"signup")}>{mode==="signup"?"Already registered? Sign in":"Create an account"}</button><button disabled={busy} onClick={()=>setMode("recovery")}>Forgot password?</button></div>
        <p className="muted">Verify your email, complete your details and upload your ID privately. Our team reviews your identity before you can bid.</p>
      </section>:onboardingType?<Onboarding key={onboardingType} type={onboardingType} record={onboarding.find(o=>o.account_type===onboardingType)} documents={documents.map(d=>({kind:String(d.kind),auction_id:d.auction_id}))} onDocumentsSaved={async()=>{const {data,error}=await client.from("ir_documents").select("*").eq("user_id",user.id);if(error)throw error;setDocuments((data||[]) as Row[]);}} onCancel={()=>{setOnboardingType(null);setTab("Settings");}} onComplete={async()=>{await refresh();setTab("My bids");setOnboardingType(null);}}/>:<>
        <p className="accountContext">{activeReady?"Buyer account":"Complete your account setup"}</p>
        <nav className="portalTabs" aria-label="Account sections">{tabs.map(t=><button className={visibleTab===t?"active":""} aria-pressed={visibleTab===t} key={t} onClick={()=>setTab(t)}>{t}{t==="Notifications"&&notifications.some(n=>!n.read_at)?" •":""}</button>)}</nav>
        {visibleTab==="Settings"&&<section className="portalPanel"><p className="eyebrow">YOUR ACCOUNT</p><h2>Account details & verification</h2><p>Manage your details, verify your identity and follow your favourite auctions in your watchlist.</p><p>{activeReady?"Setup complete":"Complete your account setup to start bidding."}</p><button className="goldButton" disabled={busy} onClick={()=>setOnboardingType("buyer")}>{activeReady?"Update details & verification":"Complete account setup"}</button><div className="portalLinks"><Link href="/#auctions">Browse auctions →</Link><Link href="/account?tab=bids" onClick={()=>setTab("My bids")}>My bids →</Link></div></section>}
        {profile?.suspended&&<p role="alert" className="portalMessage">Your account is suspended. Bidding and uploading are disabled.</p>}
        {visibleTab==="My bids"&&activeReady&&<BidActivity key={user.id} onAccountTabChange={setTab}/>}
        {["Watchlist"].includes(visibleTab)&&activeReady&&<section><div className="sectionHeading"><h2>{visibleTab}</h2><button onClick={()=>void run(refresh,"Saved items refreshed")}>Refresh</button></div>{!catalogueView.length?<div className="portalPanel"><h3>Nothing saved here yet.</h3><p>Browse auctions and save the assets that interest you.</p><Link href="/#auctions">Browse auctions →</Link></div>:<div className="portalGrid">{catalogueView.map(lot=><article className="portalPanel" key={String(lot.id)}>
          {lot.image_path&&<img className="lotImage" src={listingImageUrl(lot.image_path)} alt={String(lot.title)}/>}
          <p className="eyebrow">{lot.category} · {label(lot.status)}</p><h3>{lot.title}</h3><p>{lot.description}</p><p>{lot.location}</p><strong className="price">{currency(lot.current_bid)}</strong><p>{lot.bid_count} bids · {lot.has_reserve?(lot.reserve_met?"Reserve met":"Reserve not met"):"No reserve"}</p><p>Ends {new Date(String(lot.end_at)).toLocaleString("en-MT")}</p>
          {maxima.find(m=>m.auction_id===lot.id)&&<p>Your private maximum: {currency(maxima.find(m=>m.auction_id===lot.id)?.amount)}</p>}
          <button disabled={busy} onClick={()=>void run(async()=>{await rpc("ir_watch",{p_auction:lot.id,p_watch:!watched.includes(String(lot.id))});},"Watchlist updated")}>{watched.includes(String(lot.id))?"Remove from watchlist":"Watch this auction"}</button>
          {lot.status==="live"&&<form onSubmit={e=>bid(e,String(lot.id))}><label>Your maximum (€)<input name="amount" type="number" min={Number(lot.current_bid)} step="0.01" required/></label><button className="goldButton" disabled={busy||!connected||!trading||Boolean(profile?.suspended)}>Confirm maximum bid</button><small>Proxy bidding applies. Bids in the last two minutes extend the end time.</small></form>}
        </article>)}</div>}</section>}

        {tab==="Orders"&&<section className="portalPanel"><h2>Your orders</h2><p>Orders appear after an auction closes successfully. Online payment collection is not enabled.</p>{orders.map(o=><div className="record" key={String(o.id)}><h3>Order {String(o.id).slice(0,8)}</h3><p>{currency(o.amount)} · {label(o.status)} · You are the buyer</p><form onSubmit={e=>{e.preventDefault();const d=new FormData(e.currentTarget);void run(async()=>{await rpc("ir_open_dispute",{p_order:o.id,p_reason:field(d,"reason")});},"Dispute submitted for staff review");}}><label>Report a problem<textarea name="reason" minLength={20} maxLength={5000} required/></label><button disabled={busy}>Open dispute</button></form></div>)}</section>}
        {tab==="Notifications"&&<section className="portalPanel"><h2>Account notifications</h2><p>In-app notifications are available here. Email delivery is pending Resend domain setup.</p>{notifications.length?notifications.map(n=><div className="record" key={String(n.id)}><strong>{label(n.kind)}</strong><p>{n.message}</p><small>{new Date(String(n.created_at)).toLocaleString("en-MT")}</small>{!n.read_at&&<button onClick={()=>void run(async()=>{await rpc("ir_mark_read",{p_id:n.id});},"Marked as read")}>Mark read</button>}</div>):<p>You’re all caught up.</p>}</section>}
        {tab==="Security"&&<section className="portalGrid"><div className="portalPanel"><h2>Account security</h2><p>{user.email} · {user.email_confirmed_at?"Email verified":"Email verification required"}</p><p>Current session: {aal==="aal2"?"Two-factor authenticated":"Password authenticated"}</p><button onClick={()=>setMode("password")}>Change password</button><h3>Authenticator app</h3><p>Two-factor authentication is optional. Keep access to your authenticator; do not share the QR code.</p>
          {!factor&&!qr&&<button disabled={busy} onClick={()=>void run(async()=>{const {data,error}=await client.auth.mfa.enroll({factorType:"totp",friendlyName:`Irkanti ${new Date().toISOString()}`});if(error)throw error;setFactor(data.id);setQr(data.totp.qr_code);},"Scan the QR code and enter a six-digit code")}>Set up two-factor authentication</button>}
          {qr&&<img className="totpQr" src={qr} alt="Scan this private authenticator QR code"/>}
          {(factor||qr)&&aal!=="aal2"&&<form onSubmit={e=>{e.preventDefault();const code=field(new FormData(e.currentTarget),"code");void run(async()=>{const {error}=await client.auth.mfa.challengeAndVerify({factorId:factor,code});if(error)throw error;setQr("");},"Two-factor verification successful");}}><label>Authenticator code<input name="code" inputMode="numeric" pattern="[0-9]{6}" autoComplete="one-time-code" required/></label><button className="goldButton" disabled={busy}>Verify code</button></form>}
        </div>{adminInvite&&profile?.role!=="admin"&&<div className="portalPanel"><h2>Administrator invitation</h2><p>Verify your email first. This invitation is checked securely against the verified account.</p><button className="goldButton" disabled={busy||!user.email_confirmed_at} onClick={()=>void run(async()=>{await rpc("ir_claim_admin");},"Administrator access activated")}>Accept administrator invitation</button></div>}</section>}

      </>}
    </div><footer className="portalFooter"><Link className="brand" href="/" aria-label="Irkanti home"><BrandLogo /></Link><p>Malta’s high-value auction marketplace · <Link href="/">Return to homepage</Link></p></footer>
  </main>;
}
import { listingImageUrl } from "@/lib/listing-image";
