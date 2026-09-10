import { env } from "cloudflare:workers";

type DbEnv = typeof env & { DB: D1Database };

const categories = ["Property", "Motor Cars", "Boats", "Watches & Jewellery", "Art & Antiques", "Collectables"];

const addDays = (days: number, hours = 0) => new Date(Date.now() + ((days * 24 + hours) * 60 * 60 * 1000)).toISOString();

async function initialise() {
  const db = (env as DbEnv).DB;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, initials TEXT NOT NULL, email TEXT NOT NULL UNIQUE, role TEXT NOT NULL, verified INTEGER NOT NULL DEFAULT 0, joined_at TEXT NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS auctions (id TEXT PRIMARY KEY, seller_id TEXT NOT NULL, title TEXT NOT NULL, category TEXT NOT NULL, location TEXT NOT NULL, description TEXT NOT NULL, image_url TEXT NOT NULL, start_price REAL NOT NULL, reserve_price REAL NOT NULL, current_bid REAL NOT NULL, highest_bidder_id TEXT, bid_count INTEGER NOT NULL DEFAULT 0, end_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'live', featured INTEGER NOT NULL DEFAULT 0, views INTEGER NOT NULL DEFAULT 0, watch_count INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 0)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS max_bids (auction_id TEXT NOT NULL, user_id TEXT NOT NULL, max_amount REAL NOT NULL, created_at TEXT NOT NULL, UNIQUE(auction_id, user_id))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS bid_events (id TEXT PRIMARY KEY, auction_id TEXT NOT NULL, user_id TEXT NOT NULL, visible_amount REAL NOT NULL, created_at TEXT NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS watchlist (user_id TEXT NOT NULL, auction_id TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(user_id, auction_id))`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_auctions_status_end_at ON auctions(status, end_at)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_auctions_seller_id ON auctions(seller_id)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_auctions_category ON auctions(category)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_bid_events_auction_created ON bid_events(auction_id, created_at)`),
  ]);

  const users = [
    ["buyer_01", "Lara Vella", "LV", "lara@demo.ikranti.com", "buyer", 1, "2026-01-12"],
    ["seller_01", "Marc Camilleri", "MC", "marc@demo.ikranti.com", "seller", 1, "2025-11-04"],
    ["collector_01", "Elena Borg", "EB", "elena@demo.ikranti.com", "buyer", 1, "2026-02-18"],
    ["seller_auto", "Mdina Motor House", "MM", "concierge@demo.ikranti.com", "seller", 1, "2025-10-08"],
    ["seller_estate", "Harbour Estates", "HE", "property@demo.ikranti.com", "seller", 1, "2025-09-16"],
  ];
  for (const user of users) {
    await db.prepare(`INSERT OR IGNORE INTO users (id,name,initials,email,role,verified,joined_at) VALUES (?,?,?,?,?,?,?)`).bind(...user).run();
  }

  const seeded = await db.prepare(`SELECT COUNT(*) AS count FROM auctions`).first<{ count: number }>();
  if ((seeded?.count ?? 0) === 0) {
    const lots = [
      ["jaguar-e-type", "seller_auto", "1967 Jaguar E-Type Series 1", "Motor Cars", "Naxxar, Malta", "A beautifully preserved Series 1 roadster in British Racing Green. Matching numbers, Maltese registered and accompanied by an extensive history file. Independent inspection available by appointment.", "https://images.unsplash.com/photo-1553440569-bcc63803a83d?auto=format&fit=crop&w=1600&q=90", 72000, 82000, 84500, "collector_01", 23, addDays(1, 7), "live", 1, 1240, 48],
      ["rolex-daytona", "seller_01", "Rolex Cosmograph Daytona", "Watches & Jewellery", "Valletta, Malta", "Oystersteel chronograph with black dial, full set and 2022 dated card. Examined by our independent watch specialist and offered with a 12-month authenticity guarantee.", "https://images.unsplash.com/photo-1670177257750-9b47927f68eb?auto=format&fit=crop&w=1600&q=90", 17000, 20500, 21750, "buyer_01", 18, addDays(3, 11), "live", 1, 962, 62],
      ["senglea-palazzo", "seller_estate", "Palazzo with Grand Harbour Views", "Property", "Senglea, Malta", "An architecturally significant harbour-side residence arranged across four levels, with an unrestored piano nobile and private roof terrace. Legal pack and viewing calendar available to registered bidders.", "https://images.unsplash.com/photo-1600607687920-4e2a09cf159d?auto=format&fit=crop&w=1600&q=90", 980000, 1180000, 1240000, "collector_01", 31, addDays(5, 2), "live", 1, 1844, 91],
      ["riva-aquarama", "seller_01", "1971 Riva Aquarama Special", "Boats", "Grand Harbour Marina", "Twin-engine mahogany runabout following a three-year restoration. EU VAT paid, Malta flag eligible and supplied with current survey, engine records and fitted cover.", "https://images.unsplash.com/photo-1540946485063-a40da27545f8?auto=format&fit=crop&w=1600&q=90", 280000, 330000, 342000, "buyer_01", 14, addDays(2, 4), "live", 1, 770, 35],
      ["caruana-painting", "seller_01", "Edward Caruana Dingli, Harbour Morning", "Art & Antiques", "Attard, Malta", "Signed oil on canvas depicting the Grand Harbour at first light. Private Maltese collection; accompanied by provenance documentation and a condition assessment.", "https://images.unsplash.com/photo-1577083552431-6e5fd01aa342?auto=format&fit=crop&w=1600&q=90", 12000, 18500, 19400, "collector_01", 16, addDays(4, 8), "live", 0, 644, 27],
      ["malta-map", "seller_01", "De Wit Map of Malta, circa 1680", "Collectables", "Rabat, Malta", "A finely engraved and hand-coloured map of Malta and Gozo by Frederick de Wit, retaining wide margins and presented in a conservation-grade frame.", "https://images.unsplash.com/photo-1524661135-423995f22d0b?auto=format&fit=crop&w=1600&q=90", 1600, 0, 2450, "buyer_01", 9, addDays(6, 1), "live", 0, 383, 18],
      ["mercedes-280sl", "seller_auto", "1969 Mercedes-Benz 280 SL Pagoda", "Motor Cars", "Mosta, Malta", "European specification example in Horizon Blue with navy interior. Recently serviced, accompanied by hardtop and documented restoration photographs.", "https://images.unsplash.com/photo-1563720223185-11003d516935?auto=format&fit=crop&w=1600&q=90", 68000, 82000, 78500, "collector_01", 12, addDays(7, 2), "live", 0, 511, 29],
      ["malta-cabinet", "seller_01", "18th-Century Maltese Olivewood Cabinet", "Art & Antiques", "Balzan, Malta", "A compact olivewood and ebonised cabinet on original stand, with fitted interior and bone escutcheons. Private family provenance since the 1940s.", "https://images.unsplash.com/photo-1586023492125-27b2c045efd7?auto=format&fit=crop&w=1600&q=90", 8500, 12500, 13100, "buyer_01", 11, addDays(4, 19), "live", 0, 456, 22],
      ["seller-pending-1", "seller_01", "Cartier Tank Louis, 18k Gold", "Watches & Jewellery", "Sliema, Malta", "Freshly submitted private collection piece with box and service papers.", "https://images.unsplash.com/photo-1524592094714-0f0654e20314?auto=format&fit=crop&w=1600&q=90", 6500, 7800, 6500, null, 0, addDays(10), "under_review", 0, 0, 0],
    ];
    for (const lot of lots) {
      await db.prepare(`INSERT INTO auctions (id,seller_id,title,category,location,description,image_url,start_price,reserve_price,current_bid,highest_bidder_id,bid_count,end_at,status,featured,views,watch_count) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(...lot).run();
    }
  }
}

function serialiseAuction(row: Record<string, unknown>) {
  return {
    id: row.id, sellerId: row.seller_id, sellerName: row.seller_name,
    title: row.title, category: row.category, location: row.location,
    description: row.description, image: row.image_url,
    startPrice: row.start_price, reservePrice: row.reserve_price,
    currentBid: row.current_bid, highestBidderId: row.highest_bidder_id,
    bidCount: row.bid_count, endAt: row.end_at, status: row.status,
    featured: Boolean(row.featured), views: row.views, watchCount: row.watch_count,
  };
}

async function readMarketplace(userId: string) {
  const db = (env as DbEnv).DB;
  const [user, auctionResult, watchedResult, myLotsResult, eventResult] = await Promise.all([
    db.prepare(`SELECT * FROM users WHERE id = ?`).bind(userId).first(),
    db.prepare(`SELECT a.*, u.name AS seller_name FROM auctions a JOIN users u ON u.id = a.seller_id WHERE a.status = 'live' ORDER BY a.featured DESC, a.end_at ASC`).all(),
    db.prepare(`SELECT auction_id FROM watchlist WHERE user_id = ?`).bind(userId).all(),
    db.prepare(`SELECT a.*, u.name AS seller_name FROM auctions a JOIN users u ON u.id = a.seller_id WHERE a.seller_id = ? ORDER BY a.end_at DESC`).bind(userId).all(),
    db.prepare(`SELECT b.auction_id, b.visible_amount, b.created_at, u.initials FROM bid_events b JOIN users u ON u.id = b.user_id ORDER BY b.created_at DESC LIMIT 24`).all(),
  ]);
  return {
    user: user ? { id: user.id, name: user.name, initials: user.initials, email: user.email, role: user.role, verified: Boolean(user.verified) } : null,
    auctions: auctionResult.results.map((row: Record<string, unknown>) => serialiseAuction(row)),
    watched: watchedResult.results.map((row: Record<string, unknown>) => row.auction_id),
    myLots: myLotsResult.results.map((row: Record<string, unknown>) => serialiseAuction(row)),
    recentBids: eventResult.results,
    categories,
  };
}

export async function GET(request: Request) {
  await initialise();
  const userId = new URL(request.url).searchParams.get("user") || "buyer_01";
  return Response.json(await readMarketplace(userId));
}

export async function POST(request: Request) {
  await initialise();
  const db = (env as DbEnv).DB;
  const body = await request.json() as Record<string, unknown>;
  const action = String(body.action || "");
  const userId = String(body.userId || "");
  const user = await db.prepare(`SELECT * FROM users WHERE id = ?`).bind(userId).first<Record<string, unknown>>();
  if (!user) return Response.json({ error: "Please sign in before continuing." }, { status: 401 });

  if (action === "watch") {
    const auctionId = String(body.auctionId || "");
    const existing = await db.prepare(`SELECT 1 AS found FROM watchlist WHERE user_id = ? AND auction_id = ?`).bind(userId, auctionId).first();
    if (existing) {
      await db.batch([
        db.prepare(`DELETE FROM watchlist WHERE user_id = ? AND auction_id = ?`).bind(userId, auctionId),
        db.prepare(`UPDATE auctions SET watch_count = MAX(0, watch_count - 1) WHERE id = ?`).bind(auctionId),
      ]);
    } else {
      await db.batch([
        db.prepare(`INSERT OR IGNORE INTO watchlist (user_id, auction_id, created_at) VALUES (?, ?, ?)`).bind(userId, auctionId, new Date().toISOString()),
        db.prepare(`UPDATE auctions SET watch_count = watch_count + 1 WHERE id = ?`).bind(auctionId),
      ]);
    }
    return Response.json(await readMarketplace(userId));
  }

  if (action === "bid") {
    const auctionId = String(body.auctionId || "");
    const maxAmount = Number(body.maxAmount);
    const auction = await db.prepare(`SELECT * FROM auctions WHERE id = ?`).bind(auctionId).first<Record<string, unknown>>();
    if (!auction || auction.status !== "live") return Response.json({ error: "This auction is no longer live." }, { status: 400 });
    if (auction.seller_id === userId) return Response.json({ error: "You cannot bid on your own lot." }, { status: 400 });
    if (new Date(String(auction.end_at)).getTime() <= Date.now()) return Response.json({ error: "Bidding has closed." }, { status: 400 });

    const current = Number(auction.current_bid);
    const increment = current >= 100000 ? 5000 : current >= 10000 ? 500 : current >= 1000 ? 100 : current >= 100 ? 25 : 5;
    const own = await db.prepare(`SELECT max_amount FROM max_bids WHERE auction_id = ? AND user_id = ?`).bind(auctionId, userId).first<{ max_amount: number }>();
    const minimum = auction.highest_bidder_id === userId ? Math.max(current, Number(own?.max_amount || current)) + increment : current + increment;
    if (!Number.isFinite(maxAmount) || maxAmount < minimum) return Response.json({ error: `Your maximum bid must be at least €${minimum.toLocaleString("en-MT")}.` }, { status: 400 });

    let leaderId = auction.highest_bidder_id ? String(auction.highest_bidder_id) : userId;
    let visibleAmount = current;
    if (!auction.highest_bidder_id) {
      leaderId = userId;
      visibleAmount = Math.max(Number(auction.start_price), current);
    } else if (auction.highest_bidder_id === userId) {
      leaderId = userId;
    } else {
      const leaderMaxRow = await db.prepare(`SELECT max_amount FROM max_bids WHERE auction_id = ? AND user_id = ?`).bind(auctionId, String(auction.highest_bidder_id)).first<{ max_amount: number }>();
      const leaderMax = Number(leaderMaxRow?.max_amount || current);
      if (maxAmount > leaderMax) {
        leaderId = userId;
        visibleAmount = Math.min(maxAmount, leaderMax + increment);
      } else {
        leaderId = String(auction.highest_bidder_id);
        visibleAmount = Math.min(leaderMax, maxAmount + increment);
      }
    }

    const oldEnd = new Date(String(auction.end_at)).getTime();
    const extendedEnd = oldEnd - Date.now() <= 120000 ? new Date(Date.now() + 120000).toISOString() : String(auction.end_at);
    const now = new Date().toISOString();
    const results = await db.batch([
      db.prepare(`UPDATE auctions SET current_bid = ?, highest_bidder_id = ?, bid_count = bid_count + 1, end_at = ?, version = version + 1 WHERE id = ? AND version = ?`).bind(visibleAmount, leaderId, extendedEnd, auctionId, Number(auction.version)),
      db.prepare(`INSERT INTO max_bids (auction_id,user_id,max_amount,created_at) VALUES (?,?,?,?) ON CONFLICT(auction_id,user_id) DO UPDATE SET max_amount=excluded.max_amount, created_at=excluded.created_at`).bind(auctionId, userId, maxAmount, now),
      db.prepare(`INSERT INTO bid_events (id,auction_id,user_id,visible_amount,created_at) VALUES (?,?,?,?,?)`).bind(`bid_${crypto.randomUUID()}`, auctionId, userId, visibleAmount, now),
    ]);
    if ((results[0].meta?.changes || 0) === 0) return Response.json({ error: "Another bid arrived first. Please try once more." }, { status: 409 });
    return Response.json({ ...(await readMarketplace(userId)), bid: { leading: leaderId === userId, visibleAmount, extended: extendedEnd !== auction.end_at } });
  }

  if (action === "createListing") {
    const title = String(body.title || "").trim();
    const category = String(body.category || "");
    const location = String(body.location || "").trim();
    const description = String(body.description || "").trim();
    const imageUrl = String(body.imageUrl || "").trim();
    const startPrice = Number(body.startPrice);
    const reservePrice = body.reservePrice === "" || body.reservePrice == null ? 0 : Number(body.reservePrice);
    if (title.length < 5 || !categories.includes(category) || !location || description.length < 20 || !Number.isFinite(startPrice) || startPrice < 1 || !Number.isFinite(reservePrice) || reservePrice < 0) {
      return Response.json({ error: "Complete every field and add a description of at least 20 characters." }, { status: 400 });
    }
    const id = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 42)}-${crypto.randomUUID().slice(0, 6)}`;
    await db.prepare(`INSERT INTO auctions (id,seller_id,title,category,location,description,image_url,start_price,reserve_price,current_bid,bid_count,end_at,status,featured,views,watch_count) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(id, userId, title, category, location, description, imageUrl || "https://images.unsplash.com/photo-1564540574859-0dfb63985953?auto=format&fit=crop&w=1600&q=90", startPrice, reservePrice, startPrice, 0, addDays(7), "under_review", 0, 0, 0).run();
    return Response.json({ ...(await readMarketplace(userId)), message: "Your asset has been submitted for specialist review." });
  }

  return Response.json({ error: "Unknown action." }, { status: 400 });
}
