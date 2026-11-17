"use client";

import { useCallback, useEffect, useState } from "react";

export function useStoredOnboardingDismissal(storageKey: string | null) {
  const [preference, setPreference] = useState<{ key: string; dismissed: boolean } | null>(null);

  useEffect(() => {
    if (!storageKey) return;

    let dismissed = false;
    try {
      dismissed = window.localStorage.getItem(storageKey) === "true";
    } catch {
      // Setup can still be dismissed in a host that blocks browser storage.
    }
    setPreference({ key: storageKey, dismissed });
  }, [storageKey]);

  const dismiss = useCallback(() => {
    if (!storageKey) return;
    setPreference({ key: storageKey, dismissed: true });
    try {
      window.localStorage.setItem(storageKey, "true");
    } catch {
      // Keep the dismissal in memory for this visit.
    }
  }, [storageKey]);

  const ready = preference !== null && preference.key === storageKey;
  return { dismissed: ready && preference.dismissed, dismiss, ready };
}
