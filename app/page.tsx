"use client";

/* eslint-disable @next/next/no-img-element -- auction media is uploaded or catalogued at runtime */

import { FormEvent, useEffect, useMemo, useState } from "react";

type Auction = {
  id: string; sellerId: string; sellerName: string; title: string; category: string;
  location: string; description: string; image: string; startPrice: number;
  reservePrice: number; currentBid: number; highestBidderId: string | null;
  bidCount: number; endAt: string; status: string; featured: boolean;
  views: number; watchCount: number;
};

type Profile = { id: string; name: string; initials: string; email: string; role: "buyer" | "seller" | "admin"; verified: boolean };
type BidEvent = { auction_id: string; visible_amount: number; created_at: string; initials: string };
type MarketplaceData = { user: Profile | null; auctions: Auction[]; watched: string[]; myLots: Auction[]; recentBids: BidEvent[]; categories: string[] };

const demoProfiles = [
  { id: "buyer_01", name: "Lara Vella", initials: "LV", role: "buyer", detail: "Buyer · 6 watched lots" },
  { id: "seller_01", name: "Marc Camilleri", initials: "MC", role: "seller", detail: "Seller · 4 active assets" },
  { id: "collector_01", name: "Elena Borg", initials: "EB", role: "buyer", detail: "Collector · verified bidder" },
] as const;

const fallbackLots: Auction[] = [
  { id:"jaguar-e-type",sellerId:"seller_auto",sellerName:"Mdina Motor House",title:"1967 Jaguar E-Type Series 1",category:"Motor Cars",location:"Naxxar, Malta",description:"A beautifully preserved Series 1 roadster in British Racing Green. Matching numbers, Maltese registered and accompanied by an extensive history file. Independent inspection available by appointment.",image:"https://images.unsplash.com/photo-1553440569-bcc63803a83d?auto=format&fit=crop&w=1600&q=90",startPrice:72000,reservePrice:82000,currentBid:84500,highestBidderId:"collector_01",bidCount:23,endAt:new Date(Date.now()+112000000).toISOString(),status:"live",featured:true,views:1240,watchCount:48 },
  { id:"rolex-daytona",sellerId:"seller_01",sellerName:"Marc Camilleri",title:"Rolex Cosmograph Daytona",category:"Watches & Jewellery",location:"Valletta, Malta",description:"Oystersteel chronograph with black dial, full set and 2022 dated card. Examined by our independent watch specialist and offered with a 12-month authenticity guarantee.",image:"https://images.unsplash.com/photo-1670177257750-9b47927f68eb?auto=format&fit=crop&w=1600&q=90",startPrice:17000,reservePrice:20500,currentBid:21750,highestBidderId:"buyer_01",bidCount:18,endAt:new Date(Date.now()+297000000).toISOString(),status:"live",featured:true,views:962,watchCount:62 },
  { id:"senglea-palazzo",sellerId:"seller_estate",sellerName:"Harbour Estates",title:"Palazzo with Grand Harbour Views",category:"Property",location:"Senglea, Malta",description:"An architecturally significant harbour-side residence arranged across four levels, with an unrestored piano nobile and private roof terrace. Legal pack and viewing calendar available to registered bidders.",image:"https://images.unsplash.com/photo-1600607687920-4e2a09cf159d?auto=format&fit=crop&w=1600&q=90",startPrice:980000,reservePrice:1180000,currentBid:1240000,highestBidderId:"collector_01",bidCount:31,endAt:new Date(Date.now()+440000000).toISOString(),status:"live",featured:true,views:1844,watchCount:91 },
  { id:"riva-aquarama",sellerId:"seller_01",sellerName:"Marc Camilleri",title:"1971 Riva Aquarama Special",category:"Boats",location:"Grand Harbour Marina",description:"Twin-engine mahogany runabout following a three-year restoration. EU VAT paid, Malta flag eligible and supplied with current survey, engine records and fitted cover.",image:"https://images.unsplash.com/photo-1540946485063-a40da27545f8?auto=format&fit=crop&w=1600&q=90",startPrice:280000,reservePrice:330000,currentBid:342000,highestBidderId:"buyer_01",bidCount:14,endAt:new Date(Date.now()+194000000).toISOString(),status:"live",featured:true,views:770,watchCount:35 },
  { id:"caruana-painting",sellerId:"seller_01",sellerName:"Marc Camilleri",title:"Edward Caruana Dingli, Harbour Morning",category:"Art & Antiques",location:"Attard, Malta",description:"Signed oil on canvas depicting the Grand Harbour at first light. Private Maltese collection; accompanied by provenance documentation and a condition assessment.",image:"https://images.unsplash.com/photo-1577083552431-6e5fd01aa342?auto=format&fit=crop&w=1600&q=90",startPrice:12000,reservePrice:18500,currentBid:19400,highestBidderId:"collector_01",bidCount:16,endAt:new Date(Date.now()+375000000).toISOString(),status:"live",featured:false,views:644,watchCount:27 },
  { id:"malta-map",sellerId:"seller_01",sellerName:"Marc Camilleri",title:"De Wit Map of Malta, circa 1680",category:"Collectables",location:"Rabat, Malta",description:"A finely engraved and hand-coloured map of Malta and Gozo by Frederick de Wit, retaining wide margins and presented in a conservation-grade frame.",image:"https://images.unsplash.com/photo-1524661135-423995f22d0b?auto=format&fit=crop&w=1600&q=90",startPrice:1600,reservePrice:0,currentBid:2450,highestBidderId:"buyer_01",bidCount:9,endAt:new Date(Date.now()+528000000).toISOString(),status:"live",featured:false,views:383,watchCount:18 },
  { id:"mercedes-280sl",sellerId:"seller_auto",sellerName:"Mdina Motor House",title:"1969 Mercedes-Benz 280 SL Pagoda",category:"Motor Cars",location:"Mosta, Malta",description:"European specification example in Horizon Blue with navy interior. Recently serviced, accompanied by hardtop and documented restoration photographs.",image:"https://images.unsplash.com/photo-1563720223185-11003d516935?auto=format&fit=crop&w=1600&q=90",startPrice:68000,reservePrice:82000,currentBid:78500,highestBidderId:"collector_01",bidCount:12,endAt:new Date(Date.now()+610000000).toISOString(),status:"live",featured:false,views:511,watchCount:29 },
  { id:"malta-cabinet",sellerId:"seller_01",sellerName:"Marc Camilleri",title:"18th-Century Maltese Olivewood Cabinet",category:"Art & Antiques",location:"Balzan, Malta",description:"A compact olivewood and ebonised cabinet on original stand, with fitted interior and bone escutcheons. Private family provenance since the 1940s.",image:"https://images.unsplash.com/photo-1586023492125-27b2c045efd7?auto=format&fit=crop&w=1600&q=90",startPrice:8500,reservePrice:12500,currentBid:13100,highestBidderId:"buyer_01",bidCount:11,endAt:new Date(Date.now()+417000000).toISOString(),status:"live",featured:false,views:456,watchCount:22 },
];

const emptyData: MarketplaceData = { user:null, auctions:fallbackLots, watched:[], myLots:[], recentBids:[], categories:["Property","Motor Cars","Boats","Watches & Jewellery","Art & Antiques","Collectables"] };
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
  const [data, setData] = useState<MarketplaceData>(emptyData);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [category, setCategory] = useState("All assets");
  const [query, setQuery] = useState("");
  const [authOpen, setAuthOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [sellOpen, setSellOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState(false);
  const [maxBid, setMaxBid] = useState("");

  const load = async (userId = "buyer_01", activate = false) => {
    try {
      const response = await fetch(`/api/marketplace?user=${encodeURIComponent(userId)}`, { cache:"no-store" });
      if (!response.ok) throw new Error("Marketplace unavailable");
      const next = await response.json() as MarketplaceData;
      setData(next);
      if (activate) setProfile(next.user);
    } catch { setData((current) => ({ ...current, auctions:fallbackLots })); }
  };

  useEffect(() => {
    const saved = window.localStorage.getItem("ikranti-demo-profile");
    let active = true;
    fetch(`/api/marketplace?user=${encodeURIComponent(saved || "buyer_01")}`, { cache:"no-store" })
      .then((response) => response.ok ? response.json() as Promise<MarketplaceData> : Promise.reject(new Error("Marketplace unavailable")))
      .then((next) => { if (active) { setData(next); if (saved) setProfile(next.user); } })
      .catch(() => { if (active) setData((current) => ({ ...current, auctions:fallbackLots })); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      fetch(`/api/marketplace?user=${encodeURIComponent(profile?.id || "buyer_01")}`, { cache:"no-store" })
        .then((response) => response.ok ? response.json() as Promise<MarketplaceData> : Promise.reject(new Error("Refresh failed")))
        .then((next) => setData(next))
        .catch(() => undefined);
    }, 10000);
    return () => window.clearInterval(timer);
  }, [profile?.id]);

  const selected = data.auctions.find((lot) => lot.id === selectedId) || null;
  const selectedFee = selected ? (selected.category === "Property" ? 2950 : selected.category === "Motor Cars" || selected.category === "Boats" ? Math.min(1500, selected.currentBid * 0.06) : selected.currentBid * 0.075) : 0;
  const filtered = useMemo(() => data.auctions.filter((lot) => {
    const categoryMatch = category === "All assets" || lot.category === category;
    const queryMatch = !query || `${lot.title} ${lot.location} ${lot.category}`.toLowerCase().includes(query.toLowerCase());
    return categoryMatch && queryMatch;
  }), [data.auctions, category, query]);

  const notify = (message:string) => { setToast(message); window.setTimeout(() => setToast(""), 3800); };
  const chooseProfile = async (id:string) => {
    setBusy(true); await load(id, true); window.localStorage.setItem("ikranti-demo-profile", id);
    setAuthOpen(false); setBusy(false); notify("Signed in to your preview account.");
  };
  const signOut = () => { window.localStorage.removeItem("ikranti-demo-profile"); setProfile(null); setAccountOpen(false); notify("You’re now browsing as a guest."); };

  const perform = async (payload:Record<string, unknown>) => {
    if (!profile) { setAuthOpen(true); return null; }
    setBusy(true);
    try {
      const response = await fetch("/api/marketplace", { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({ ...payload, userId:profile.id }) });
      const result = await response.json() as MarketplaceData & { error?:string; message?:string; bid?:{leading:boolean; extended:boolean} };
      if (!response.ok) throw new Error(result.error || "Please try again.");
      setData(result); return result;
    } catch (error) { notify(error instanceof Error ? error.message : "Please try again."); return null; }
    finally { setBusy(false); }
  };

  const toggleWatch = async (auctionId:string) => {
    const result = await perform({ action:"watch", auctionId });
    if (result) notify(result.watched.includes(auctionId) ? "Added to your watchlist." : "Removed from your watchlist.");
  };

  const submitBid = async (event:FormEvent) => {
    event.preventDefault(); if (!selected) return;
    const result = await perform({ action:"bid", auctionId:selected.id, maxAmount:Number(maxBid) });
    if (result?.bid) { setMaxBid(""); notify(result.bid.leading ? `You’re leading${result.bid.extended ? " — the auction was extended." : "."}` : "Bid registered. Another bidder’s maximum remains higher."); }
  };

  const openLot = (id:string) => {
    const lot = data.auctions.find((item) => item.id === id);
    setSelectedId(id); if (lot) setMaxBid(String(lot.currentBid + bidStep(lot.currentBid)));
  };

  const openSell = () => { if (!profile) setAuthOpen(true); else setSellOpen(true); };

  return (
    <main id="top">
      <header className="nav shell">
        <a className="brand" href="#top" aria-label="Ikranti home"><Mark/><span>IKRANTI</span></a>
        <nav className="navlinks" aria-label="Main navigation"><a href="#auctions">Live auctions</a><a href="#categories">Categories</a><button onClick={openSell}>Sell</button><a href="#how">How it works</a></nav>
        <div className="navActions">
          <button className="searchIcon" onClick={() => document.getElementById("auction-search")?.focus()} aria-label="Search">⌕</button>
          {profile ? <button className="profileButton" onClick={() => setAccountOpen(true)}><span>{profile.initials}</span><b>{profile.name.split(" ")[0]}</b></button> : <button className="textButton" onClick={() => setAuthOpen(true)}>Sign in</button>}
          <button className="goldButton" onClick={openSell}>Sell an asset</button>
        </div>
      </header>

      <section className="hero">
        <div className="heroRings" aria-hidden="true"><i/><i/><i/></div>
        <div className="shell heroInner">
          <p className="eyebrow"><span/> MALTA’S PREMIER AUCTION MARKETPLACE</p>
          <h1>Remarkable assets.<br/><em>Exceptional outcomes.</em></h1>
          <p className="heroCopy">Discover and bid on Malta’s most distinctive property, vehicles, boats, watches, art and antiques—all verified, all transparent.</p>
          <div className="heroActions"><a className="goldButton large" href="#auctions">Explore live auctions</a><button className="ghostButton large" onClick={openSell}>Sell with Ikranti <b>↗</b></button></div>
          <div className="proof"><span>Identity verified</span><span>Secure bidding</span><span>Malta-based support</span></div>
        </div>
        <div className="heroLot"><small>FEATURED PROPERTY</small><strong>Palazzo with Grand Harbour Views</strong><button onClick={() => openLot("senglea-palazzo")} aria-label="Open featured property">↗</button></div>
      </section>

      <section className="auctionSection shell" id="auctions">
        <div className="sectionHead"><div><p className="eyebrow dark"><span/> CURATED FOR DISCERNING BUYERS</p><h2>Live now</h2></div><p>{filtered.length} exceptional assets open for bidding</p></div>
        <div className="marketToolbar">
          <div className="categoryTabs" role="tablist" aria-label="Auction categories">
            {["All assets", ...data.categories].map((item) => <button key={item} className={category === item ? "active" : ""} onClick={() => setCategory(item)}>{item}</button>)}
          </div>
          <label className="searchBox"><span>⌕</span><input id="auction-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search auctions" aria-label="Search auctions"/></label>
        </div>
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
        <div className="trustIntro"><p className="eyebrow dark"><span/> TRUSTED FROM LISTING TO HANDOVER</p><h2>Serious assets deserve<br/><em>a better way to sell.</em></h2><p>Ikranti brings specialist oversight and transparent technology to every transaction. No anonymous bids. No endless messages. No uncertainty.</p></div>
        <div className="steps">
          <article><span>01</span><i>⌁</i><h3>Submit your asset</h3><p>Tell us what you’re selling. Our specialists review its documentation, condition and market fit.</p></article>
          <article><span>02</span><i>◈</i><h3>We prepare the auction</h3><p>A considered presentation, realistic reserve and verified details give bidders confidence.</p></article>
          <article><span>03</span><i>↗</i><h3>The market decides</h3><p>Verified bidders compete openly, with automatic bids and fair anti-sniping extensions.</p></article>
          <article><span>04</span><i>✓</i><h3>Complete securely</h3><p>We guide payment, documents and handover according to the asset category.</p></article>
        </div>
      </section>

      <section className="numbers"><div className="shell"><div><strong>€2.8m</strong><span>VALUE CURRENTLY LIVE</span></div><div><strong>100%</strong><span>VERIFIED SELLERS</span></div><div><strong>2 min</strong><span>ANTI-SNIPE PROTECTION</span></div><div><strong>6</strong><span>SPECIALIST CATEGORIES</span></div></div></section>

      <section className="sellBanner" id="sell"><div className="shell"><div><p className="eyebrow"><span/> YOUR ASSET. THE RIGHT AUDIENCE.</p><h2>Ready to discover<br/><em>what it’s truly worth?</em></h2></div><div><p>Submit your asset for a complimentary review. No listing fee. Our specialists respond within one business day.</p><button className="goldButton large" onClick={openSell}>Start your submission</button></div></div></section>

      <footer><div className="shell footerTop"><div className="footerBrand"><a className="brand" href="#top"><Mark/><span>IKRANTI</span></a><p>Malta’s trusted marketplace for exceptional assets.</p><small>Licensed auction services delivered with independent Maltese partners.</small></div><div><h4>Marketplace</h4><a href="#auctions">Live auctions</a><a href="#categories">Categories</a><button onClick={openSell}>Sell an asset</button><a href="#how">How it works</a></div><div><h4>Trust</h4><a href="#how">Buyer protection</a><a href="#how">Verification</a><a href="#how">Bidding rules</a><a href="#how">Fees</a></div><div><h4>Concierge</h4><a href="mailto:concierge@ikranti.com">concierge@ikranti.com</a><a href="tel:+35621240000">+356 2124 0000</a><span>Valletta, Malta</span></div></div><div className="shell footerBottom"><span>© 2026 Ikranti Marketplace Ltd.</span><div><button>Terms</button><button>Privacy</button><button>Cookies</button></div><span>EN · EUR</span></div></footer>

      {selected && <div className="overlay" role="dialog" aria-modal="true" aria-label={selected.title}>
        <div className="lotPanel">
          <button className="close" onClick={() => setSelectedId(null)} aria-label="Close">×</button>
          <div className="panelImage" style={{backgroundImage:`url(${selected.image})`}}><span className="live">● LIVE AUCTION</span><div className="photoCount">▧ 1 / 8</div></div>
          <div className="panelContent">
            <p className="lotCategory">{selected.category.toUpperCase()}</p><h2>{selected.title}</h2><p className="location">⌖ {selected.location} · Offered by <b>{selected.sellerName}</b> ✓</p>
            <div className="panelStats"><div><small>CURRENT BID</small><strong>{euro.format(selected.currentBid)}</strong></div><div><small>TIME REMAINING</small><b><Countdown endAt={selected.endAt}/></b></div><div><small>BID ACTIVITY</small><b>{selected.bidCount} bids</b></div></div>
            <div className={`reserve ${selected.reservePrice > selected.currentBid ? "pending" : ""}`}><span>{selected.reservePrice > selected.currentBid ? "◇" : "✓"}</span><div><b>{selected.reservePrice === 0 ? "Offered without reserve" : selected.reservePrice <= selected.currentBid ? "Reserve met" : "Reserve not yet met"}</b><small>{selected.reservePrice === 0 || selected.reservePrice <= selected.currentBid ? "This lot will sell to the highest bidder." : "The seller’s confidential minimum has not yet been reached."}</small></div></div>
            <form className="bidForm" onSubmit={submitBid}><label>Your maximum bid<input type="number" min={selected.currentBid + bidStep(selected.currentBid)} step={bidStep(selected.currentBid)} value={maxBid} onChange={(e) => setMaxBid(e.target.value)} required/></label><button className="goldButton large" disabled={busy}>{busy ? "Placing bid…" : profile ? "Place secure bid" : "Sign in to bid"}</button></form>
            <p className="proxyNote">We bid only as much as needed on your behalf. The next minimum is {euro.format(selected.currentBid + bidStep(selected.currentBid))}. Bids are binding.</p>
            <div className="feePreview"><span><small>WINNING BID</small>{euro.format(selected.currentBid)}</span><b>+</b><span><small>BUYER FEE</small>{euro.format(selectedFee)}</span><b>=</b><span><small>ESTIMATED TOTAL</small>{euro.format(selected.currentBid + selectedFee)}</span></div>
            <div className="panelActions"><button onClick={() => toggleWatch(selected.id)}>{data.watched.includes(selected.id) ? "◆ Watching" : "◇ Add to watchlist"}</button><button>↗ Share lot</button><button>⌁ Arrange viewing</button></div>
            <div className="description"><h3>About this lot</h3><p>{selected.description}</p><div className="documentChips"><span>✓ Identity verified</span><span>✓ Ownership reviewed</span><span>▤ Condition report</span></div></div>
            <div className="bidHistory"><h3>Recent activity</h3>{data.recentBids.filter((event) => event.auction_id === selected.id).slice(0,4).map((event,i) => <div key={`${event.created_at}-${i}`}><span><i>{event.initials}</i> Verified bidder</span><b>{euro.format(event.visible_amount)}</b></div>)}{!data.recentBids.some((event) => event.auction_id === selected.id) && <p>Bid history is available to signed-in participants.</p>}</div>
          </div>
        </div>
      </div>}

      {authOpen && <div className="overlay centered" role="dialog" aria-modal="true" aria-label="Preview sign in"><div className="authModal"><button className="close" onClick={() => setAuthOpen(false)} aria-label="Close">×</button><Mark/><p className="eyebrow dark"><span/> PREVIEW ACCESS</p><h2>Choose an account</h2><p>Explore the complete buyer and seller experience using one of the populated demonstration profiles.</p><div className="profileChoices">{demoProfiles.map((item) => <button key={item.id} onClick={() => chooseProfile(item.id)} disabled={busy}><span>{item.initials}</span><div><b>{item.name}</b><small>{item.detail}</small></div><i>→</i></button>)}</div><small className="demoNote">These preview profiles contain fictional demonstration data. Production identity verification will replace them at launch.</small></div></div>}

      {accountOpen && profile && <div className="overlay centered" role="dialog" aria-modal="true" aria-label="Your account"><div className="accountModal"><button className="close" onClick={() => setAccountOpen(false)} aria-label="Close">×</button><div className="accountHead"><span>{profile.initials}</span><div><p>{profile.role === "seller" ? "SELLER CONCIERGE" : "PRIVATE CLIENT"}</p><h2>Welcome, {profile.name.split(" ")[0]}.</h2><small>✓ Identity verified · {profile.email}</small></div></div>{profile.role === "seller" ? <SellerDashboard lots={data.myLots} onSell={() => {setAccountOpen(false);setSellOpen(true)}}/> : <BuyerDashboard lots={data.auctions.filter((lot) => data.watched.includes(lot.id) || lot.highestBidderId === profile.id)} userId={profile.id} openLot={(id) => {setAccountOpen(false);openLot(id)}}/>}<div className="accountFooter"><button onClick={() => {setAccountOpen(false);setAuthOpen(true)}}>Switch preview account</button><button onClick={signOut}>Sign out</button></div></div></div>}

      {sellOpen && profile && <ListingModal profile={profile} categories={data.categories} busy={busy} close={() => setSellOpen(false)} submit={async (payload) => {const result=await perform({action:"createListing",...payload});if(result){setSellOpen(false);notify(result.message || "Asset submitted.");if(profile.role === "seller") setAccountOpen(true);}}}/>} 
      {toast && <div className="toast"><span>✓</span>{toast}</div>}
    </main>
  );
}

function BuyerDashboard({ lots, userId, openLot }:{lots:Auction[];userId:string;openLot:(id:string)=>void}) {
  const leading = lots.filter((lot) => lot.highestBidderId === userId);
  return <div className="dashboard"><div className="dashboardStats"><div><small>WATCHING</small><strong>{lots.length}</strong></div><div><small>LEADING</small><strong>{leading.length}</strong></div><div><small>WON</small><strong>2</strong></div></div><div className="dashboardTitle"><h3>Your activity</h3><button>Notification settings</button></div><div className="dashboardLots">{lots.length ? lots.slice(0,4).map((lot) => <button key={lot.id} onClick={() => openLot(lot.id)}><img src={lot.image} alt=""/><div><small>{lot.category}</small><b>{lot.title}</b><span>{lot.highestBidderId === userId ? "● You’re leading" : `${lot.bidCount} bids`}</span></div><strong>{euro.format(lot.currentBid)}</strong></button>) : <div className="dashboardEmpty"><p>Your watchlist is ready for something exceptional.</p></div>}</div></div>;
}

function SellerDashboard({ lots, onSell }:{lots:Auction[];onSell:()=>void}) {
  const active = lots.filter((lot) => lot.status === "live");
  return <div className="dashboard"><div className="dashboardStats"><div><small>LIVE LOTS</small><strong>{active.length}</strong></div><div><small>TOTAL BIDS</small><strong>{active.reduce((sum,lot)=>sum+lot.bidCount,0)}</strong></div><div><small>CURRENT VALUE</small><strong>{euro.format(active.reduce((sum,lot)=>sum+lot.currentBid,0))}</strong></div></div><div className="dashboardTitle"><h3>Your assets</h3><button className="goldButton" onClick={onSell}>Submit another</button></div><div className="dashboardLots">{lots.map((lot) => <div className="sellerRow" key={lot.id}><img src={lot.image} alt=""/><div><small>{lot.category}</small><b>{lot.title}</b><span className={lot.status}>{lot.status === "live" ? `${lot.bidCount} bids · Live` : "Under specialist review"}</span></div><strong>{euro.format(lot.currentBid)}</strong></div>)}</div></div>;
}

function ListingModal({ profile, categories, busy, close, submit }:{profile:Profile;categories:string[];busy:boolean;close:()=>void;submit:(payload:Record<string,unknown>)=>Promise<void>}) {
  const [step,setStep]=useState(1); const [imageUrl,setImageUrl]=useState(""); const [uploading,setUploading]=useState(false);
  const [fields,setFields]=useState({title:"",category:"",location:"",description:"",startPrice:"",reservePrice:""});
  const update=(key:string,value:string)=>setFields((current)=>({...current,[key]:value}));
  const upload=async(file?:File)=>{if(!file)return;setUploading(true);try{const form=new FormData();form.append("file",file);const response=await fetch("/api/media",{method:"POST",body:form});const result=await response.json() as {url?:string;error?:string};if(!response.ok)throw new Error(result.error);setImageUrl(result.url||"");}catch{setImageUrl(URL.createObjectURL(file));}finally{setUploading(false)}};
  return <div className="overlay centered" role="dialog" aria-modal="true" aria-label="Submit an asset"><div className="listingModal"><button className="close" onClick={close} aria-label="Close">×</button><div className="listingSide"><Mark/><p>SELL WITH IKRANTI</p><h2>Put your asset<br/>before the right people.</h2><div className="formSteps"><span className={step===1?"active":"done"}><b>1</b> Asset details</span><span className={step===2?"active":""}><b>2</b> Value & reserve</span><span className={step===3?"active":""}><b>3</b> Review</span></div><small>Submitted by<br/><b>{profile.name} · Verified</b></small></div><form className="listingForm" onSubmit={(e)=>{e.preventDefault();submit({...fields,imageUrl,startPrice:Number(fields.startPrice),reservePrice:fields.reservePrice ? Number(fields.reservePrice) : 0})}}>{step===1&&<><p className="eyebrow dark"><span/> STEP ONE</p><h2>Tell us about your asset</h2><label>Category<select value={fields.category} onChange={(e)=>update("category",e.target.value)} required><option value="">Choose a category</option>{categories.map((item)=><option key={item}>{item}</option>)}</select></label><label>Asset title<input value={fields.title} onChange={(e)=>update("title",e.target.value)} placeholder="e.g. 1968 Porsche 911 S" required minLength={5}/></label><label>Location<input value={fields.location} onChange={(e)=>update("location",e.target.value)} placeholder="e.g. Sliema, Malta" required/></label><label>Description<textarea value={fields.description} onChange={(e)=>update("description",e.target.value)} placeholder="Condition, provenance, history and what makes it special…" required minLength={20}/></label><button type="button" className="goldButton large" onClick={()=>setStep(2)} disabled={!fields.category||fields.title.length<5||!fields.location||fields.description.length<20}>Continue</button></>}{step===2&&<><p className="eyebrow dark"><span/> STEP TWO</p><h2>Set the auction parameters</h2><div className="fieldPair"><label>Starting bid (€)<input type="number" min="1" value={fields.startPrice} onChange={(e)=>update("startPrice",e.target.value)} required/></label><label>Confidential reserve (€)<input type="number" min="0" value={fields.reservePrice} onChange={(e)=>update("reservePrice",e.target.value)} placeholder="0 = no reserve"/></label></div><label className="uploadBox">{imageUrl?<img src={imageUrl} alt="Asset preview"/>:<><span>＋</span><b>{uploading?"Uploading…":"Add a lead photograph"}</b><small>JPG, PNG or WebP · up to 8 MB</small></>}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e)=>upload(e.target.files?.[0])}/></label><div className="formActions"><button type="button" className="backButton" onClick={()=>setStep(1)}>← Back</button><button type="button" className="goldButton large" onClick={()=>setStep(3)} disabled={!fields.startPrice}>Review submission</button></div></>}{step===3&&<><p className="eyebrow dark"><span/> FINAL REVIEW</p><h2>Your asset is ready</h2><div className="reviewCard">{imageUrl&&<img src={imageUrl} alt=""/>}<div><small>{fields.category}</small><h3>{fields.title}</h3><p>{fields.location}</p><strong>Starting at {euro.format(Number(fields.startPrice))}</strong></div></div><div className="reviewNote"><span>◇</span><p><b>Specialist review comes next.</b><br/>We’ll verify the asset, refine the presentation and agree the final reserve before it goes live.</p></div><div className="formActions"><button type="button" className="backButton" onClick={()=>setStep(2)}>← Back</button><button className="goldButton large" disabled={busy}>{busy?"Submitting…":"Submit for review"}</button></div></>}</form></div></div>;
}
