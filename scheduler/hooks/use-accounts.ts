import { useCallback, useEffect, useState } from "react";
import type { ConnectedAccount } from "@/types";

export function useAccounts() {
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch("/api/accounts");
      if (!response.ok) {
        throw new Error("Failed to load accounts");
      }
      const data = await response.json();
      setAccounts(data.accounts || []);
    } catch (err) {
      console.error("Failed to load accounts:", err);
      setError(err instanceof Error ? err.message : "Failed to load accounts");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { accounts, loading, error, refresh };
}
