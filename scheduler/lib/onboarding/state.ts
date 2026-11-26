import { prisma } from "@/lib/prisma";

export interface OnboardingState {
  hasConnectedAccount: boolean;
  /** A draft, scheduled post, or published post. */
  hasPost: boolean;
  /** A post successfully published to all of its destinations. */
  hasPublishedPost: boolean;
  /** Any live MCP, CLI, or API credential: the user has wired up an assistant. */
  hasAiConnection: boolean;
}

export async function hasOnboardingPost(userId: string): Promise<boolean> {
  return (
    (await prisma.post.count({ where: { userId, status: { in: ["draft", "scheduled", "published"] } }, take: 1 })) > 0
  );
}

/**
 * Progress through the milestones a new user completes before SimplePost is
 * useful. Derived entirely from real data rather than a stored checklist, so a
 * user who arrives through the MCP server or CLI is already counted as done.
 */
export async function getOnboardingState(userId: string, now: Date = new Date()): Promise<OnboardingState> {
  const [connectedAccounts, hasPost, publishedPosts, mcpTokens, cliTokens, apiKeys] = await Promise.all([
    prisma.connectedAccount.count({ where: { userId, workspaceId: null }, take: 1 }),
    hasOnboardingPost(userId),
    prisma.post.count({ where: { userId, status: "published" }, take: 1 }),
    prisma.mcpAccessToken.count({
      where: { userId, revokedAt: null, expiresAt: { gt: now } },
      take: 1,
    }),
    prisma.cliToken.count({
      where: { userId, revokedAt: null, expiresAt: { gt: now } },
      take: 1,
    }),
    prisma.apiKey.count({ where: { userId, revokedAt: null }, take: 1 }),
  ]);

  return {
    hasConnectedAccount: connectedAccounts > 0,
    hasPost,
    hasPublishedPost: publishedPosts > 0,
    hasAiConnection: mcpTokens > 0 || cliTokens > 0 || apiKeys > 0,
  };
}
