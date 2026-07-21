import type { AccountOptionsMap } from "@/types";

export function mergeAccountOptions(
  options: AccountOptionsMap,
  accountId: string,
  updates: Record<string, unknown>,
): AccountOptionsMap {
  const nextAccountOptions = {
    ...((options[accountId] ?? {}) as Record<string, unknown>),
    ...updates,
  };

  for (const [key, value] of Object.entries(nextAccountOptions)) {
    if (value === undefined || value === "") {
      delete nextAccountOptions[key];
    }
  }

  return {
    ...options,
    [accountId]: nextAccountOptions,
  };
}
