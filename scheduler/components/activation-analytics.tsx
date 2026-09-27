"use client";

import { useEffect } from "react";

import { usePathname } from "next/navigation";

import { analyticsEnabled, trackEvent } from "@/lib/analytics/plausible";

const CHECK_INTERVAL_MS = 60_000;
let lastCheck = 0;

interface ClaimedEvent {
  name: string;
  props: Record<string, string>;
}

/**
 * Relays first-time activation milestones (recorded server-side for every interface,
 * including MCP and scheduled dispatch) to Plausible from a signed-in browser. The
 * server hands each milestone out once, so another tab or device cannot repeat it.
 */
export function ActivationAnalytics() {
  const pathname = usePathname();
  useEffect(() => {
    if (!analyticsEnabled()) return;
    const now = Date.now();
    if (now - lastCheck < CHECK_INTERVAL_MS) return;
    lastCheck = now;
    void fetch("/api/v1/analytics/milestones", { method: "POST", credentials: "same-origin" })
      .then((response) => (response.ok ? (response.json() as Promise<{ events?: ClaimedEvent[] }>) : { events: [] }))
      .then(({ events }) => {
        for (const event of events ?? []) trackEvent(event.name, event.props);
      })
      .catch(() => {
        /* Analytics must never interrupt the app. */
      });
  }, [pathname]);
  return null;
}
