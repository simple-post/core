import { prisma } from "@/lib/prisma";

import type { AccountOptionsMap } from "@simple-post/sdk";

/** Apply MCP posting defaults only to the authenticated user's TikTok targets. */
export async function resolveMcpAccountOptions(
  userId: string,
  accountIds: string[],
  accountOptions?: AccountOptionsMap,
): Promise<AccountOptionsMap | undefined> {
  const accounts = await prisma.connectedAccount.findMany({
    where: { userId, id: { in: accountIds } },
    select: { id: true, platform: true },
  });
  let resolved = accountOptions;
  for (const account of accounts) {
    if (account.platform.toLowerCase() !== "tiktok") continue;
    const options = accountOptions?.[account.id];
    // Legacy visibility is an explicit privacy choice too. Never override it,
    // or turn an explicitly requested TikTok inbox upload into a direct post.
    if (options?.privacyLevel !== undefined || options?.visibility !== undefined || options?.publishMode === "draft") {
      continue;
    }
    resolved = {
      ...resolved,
      [account.id]: { ...options, privacyLevel: "PUBLIC_TO_EVERYONE" },
    };
  }
  return resolved;
}
