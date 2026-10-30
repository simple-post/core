import { syncAdsPermission } from "@/lib/analytics/ads-permission";
import { prisma } from "@/lib/prisma";

jest.mock("@/lib/prisma", () => ({
  prisma: { openAiAdsMeasurement: { createMany: jest.fn(), updateMany: jest.fn() } },
}));
const now = new Date("2026-10-30T12:00:00Z");
beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers().setSystemTime(now);
});
afterEach(() => jest.useRealTimers());
it.each([undefined, true])(
  "does not enroll or regrant from stale allowed cookies or an explicit grant (%s)",
  async (choice) => {
    await syncAdsPermission("user", "sp_ads_permission_v1=allowed; sp_ads_click_v1=stale", choice);
    expect(prisma.openAiAdsMeasurement.createMany).not.toHaveBeenCalled();
    expect(prisma.openAiAdsMeasurement.updateMany).not.toHaveBeenCalled();
  },
);
it("does nothing without a saved choice", async () => {
  await syncAdsPermission("user", "");
  expect(prisma.openAiAdsMeasurement.createMany).not.toHaveBeenCalled();
  expect(prisma.openAiAdsMeasurement.updateMany).not.toHaveBeenCalled();
});
it.each([undefined, false])("only revokes existing permission and clears matching data (%s)", async (choice) => {
  await syncAdsPermission("user", "sp_ads_permission_v1=declined", choice);
  expect(prisma.openAiAdsMeasurement.updateMany).toHaveBeenCalledWith({
    where: { userId: "user", permissionRevokedAt: null },
    data: { permissionRevokedAt: now, clickReference: null, clickCapturedAt: null },
  });
  expect(prisma.openAiAdsMeasurement.createMany).not.toHaveBeenCalled();
});
