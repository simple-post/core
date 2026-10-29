jest.mock("@/lib/prisma", () => ({ prisma: { $executeRaw: jest.fn() } }));
import { funnelProperties, measurementFailure, recordFunnelEvent } from "@/lib/analytics/events";
import { prisma } from "@/lib/prisma";
it("accepts only bounded technical labels and finite numeric measurements", () => {
  expect(
    funnelProperties({
      tool: "create_post",
      platform: "instagram",
      durationMs: 42,
      email: "person@example.com",
      message: "private",
      reason: "person@example.com",
      url: "https://private",
      amountPaid: Number.NaN,
    }),
  ).toEqual({ tool: "create_post", platform: "instagram", durationMs: 42 });
  expect(measurementFailure(new Error("private"))).toBe("unknown_error");
});
it("cannot turn measurement errors into failed product operations", async () => {
  (prisma.$executeRaw as jest.Mock).mockRejectedValue(new Error("not available"));
  await expect(recordFunnelEvent("u", "checkout_created")).resolves.toBeUndefined();
});
