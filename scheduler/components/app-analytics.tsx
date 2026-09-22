"use client";

import { useEffect, useRef } from "react";

import { usePathname } from "next/navigation";

import { captureFirstTouch } from "@/lib/analytics/first-touch";
import { trackEvent, trackOnce } from "@/lib/analytics/plausible";

export function AppAnalytics() {
  const pathname = usePathname();
  const previous = useRef<string | null>(null);
  useEffect(() => {
    if (pathname.startsWith("/admin/") || previous.current === pathname) return;
    previous.current = pathname;
    captureFirstTouch();
    trackEvent("pageview");
    trackOnce("app-opened", "App Opened");
    if (pathname === "/subscribe" && new URLSearchParams(window.location.search).get("checkout") === "cancelled") {
      trackOnce("checkout-cancelled", "Checkout Cancelled");
    }
  }, [pathname]);
  return null;
}
