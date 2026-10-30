import { prisma } from "../prisma";

import { readAdsPreference } from "./ads-preference";
import { openAiAdsConfigured } from "./openai-ads";

/** Explicit opt-outs remain authoritative; this never re-enables an existing row. */
export async function syncAdsPermission(userId: string, cookie: string, explicitChoice?: boolean) {
  const declined =
    explicitChoice === false || (explicitChoice === undefined && readAdsPreference(cookie) === "declined");
  if (!declined) return;
  const now = new Date();
  // Persist opt-out even if it races signup enrollment or a recovery pass.
  await prisma.openAiAdsMeasurement.createMany({
    data: [{ userId, enrollmentMode: "automatic", permissionGrantedAt: null, permissionRevokedAt: now }],
    skipDuplicates: true,
  });
  await prisma.openAiAdsMeasurement.updateMany({
    where: { userId, permissionRevokedAt: null },
    data: { permissionRevokedAt: now, clickReference: null, clickCapturedAt: null },
  });
}

/** Called for newly created accounts, without a prompt or advertising cookies. */
export async function enrollOpenAiMeasurement(userId: string, cookie: string) {
  if (!openAiAdsConfigured()) return;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isAdmin: true, analyticsExcluded: true, email: true },
  });
  if (!user || user.isAdmin || user.analyticsExcluded || user.email === "demo@simplepost.social") return;
  const declined = readAdsPreference(cookie) === "declined";
  await prisma.openAiAdsMeasurement.createMany({
    data: [
      {
        userId,
        enrollmentMode: "automatic",
        permissionGrantedAt: null,
        ...(declined ? { permissionRevokedAt: new Date() } : {}),
      },
    ],
    skipDuplicates: true,
  });
  if (declined) await syncAdsPermission(userId, cookie, false);
}
