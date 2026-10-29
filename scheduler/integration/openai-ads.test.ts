import { OPENAI_ADS_KINDS, relayOpenAiMilestones } from "@/lib/analytics/openai-ads";
import { prisma } from "@/lib/prisma";

const userId = "openai-ads-review-user";
const now = new Date("2026-10-29T12:00:00Z");
const at = (seconds: number) => new Date(now.getTime() + seconds * 1000);
const savedEnv = { ...process.env };
const originalFetch = global.fetch;

beforeEach(async () => {
  await prisma.user.deleteMany({ where: { id: userId } });
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
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
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
  expect(await relayOpenAiMilestones(now)).toEqual({ sent: 0, failed: true });
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
