"use client";

import { useEffect, useState } from "react";

// Schedule the closing boundary without re-rendering the whole marketplace every second.
export function useAuctionEnded(endAt: string | undefined, status: string | undefined) {
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    if (!endAt) return;
    const deadline = new Date(endAt).getTime();
    let timer: number;
    const update = () => {
      const now = Date.now();
      setClock(now);
      if (deadline > now) timer = window.setTimeout(update, Math.min(86400000, deadline - now + 50));
    };
    timer = window.setTimeout(update, 0);
    return () => window.clearTimeout(timer);
  }, [endAt]);
  return Boolean(endAt && (status !== "live" || new Date(endAt).getTime() <= clock));
}
