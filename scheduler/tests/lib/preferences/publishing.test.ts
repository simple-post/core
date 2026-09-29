import { readPublishingPreferences, updatePublishingPreferences } from "@/lib/preferences/publishing";
import { prisma } from "@/lib/prisma";
jest.mock("@/lib/prisma", () => ({
  prisma: {
    userPublishingPreferences: { findUnique: jest.fn(), upsert: jest.fn() },
    connectedAccount: { count: jest.fn() },
  },
}));
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(prisma.userPublishingPreferences.findUnique).mockResolvedValue(null);
});
it("returns UTC as unconfirmed until the user chooses a timezone", async () => {
  await expect(readPublishingPreferences("owner")).resolves.toEqual({
    timeZone: "UTC",
    timeZoneConfirmed: false,
    calendarView: "week",
    defaultAccountIds: [],
  });
});
it("validates timezone before any database mutation", async () => {
  await expect(updatePublishingPreferences("owner", { timeZone: "Mars/Olympus" })).rejects.toThrow("IANA timezone");
  expect(prisma.userPublishingPreferences.upsert).not.toHaveBeenCalled();
});
it("rejects default destinations belonging to another user", async () => {
  jest.mocked(prisma.connectedAccount.count).mockResolvedValue(0);
  await expect(updatePublishingPreferences("owner", { defaultAccountIds: ["foreign"] })).rejects.toThrow(
    "no longer connected",
  );
  expect(prisma.connectedAccount.count).toHaveBeenCalledWith({ where: { userId: "owner", id: { in: ["foreign"] } } });
  expect(prisma.userPublishingPreferences.upsert).not.toHaveBeenCalled();
});
it("deduplicates defaults and persists only fields being changed", async () => {
  jest.mocked(prisma.connectedAccount.count).mockResolvedValue(1);
  await updatePublishingPreferences("owner", { defaultAccountIds: ["a", "a"] });
  expect(prisma.userPublishingPreferences.upsert).toHaveBeenCalledWith({
    where: { userId: "owner" },
    create: { userId: "owner", defaultAccountIds: ["a"] },
    update: { defaultAccountIds: ["a"] },
  });
});
