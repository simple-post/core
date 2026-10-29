"use client";

import { useEffect } from "react";

import { usePathname } from "next/navigation";

import { analyticsEnabled, trackEvent } from "@/lib/analytics/plausible";

interface ClaimedEvent {
  kind: string;
  eventId: string;
  name: string;
  props: Record<string, string>;
  occurredAt: string;
}
let inFlight = false;
let lastCheck = 0;

/** Delivery time in Plausible is not occurrence time. Use the DB cohort report for cross-day conversion. */
export function ActivationAnalytics() {
  const pathname = usePathname();
  useEffect(() => {
    let active = true;
    async function relay() {
      if (
        !active ||
        !analyticsEnabled() ||
        document.visibilityState === "hidden" ||
        inFlight ||
        Date.now() - lastCheck < 30_000
      )
        return;
      inFlight = true;
      lastCheck = Date.now();
      try {
        const response = await fetch("/api/v1/analytics/milestones", {
          method: "POST",
          signal: AbortSignal.timeout(10_000),
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ protocol: 2 }),
        });
        if (!response.ok) return;
        const batch = (await response.json()) as { claimToken?: string; events?: ClaimedEvent[] };
        if (!batch.claimToken) return;
        const delivered: string[] = [];
        for (const event of batch.events ?? []) {
          const key = `simplepost:milestone:${event.eventId}`;
          let already = false;
          try {
            already = localStorage.getItem(key) === "1";
          } catch {
            /* Best effort across reloads. */
          }
          if (already) {
            delivered.push(event.kind);
            continue;
          }
          const ok = await new Promise<boolean>((resolve) =>
            trackEvent(event.name, event.props, (result) =>
              resolve(!!result?.status && result.status >= 200 && result.status < 300 && !result.dropped),
            ),
          );
          if (ok) {
            delivered.push(event.kind);
            try {
              localStorage.setItem(key, "1");
            } catch {
              /* DB receipt still prevents repeats. */
            }
          }
        }
        await fetch("/api/v1/analytics/milestones", {
          method: "POST",
          signal: AbortSignal.timeout(10_000),
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          keepalive: true,
          body: JSON.stringify({ protocol: 2, claimToken: batch.claimToken, delivered }),
        });
      } catch {
        /* Lease expiry permits recovery without interrupting the app. */
      } finally {
        inFlight = false;
      }
    }
    void relay();
    const timer = window.setInterval(() => void relay(), 60_000);
    const focus = () => void relay();
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", focus);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", focus);
    };
  }, [pathname]);
  return null;
}
