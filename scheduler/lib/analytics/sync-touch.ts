import { prisma } from "@/lib/prisma";

import { LAST_NON_DIRECT_COOKIE, readFirstTouch } from "./first-touch";

/** First touch is immutable; the latest identifiable touch is separate and not an authorization claim. */
export async function syncLastNonDirectTouch(userId: string, cookie: string) {
  const touch = readFirstTouch(cookie, new Date(), LAST_NON_DIRECT_COOKIE);
  if (!touch || ["direct", "unknown"].includes(touch.source)) return;
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { lastNonDirectAcquisition: true } });
    if (!user) return;
    let current: { firstSeenAt?: string } = {};
    try {
      current = JSON.parse(user.lastNonDirectAcquisition || "{}");
    } catch {
      /* Replace invalid optional metadata. */
    }
    if (current?.firstSeenAt && Date.parse(current.firstSeenAt) >= Date.parse(touch.firstSeenAt)) return;
    await prisma.user.updateMany({
      where: { id: userId, lastNonDirectAcquisition: user.lastNonDirectAcquisition },
      data: { lastNonDirectAcquisition: JSON.stringify(touch) },
    });
  } catch {
    /* Attribution must not delay or break product work. */
  }
}
