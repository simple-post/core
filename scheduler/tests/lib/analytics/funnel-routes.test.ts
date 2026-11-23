import { NextRequest } from "next/server";

import { GET as report } from "@/app/api/admin/analytics/funnel/route";
import { POST as observation } from "@/app/api/v1/analytics/events/route";
import { hasAnalyticsAdminAccess } from "@/lib/analytics/admin";
import { recordFunnelEvent } from "@/lib/analytics/events";
import { requireBrowserSession } from "@/lib/middleware/auth";
import { prisma } from "@/lib/prisma";
import { UnauthorizedError } from "@/lib/utils/errors";

jest.mock("@/lib/middleware/auth", () => ({ requireBrowserSession: jest.fn() }));
jest.mock("@/lib/analytics/admin", () => ({ hasAnalyticsAdminAccess: jest.fn() }));
jest.mock("@/lib/analytics/events", () => ({ recordFunnelEvent: jest.fn() }));
jest.mock("@/lib/prisma", () => ({
  prisma: { user: { findMany: jest.fn() }, funnelEvent: { groupBy: jest.fn() }, $queryRaw: jest.fn() },
}));
const request = (body: unknown, origin = "http://localhost:3000") =>
  new NextRequest("http://localhost:3000/api/v1/analytics/events", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  jest.resetAllMocks();
  delete process.env.SELF_HOSTED;
  jest.mocked(requireBrowserSession).mockResolvedValue({ user: { id: "current-user" } } as never);
  jest.mocked(hasAnalyticsAdminAccess).mockResolvedValue(true);
  jest.mocked(prisma.user.findMany).mockResolvedValue([]);
  jest.mocked(prisma.$queryRaw).mockResolvedValue([]);
});
it("requires current admin access and never queries reports for ordinary users", async () => {
  jest.mocked(hasAnalyticsAdminAccess).mockResolvedValue(false);
  const response = await report(new NextRequest("http://localhost:3000/api/admin/analytics/funnel"));
  expect(response.status).toBe(404);
  expect(prisma.user.findMany).not.toHaveBeenCalled();
});
it("does not allow unauthenticated report access", async () => {
  jest.mocked(requireBrowserSession).mockRejectedValue(new UnauthorizedError("Authentication required"));
  const response = await report(new NextRequest("http://localhost:3000/api/admin/analytics/funnel"));
  expect(response.status).toBe(401);
  expect(prisma.user.findMany).not.toHaveBeenCalled();
});
it("uses excluded-account filters and rejects invalid cohort windows", async () => {
  const invalid = await report(new NextRequest("http://localhost:3000/api/admin/analytics/funnel?window=365"));
  expect(invalid.status).toBe(400);
  expect(prisma.user.findMany).not.toHaveBeenCalled();
  const response = await report(
    new NextRequest("http://localhost:3000/api/admin/analytics/funnel?from=2026-10-01&to=2026-10-28&window=7"),
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(prisma.user.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({ isAdmin: false, analyticsExcluded: false, email: expect.any(Object) }),
    }),
  );
});
it.each([null, [], { kind: "first_payment" }, { kind: "post_published" }])(
  "browser observations cannot assert authoritative facts: %p",
  async (body) => {
    const response = await observation(request(body));
    expect(response.status).toBe(400);
    expect(recordFunnelEvent).not.toHaveBeenCalled();
  },
);
it("uses only the session identity and bounded properties for browser observations", async () => {
  const response = await observation(
    request({ kind: "plan_viewed", plan: "basic", userId: "forged", email: "private" }),
  );
  expect(response.status).toBe(200);
  expect(recordFunnelEvent).toHaveBeenCalledWith(
    "current-user",
    "plan_viewed",
    expect.objectContaining({ properties: { plan: "basic" } }),
  );
});
it("rejects foreign-origin observations", async () => {
  const response = await observation(request({ kind: "plan_viewed" }, "https://foreign.example"));
  expect(response.status).toBe(403);
  expect(recordFunnelEvent).not.toHaveBeenCalled();
});
it("distinguishes database failure from bad dates", async () => {
  jest.mocked(prisma.user.findMany).mockRejectedValue(new Error("unavailable"));
  const failed = await report(new NextRequest("http://localhost:3000/api/admin/analytics/funnel"));
  expect(failed.status).toBe(500);
  const invalid = await report(new NextRequest("http://localhost:3000/api/admin/analytics/funnel?from=bad"));
  expect(invalid.status).toBe(400);
});
