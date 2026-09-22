export type BidChatEntry = {
  id: string;
  amount: number;
  kind: "bid" | "automatic" | "priority" | "snapshot";
  created_at: string | null;
  is_mine: boolean;
  is_leading: boolean;
};

export type BidHistoryData = {
  auction_id: string;
  entries: BidChatEntry[];
  snapshot: BidChatEntry | null;
  leading_entry_id: string | null;
  has_more: boolean;
  next_before: string | null;
  auction: {
    current_bid: number; bid_count: number; end_at: string; status: string;
    reserve_met: boolean; has_reserve: boolean; version: number;
    has_bids: boolean; viewer_leading: boolean;
  };
};

// A reconnect can miss more than one page. Without overlap, replace the window;
// older entries remain available through pagination, never silently omit a gap.
export function mergeBidHistory(current: BidHistoryData | null, incoming: BidHistoryData, older = false): BidHistoryData {
  if (!current || current.auction_id !== incoming.auction_id) return incoming;
  if (!older && incoming.auction.version < current.auction.version) return current;
  const currentIds = new Set(current.entries.map(entry => entry.id));
  const overlap = incoming.entries.some(entry => currentIds.has(entry.id));
  if (!older && !overlap) return incoming;
  const meta = older ? current : incoming;
  const entries = [...new Map([...current.entries, ...incoming.entries].map(entry => [entry.id, entry])).values()]
    .sort((a, b) => BigInt(a.id) < BigInt(b.id) ? -1 : 1)
    .map(entry => ({ ...entry, is_leading: entry.id === meta.leading_entry_id }));
  const retainedEarlier = !older && current.entries.length > 0 && incoming.entries.length > 0
    && BigInt(current.entries[0].id) < BigInt(incoming.entries[0].id);
  const cursor = older ? incoming : retainedEarlier ? current : incoming;
  return { ...meta, entries, snapshot: entries.length ? null : meta.snapshot,
    has_more: cursor.has_more, next_before: cursor.next_before };
}

export function bidLeaderText(history: BidHistoryData, ended = false): string {
  const a = history.auction;
  if (!a.has_bids) return a.status === "live" ? "Be the first to bid" : "No bids placed";
  if (a.status === "sold") return a.viewer_leading ? "Your Bid · Winning bid" : "Floor bid · Winning bid";
  if (a.status === "withdrawn") return "Auction withdrawn";
  if (a.status === "reserve_not_met") return "Auction ended · Reserve not met";
  if (a.status !== "live" || ended) return "Bidding ended · Awaiting result";
  return a.viewer_leading ? "Your Bid · You’re leading" : "Floor bid · Leading bid";
}
