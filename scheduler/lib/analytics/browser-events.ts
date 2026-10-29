import { analyticsEnabled, trackEvent } from "./plausible";

/** Bounded first-party observations; never submit identity or arbitrary event properties. */
export function trackBrowserFunnelEvent(kind: "plan_viewed" | "assistant_authorization_cancelled", plan?: string) {
  if (!analyticsEnabled()) return;
  trackEvent(kind === "plan_viewed" ? "Plan Viewed" : "AI Authorization Cancelled", plan ? { plan } : undefined);
  void fetch("/api/v1/analytics/events", {
    method: "POST",
    credentials: "same-origin",
    keepalive: true,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, plan }),
  }).catch(() => {});
}
