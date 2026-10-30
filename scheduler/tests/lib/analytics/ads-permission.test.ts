import { enrollOpenAiMeasurement, syncAdsPermission } from "@/lib/analytics/ads-permission";
import { openAiAdsConfigured } from "@/lib/analytics/openai-ads";
import { prisma } from "@/lib/prisma";
jest.mock("@/lib/analytics/openai-ads", () => ({ openAiAdsConfigured: jest.fn(() => true) }));

jest.mock("@/lib/prisma", () => ({
  prisma: { user: { findUnique: jest.fn() }, openAiAdsMeasurement: { createMany: jest.fn(), updateMany: jest.fn() } },
}));
const now = new Date("2026-10-30T12:00:00Z");
beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers().setSystemTime(now);
  jest.mocked(openAiAdsConfigured).mockReturnValue(true);
  jest
    .mocked(prisma.user.findUnique)
    .mockResolvedValue({ isAdmin: false, analyticsExcluded: false, email: "customer@example.invalid" } as never);
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

it("automatically enrolls a new account without an Allow cookie or consent timestamp", async () => {
  await enrollOpenAiMeasurement("user", "");
  expect(prisma.openAiAdsMeasurement.createMany).toHaveBeenCalledWith({
    data: [{ userId: "user", enrollmentMode: "automatic", permissionGrantedAt: null }],
    skipDuplicates: true,
  });
});
it("keeps a saved browser decline as an account opt-out", async () => {
  await enrollOpenAiMeasurement("user", "sp_ads_permission_v1=declined");
  expect(prisma.openAiAdsMeasurement.createMany).toHaveBeenCalledWith({
    data: [{ userId: "user", enrollmentMode: "automatic", permissionGrantedAt: null, permissionRevokedAt: now }],
    skipDuplicates: true,
  });
});
it("does not enroll when production measurement is disabled", async () => {
  jest.mocked(openAiAdsConfigured).mockReturnValue(false);
  await enrollOpenAiMeasurement("user", "");
  expect(prisma.openAiAdsMeasurement.createMany).not.toHaveBeenCalled();
});
it("does not enroll admin or excluded test accounts", async () => {
  jest.mocked(prisma.user.findUnique).mockResolvedValue({ isAdmin: false, analyticsExcluded: true } as never);
  await enrollOpenAiMeasurement("user", "");
  expect(prisma.openAiAdsMeasurement.createMany).not.toHaveBeenCalled();
});
