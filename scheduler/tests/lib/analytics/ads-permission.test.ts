import { syncAdsPermission } from "@/lib/analytics/ads-permission";
import { openAiAdsConfigured } from "@/lib/analytics/openai-ads";
import { prisma } from "@/lib/prisma";

jest.mock("@/lib/analytics/openai-ads", () => ({ openAiAdsConfigured: jest.fn(() => true) }));
jest.mock("@/lib/prisma", () => ({
  prisma: { openAiAdsMeasurement: { createMany: jest.fn(), updateMany: jest.fn() } },
}));
const now = new Date("2026-10-29T12:00:00Z");
const reference = "Opaque+/unchanged==";
const clickCookie = `sp_ads_permission_v1=allowed; sp_ads_click_v1=${encodeURIComponent(JSON.stringify({ reference, capturedAt: new Date(now.getTime() - 1000).toISOString() }))}`;
beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers().setSystemTime(now);
  jest.mocked(openAiAdsConfigured).mockReturnValue(true);
});
afterEach(() => {
  jest.useRealTimers();
});
it("does not enroll anyone without an explicit saved preference or production configuration", async () => {
  await syncAdsPermission("user", "");
  jest.mocked(openAiAdsConfigured).mockReturnValue(false);
  await syncAdsPermission("user", clickCookie, true);
  expect(prisma.openAiAdsMeasurement.createMany).not.toHaveBeenCalled();
  expect(prisma.openAiAdsMeasurement.updateMany).not.toHaveBeenCalled();
});
it("enrolls before milestones using server time and preserves the click without modifying it", async () => {
  await syncAdsPermission("user", clickCookie);
  expect(prisma.openAiAdsMeasurement.createMany).toHaveBeenCalledWith({
    data: [
      {
        userId: "user",
        permissionGrantedAt: now,
        clickReference: reference,
        clickCapturedAt: new Date(now.getTime() - 1000),
      },
    ],
    skipDuplicates: true,
  });
  expect(prisma.openAiAdsMeasurement.updateMany).toHaveBeenCalledTimes(1);
  expect(prisma.openAiAdsMeasurement.updateMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({ permissionRevokedAt: null }),
      data: expect.objectContaining({ clickReference: reference }),
    }),
  );
});
it("does not regrant a revoked account on login from a stale allowed browser", async () => {
  await syncAdsPermission("user", clickCookie);
  expect(prisma.openAiAdsMeasurement.createMany).toHaveBeenCalledWith(
    expect.objectContaining({ skipDuplicates: true }),
  );
  expect(
    jest
      .mocked(prisma.openAiAdsMeasurement.updateMany)
      .mock.calls.every(([args]) => args?.where?.permissionRevokedAt === null),
  ).toBe(true);
});
it("withdraws account permission and removes click matching data", async () => {
  await syncAdsPermission("user", clickCookie, false);
  expect(prisma.openAiAdsMeasurement.updateMany).toHaveBeenCalledWith({
    where: { userId: "user", permissionRevokedAt: null },
    data: { permissionRevokedAt: now, clickReference: null, clickCapturedAt: null },
  });
  expect(prisma.openAiAdsMeasurement.createMany).toHaveBeenCalledWith({
    data: [{ userId: "user", permissionGrantedAt: now, permissionRevokedAt: now }],
    skipDuplicates: true,
  });
});
it("only a fresh explicit choice advances the permission window after withdrawal", async () => {
  await syncAdsPermission("user", clickCookie, true);
  expect(prisma.openAiAdsMeasurement.updateMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { userId: "user", permissionRevokedAt: { not: null } },
      data: expect.objectContaining({ permissionGrantedAt: now, permissionRevokedAt: null, nextAttemptAt: now }),
    }),
  );
});
