"use client";

import { useEffect, useRef, useState } from "react";
import { BidChatEntry, BidHistoryData, bidLeaderText } from "@/lib/bid-history";
import styles from "./bid-history.module.css";
import { useAuctionEnded } from "./use-auction-ended";

const money = new Intl.NumberFormat("en-MT", { style: "currency", currency: "EUR", maximumFractionDigits: 2 });
const time = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Europe/Malta" });

export function BidBubble({ entry, ended }: { entry: BidChatEntry; ended: boolean }) {
  return <article className={`${styles.message} ${entry.is_mine ? styles.own : ""}`}>
    <span className={styles.avatar} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="12" cy="8" r="3"/><path d="M5 21v-3a7 7 0 0 1 14 0v3"/></svg></span>
    <div className={`${styles.bubble} ${entry.is_leading ? styles.leadingBubble : ""}`}>
      <div className={styles.messageHead}><strong>{entry.is_mine ? "Your Bid" : "Floor bid"}</strong>{entry.is_leading && <span className={styles.leadBadge}>{ended ? "Final highest bid" : "Leading bid"}</span>}</div>
      <p className={styles.amount}>{money.format(entry.amount)}</p>
      {entry.kind === "automatic" && <p className={styles.detail}>Automatic bid</p>}
      {entry.kind === "priority" && <p className={styles.detail}>Equal amount · earlier bidder keeps the lead</p>}
      {entry.kind === "snapshot" && <p className={styles.detail}>Current bid when detailed history began</p>}
      {entry.created_at && <time className={styles.time} dateTime={entry.created_at}>{time.format(new Date(entry.created_at))}</time>}
    </div>
  </article>;
}

type Props = {
  history: BidHistoryData | null; loading: boolean; error: string;
  olderLoading: boolean; olderError: string;
  connection: "connecting" | "live" | "reconnecting" | "offline";
  refresh: () => void; loadOlder: () => void;
};

export function BidHistory({ history, loading, error, olderLoading, olderError, connection, refresh, loadOlder }: Props) {
  const log = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const previous = useRef({ first: "", last: "", height: 0, top: 0 });
  const [newBids, setNewBids] = useState(false);
  const entries = history?.entries.length ? history.entries : history?.snapshot ? [history.snapshot] : [];
  const first = entries[0]?.id ?? "", last = entries.at(-1)?.id ?? "";
  const ended = useAuctionEnded(history?.auction.end_at, history?.auction.status);

  useEffect(() => {
    if (ended && history?.auction.status === "live") refresh();
  }, [history?.auction.status, ended, refresh]);

  useEffect(() => {
    const element = log.current;
    if (!element) return;
    const old = previous.current;
    if (!old.last || following.current) {
      element.scrollTop = element.scrollHeight;
      setNewBids(false);
    } else if (first !== old.first && last === old.last) {
      // Keep the same message under the reader's eye when older bids are prepended.
      element.scrollTop = old.top + element.scrollHeight - old.height;
    } else if (last !== old.last) setNewBids(true);
    previous.current = { first, last, height: element.scrollHeight, top: element.scrollTop };
  }, [first, last]);

  const jumpLatest = () => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
    following.current = true;
    setNewBids(false);
  };
  return <aside className={styles.panel} aria-labelledby="bid-history-title">
    <header className={styles.header}>
      <p className={styles.eyebrow}>THE BIDDING ROOM</p>
      <div className={styles.titleRow}><h2 id="bid-history-title">Bid history</h2><span className={`${styles.connection} ${connection === "live" && !error ? styles.connected : ""}`}>{error ? "Update needed" : connection === "live" ? "Live" : connection === "connecting" ? "Connecting…" : connection === "offline" ? "Offline" : "Reconnecting…"}</span></div>
      <p>Follow every bid, including automatic replies.</p>
    </header>
    {history && <div className={`${styles.leader} ${history.auction.viewer_leading ? styles.yourLead : ""}`} role="status">
      <span>{bidLeaderText(history, ended)}</span>
      <strong>{money.format(history.auction.current_bid)}</strong>
      {history.auction.has_bids && history.auction.has_reserve && !history.auction.reserve_met && <small>Reserve not met</small>}
    </div>}
    {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- The independently scrollable transcript must support keyboard scrolling. */}
    <div className={styles.log} ref={log} role="log" aria-label="Bid messages, oldest to newest" aria-live="polite" aria-relevant="additions" aria-busy={loading} tabIndex={0} onScroll={() => {
      const element = log.current;
      if (!element) return;
      following.current = element.scrollHeight - element.scrollTop - element.clientHeight < 70;
      previous.current = { first, last, height: element.scrollHeight, top: element.scrollTop };
      if (following.current) setNewBids(false);
    }}>
      {history?.has_more && <button className={styles.secondary} disabled={olderLoading} onClick={loadOlder}>{olderLoading ? "Loading earlier bids…" : "Load earlier bids"}</button>}
      {olderError && <p role="alert" className={styles.notice}>{olderError}</p>}
      {loading && <p className={styles.empty}>Loading bid history…</p>}
      {error && <div className={styles.empty} role="alert"><p>{error}</p><button className={styles.secondary} onClick={refresh}>Try again</button></div>}
      {!loading && !error && !entries.length && <div className={styles.empty}><span aria-hidden="true">◇</span><h3>The conversation starts with a bid</h3><p>No bids yet. Your accepted bid will appear here.</p></div>}
      <div className={styles.messages}>
        {entries.some(entry => entry.kind === "snapshot") && <p className={styles.historyNote}>Earlier bid-by-bid history is unavailable. New bids appear below this starting point.</p>}
        {entries.map(entry => <BidBubble key={entry.id} entry={entry} ended={ended}/>)}
      </div>
    </div>
    {newBids && <button className={styles.newBids} onClick={jumpLatest}>New bids ↓</button>}
    <div className={styles.footer}>
      {connection !== "live" && !loading && <p role="status">{connection === "offline" ? "You’re offline. These bids may be out of date." : "Live updates are reconnecting. These bids may be out of date."} <button onClick={refresh}>Refresh</button></p>}
      <p>Latest bid at the bottom. “Floor bid” means another bidder, including their automatic bids. Unspent maximum bids stay private.</p>
      <button className={styles.backToBid} onClick={() => document.getElementById("lot-bid-form")?.scrollIntoView({ block: "center" })}>Back to bidding ↑</button>
    </div>
  </aside>;
}
