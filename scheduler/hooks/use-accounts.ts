"use client";
import { useQuery } from "@tanstack/react-query";

import type { SourceCopy } from "@/lib/i18n/source-copy";
import { useUiCopy } from "@/lib/i18n/use-ui-copy";
import { queryKeys } from "@/lib/query-client";
import { ApiResponseError } from "@/lib/utils/api-response-error";
import type { ConnectedAccount } from "@/types";

interface AccountsResponse {
  accounts: ConnectedAccount[];
}

async function fetchAccounts(copy: SourceCopy): Promise<ConnectedAccount[]> {
  const response = await fetch("/api/v1/accounts");
  if (!response.ok) {
    throw new ApiResponseError(
      await response.json().catch(() => null),
      copy("Failed to fetch accounts"),
      response.status,
    );
  }
  const data: AccountsResponse = await response.json();
  return data.accounts || [];
}

export function useAccounts() {
  const { copy } = useUiCopy();
  return useQuery({
    queryKey: queryKeys.accounts,
    queryFn: () => fetchAccounts(copy),
  });
}
