import { createHash } from "node:crypto";

import {
  OPENAI_ADS_KINDS,
  openAiAdsConfigured,
  openAiMilestoneEvents,
  relayOpenAiMilestones,
  type MeasurementRow,
} from "@/lib/analytics/openai-ads";
import { prisma } from "@/lib/prisma";

jest.mock("@/lib/prisma", () => ({ prisma: { openAiAdsMeasurement: { findMany: jest.fn(), updateMany: jest.fn() } } }));

const now = new Date("2026-10-29T12:00:00Z");
const at = (seconds: number) => new Date(now.getTime() + seconds * 1000);
function row(): MeasurementRow {
  return {
    userId: "user_1",
    permissionGrantedAt: at(-3600),
    permissionRevokedAt: null,
    clickReference: null,
    clickCapturedAt: null,
    reportedKinds: [],
    skippedKinds: [],
    nextAttemptAt: at(-60),
    leaseToken: null,
    leaseExpiresAt: null,
    attempts: 0,
    lastError: null,
    createdAt: at(-3600),
    updatedAt: at(-3600),
    user: {
      id: "user_1",
      email: " Buyer@Example.com ",
      acquisition: '{"source":"chatgpt"}',
      freeTrial: { startsAt: at(-3000) },
      activationMilestone: { socialConnectedAt: at(-2000), firstPostPublishedAt: at(-1000) },
      firstPayment: { paidAt: at(-100), planKey: "advanced", amountPaid: 1900, currency: "eur" },
    },
  };
}

describe("four OpenAI acquisition milestones", () => {
  const savedEnv = { ...process.env };
  const originalFetch = global.fetch;
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(now);
    process.env.NEXT_PUBLIC_APP_URL = "https://app.simplepost.social";
    process.env.OPENAI_ADS_MEASUREMENT_ENABLED = "true";
    process.env.OPENAI_ADS_PIXEL_ID = "pixel_test";
    process.env.OPENAI_CONVERSIONS_API_KEY = "test-only-key";
    process.env.SELF_HOSTED = "false";
    jest.mocked(prisma.openAiAdsMeasurement.findMany).mockReset();
    jest.mocked(prisma.openAiAdsMeasurement.updateMany).mockReset().mockResolvedValue({ count: 1 });
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });
  });
  afterEach(() => {
    process.env = { ...savedEnv };
    global.fetch = originalFetch;
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("maps actual trial, connection, publication and payment timestamps to the right shapes", () => {
    const result = openAiMilestoneEvents(row(), now);
    expect(result.events.map((item) => item.kind)).toEqual(OPENAI_ADS_KINDS);
    expect(result.events.map((item) => [item.event.type, item.event.custom_event_name, item.event.data.type])).toEqual([
      ["trial_started", undefined, "plan_enrollment"],
      ["custom", "social_account_connected", "custom"],
      ["custom", "first_post_published", "custom"],
      ["subscription_created", undefined, "plan_enrollment"],
    ]);
    expect(result.events.map((item) => item.event.timestamp_ms)).toEqual(
      [-3000, -2000, -1000, -100].map((s) => at(s).getTime()),
    );
    expect(result.events[3].event.data).toEqual({
      type: "plan_enrollment",
      plan_id: "advanced",
      amount: 1900,
      currency: "EUR",
    });
    const emailHash = createHash("sha256").update("buyer@example.com").digest("hex");
    for (const { event } of result.events) {
      expect(event.user.emails_sha256).toEqual([emailHash]);
      expect(event.opt_out).toBe(true);
      expect(event.id).not.toContain("user_1");
    }
    expect(JSON.stringify(result)).not.toMatch(/Buyer@Example|buyer@example|user_1/);
    expect(new Set(result.events.map((item) => item.event.id)).size).toBe(4);
  });

  it("uses stable per-customer per-kind IDs across retries and older payment corrections", () => {
    const value = row();
    const first = openAiMilestoneEvents(value, now).events;
    value.user.firstPayment!.paidAt = at(-200);
    expect(openAiMilestoneEvents(value, at(10)).events.map((item) => item.event.id)).toEqual(
      first.map((item) => item.event.id),
    );
  });

  it("includes only a permitted click that predates the event and is within 30 days", () => {
    const value = row();
    value.clickReference = "Opaque+/unchanged==";
    value.clickCapturedAt = at(-1500);
    const events = openAiMilestoneEvents(value, now).events;
    expect(events.map(({ event }) => event.oppref)).toEqual([
      undefined,
      undefined,
      value.clickReference,
      value.clickReference,
    ]);
    value.clickCapturedAt = at(-31 * 86_400);
    expect(openAiMilestoneEvents(value, now).events.every(({ event }) => !event.oppref)).toBe(true);
    value.clickCapturedAt = null;
    expect(openAiMilestoneEvents(value, now).events.every(({ event }) => !event.oppref)).toBe(true);
  });

  it("does not infer milestones from signup, a draft or a subscription access grant", () => {
    const value = row();
    value.user.freeTrial = null;
    value.user.activationMilestone = null;
    value.user.firstPayment = null;
    expect(openAiMilestoneEvents(value, now).events).toEqual([]);
  });

  it("handles a payment weeks after trial without dropping the recent payment event", () => {
    const value = row();
    value.createdAt = value.permissionGrantedAt = at(-30 * 86_400);
    value.user.freeTrial!.startsAt = at(-20 * 86_400);
    expect(openAiMilestoneEvents(value, now).events.map((item) => item.kind)).toContain("subscription_created");
    expect(openAiMilestoneEvents(value, now).skipped).toEqual(["trial_started"]);
  });

  it.each(["revoked", "future-grant", "legacy", "empty-email"])("fails closed for %s", (condition) => {
    const value = row();
    if (condition === "revoked") value.permissionRevokedAt = at(-10);
    if (condition === "future-grant") value.permissionGrantedAt = at(1);
    if (condition === "legacy") value.user.acquisition = null;
    if (condition === "empty-email") value.user.email = " ";
    expect(openAiMilestoneEvents(value, now).events).toEqual([]);
  });

  it("never backfills events before permission or before the permission row existed", () => {
    const value = row();
    value.createdAt = at(-1500);
    const result = openAiMilestoneEvents(value, now);
    expect(result.skipped).toEqual(["trial_started", "social_account_connected"]);
    expect(result.events.map((item) => item.kind)).toEqual(["first_post_published", "subscription_created"]);
  });

  it("skips already delivered/expired events and defers impossible future timestamps", () => {
    const value = row();
    value.reportedKinds = ["trial_started"];
    value.skippedKinds = ["social_account_connected"];
    value.user.activationMilestone!.firstPostPublishedAt = at(1);
    value.user.firstPayment!.paidAt = at(-7 * 86_400);
    expect(openAiMilestoneEvents(value, now)).toEqual({ events: [], skipped: ["subscription_created"] });
  });

  it("leaves a safety margin before the upstream seven-day ingestion limit", () => {
    const value = row();
    value.createdAt = value.permissionGrantedAt = at(-8 * 86_400);
    value.user.freeTrial!.startsAt = at(-7 * 86_400 + 5 * 60);
    expect(openAiMilestoneEvents(value, now).skipped).toEqual(["trial_started"]);
    value.user.freeTrial!.startsAt = at(-7 * 86_400 + 15 * 60);
    expect(openAiMilestoneEvents(value, now).events.map(({ kind }) => kind)).toContain("trial_started");
  });

  it.each([{ amountPaid: 0 }, { amountPaid: -1 }, { amountPaid: 1.1 }, { planKey: "trial" }, { currency: "invalid" }])(
    "rejects invalid payment %j",
    (override) => {
      const value = row();
      Object.assign(value.user.firstPayment!, override);
      expect(openAiMilestoneEvents(value, now).events.map((item) => item.kind)).not.toContain("subscription_created");
    },
  );

  it.each([
    ["OPENAI_ADS_MEASUREMENT_ENABLED", "false"],
    ["OPENAI_ADS_PIXEL_ID", ""],
    ["OPENAI_CONVERSIONS_API_KEY", ""],
    ["NEXT_PUBLIC_APP_URL", "http://localhost:3000"],
    ["NEXT_PUBLIC_APP_URL", "https://preview.example.com"],
    ["SELF_HOSTED", "true"],
    ["NODE_ENV", "development"],
  ])("does no database or network work when %s=%s", async (name, value) => {
    process.env[name] = value;
    expect(openAiAdsConfigured()).toBe(false);
    expect(await relayOpenAiMilestones(now)).toEqual({ sent: 0, failed: false });
    expect(prisma.openAiAdsMeasurement.findMany).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  function queue(value = row()) {
    jest
      .mocked(prisma.openAiAdsMeasurement.findMany)
      .mockResolvedValueOnce([{ userId: value.userId }] as never)
      .mockResolvedValueOnce([value] as never);
  }
  it("sends one bounded batch and records delivery only after success", async () => {
    queue();
    expect(await relayOpenAiMilestones(now)).toEqual({ sent: 4, failed: false });
    expect(global.fetch).toHaveBeenCalledWith(
      "https://bzr.openai.com/v1/events?pid=pixel_test",
      expect.objectContaining({
        method: "POST",
        redirect: "error",
        signal: expect.any(AbortSignal),
        headers: expect.objectContaining({ Authorization: "Bearer test-only-key" }),
        body: JSON.stringify({ events: openAiMilestoneEvents(row(), now).events.map((item) => item.event) }),
      }),
    );
    expect(prisma.openAiAdsMeasurement.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: "user_1", leaseToken: expect.any(String), permissionRevokedAt: null }),
        data: expect.objectContaining({
          reportedKinds: { push: [...OPENAI_ADS_KINDS] },
          lastError: null,
          leaseToken: null,
        }),
      }),
    );
  });

  it("does not send without an existing permission record", async () => {
    jest.mocked(prisma.openAiAdsMeasurement.findMany).mockResolvedValueOnce([]);
    expect(await relayOpenAiMilestones(now)).toEqual({ sent: 0, failed: false });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(prisma.openAiAdsMeasurement.updateMany).not.toHaveBeenCalled();
  });

  it("rechecks permission after claiming, so a revoked or concurrently claimed row cannot send", async () => {
    jest
      .mocked(prisma.openAiAdsMeasurement.findMany)
      .mockResolvedValueOnce([{ userId: "user_1" }] as never)
      .mockResolvedValueOnce([]);
    expect(await relayOpenAiMilestones(now)).toEqual({ sent: 0, failed: false });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(prisma.openAiAdsMeasurement.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ permissionRevokedAt: null }) }),
    );
  });

  it.each(["network", "HTTP"])(
    "retains retry eligibility after %s failure without leaking upstream details",
    async (failure) => {
      queue();
      if (failure === "network") jest.mocked(global.fetch).mockRejectedValue(new Error("secret upstream payload"));
      else jest.mocked(global.fetch).mockResolvedValue({ ok: false, status: 503 } as never);
      expect(await relayOpenAiMilestones(now)).toEqual({
        sent: 0,
        failed: true,
        error: failure === "network" ? "OpenAI measurement request failed" : "OpenAI measurement HTTP 503",
      });
      const data = jest.mocked(prisma.openAiAdsMeasurement.updateMany).mock.calls[1][0].data;
      expect(data.reportedKinds).toEqual({ push: [] });
      expect(data.nextAttemptAt).toEqual(at(60));
      expect(JSON.stringify(data)).not.toMatch(/secret|test-only-key|buyer@example/);
    },
  );

  it("isolates a rejected event while acknowledging the other milestones", async () => {
    queue();
    jest.mocked(global.fetch).mockImplementation(async (_url, init) => {
      const events = JSON.parse(init!.body as string).events as { custom_event_name?: string }[];
      const rejected = events.some((event) => event.custom_event_name === "social_account_connected");
      return { ok: !rejected, status: rejected ? 400 : 200 } as Response;
    });
    expect(await relayOpenAiMilestones(now)).toEqual({ sent: 3, failed: true, error: "OpenAI measurement HTTP 400" });
    expect(prisma.openAiAdsMeasurement.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reportedKinds: { push: ["trial_started", "first_post_published", "subscription_created"] },
          skippedKinds: { push: ["social_account_connected"] },
          nextAttemptAt: new Date("9999-01-01T00:00:00Z"),
          lastError: "OpenAI measurement HTTP 400",
        }),
      }),
    );
    const signals = jest.mocked(global.fetch).mock.calls.map(([, init]) => init!.signal);
    expect(new Set(signals).size).toBe(1);
  });

  it.each([401, 403, 429, 503])("does not multiply requests for HTTP %s failures", async (status) => {
    queue();
    jest.mocked(global.fetch).mockResolvedValue({ ok: false, status } as Response);
    expect(await relayOpenAiMilestones(now)).toEqual({
      sent: 0,
      failed: true,
      error: `OpenAI measurement HTTP ${status}`,
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it.each([200, 400, 503])("releases the unread response body for HTTP %s", async (status) => {
    const value = row();
    value.user.activationMilestone = null;
    value.user.firstPayment = null;
    queue(value);
    const response = new Response("ignored upstream details", { status });
    const cancel = jest.spyOn(response.body!, "cancel").mockResolvedValue();
    jest.mocked(global.fetch).mockResolvedValue(response);
    await relayOpenAiMilestones(now);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("bounds validation isolation to seventeen requests", async () => {
    const rows = Array.from({ length: 50 }, (_, i) => {
      const value = row();
      value.userId = value.user.id = `user_${i}`;
      return value;
    });
    jest
      .mocked(prisma.openAiAdsMeasurement.findMany)
      .mockResolvedValueOnce(rows.map(({ userId }) => ({ userId })) as never)
      .mockResolvedValueOnce(rows as never);
    jest.mocked(global.fetch).mockResolvedValue({ ok: false, status: 400 } as Response);
    expect(await relayOpenAiMilestones(now)).toEqual(expect.objectContaining({ sent: 0, failed: true }));
    expect(global.fetch).toHaveBeenCalledTimes(17);
    for (const call of jest.mocked(prisma.openAiAdsMeasurement.updateMany).mock.calls.slice(1))
      expect(call[0].data.skippedKinds).toEqual({ push: [] });
  });

  it("does not start split requests after the shared time budget expires", async () => {
    queue();
    const controller = new AbortController();
    jest.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    jest.mocked(global.fetch).mockImplementation(async () => {
      controller.abort();
      return { ok: false, status: 400 } as Response;
    });
    expect(await relayOpenAiMilestones(now)).toEqual({
      sent: 0,
      failed: true,
      error: "OpenAI measurement delivery deferred",
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("preserves successful delivery and retries untried events when slow isolation exhausts the shared budget", async () => {
    queue();
    const controller = new AbortController();
    jest.spyOn(AbortSignal, "timeout").mockImplementation(() => {
      setTimeout(() => controller.abort(), 3000);
      return controller.signal;
    });
    jest.mocked(global.fetch).mockImplementation(
      (_url, init) =>
        new Promise((resolve, reject) => {
          const events = JSON.parse(init!.body as string).events as { custom_event_name?: string }[];
          const bad = events.some((event) => event.custom_event_name === "social_account_connected");
          const timer = setTimeout(
            () => resolve({ ok: !bad, status: bad ? 400 : 200 } as Response),
            bad && events.length === 1 ? 3000 : 500,
          );
          init!.signal!.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              reject(new Error("aborted"));
            },
            { once: true },
          );
        }),
    );
    const result = relayOpenAiMilestones(now);
    await jest.advanceTimersByTimeAsync(3100);
    expect(await result).toEqual({ sent: 1, failed: true, error: "OpenAI measurement request failed" });
    expect(global.fetch).toHaveBeenCalledTimes(4);
    expect(prisma.openAiAdsMeasurement.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ reportedKinds: { push: ["trial_started"] }, skippedKinds: { push: [] } }),
      }),
    );
  });
});
