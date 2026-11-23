import { NextRequest } from "next/server";

import { GET as funnelReport } from "@/app/api/admin/analytics/funnel/route";
import { claimMilestoneEvents } from "@/lib/analytics/activation";
import { recordFunnelEvent } from "@/lib/analytics/events";
import { measureMcpTool } from "@/lib/analytics/tool-measurement";
import { prisma } from "@/lib/prisma";
jest.mock("@/lib/middleware/auth", () => ({
  requireBrowserSession: async () => ({ user: { id: "funnel-review-operator" } }),
}));
const id = "funnel-observability-review";
beforeEach(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [id, "funnel-review-operator"] } } });
  await prisma.user.create({
    data: {
      id,
      name: "Review",
      email: "funnel-review@example.invalid",
      acquisition: JSON.stringify({ version: 1, source: "direct", measurementVersion: "funnel-v2" }),
    },
  });
});
afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [id, "funnel-review-operator"] } } });
  await prisma.$disconnect();
});
it("atomically deduplicates an observation and updates earliest milestones without retaining content", async () => {
  const at = new Date();
  await Promise.all(
    Array.from({ length: 8 }, () =>
      recordFunnelEvent(id, "tool_call", {
        key: "one-call",
        at,
        properties: { tool: "create_post", outcome: "succeeded", durationMs: 25, message: "private" },
      }),
    ),
  );
  const row = await prisma.activationMilestone.findUniqueOrThrow({ where: { userId: id } });
  expect(row.firstToolCalledAt).toEqual(at);
  expect(row.firstToolSucceededAt).toEqual(new Date(at.getTime() + 25));
  expect(row.firstPostAttemptedAt).toEqual(at);
  expect(await prisma.funnelEvent.count({ where: { userId: id } })).toBe(1);
  const before = await prisma.$queryRaw<
    Array<{ xmin: string }>
  >`SELECT xmin::text AS xmin FROM activation_milestone WHERE "userId"=${id}`;
  await recordFunnelEvent(id, "tool_call", {
    at: new Date(at.getTime() + 100),
    properties: { tool: "create_post", outcome: "succeeded", durationMs: 25 },
  });
  const after = await prisma.$queryRaw<
    Array<{ xmin: string }>
  >`SELECT xmin::text AS xmin FROM activation_milestone WHERE "userId"=${id}`;
  expect(after).toEqual(before);
  expect(JSON.stringify(await prisma.funnelEvent.findMany({ where: { userId: id } }))).not.toContain("private");
});
it("preserves tool results and thrown failures while recording one outcome per call", async () => {
  const result = { isError: true, content: [{ type: "text" as const, text: "private error" }] };
  expect(await measureMcpTool({ userId: id }, "list_accounts", async () => result)).toBe(result);
  const error = new Error("private failure");
  await expect(
    measureMcpTool({ userId: id }, "list_accounts", async () => {
      throw error;
    }),
  ).rejects.toBe(error);
  const events = await prisma.funnelEvent.findMany({ where: { userId: id } });
  expect(events).toHaveLength(2);
  expect(events.every((e) => (e.properties as { outcome: string }).outcome === "failed")).toBe(true);
});
it("keeps repeat-use milestones after deletion, including an earlier publication delivered late", async () => {
  await prisma.post.create({
    data: { userId: id, message: "private", status: "published", publishedAt: new Date("2026-10-03T10:00:00Z") },
  });
  await prisma.post.create({
    data: { userId: id, message: "private", status: "published", publishedAt: new Date("2026-10-01T10:00:00Z") },
  });
  await prisma.post.create({
    data: { userId: id, message: "private", status: "published", publishedAt: new Date("2026-10-02T10:00:00Z") },
  });
  await prisma.post.create({ data: { userId: id, message: "private", status: "failed" } });
  await prisma.post.deleteMany({ where: { userId: id } });
  const row = await prisma.activationMilestone.findUniqueOrThrow({ where: { userId: id } });
  expect(row.firstPostPublishedAt).toEqual(new Date("2026-10-01T10:00:00Z"));
  expect(row.secondPublishingDayAt).toEqual(new Date("2026-10-02T10:00:00Z"));
  expect(await prisma.funnelEvent.count({ where: { userId: id, kind: "post_failed" } })).toBe(1);
  expect(await prisma.funnelEvent.count({ where: { userId: id, kind: "post_published" } })).toBe(0);
});
it("excludes internal accounts from observations, tool milestones and browser claims", async () => {
  await prisma.user.update({ where: { id }, data: { analyticsExcluded: true } });
  await recordFunnelEvent(id, "tool_call", { properties: { tool: "create_post", outcome: "succeeded" } });
  await prisma.post.create({ data: { userId: id, message: "internal", status: "failed" } });
  expect(await prisma.funnelEvent.count({ where: { userId: id } })).toBe(0);
  expect(await claimMilestoneEvents(id)).toEqual([]);
  const row = await prisma.activationMilestone.findUniqueOrThrow({ where: { userId: id } });
  expect(row.firstToolCalledAt).toBeNull();
});
it("serves verified operators aggregates and outcome breakdowns without account identity", async () => {
  await prisma.user.create({
    data: {
      id: "funnel-review-operator",
      name: "Operator",
      email: "operator@example.invalid",
      isAdmin: true,
      emailVerified: true,
    },
  });
  await recordFunnelEvent(id, "tool_call", {
    channel: "mcp",
    properties: { tool: "create_post", outcome: "failed", reason: "VALIDATION_ERROR" },
  });
  await prisma.user.update({ where: { id }, data: { createdAt: new Date("2010-02-03") } });
  const response = await funnelReport(
    new NextRequest("http://localhost:3000/api/admin/analytics/funnel?from=2010-02-03&to=2010-02-03"),
  );
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.totals.signups).toBe(1);
  expect(body.totals.noTrial).toBe(1);
  expect(body.breakdown).toContainEqual(expect.objectContaining({ kind: "tool_call", outcome: "failed", attempts: 1 }));
  expect(JSON.stringify(body)).not.toContain(id);
});
