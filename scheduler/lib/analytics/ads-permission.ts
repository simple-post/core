import { prisma } from "../prisma";

import { readAdsClick, readAdsPreference } from "./ads-preference";
import { openAiAdsConfigured } from "./openai-ads";

/** Called before the first trial can start. Existing revocations require a fresh explicit choice. */
export async function syncAdsPermission(userId: string, cookie: string, explicitChoice?: boolean) {
  if (!openAiAdsConfigured()) return;
  const preference = explicitChoice === undefined ? readAdsPreference(cookie) : explicitChoice ? "allowed" : "declined";
  if (!preference) return;
  const now = new Date();
  if (preference === "declined") {
    await prisma.openAiAdsMeasurement.createMany({
      data: [{ userId, permissionGrantedAt: now, permissionRevokedAt: now }],
      skipDuplicates: true,
    });
    await prisma.openAiAdsMeasurement.updateMany({
      where: { userId, permissionRevokedAt: null },
      data: { permissionRevokedAt: now, clickReference: null, clickCapturedAt: null },
    });
    return;
  }
  const click = readAdsClick(cookie, now);
  // Do not trust browser timestamps as permission dates or backdate existing milestones.
  await prisma.openAiAdsMeasurement.createMany({
    data: [
      {
        userId,
        permissionGrantedAt: now,
        ...(click ? { clickReference: click.reference, clickCapturedAt: click.capturedAt } : {}),
      },
    ],
    skipDuplicates: true,
  });
  if (explicitChoice === true) {
    await prisma.openAiAdsMeasurement.updateMany({
      where: { userId, permissionRevokedAt: { not: null } },
      data: {
        permissionGrantedAt: now,
        permissionRevokedAt: null,
        nextAttemptAt: now,
        clickReference: null,
        clickCapturedAt: null,
      },
    });
  }
  if (click) {
    await prisma.openAiAdsMeasurement.updateMany({
      where: {
        userId,
        permissionRevokedAt: null,
        OR: [{ clickCapturedAt: null }, { clickCapturedAt: { lt: click.capturedAt } }],
      },
      data: { clickReference: click.reference, clickCapturedAt: click.capturedAt },
    });
  }
}
