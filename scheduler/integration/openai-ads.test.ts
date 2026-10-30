import { enrollOpenAiMeasurement, syncAdsPermission } from "@/lib/analytics/ads-permission";
import { OPENAI_ADS_KINDS, relayOpenAiMilestones } from "@/lib/analytics/openai-ads";
import { prisma } from "@/lib/prisma";

const userId = "openai-ads-review-user";
const now = new Date("2026-10-29T12:00:00Z");
const at = (seconds: number) => new Date(now.getTime() + seconds * 1000);
const savedEnv = { ...process.env };
const originalFetch = global.fetch;

beforeEach(async () => {
  await prisma.user.deleteMany({ where: { id: { startsWith: "openai-ads-review-" } } });
  process.env.NEXT_PUBLIC_APP_URL = "https://app.simplepost.social";
  process.env.OPENAI_ADS_MEASUREMENT_ENABLED = "true";
  process.env.OPENAI_ADS_PIXEL_ID = "pixel_test";
  process.env.OPENAI_CONVERSIONS_API_KEY = "test-only-key";
  process.env.SELF_HOSTED = "false";
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });
  await prisma.user.create({
    data: {
      id: userId,
      name: "Measurement Test",
      email: "openai-ads-review@example.com",
      createdAt: at(-3600),
      acquisition: '{"version":1,"source":"chatgpt"}',
      openAiAdsMeasurement: {
        create: { permissionGrantedAt: at(-3500), createdAt: at(-3500), nextAttemptAt: at(-60) },
      },
      freeTrial: { create: { startsAt: at(-3000), expiresAt: at(7 * 86_400) } },
    },
  });
});
afterEach(() => {
  process.env = { ...savedEnv };
  global.fetch = originalFetch;
});
afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { startsWith: "openai-ads-review-" } } });
  await prisma.$disconnect();
});

it("never enrolls new accounts from concurrent stale allowed cookies or explicit grants", async () => {
  await prisma.openAiAdsMeasurement.delete({ where: { userId } });
  const header = "sp_ads_permission_v1=allowed; sp_ads_click_v1=stale";
  await Promise.all([syncAdsPermission(userId, header), syncAdsPermission(userId, header, true)]);
  expect(await prisma.openAiAdsMeasurement.findUnique({ where: { userId } })).toBeNull();
  expect(await relayOpenAiMilestones()).toEqual({ sent: 0, failed: false });
});

it("preserves prior consent and delivery history, then prevents regrant after withdrawal", async () => {
  await prisma.openAiAdsMeasurement.update({ where: { userId }, data: { clickReference: "prior-click" } });
  const delivery = await relayOpenAiMilestones(now);
  expect(delivery.sent).toBe(1);
  await syncAdsPermission(userId, "", false);
  await syncAdsPermission(userId, "sp_ads_permission_v1=allowed", true);
  const permission = await prisma.openAiAdsMeasurement.findUniqueOrThrow({ where: { userId } });
  expect(permission.permissionRevokedAt).not.toBeNull();
  expect(permission.clickReference).toBeNull();
  expect(permission.reportedKinds).toEqual(["trial_started"]);
});

it("persists an opt-out before automatic enrollment or recovery can run", async () => {
  await prisma.openAiAdsMeasurement.delete({ where: { userId } });
  await syncAdsPermission(userId, "", false);
  await enrollOpenAiMeasurement(userId, "");
  const optedOut = await prisma.openAiAdsMeasurement.findUniqueOrThrow({ where: { userId } });
  expect(optedOut.permissionRevokedAt).not.toBeNull();
  expect(optedOut.enrollmentMode).toBe("automatic");
});

it("automatically enrolls and delivers a missed trial without inventing consent", async () => {
  await prisma.openAiAdsMeasurement.delete({ where: { userId } });
  await prisma.freeTrial.update({ where: { userId }, data: { startsAt: new Date() } });
  await enrollOpenAiMeasurement(userId, "");
  const row = await prisma.openAiAdsMeasurement.findUniqueOrThrow({ where: { userId } });
  expect(row.enrollmentMode).toBe("automatic");
  expect(row.permissionGrantedAt).toBeNull();
  expect(await relayOpenAiMilestones()).toEqual({ sent: 1, failed: false });
  await syncAdsPermission(userId, "", false);
  await enrollOpenAiMeasurement(userId, "");
  const optedOut = await prisma.openAiAdsMeasurement.findUniqueOrThrow({ where: { userId } });
  expect(optedOut.permissionRevokedAt).not.toBeNull();
  await expect(
    prisma.openAiAdsMeasurement.update({ where: { userId }, data: { permissionRevokedAt: null } }),
  ).rejects.toThrow();
});

async function reachMilestones() {
  await prisma.connectedAccount.create({
    data: {
      userId,
      platform: "linkedin",
      platformAccountId: "ads-review-linkedin",
      accessToken: "test-encrypted",
      createdAt: at(-2000),
    },
  });
  await prisma.connectedAccount.create({
    data: {
      userId,
      platform: "x",
      platformAccountId: "ads-review-x",
      accessToken: "test-encrypted",
      createdAt: at(-1900),
    },
  });
  const post = await prisma.post.create({ data: { userId, status: "draft", message: "Private test content" } });
  await prisma.post.update({ where: { id: post.id }, data: { status: "scheduled" } });
  await prisma.post.update({ where: { id: post.id }, data: { status: "published", publishedAt: at(-1000) } });
  await prisma.post.create({ data: { userId, status: "published", message: "Later post", publishedAt: at(-900) } });
  await prisma.firstPayment.create({
    data: {
      userId,
      stripeInvoiceId: "in_ads_review",
      stripeSubscriptionId: "sub_ads_review",
      paidAt: at(-100),
      amountPaid: 1900,
      currency: "eur",
      planKey: "advanced",
    },
  });
}
function sentEvents() {
  return JSON.parse(jest.mocked(global.fetch).mock.calls[0][1]!.body as string).events as {
    id: string;
    type: string;
    custom_event_name?: string;
    timestamp_ms: number;
  }[];
}

it("relays each actual database milestone once across repeated dispatches", async () => {
  await reachMilestones();
  expect(await relayOpenAiMilestones(now)).toEqual({ sent: 4, failed: false });
  expect(await relayOpenAiMilestones(at(61))).toEqual({ sent: 0, failed: false });
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(sentEvents().map((event) => event.custom_event_name || event.type)).toEqual(OPENAI_ADS_KINDS);
  expect(sentEvents().map((event) => event.timestamp_ms)).toEqual(
    [-3000, -2000, -1000, -100].map((s) => at(s).getTime()),
  );
  const delivery = await prisma.openAiAdsMeasurement.findUniqueOrThrow({ where: { userId } });
  expect(delivery.reportedKinds).toEqual([...OPENAI_ADS_KINDS]);
  expect(delivery.leaseToken).toBeNull();
});

it("uses a database lease so concurrent dispatchers send one batch", async () => {
  await reachMilestones();
  jest.mocked(global.fetch).mockImplementation(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    return { ok: true, status: 200 } as Response;
  });
  const results = await Promise.all(Array.from({ length: 4 }, () => relayOpenAiMilestones(now)));
  expect(results.reduce((sum, result) => sum + result.sent, 0)).toBe(4);
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

it("retries failed delivery with the same event IDs and original timestamps", async () => {
  await reachMilestones();
  jest.mocked(global.fetch).mockResolvedValueOnce({ ok: false, status: 503 } as Response);
  expect(await relayOpenAiMilestones(now)).toEqual({ sent: 0, failed: true, error: "OpenAI measurement HTTP 503" });
  const first = sentEvents();
  const delivery = await prisma.openAiAdsMeasurement.findUniqueOrThrow({ where: { userId } });
  expect(delivery.reportedKinds).toEqual([]);
  expect(delivery.lastError).toBe("OpenAI measurement HTTP 503");
  expect(await relayOpenAiMilestones(at(61))).toEqual({ sent: 4, failed: false });
  const retried = JSON.parse(jest.mocked(global.fetch).mock.calls[1][1]!.body as string).events;
  expect(retried).toEqual(first);
});

it("stops pending retries when permission is revoked", async () => {
  jest.mocked(global.fetch).mockResolvedValueOnce({ ok: false, status: 503 } as Response);
  await relayOpenAiMilestones(now);
  await prisma.openAiAdsMeasurement.update({ where: { userId }, data: { permissionRevokedAt: now } });
  expect(await relayOpenAiMilestones(at(61))).toEqual({ sent: 0, failed: false });
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

it("does not send drafts or repeatedly connected accounts as extra milestones", async () => {
  await prisma.post.create({ data: { userId, status: "draft", message: "Not published" } });
  expect(await relayOpenAiMilestones(now)).toEqual({ sent: 1, failed: false });
  expect(sentEvents().map((event) => event.type)).toEqual(["trial_started"]);
  await reachMilestones();
  expect(await relayOpenAiMilestones(at(61))).toEqual({ sent: 3, failed: false });
  const delivery = await prisma.openAiAdsMeasurement.findUniqueOrThrow({ where: { userId } });
  expect(delivery.reportedKinds).toEqual([...OPENAI_ADS_KINDS]);
});

it("does not auto-create permission rows for trial users", async () => {
  await prisma.openAiAdsMeasurement.delete({ where: { userId } });
  await reachMilestones();
  expect(await relayOpenAiMilestones(now)).toEqual({ sent: 0, failed: false });
  expect(global.fetch).not.toHaveBeenCalled();
});

it("does not let idle users consume the fifty-row candidate limit", async () => {
  const ids = Array.from({ length: 51 }, (_, i) => `openai-ads-review-idle-${i}`);
  await prisma.user.createMany({
    data: ids.map((id) => ({ id, name: "Idle Test", email: `${id}@example.com`, acquisition: '{"source":"direct"}' })),
  });
  await prisma.openAiAdsMeasurement.createMany({
    data: ids.map((id) => ({
      userId: id,
      permissionGrantedAt: at(-3500),
      createdAt: at(-3500),
      nextAttemptAt: at(-300),
      reportedKinds: ["trial_started"],
    })),
  });
  await prisma.freeTrial.createMany({
    data: ids.map((id) => ({ userId: id, startsAt: at(-3000), expiresAt: at(86_400) })),
  });
  expect(await relayOpenAiMilestones(now)).toEqual({ sent: 1, failed: false });
  expect(sentEvents().map((event) => event.type)).toEqual(["trial_started"]);
  expect(await prisma.openAiAdsMeasurement.count({ where: { userId: { in: ids }, leaseToken: { not: null } } })).toBe(
    0,
  );
});

it("picks up a payment immediately when an idle trial user reaches that milestone", async () => {
  await prisma.openAiAdsMeasurement.update({ where: { userId }, data: { reportedKinds: ["trial_started"] } });
  expect(await relayOpenAiMilestones(now)).toEqual({ sent: 0, failed: false });
  await prisma.firstPayment.create({
    data: {
      userId,
      stripeInvoiceId: "in_late",
      stripeSubscriptionId: "sub_late",
      paidAt: at(-1),
      amountPaid: 1900,
      currency: "eur",
      planKey: "advanced",
    },
  });
  expect(await relayOpenAiMilestones(now)).toEqual({ sent: 1, failed: false });
  expect(sentEvents()[0].type).toBe("subscription_created");
});

it("records valid events from other users and permanently isolates a proven invalid event", async () => {
  await reachMilestones();
  const otherId = "openai-ads-review-other";
  await prisma.user.create({
    data: {
      id: otherId,
      name: "Other Test",
      email: "other@example.com",
      acquisition: '{"source":"direct"}',
      openAiAdsMeasurement: {
        create: { permissionGrantedAt: at(-3500), createdAt: at(-3500), nextAttemptAt: at(-60) },
      },
      freeTrial: { create: { startsAt: at(-3000), expiresAt: at(86_400) } },
    },
  });
  jest.mocked(global.fetch).mockImplementation(async (_url, init) => {
    const events = JSON.parse(init!.body as string).events as { custom_event_name?: string }[];
    const invalid = events.some((event) => event.custom_event_name === "social_account_connected");
    return { ok: !invalid, status: invalid ? 400 : 200 } as Response;
  });
  expect(await relayOpenAiMilestones(now)).toEqual({ sent: 4, failed: true, error: "OpenAI measurement HTTP 400" });
  const delivery = await prisma.openAiAdsMeasurement.findUniqueOrThrow({ where: { userId } });
  const other = await prisma.openAiAdsMeasurement.findUniqueOrThrow({ where: { userId: otherId } });
  expect(delivery.reportedKinds).toEqual(["trial_started", "first_post_published", "subscription_created"]);
  expect(delivery.skippedKinds).toEqual(["social_account_connected"]);
  expect(other.reportedKinds).toEqual(["trial_started"]);
  jest
    .mocked(global.fetch)
    .mockClear()
    .mockResolvedValue({ ok: true, status: 200 } as Response);
  expect(await relayOpenAiMilestones(at(61))).toEqual({ sent: 0, failed: false });
  expect(global.fetch).not.toHaveBeenCalled();
});

it.each(["Pacific/Auckland", "America/Los_Angeles"])(
  "keeps permission instants correct in a %s session",
  async (timezone) => {
    await prisma.openAiAdsMeasurement.delete({ where: { userId } });
    const [value] = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('TimeZone', ${timezone}, true)`;
      return tx.$queryRaw<
        { permissionGrantedAt: Date; createdAt: Date; nextAttemptAt: Date; updatedAt: Date; reference: Date }[]
      >`
      INSERT INTO "openai_ads_measurement" ("userId", "permissionGrantedAt")
      VALUES (${userId}, CURRENT_TIMESTAMP)
      RETURNING "permissionGrantedAt", "createdAt", "nextAttemptAt", "updatedAt", CURRENT_TIMESTAMP AS reference
    `;
    });
    for (const time of [value.permissionGrantedAt, value.createdAt, value.nextAttemptAt, value.updatedAt])
      expect(Math.abs(time.getTime() - value.reference.getTime())).toBeLessThanOrEqual(1);
  },
);

it("permanently skips an invalid first-payment record rather than polling it indefinitely", async () => {
  await prisma.openAiAdsMeasurement.update({ where: { userId }, data: { reportedKinds: ["trial_started"] } });
  await prisma.firstPayment.create({
    data: {
      userId,
      stripeInvoiceId: "in_unknown",
      stripeSubscriptionId: "sub_unknown",
      paidAt: at(-100),
      amountPaid: 1900,
      currency: "eur",
      planKey: null,
    },
  });
  expect(await relayOpenAiMilestones(now)).toEqual({ sent: 0, failed: false });
  const delivery = await prisma.openAiAdsMeasurement.findUniqueOrThrow({ where: { userId } });
  expect(delivery.skippedKinds).toEqual(["subscription_created"]);
  expect(await relayOpenAiMilestones(at(61))).toEqual({ sent: 0, failed: false });
  expect(global.fetch).not.toHaveBeenCalled();
});

it("requires a new grant after revocation and excludes milestones reached during revocation", async () => {
  await prisma.openAiAdsMeasurement.update({
    where: { userId },
    data: { permissionRevokedAt: at(-2000), reportedKinds: ["trial_started"] },
  });
  await expect(
    prisma.openAiAdsMeasurement.update({ where: { userId }, data: { permissionRevokedAt: null } }),
  ).rejects.toThrow();
  await prisma.firstPayment.create({
    data: {
      userId,
      stripeInvoiceId: "in_revoked",
      stripeSubscriptionId: "sub_revoked",
      paidAt: at(-100),
      amountPaid: 1900,
      currency: "eur",
      planKey: "advanced",
    },
  });
  await prisma.openAiAdsMeasurement.update({
    where: { userId },
    data: { permissionRevokedAt: null, permissionGrantedAt: now },
  });
  expect(await relayOpenAiMilestones(now)).toEqual({ sent: 0, failed: false });
  expect(global.fetch).not.toHaveBeenCalled();
  const delivery = await prisma.openAiAdsMeasurement.findUniqueOrThrow({ where: { userId } });
  expect(delivery.reportedKinds).toEqual(["trial_started"]);
  expect(delivery.skippedKinds).toEqual(["subscription_created"]);
});
