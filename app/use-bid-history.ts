"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { browserClient } from "@/lib/supabase/browser";
import { BidHistoryData, mergeBidHistory } from "@/lib/bid-history";

type Connection = "connecting" | "live" | "reconnecting" | "offline";
type HistoryState = {
  key: string; history: BidHistoryData | null; loading: boolean; error: string;
  olderLoading: boolean; olderError: string; connection: Connection;
};
const empty = (key: string): HistoryState => ({ key, history: null, loading: true, error: "", olderLoading: false, olderError: "", connection: "connecting" });

export function useBidHistory(auctionId: string | null, viewerId: string | null | undefined, revision: number) {
  const key = `${auctionId}:${viewerId === undefined ? "loading" : viewerId ?? "guest"}`;
  const [state, setState] = useState<HistoryState>(() => empty(key));
  const actions = useRef({ refresh: () => {}, older: () => {} });

  useEffect(() => {
    actions.current = { refresh: () => {}, older: () => {} };
    if (!auctionId || viewerId === undefined) return;
    const client = browserClient();
    let active = true, fetching = false, dirty = false, fetchingOlder = false;
    let latest: BidHistoryData | null = null;
    let connection: Connection = navigator.onLine ? "connecting" : "offline";
    const controllers = new Set<AbortController>();
    const patch = (value: Partial<HistoryState>) => { if (active) setState(s => ({ ...(s.key === key ? s : empty(key)), ...value })); };
    const read = async (before?: string) => {
      const controller = new AbortController();
      controllers.add(controller);
      const timeout = window.setTimeout(() => controller.abort(), 12000);
      try {
        const { data, error } = await client.rpc("ir_bid_history", { p_auction: auctionId, p_before: before ?? null, p_limit: 50 }).abortSignal(controller.signal);
        if (error || !data || data.auction_id !== auctionId) throw new Error("History unavailable");
        return data as BidHistoryData;
      } finally { clearTimeout(timeout); controllers.delete(controller); }
    };
    const refresh = async () => {
      dirty = true;
      if (fetching) return;
      fetching = true;
      try {
        while (dirty && active) {
          dirty = false;
          try {
            const data = await read();
            if (!active) return;
            latest = mergeBidHistory(latest, data);
            patch({ history: latest, loading: false, error: "" });
          } catch {
            // Never continue displaying personalized labels from an invalidated session.
            latest = null;
            patch({ history: null, loading: false, error: "Bid history couldn’t be refreshed. Reconnect or try again." });
          }
        }
      } finally { fetching = false; }
    };
    const older = async () => {
      const before = latest?.next_before;
      if (!before || fetchingOlder) return;
      fetchingOlder = true;
      patch({ olderLoading: true, olderError: "" });
      try {
        const data = await read(before);
        if (!active) return;
        // A reconnect may have replaced the visible window while this page was loading.
        // Do not splice an old page onto a new head with an invisible gap between them.
        if (!latest || latest.next_before !== before) return;
        latest = mergeBidHistory(latest, data, true);
        patch({ history: latest });
        // Pagination may race a new bid; get a fresh authoritative head as well.
        void refresh();
      } catch { patch({ olderError: "Earlier bids couldn’t be loaded. Try again." }); }
      finally { fetchingOlder = false; patch({ olderLoading: false }); }
    };
    actions.current = { refresh: () => void refresh(), older: () => void older() };
    const setConnection = (value: Connection) => { connection = value; patch({ connection }); };
    const channel = client.channel(`bid-history:${auctionId}:${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "ir_public_auctions", filter: `id=eq.${auctionId}` }, () => void refresh())
      .on("system", {}, payload => {
        if (payload.status === "error" || payload.status === "timeout") setConnection("reconnecting");
        else if (payload.status === "ok") { setConnection("live"); void refresh(); }
      })
      .subscribe(status => {
        if (!active) return;
        if (status === "SUBSCRIBED") { setConnection("live"); void refresh(); }
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          setConnection(navigator.onLine ? "reconnecting" : "offline");
        }
      });
    const online = () => { setConnection("reconnecting"); void refresh(); };
    const offline = () => setConnection("offline");
    const visible = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    document.addEventListener("visibilitychange", visible);
    // Realtime is primary. A slower fallback only runs while the connection is degraded.
    const fallback = window.setInterval(() => {
      if (connection !== "live" && navigator.onLine && document.visibilityState === "visible") void refresh();
    }, 30000);
    void refresh();
    return () => {
      active = false;
      controllers.forEach(controller => controller.abort());
      window.clearInterval(fallback);
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
      document.removeEventListener("visibilitychange", visible);
      void client.removeChannel(channel);
    };
  }, [auctionId, viewerId, key]);

  useEffect(() => { if (revision) actions.current.refresh(); }, [revision]);
  const refresh = useCallback(() => actions.current.refresh(), []);
  const loadOlder = useCallback(() => actions.current.older(), []);
  const visible = state.key === key ? state : empty(key);
  return { history: visible.history, loading: visible.loading, error: visible.error,
    olderLoading: visible.olderLoading, olderError: visible.olderError, connection: visible.connection,
    refresh, loadOlder };
}
