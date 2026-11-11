"use client";

import { useEffect, useState } from "react";

import { saveAdsPreference } from "@/lib/analytics/ads-preference";
import { useUiCopy } from "@/lib/i18n/use-ui-copy";

/** Privacy-page control for previous participants; never offers or creates enrollment. */
export function AdsMeasurementWithdrawal() {
  const { copy } = useUiCopy();
  const [preference, setPreference] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/analytics/ads-measurement", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled) setPreference(data?.preference ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  async function withdraw() {
    setBusy(true);
    setFailed(false);
    try {
      const response = await fetch("/api/analytics/ads-measurement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allowed: false }),
      });
      if (!response.ok) throw new Error("Withdrawal failed");
      saveAdsPreference(false);
      setPreference("declined");
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  if (!preference) return null;
  return (
    <div className="mt-4 text-sm">
      {preference === "allowed" ? (
        <button className="rounded border border-border px-3 py-2" disabled={busy} onClick={() => void withdraw()}>
          {copy("Stop sharing conversion events")}
        </button>
      ) : (
        <p role="status">{copy("Ad measurement is off for your account.")}</p>
      )}
      {failed && <p role="status">{copy("Could not save your preference. Please try again.")}</p>}
    </div>
  );
}
