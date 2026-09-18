"use client";


import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { browserClient } from "../lib/supabase/browser";

type Auction = {
  id: string; sellerId: string; sellerName: string; title: string; category: string;
  location: string; description: string; image: string; startPrice: number;
  reservePrice?: number; hasReserve?: boolean; reserveMet?: boolean; currentBid: number; highestBidderId: string | null;
  bidCount: number; endAt: string; status: string; featured: boolean;
  views: number; watchCount: number;
};

type Profile = { id: string; name: string; initials: string; email: string; role: "buyer" | "seller" | "admin"; verified: boolean };
type BidEvent = { auction_id: string; visible_amount: number; created_at: string; initials: string };
type MarketplaceData = { user: Profile | null; auctions: Auction[]; watched: string[]; myLots: Auction[]; recentBids: BidEvent[]; categories: string[]; isPreview?:boolean };

const emptyData: MarketplaceData = { isPreview:false, user:null, auctions:[], watched:[], myLots:[], recentBids:[], categories:["Property","Motor Cars","Boats","Watches & Jewellery","Art & Antiques","Collectables"] };
const euro = new Intl.NumberFormat("en-MT", { style:"currency", currency:"EUR", maximumFractionDigits:0 });
const bidStep = (value:number) => value >= 100000 ? 5000 : value >= 10000 ? 500 : value >= 1000 ? 100 : value >= 100 ? 25 : 5;

function Countdown({ endAt }: { endAt:string }) {
  const [label, setLabel] = useState("—");
  useEffect(() => {
    const update = () => {
      const left = Math.max(0, new Date(endAt).getTime() - Date.now());
      const d = Math.floor(left / 86400000);
      const h = Math.floor((left % 86400000) / 3600000);
      const m = Math.floor((left % 3600000) / 60000);
      const s = Math.floor((left % 60000) / 1000);
      setLabel(d > 0 ? `${d}d ${String(h).padStart(2,"0")}h ${String(m).padStart(2,"0")}m` : `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`);
    };
    update(); const timer = window.setInterval(update, 1000); return () => window.clearInterval(timer);
  }, [endAt]);
  return <span>{label}</span>;
}

function Mark() { return <span className="mark" aria-hidden="true">I</span>; }

export default function Home() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [data, setData] = useState<MarketplaceData>(emptyData);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [category, setCategory] = useState("All assets");
  const [query, setQuery] = useState("");
  const [authOpen, setAuthOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState(false);
  const [maxBid, setMaxBid] = useState("");
  const [bidMessage, setBidMessage] = useState("");
  const pendingBid = useRef<{ auction:string; amount:number; id:string } | null>(null);
  const [serviceError, setServiceError] = useState("");
  const [information, setInformation] = useState<"terms" | "privacy" | "cookies" | null>(null);
  const requestVersion = useRef(0);
  const mutationPending = useRef(false);

  useEffect(() => {
    // Presentation only: all private actions remain authorized by the account API.
    // INITIAL_SESSION restores the same cookie-backed session used by /account.
    const { data: { subscription } } = browserClient().auth.onAuthStateChange((_event, session) => {
      setSignedIn(Boolean(session?.user));
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    window.localStorage.removeItem("ikranti-demo-profile");
    const requestedLot = new URLSearchParams(window.location.search).get("lot");
    const version = ++requestVersion.current;
    let active = true;
    fetch("/api/marketplace", { cache:"no-store" })
      .then((response) => response.ok ? response.json() as Promise<MarketplaceData> : Promise.reject(new Error("Marketplace unavailable")))
      .then((next) => { if (active && version === requestVersion.current) { setData(next); setServiceError(""); if (requestedLot) setSelectedId(requestedLot); } })
      .catch(() => { if (active) setServiceError("The auction service is unavailable. Please refresh to try again."); });
    return () => { active = false; };
  }, []);

  const selected = data.auctions.find((lot) => lot.id === selectedId) || null;
  const reserveIsMet = selected ? (selected.reserveMet ?? (selected.reservePrice ?? 0) <= selected.currentBid) : false;
  const reserveExists = selected ? (selected.hasReserve ?? (selected.reservePrice ?? 0) > 0) : false;
  const filtered = useMemo(() => data.auctions.filter((lot) => {
    const categoryMatch = category === "All assets" || lot.category === category;
    const queryMatch = !query || `${lot.title} ${lot.location} ${lot.category}`.toLowerCase().includes(query.toLowerCase());
    return categoryMatch && queryMatch;
  }), [data.auctions, category, query]);

  const notify = (message:string) => { setToast(message); window.setTimeout(() => setToast(""), 3800); };

  const toggleWatch = async (auctionId:string) => {
    if (!signedIn) { setAuthOpen(true); return; }
    const watched = data.watched.includes(auctionId);
    const {error}=await browserClient().rpc("ir_watch",{p_auction:auctionId,p_watch:!watched});
    if(error){notify(error.message);return;}
    setData(current=>({...current,watched:watched?current.watched.filter(id=>id!==auctionId):[...current.watched,auctionId]}));
    notify(watched?"Removed from watchlist.":"Added to watchlist.");
  };

  const submitBid = async (event:FormEvent) => {
    event.preventDefault(); if (!selected) return;

    if (!signedIn) { setAuthOpen(true); return; }
    if (mutationPending.current) return;
    const amount = Number(maxBid);
    if (!Number.isFinite(amount) || amount <= 0) { setBidMessage("Enter a valid maximum bid."); return; }
    if (!pendingBid.current || pendingBid.current.auction !== selected.id || pendingBid.current.amount !== amount) {
      pendingBid.current = { auction:selected.id, amount, id:crypto.randomUUID() };
    }
    mutationPending.current = true;
    setBusy(true); setBidMessage("");
    try {
      const { data:result, error } = await browserClient().rpc("ir_submit_bid", {
        p_auction:selected.id, p_max:amount, p_request:pendingBid.current.id,
      });
      if (error) throw new Error(error.message);
      if (result?.error) throw new Error(String(result.error));
      if (typeof result?.leading !== "boolean") throw new Error("Bid result could not be confirmed. Retry the same amount to check safely.");
      pendingBid.current = null;
      setBidMessage(result.leading ? "Bid accepted. You’re leading." : "Bid accepted. Another bidder’s maximum remains higher.");
      // A failed catalogue refresh must not turn an accepted bid into a reported failure.
      try {
        const response = await fetch("/api/marketplace", {cache:"no-store"});
        if (response.ok) setData(await response.json() as MarketplaceData);
      } catch { /* Keep the confirmed result; the catalogue can refresh later. */ }
    } catch (error) {
      setBidMessage(error instanceof Error ? error.message : "Bid result could not be confirmed. Retry the same amount to check safely.");
    } finally { mutationPending.current = false; setBusy(false); }
  };

  const openLot = (id:string) => {
    setBidMessage("");
    const lot = data.auctions.find((item) => item.id === id);
    setSelectedId(id); if (lot) setMaxBid(String(lot.currentBid + bidStep(lot.currentBid)));
  };

  const openSell = () => { window.location.assign("/account"); };

  return (
    <main id="top">
      <header className="nav shell">
        <a className="brand" href="#top" aria-label="Irkanti home"><Mark/><span>IRKANTI</span></a>
        <nav className="navlinks" aria-label="Main navigation"><a href="#auctions">Live auctions</a><a href="#categories">Categories</a><button onClick={openSell}>Sell</button><a href="#how">How it works</a></nav>
        <div className="navActions">
          <button className="searchIcon" onClick={() => document.getElementById("auction-search")?.focus()} aria-label="Search">⌕</button>
          <a className="textButton" href="/account" aria-busy={signedIn === null}>{signedIn === null ? "Account…" : signedIn ? "My account" : "Sign in"}</a>
          <button className="goldButton" onClick={openSell}>Sell an asset</button>
        </div>
      </header>

      <section className="hero">
        <div className="heroRings" aria-hidden="true"><i/><i/><i/></div>
        <div className="shell heroInner">
          <p className="eyebrow"><span/> MALTA’S PREMIER AUCTION MARKETPLACE</p>
          <h1>Remarkable assets.<br/><em>Exceptional outcomes.</em></h1>
          <p className="heroCopy">A new home for Malta’s distinctive property, vehicles, boats, watches, art and antiques. Browse approved listings or submit your own asset.</p>
          <div className="heroActions"><a className="goldButton large" href="#auctions">Explore live auctions</a><button className="ghostButton large" onClick={openSell}>Sell with Irkanti <b>↗</b></button></div>
          <div className="proof"><span>Malta-focused</span><span>Automatic bidding</span><span>Seller-submitted assets</span></div>
        </div>
        <div className="heroLot"><small>SELL WITH IRKANTI</small><strong>Your asset. Its next chapter.</strong><button onClick={openSell} aria-label="Submit an asset">↗</button></div>
      </section>

      <section className="auctionSection shell" id="auctions">
        <div className="sectionHead"><div><p className="eyebrow dark"><span/> CURATED FOR DISCERNING BUYERS</p><h2>Live now</h2></div><p>{filtered.length} exceptional assets open for bidding</p></div>
        {serviceError && <p role="alert">{serviceError}</p>}
        <div className="marketToolbar">
          <div className="categoryTabs" role="tablist" aria-label="Auction categories">
            {["All assets", ...data.categories].map((item) => <button key={item} className={category === item ? "active" : ""} onClick={() => setCategory(item)}>{item}</button>)}
          </div>
          <label className="searchBox"><span>⌕</span><input id="auction-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search auctions" aria-label="Search auctions"/></label>
        </div>
        {!filtered.length && <div className="previewNotice"><p>{serviceError ? "Listings could not be loaded." : "No approved auctions are available yet."}</p><button className="goldButton" onClick={openSell}>Submit your first asset</button></div>}
        <div className="lotGrid">
          {filtered.map((lot) => <article className="lot" key={lot.id}>
            <button className="lotImage" style={{backgroundImage:`url(${lot.image})`}} onClick={() => openLot(lot.id)} aria-label={`View ${lot.title}`}>
              <span className="live">● LIVE</span><span className="timer"><Countdown endAt={lot.endAt}/></span>
              <span className="lotArrow">↗</span>
            </button>
            <div className="lotBody">
              <div className="lotTop"><p className="lotCategory">{lot.category.toUpperCase()}</p><button className={`watch ${data.watched.includes(lot.id) ? "saved" : ""}`} onClick={() => toggleWatch(lot.id)} aria-label="Toggle watchlist">{data.watched.includes(lot.id) ? "◆" : "◇"}</button></div>
              <button className="titleButton" onClick={() => openLot(lot.id)}><h3>{lot.title}</h3></button><p className="location">⌖ {lot.location}</p>
              <div className="bidLine"><div><small>CURRENT BID</small><strong>{euro.format(lot.currentBid)}</strong></div><div className="bidCount">{lot.bidCount} bids</div></div>
            </div>
          </article>)}
        </div>
        {filtered.length === 0 && <div className="emptyState"><Mark/><h3>No matching lots</h3><p>Try another category or a broader search.</p></div>}
      </section>

      <section className="categorySection" id="categories">
        <div className="shell">
          <p className="eyebrow"><span/> EXPLORE THE COLLECTION</p><h2>One marketplace.<br/><em>Six worlds of value.</em></h2>
          <div className="categoryGrid">
            {[
              ["01","Property","Residences, land & commercial","https://images.unsplash.com/photo-1600607688969-a5bfcd646154?auto=format&fit=crop&w=900&q=85"],
              ["02","Motor Cars","Classic, luxury & performance","https://images.unsplash.com/photo-1494905998402-395d579af36f?auto=format&fit=crop&w=900&q=85"],
              ["03","Boats","Motor yachts, sailing & classics","https://images.unsplash.com/photo-1540946485063-a40da27545f8?auto=format&fit=crop&w=900&q=85"],
              ["04","Watches & Jewellery","Rare references & fine jewels","https://images.unsplash.com/photo-1670177257750-9b47927f68eb?auto=format&fit=crop&w=900&q=85"],
              ["05","Art & Antiques","Maltese and international masters","https://images.unsplash.com/photo-1577083552431-6e5fd01aa342?auto=format&fit=crop&w=900&q=85"],
              ["06","Collectables","Objects with a story","https://images.unsplash.com/photo-1524661135-423995f22d0b?auto=format&fit=crop&w=900&q=85"],
            ].map(([number,title,copy,image]) => <button key={title} className="categoryCard" style={{backgroundImage:`linear-gradient(0deg,#08090ae8,#08090a1c),url(${image})`}} onClick={() => {setCategory(title); document.getElementById("auctions")?.scrollIntoView()}}><span>{number}</span><div><h3>{title}</h3><p>{copy}</p></div><b>↗</b></button>)}
          </div>
        </div>
      </section>

      <section className="trustSection shell" id="how">
        <div className="trustIntro"><p className="eyebrow dark"><span/> THE MARKETPLACE VISION</p><h2>Serious assets deserve<br/><em>a better way to sell.</em></h2><p>Try the submission and bidding journey below. Identity verification, specialist review, payments and handover services must be established before real trading opens.</p></div>
        <div className="steps">
          <article><span>01</span><i>⌁</i><h3>Submit your asset</h3><p>Submit your asset with photographs, a starting bid, a confidential reserve and ownership evidence.</p></article>
          <article><span>02</span><i>◈</i><h3>Prepare the auction</h3><p>Submissions enter a review queue. They do not automatically become public auctions.</p></article>
          <article><span>03</span><i>↗</i><h3>The market decides</h3><p>Place a private maximum bid. Bids in the final two minutes extend the auction.</p></article>
          <article><span>04</span><i>✓</i><h3>After the auction</h3><p>Online payments are not available yet. Winning auctions appear in your account for follow-up.</p></article>
        </div>
      </section>

      <section className="numbers"><div className="shell"><div><strong>{data.auctions.length}</strong><span>SAMPLE AUCTIONS</span></div><div><strong>3</strong><span>PREVIEW ACCOUNTS</span></div><div><strong>2 min</strong><span>ANTI-SNIPE PROTECTION</span></div><div><strong>6</strong><span>ASSET CATEGORIES</span></div></div></section>

      <section className="sellBanner" id="sell"><div className="shell"><div><p className="eyebrow"><span/> YOUR ASSET. THE RIGHT AUDIENCE.</p><h2>Ready to discover<br/><em>what it’s truly worth?</em></h2></div><div><p>Create your own account and apply to sell. Identity, ownership and category-specific documents are reviewed privately before a listing is approved.</p><button className="goldButton large" onClick={openSell}>Start your submission</button></div></div></section>

      <footer><div className="shell footerTop"><div className="footerBrand"><a className="brand" href="#top"><Mark/><span>IRKANTI</span></a><p>Malta’s trusted marketplace for exceptional assets.</p><small>Seller-submitted listings for the Maltese market.</small></div><div><h4>Marketplace</h4><a href="#auctions">Live auctions</a><a href="#categories">Categories</a><button onClick={openSell}>Sell an asset</button><a href="#how">How it works</a></div><div><h4>Trust</h4><a href="#how">Buyer protection</a><a href="#how">Verification</a><a href="#how">Bidding rules</a><a href="#how">Fees</a></div><div><h4>Irkanti</h4><span>Built for the Maltese market</span><span>Support details coming at launch</span></div></div><div className="shell footerBottom"><span>© 2026 Irkanti · Auction marketplace</span><div><button onClick={() => setInformation("terms")}>Terms</button><button onClick={() => setInformation("privacy")}>Privacy</button><button onClick={() => setInformation("cookies")}>Cookies</button></div><span>EN · EUR</span></div></footer>

      {selected && <div className="overlay" role="dialog" aria-modal="true" aria-label={selected.title}>
        <div className="lotPanel">
          <button className="close" onClick={() => setSelectedId(null)} aria-label="Close">×</button>
          <div className="panelImage" style={{backgroundImage:`url(${selected.image})`}}><span className="live">● LIVE AUCTION</span><div className="photoCount">▧ Seller photograph</div></div>
          <div className="panelContent">
            <p className="lotCategory">{selected.category.toUpperCase()}</p><h2>{selected.title}</h2><p className="location">⌖ {selected.location} · Offered by <b>{selected.sellerName}</b> ✓</p>
            <div className="panelStats"><div><small>CURRENT BID</small><strong>{euro.format(selected.currentBid)}</strong></div><div><small>TIME REMAINING</small><b><Countdown endAt={selected.endAt}/></b></div><div><small>BID ACTIVITY</small><b>{selected.bidCount} bids</b></div></div>
            <div className={`reserve ${!reserveIsMet ? "pending" : ""}`}><span>{!reserveIsMet ? "◇" : "✓"}</span><div><b>{!reserveExists ? "Offered without reserve" : reserveIsMet ? "Reserve met" : "Reserve not yet met"}</b><small>{!reserveExists || reserveIsMet ? "Winning bids remain subject to the applicable sale terms." : "The seller’s confidential minimum has not yet been reached."}</small></div></div>
            <form className="bidForm" onSubmit={submitBid}><label>Your maximum bid<input type="number" min={selected.currentBid + bidStep(selected.currentBid)} step={bidStep(selected.currentBid)} value={maxBid} onChange={(e) => setMaxBid(e.target.value)} required disabled={busy}/></label><button className="goldButton large" disabled={busy || signedIn === null}>{busy ? "Placing bid…" : signedIn === null ? "Checking account…" : signedIn ? "Place bid" : "Sign in to bid"}</button></form>
            {bidMessage && <p role="status" aria-live="polite">{bidMessage}</p>}
            <p className="proxyNote">We bid only as much as needed on your behalf. The next minimum is {euro.format(selected.currentBid + bidStep(selected.currentBid))}. Accepted bids are recorded against your account.</p>
            <div className="panelActions"><button onClick={() => toggleWatch(selected.id)}>{data.watched.includes(selected.id) ? "◆ Watching" : "◇ Add to watchlist"}</button><button onClick={async () => { try { await navigator.clipboard.writeText(`${window.location.origin}/?lot=${encodeURIComponent(selected.id)}#auctions`); notify("Link copied."); } catch { notify("Copy the page address to share this auction."); } }}>↗ Share lot</button><button onClick={() => notify("Viewing requests are not available online yet.")}>⌁ Arrange viewing</button></div>
            <div className="description"><h3>About this lot</h3><p>{selected.description}</p><div className="documentChips"><span>Seller-submitted asset</span></div></div>
            <div className="bidHistory"><h3>Recent activity</h3>{data.recentBids.filter((event) => event.auction_id === selected.id).slice(0,4).map((event,i) => <div key={`${event.created_at}-${i}`}><span><i>{event.initials}</i> Preview bidder</span><b>{euro.format(event.visible_amount)}</b></div>)}{!data.recentBids.some((event) => event.auction_id === selected.id) && <p>Bid history is available to signed-in participants.</p>}</div>
          </div>
        </div>
      </div>}

      {authOpen && <div className="overlay centered" role="dialog" aria-modal="true" aria-label="Sign in"><div className="authModal"><button className="close" onClick={() => setAuthOpen(false)} aria-label="Close">×</button><Mark/><h2>Your Irkanti account</h2><p>Register or sign in securely with your own email address. Complete buyer onboarding and identity verification before bidding.</p><a className="goldButton" href="/account">Register or sign in →</a></div></div>}


      {information && <div className="overlay centered" role="dialog" aria-modal="true" aria-label="Preview information"><div className="authModal"><button className="close" onClick={() => setInformation(null)} aria-label="Close">×</button><p className="eyebrow dark"><span/> MARKETPLACE INFORMATION</p><h2>{information === "terms" ? "Marketplace information" : information === "privacy" ? "Your personal data" : "Local preferences"}</h2><p>{information === "terms" ? "Listings are submitted by sellers and reviewed before publication. Bids are recorded against verified buyer accounts. Online payment collection is not yet available. Final marketplace terms and fees have not yet been published." : information === "privacy" ? "Individual account data and private seller documents are stored in Supabase. Documents are accessible to their owner and authorised administrators, not other members. Listing photographs are public. The operator must publish its final privacy notice, retention policy and support contact before onboarding the public. Upload only documents relevant to verification or your listing." : "Secure account access uses essential session cookies. Shared preview profiles have been retired. No advertising cookies are required."}</p><button className="goldButton" onClick={() => setInformation(null)}>Understood</button></div></div>}
      {toast && <div className="toast" role="status"><span>◇</span>{toast}</div>}
    </main>
  );
}
