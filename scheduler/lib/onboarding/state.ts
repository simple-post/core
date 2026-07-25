import { prisma } from "@/lib/prisma";

export interface OnboardingState {
  hasConnectedAccount: boolean;
  /** A post that was actually scheduled or published. A draft is not enough. */
  hasPost: boolean;
  /** Any live MCP, CLI, or API credential: the user has wired up an assistant. */
  hasAiConnection: boolean;
}

/**
 * Progress through the three things a new user has to do before SimplePost is
 * useful. Derived entirely from real data rather than a stored checklist, so a
 * user who arrives through the MCP server or CLI is already counted as done.
 */
export async function getOnboardingState(userId: string, now: Date = new Date()): Promise<OnboardingState> {
  const [connectedAccounts, posts, mcpTokens, cliTokens, apiKeys] = await Promise.all([
    prisma.connectedAccount.count({ where: { userId }, take: 1 }),
    prisma.post.count({ where: { userId, status: { not: "draft" } }, take: 1 }),
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
    hasPost: posts > 0,
    hasAiConnection: mcpTokens > 0 || cliTokens > 0 || apiKeys > 0,
  };
}
