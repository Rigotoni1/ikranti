import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  initials: text("initials").notNull(),
  email: text("email").notNull(),
  role: text("role", { enum: ["buyer", "seller", "admin"] }).notNull(),
  verified: integer("verified", { mode: "boolean" }).notNull().default(false),
  joinedAt: text("joined_at").notNull(),
}, (table) => [uniqueIndex("idx_users_email").on(table.email)]);

export const auctions = sqliteTable("auctions", {
  id: text("id").primaryKey(),
  sellerId: text("seller_id").notNull(),
  title: text("title").notNull(),
  category: text("category").notNull(),
  location: text("location").notNull(),
  description: text("description").notNull(),
  imageUrl: text("image_url").notNull(),
  startPrice: real("start_price").notNull(),
  reservePrice: real("reserve_price").notNull(),
  currentBid: real("current_bid").notNull(),
  highestBidderId: text("highest_bidder_id"),
  bidCount: integer("bid_count").notNull().default(0),
  endAt: text("end_at").notNull(),
  status: text("status").notNull().default("live"),
  featured: integer("featured", { mode: "boolean" }).notNull().default(false),
  views: integer("views").notNull().default(0),
  watchCount: integer("watch_count").notNull().default(0),
  version: integer("version").notNull().default(0),
}, (table) => [
  index("idx_auctions_status_end_at").on(table.status, table.endAt),
  index("idx_auctions_seller_id").on(table.sellerId),
  index("idx_auctions_category").on(table.category),
]);

export const maxBids = sqliteTable("max_bids", {
  auctionId: text("auction_id").notNull(),
  userId: text("user_id").notNull(),
  maxAmount: real("max_amount").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [uniqueIndex("idx_max_bids_auction_user").on(table.auctionId, table.userId)]);

export const bidEvents = sqliteTable("bid_events", {
  id: text("id").primaryKey(),
  auctionId: text("auction_id").notNull(),
  userId: text("user_id").notNull(),
  visibleAmount: real("visible_amount").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [index("idx_bid_events_auction_created").on(table.auctionId, table.createdAt)]);

export const watchlist = sqliteTable("watchlist", {
  userId: text("user_id").notNull(),
  auctionId: text("auction_id").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [uniqueIndex("idx_watchlist_user_auction").on(table.userId, table.auctionId)]);
