"use client";

import { useEffect, useState } from "react";

import { usePathname } from "next/navigation";

import { captureAdsClick, readAdsPreference, saveAdsPreference } from "@/lib/analytics/ads-preference";

export function AdsPrivacyControl() {
  const pathname = usePathname();
  const [enabled, setEnabled] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/analytics/ads-measurement", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data?.enabled) return;
        setEnabled(true);
        if (data.preference === "declined") saveAdsPreference(false);
        const preference = readAdsPreference(document.cookie);
        setOpen(!preference);
        captureAdsClick();
        if (preference)
          void fetch("/api/analytics/ads-measurement", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sync: true }),
          }).catch(() => {});
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  async function choose(allowed: boolean) {
    setBusy(true);
    setError("");
    try {
      saveAdsPreference(allowed);
      const response = await fetch("/api/analytics/ads-measurement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allowed }),
      });
      if (!response.ok) throw new Error("Save failed");
      setOpen(false);
    } catch {
      setError("Could not save your preference. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  // Keep checkout and billing flows unchanged.
  if (!enabled || pathname.startsWith("/admin") || pathname.startsWith("/billing") || pathname === "/subscribe")
    return null;
  return (
    <aside
      aria-label="Advertising privacy"
      className="fixed bottom-4 left-4 z-50 max-w-sm rounded-xl border border-border bg-background p-4 text-sm text-foreground shadow-lg">
      {open ? (
        <>
          <p>
            Allow ad measurement? With your permission, we share trial, connection, publication and subscription events,
            a hashed email and available ad click references with OpenAI to measure our ads.
          </p>
          <p className="mt-2">
            <a href="/privacy" className="underline">
              Privacy policy
            </a>
            . You can change this here at any time.
          </p>
          <div className="mt-3 flex gap-3">
            <button
              disabled={busy}
              className="rounded border border-border px-3 py-2"
              onClick={() => void choose(false)}>
              Decline
            </button>
            <button
              disabled={busy}
              className="rounded border border-border px-3 py-2"
              onClick={() => void choose(true)}>
              Allow measurement
            </button>
          </div>
          <p role="status">{error}</p>
        </>
      ) : (
        <button onClick={() => setOpen(true)}>Ad privacy preferences</button>
      )}
    </aside>
  );
}
