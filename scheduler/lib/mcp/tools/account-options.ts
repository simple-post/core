import { prisma } from "@/lib/prisma";

import type { AccountOptionsMap } from "@simple-post/sdk";

/** Apply MCP posting defaults only to the authenticated user's TikTok targets. */
export async function resolveMcpAccountOptions(
  userId: string,
  accountIds: string[],
  accountOptions?: AccountOptionsMap,
  media: ReadonlyArray<{ type: string }> = [],
): Promise<AccountOptionsMap | undefined> {
  const accounts = await prisma.connectedAccount.findMany({
    where: { userId, id: { in: accountIds } },
    select: { id: true, platform: true },
  });
  let resolved = accountOptions;
  for (const account of accounts) {
    if (account.platform.toLowerCase() !== "tiktok") continue;
    const options = accountOptions?.[account.id];
    const defaults: Record<string, unknown> = {};
    // Legacy visibility is an explicit privacy choice too. Never override it,
    // or turn an explicitly requested TikTok inbox upload into a direct post.
    if (options?.privacyLevel === undefined && options?.visibility === undefined && options?.publishMode !== "draft") {
      defaults.privacyLevel = "PUBLIC_TO_EVERYONE";
    }
    if (
      media.length > 0 &&
      media.every((item) => item.type === "image") &&
      options?.publishMode !== "draft" &&
      options?.autoAddMusic === undefined
    ) {
      defaults.autoAddMusic = true;
    }
    if (Object.keys(defaults).length === 0) continue;
    resolved = {
      ...resolved,
      [account.id]: { ...options, ...defaults },
    };
  }
  return resolved;
}
