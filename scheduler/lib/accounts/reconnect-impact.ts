import { prisma } from "@/lib/prisma";

/** Count affected queued targets without fetching post content or another user's data. */
export async function getReconnectImpact(userId: string, accountIds: string[]): Promise<Map<string, number>> {
  const counts = new Map(accountIds.map((id) => [id, 0]));
  if (accountIds.length === 0) return counts;
  const posts = await prisma.post.findMany({
    where: { userId, status: { in: ["scheduled", "pending"] }, accounts: { some: { id: { in: accountIds } } } },
    select: { accounts: { where: { id: { in: accountIds } }, select: { id: true } }, accountResults: true },
  });
  for (const post of posts) {
    const outcomes = post.accountResults as Record<string, { success?: boolean }> | null;
    for (const account of post.accounts) {
      // A partial-post retry must not count an already published target as at risk.
      if (outcomes?.[account.id]?.success !== true) counts.set(account.id, (counts.get(account.id) ?? 0) + 1);
    }
  }
  return counts;
}
