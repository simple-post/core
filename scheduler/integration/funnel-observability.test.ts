import { NextRequest } from "next/server";

import { GET as funnelReport } from "@/app/api/admin/analytics/funnel/route";
import { acknowledgeMilestones, claimMilestoneEvents } from "@/lib/analytics/activation";
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
it("deduplicates events and advances tool and post-attempt milestones without storing content", async () => {
  await Promise.all(
    Array.from({ length: 8 }, () =>
      recordFunnelEvent(id, "post_create_attempted", {
        key: "one-request",
        properties: { tool: "create_post", message: "private", email: "secret@example.invalid" },
      }),
    ),
  );
  const result = { content: [{ type: "text" as const, text: "Private post content" }] };
  expect(await measureMcpTool({ userId: id }, "create_post", async () => result)).toBe(result);
  const row = await prisma.activationMilestone.findUniqueOrThrow({ where: { userId: id } });
  expect(row.firstToolCalledAt).not.toBeNull();
  expect(row.firstToolSucceededAt).not.toBeNull();
  expect(row.firstPostAttemptedAt).not.toBeNull();
  const events = await prisma.funnelEvent.findMany({ where: { userId: id } });
  expect(events.filter((x) => x.kind === "post_create_attempted")).toHaveLength(2);
  expect(JSON.stringify(events)).not.toMatch(/Private post|secret@example|"message"/);
});
it("records failed tool outcomes while preserving returned errors and thrown failures", async () => {
  const result = { isError: true, content: [{ type: "text" as const, text: "private error" }] };
  expect(await measureMcpTool({ userId: id }, "list_accounts", async () => result)).toBe(result);
  const error = new Error("private failure");
  await expect(
    measureMcpTool({ userId: id }, "list_accounts", async () => {
      throw error;
    }),
  ).rejects.toBe(error);
  expect(await prisma.funnelEvent.count({ where: { userId: id, kind: "tool_failed" } })).toBe(2);
  expect(await prisma.funnelEvent.count({ where: { userId: id, kind: "tool_succeeded" } })).toBe(0);
});
it("retains post milestones and durable events after deleting a post, and cascades account deletion", async () => {
  const first = await prisma.post.create({
    data: { userId: id, message: "private", status: "published", publishedAt: new Date("2026-10-01T11:00:00Z") },
  });
  const second = await prisma.post.create({
    data: { userId: id, message: "private", status: "published", publishedAt: new Date("2026-10-02T08:00:00Z") },
  });
  await prisma.post.deleteMany({ where: { id: { in: [first.id, second.id] } } });
  const row = await prisma.activationMilestone.findUniqueOrThrow({ where: { userId: id } });
  expect(row.secondPublishingDayAt).toEqual(new Date("2026-10-02T08:00:00Z"));
  expect(await prisma.funnelEvent.count({ where: { userId: id, kind: "post_published" } })).toBe(2);
  await prisma.user.delete({ where: { id } });
  expect(await prisma.funnelEvent.count({ where: { userId: id } })).toBe(0);
});
it("recovers an abandoned delivery lease and rejects receipts from its former owner", async () => {
  const now = new Date();
  const first = await claimMilestoneEvents(id, now);
  const recovered = await claimMilestoneEvents(id, new Date(now.getTime() + 121_000));
  expect(first.claimToken).not.toBe(recovered.claimToken);
  expect(recovered.events.map((x) => x.eventId)).toEqual(first.events.map((x) => x.eventId));
  await acknowledgeMilestones(
    id,
    first.claimToken!,
    first.events.map((x) => x.kind),
  );
  const observation1 = await prisma.activationMilestone.findUniqueOrThrow({ where: { userId: id } });
  expect(observation1.reportedKinds).toEqual([]);
  await acknowledgeMilestones(
    id,
    recovered.claimToken!,
    recovered.events.map((x) => x.kind),
  );
  const observation2 = await claimMilestoneEvents(id);
  expect(observation2.events).toEqual([]);
});
it("excludes marked internal accounts from both event paths and browser delivery", async () => {
  await prisma.funnelEvent.deleteMany({ where: { userId: id } });
  await prisma.user.update({ where: { id }, data: { analyticsExcluded: true } });
  await recordFunnelEvent(id, "tool_called");
  await prisma.post.create({ data: { userId: id, message: "internal", status: "draft" } });
  expect(await prisma.funnelEvent.count({ where: { userId: id } })).toBe(0);
  const observation3 = await claimMilestoneEvents(id);
  expect(observation3.events).toEqual([]);
});

it("serves verified operators aggregated cohort and outcome data without account identity", async () => {
  await prisma.user.create({
    data: {
      id: "funnel-review-operator",
      name: "Operator",
      email: "funnel-operator@example.invalid",
      isAdmin: true,
      emailVerified: true,
    },
  });
  await recordFunnelEvent(id, "tool_failed", {
    channel: "mcp",
    properties: { tool: "create_post", reason: "VALIDATION_ERROR", client: "chatgpt" },
  });
  await prisma.user.update({ where: { id }, data: { createdAt: new Date("2010-02-03") } });
  const day = "2010-02-03";
  const response = await funnelReport(
    new NextRequest(`http://localhost:3000/api/admin/analytics/funnel?from=${day}&to=${day}`),
  );
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.quality.signups).toBe(1);
  expect(body.breakdown).toContainEqual(
    expect.objectContaining({ kind: "tool_failed", tool: "create_post", reason: "VALIDATION_ERROR", attempts: 1 }),
  );
  expect(JSON.stringify(body)).not.toMatch(/funnel-review@example|funnel-observability-review|funnel-review-operator/);
});
