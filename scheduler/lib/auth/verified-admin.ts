import { isAnalyticsAdmin } from "@/lib/analytics/report";
import { prisma } from "@/lib/prisma";

/** Read the current grant, not a cached auth-session claim, so revocation is immediate. */
export async function hasVerifiedAdminAccess(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isAdmin: true, emailVerified: true },
  });
  return isAnalyticsAdmin(user);
}
