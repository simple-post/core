import { prisma } from "../prisma";

import { readAdsPreference } from "./ads-preference";

/** Enrollment is closed. Only withdrawal of an existing permission is supported. */
export async function syncAdsPermission(userId: string, cookie: string, explicitChoice?: boolean) {
  const declined =
    explicitChoice === false || (explicitChoice === undefined && readAdsPreference(cookie) === "declined");
  if (!declined) return;
  await prisma.openAiAdsMeasurement.updateMany({
    where: { userId, permissionRevokedAt: null },
    data: { permissionRevokedAt: new Date(), clickReference: null, clickCapturedAt: null },
  });
}
