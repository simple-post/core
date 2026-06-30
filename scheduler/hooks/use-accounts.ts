"use client";

import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query-client";
import type { ConnectedAccount } from "@/types";

interface AccountsResponse {
  accounts: ConnectedAccount[];
}

async function fetchAccounts(): Promise<ConnectedAccount[]> {
  const response = await fetch("/api/v1/accounts");
  if (!response.ok) {
    throw new Error("Failed to fetch accounts");
  }
  const data: AccountsResponse = await response.json();
  return data.accounts || [];
}

export function useAccounts() {
  return useQuery({
    queryKey: queryKeys.accounts,
    queryFn: fetchAccounts,
  });
}
