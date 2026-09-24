import type { AccountOverridesMap, ThreadSegment } from "@/types";

/**
 * Posts in the longest thread any target account will publish, root included.
 *
 * An account override can carry its own thread, so the shared thread alone
 * undercounts a post whose Bluesky copy is a thread while X gets one long post.
 * Kept free of server imports so the composer can share it.
 */
export function longestThreadLength(
  accountIds: string[],
  thread: ThreadSegment[] | null | undefined,
  accountOverrides: AccountOverridesMap | null | undefined,
): number {
  const sharedLength = thread?.length ?? 0;
  const lengths = accountIds.map((accountId) => accountOverrides?.[accountId]?.thread?.length ?? sharedLength);
  return (lengths.length > 0 ? Math.max(...lengths) : sharedLength) + 1;
}
