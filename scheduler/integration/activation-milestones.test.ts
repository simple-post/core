import { claimMilestoneEvents } from "@/lib/analytics/activation";
import { createFirstTouch } from "@/lib/analytics/first-touch";
import { prisma } from "@/lib/prisma";

const tracked = "activation-review-user";
const legacy = "activation-legacy-user";
const signup = new Date("2026-09-27T08:00:00Z");

async function reset() {
  await prisma.user.deleteMany({ where: { id: { in: [tracked, legacy] } } });
  await prisma.mcpOAuthClient.deleteMany({ where: { clientId: "activation-review-client" } });
}

beforeEach(async () => {
  await reset();
  await prisma.user.create({
    data: {
      id: tracked,
      name: "Activation Test",
      email: "activation-review@example.com",
      createdAt: signup,
      acquisition: JSON.stringify(
        createFirstTouch("https://simplepost.social/ai/claude/?utm_source=google", "", signup),
      ),
    },
  });
  await prisma.user.create({
    data: { id: legacy, name: "Legacy", email: "activation-legacy@example.com", createdAt: signup },
  });
  await prisma.mcpOAuthClient.create({
    data: { clientId: "activation-review-client", name: "Claude", redirectUris: ["https://claude.ai/callback"] },
  });
});
afterAll(async () => {
  await reset();
  await prisma.$disconnect();
});

function account(userId: string, platform: string, createdAt: Date) {
  return prisma.connectedAccount.create({
    data: { userId, platform, platformAccountId: `${platform}-${userId}`, accessToken: "encrypted", createdAt },
  });
}

it("records first milestones from every write path and keeps the earliest time", async () => {
  await prisma.mcpAccessToken.create({
    data: {
      tokenHash: "activation-hash",
      clientId: "activation-review-client",
      userId: tracked,
      expiresAt: new Date("2026-12-31"),
      createdAt: new Date("2026-09-27T09:00:00Z"),
    },
  });
  await prisma.cliToken.create({
    data: { userId: tracked, tokenHash: "activation-cli", expiresAt: new Date("2026-12-31") },
  });
  await account(tracked, "linkedin", new Date("2026-09-27T09:30:00Z"));
  await account(tracked, "x", new Date("2026-09-27T09:10:00Z"));
  const draft = await prisma.post.create({ data: { userId: tracked, message: "Draft", status: "draft" } });
  await prisma.post.update({ where: { id: draft.id }, data: { status: "scheduled" } });
  await prisma.post.update({ where: { id: draft.id }, data: { status: "pending" } });
  await prisma.post.update({
    where: { id: draft.id },
    data: { status: "published", publishedAt: new Date("2026-09-27T12:00:00Z") },
  });
  await prisma.post.create({
    data: { userId: tracked, message: "Later", status: "published", publishedAt: new Date("2026-09-28T12:00:00Z") },
  });

  const row = await prisma.activationMilestone.findUniqueOrThrow({ where: { userId: tracked } });
  expect(row).toMatchObject({
    signupCompletedAt: signup,
    aiConnectedAt: new Date("2026-09-27T09:00:00Z"),
    aiClient: "Claude",
    socialConnectedAt: new Date("2026-09-27T09:10:00Z"),
    socialPlatform: "x",
    firstPostPublishedAt: new Date("2026-09-27T12:00:00Z"),
  });
  expect(row.firstPostCreatedAt).toEqual(draft.createdAt);
  expect(row.firstPostScheduledAt).not.toBeNull();

  const events = await claimMilestoneEvents(tracked);
  expect(events.map((event) => event.name)).toEqual([
    "Signup Completed",
    "AI Integration Connected",
    "Social Account Connected",
    "First Post Created",
    "First Post Scheduled",
    "First Post Published",
  ]);
  expect(events[1].props).toEqual({ landing_page: "/ai/claude", landing_category: "ai_client", client: "claude" });
  expect(await claimMilestoneEvents(tracked)).toEqual([]);
});

it("hands each milestone to only one of several concurrent claims", async () => {
  const results = await Promise.all(Array.from({ length: 8 }, () => claimMilestoneEvents(tracked)));
  expect(results.flat().map((event) => event.name)).toEqual(["Signup Completed"]);
});

it("ignores legacy accounts without acquisition data", async () => {
  await account(legacy, "bluesky", new Date());
  await prisma.post.create({ data: { userId: legacy, message: "Old customer", status: "published" } });
  expect(await prisma.activationMilestone.findUnique({ where: { userId: legacy } })).toBeNull();
  expect(await claimMilestoneEvents(legacy)).toEqual([]);
});

it("records the first payment and removes milestones with the account", async () => {
  await prisma.firstPayment.create({
    data: {
      userId: tracked,
      stripeInvoiceId: "in_activation",
      stripeSubscriptionId: "sub_activation",
      paidAt: new Date("2026-10-04T10:00:00Z"),
      amountPaid: 900,
      currency: "usd",
    },
  });
  const row = await prisma.activationMilestone.findUniqueOrThrow({ where: { userId: tracked } });
  expect(row.subscriptionStartedAt).toEqual(new Date("2026-10-04T10:00:00Z"));
  const claimed = await claimMilestoneEvents(tracked);
  expect(claimed.map((event) => event.kind)).not.toContain("subscription_started");
  await prisma.user.delete({ where: { id: tracked } });
  expect(await prisma.activationMilestone.count({ where: { userId: tracked } })).toBe(0);
});
