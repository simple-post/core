import { createHash, randomUUID } from "node:crypto";

import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";

import type { Prisma } from "@prisma/client";

export const OPENAI_ADS_KINDS = [
  "trial_started",
  "social_account_connected",
  "first_post_published",
  "subscription_created",
] as const;
type Kind = (typeof OPENAI_ADS_KINDS)[number];
const MAX_EVENT_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const EVENT_AGE_MARGIN_MS = 10 * 60 * 1000;
const POLL_INTERVAL_MS = 60_000;
const LEASE_MS = 30_000;
const BATCH_SIZE = 50;
const MAX_DELIVERY_REQUESTS = 17;

const userSelect = {
  id: true,
  email: true,
  acquisition: true,
  freeTrial: { select: { startsAt: true } },
  activationMilestone: { select: { socialConnectedAt: true, firstPostPublishedAt: true } },
  firstPayment: { select: { paidAt: true, planKey: true, amountPaid: true, currency: true } },
} satisfies Prisma.UserSelect;
const measurementInclude = { user: { select: userSelect } } satisfies Prisma.OpenAiAdsMeasurementInclude;
export type MeasurementRow = Prisma.OpenAiAdsMeasurementGetPayload<{ include: typeof measurementInclude }>;

export interface OpenAiAdsEvent {
  id: string;
  type: "trial_started" | "subscription_created" | "custom";
  custom_event_name?: "social_account_connected" | "first_post_published";
  timestamp_ms: number;
  action_source: "web";
  source_url: string;
  opt_out: true;
  oppref?: string;
  user: { emails_sha256: string[] };
  data: { type: "plan_enrollment" | "custom"; plan_id?: string; amount?: number; currency?: string };
}

/** Configuration is not customer permission. Both gates must pass independently. */
export function openAiAdsConfigured(): boolean {
  return (
    process.env.OPENAI_ADS_MEASUREMENT_ENABLED === "true" &&
    process.env.NODE_ENV === "production" &&
    env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "") === "https://app.simplepost.social" &&
    !env.SELF_HOSTED &&
    Boolean(process.env.OPENAI_ADS_PIXEL_ID && process.env.OPENAI_CONVERSIONS_API_KEY)
  );
}

/** Exact milestone timestamps, never polling time; never include post/account content. */
export function openAiMilestoneEvents(row: MeasurementRow, now = new Date()) {
  const events: { kind: Kind; event: OpenAiAdsEvent }[] = [];
  const skipped: Kind[] = [];
  const grant = Math.max(row.permissionGrantedAt.getTime(), row.createdAt.getTime());
  const email = row.user.email.trim().toLowerCase();
  if (row.permissionRevokedAt || !Number.isFinite(grant) || grant > now.getTime() || !email || !row.user.acquisition)
    return { events, skipped };
  const done = new Set([...row.reportedKinds, ...row.skippedKinds]);
  const payment = row.user.firstPayment;
  const milestones: { kind: Kind; at?: Date | null; path: string; data: OpenAiAdsEvent["data"] }[] = [
    {
      kind: "trial_started",
      at: row.user.freeTrial?.startsAt,
      path: "/",
      data: { type: "plan_enrollment", plan_id: "trial" },
    },
    {
      kind: "social_account_connected",
      at: row.user.activationMilestone?.socialConnectedAt,
      path: "/accounts",
      data: { type: "custom" },
    },
    {
      kind: "first_post_published",
      at: row.user.activationMilestone?.firstPostPublishedAt,
      path: "/schedule",
      data: { type: "custom" },
    },
  ];
  // The first-payment ledger is populated only from verified, positive live invoices.
  if (
    payment &&
    Number.isSafeInteger(payment.amountPaid) &&
    payment.amountPaid > 0 &&
    ["basic", "advanced", "pro"].includes(payment.planKey || "") &&
    /^[a-z]{3}$/i.test(payment.currency)
  ) {
    milestones.push({
      kind: "subscription_created",
      at: payment.paidAt,
      path: "/billing",
      data: {
        type: "plan_enrollment",
        plan_id: payment.planKey!,
        amount: payment.amountPaid,
        currency: payment.currency.toUpperCase(),
      },
    });
  } else if (payment && !done.has("subscription_created")) {
    // An unusable first-payment record cannot monopolize an eligible polling slot.
    skipped.push("subscription_created");
  }
  const identity = createHash("sha256").update(row.user.id).digest("hex");
  const emailHash = createHash("sha256").update(email, "utf8").digest("hex");
  for (const { kind, at, path, data } of milestones) {
    if (done.has(kind) || !at) continue;
    const timestamp = at.getTime();
    if (!Number.isFinite(timestamp) || timestamp > now.getTime()) continue;
    if (timestamp < grant || now.getTime() - timestamp >= MAX_EVENT_AGE_MS - EVENT_AGE_MARGIN_MS) {
      skipped.push(kind);
      continue;
    }
    const custom = kind === "social_account_connected" || kind === "first_post_published";
    events.push({
      kind,
      event: {
        id: `simplepost_${kind}_${identity}`,
        type: kind === "trial_started" || kind === "subscription_created" ? kind : "custom",
        ...(custom ? { custom_event_name: kind } : {}),
        timestamp_ms: timestamp,
        action_source: "web",
        source_url: `https://app.simplepost.social${path}`,
        opt_out: true,
        ...(row.clickReference &&
        row.clickCapturedAt &&
        row.clickCapturedAt.getTime() <= timestamp &&
        timestamp - row.clickCapturedAt.getTime() < 30 * 86_400_000
          ? { oppref: row.clickReference }
          : {}),
        user: { emails_sha256: [emailHash] },
        data,
      },
    });
  }
  return { events, skipped };
}

function pendingMilestone(kind: Kind, user: Prisma.UserWhereInput): Prisma.OpenAiAdsMeasurementWhereInput {
  return {
    NOT: { OR: [{ reportedKinds: { has: kind } }, { skippedKinds: { has: kind } }] },
    user: { is: user },
  };
}

/** Isolate invalid events without letting an upstream failure consume a publishing request. */
async function deliverEvents(events: OpenAiAdsEvent[]) {
  const delivered = new Set<string>();
  const errors = new Map<string, string>();
  const invalid = new Set<string>();
  const signal = AbortSignal.timeout(3000);
  let requests = 0;
  async function send(group: OpenAiAdsEvent[]): Promise<void> {
    if (group.length === 0) return;
    let error = "OpenAI measurement delivery deferred";
    if (requests < MAX_DELIVERY_REQUESTS && !signal.aborted) {
      requests++;
      try {
        const response = await fetch(
          `https://bzr.openai.com/v1/events?pid=${encodeURIComponent(process.env.OPENAI_ADS_PIXEL_ID!)}`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${process.env.OPENAI_CONVERSIONS_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ events: group }),
            signal,
            redirect: "error",
          },
        );
        // Release the connection without inspecting or retaining the upstream payload.
        await response.body?.cancel();
        if (response.ok) {
          for (const event of group) delivered.add(event.id);
          return;
        }
        error = `OpenAI measurement HTTP ${response.status}`;
        if ([400, 413, 422].includes(response.status) && group.length > 1) {
          const middle = Math.ceil(group.length / 2);
          await send(group.slice(0, middle));
          await send(group.slice(middle));
          return;
        }
        if ([400, 413, 422].includes(response.status) && group.length === 1) invalid.add(group[0].id);
      } catch {
        error = "OpenAI measurement request failed";
      }
    }
    for (const event of group) errors.set(event.id, error);
  }
  await send(events);
  // A source/configuration error may reject every request. Do not discard those events.
  if (delivered.size === 0) invalid.clear();
  return { delivered, errors, invalid };
}

/** Bounded delivery after dispatch; idle users do not compete with new milestones. */
export async function relayOpenAiMilestones(
  now = new Date(),
): Promise<{ sent: number; failed: boolean; error?: string }> {
  if (!openAiAdsConfigured()) return { sent: 0, failed: false };
  const leaseToken = randomUUID();
  const leaseAvailable = { OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }] };
  const candidates = await prisma.openAiAdsMeasurement.findMany({
    where: {
      permissionRevokedAt: null,
      permissionGrantedAt: { lte: now },
      createdAt: { lte: now },
      nextAttemptAt: { lte: now },
      ...leaseAvailable,
      user: { is: { acquisition: { not: null }, email: { not: "" } } },
      AND: [
        {
          OR: [
            pendingMilestone("trial_started", { freeTrial: { is: { startsAt: { lte: now } } } }),
            pendingMilestone("social_account_connected", {
              activationMilestone: { is: { socialConnectedAt: { lte: now } } },
            }),
            pendingMilestone("first_post_published", {
              activationMilestone: { is: { firstPostPublishedAt: { lte: now } } },
            }),
            pendingMilestone("subscription_created", { firstPayment: { is: { paidAt: { lte: now } } } }),
          ],
        },
      ],
    },
    orderBy: [{ nextAttemptAt: "asc" }, { userId: "asc" }],
    take: BATCH_SIZE,
    select: { userId: true },
  });
  if (candidates.length === 0) return { sent: 0, failed: false };
  await prisma.openAiAdsMeasurement.updateMany({
    where: {
      userId: { in: candidates.map((row) => row.userId) },
      permissionRevokedAt: null,
      nextAttemptAt: { lte: now },
      ...leaseAvailable,
    },
    data: { leaseToken, leaseExpiresAt: new Date(now.getTime() + LEASE_MS) },
  });
  // Re-read permission after claiming; never send a stale pre-claim snapshot.
  const rows = await prisma.openAiAdsMeasurement.findMany({
    where: { leaseToken, permissionRevokedAt: null, permissionGrantedAt: { lte: now } },
    include: measurementInclude,
  });
  const batches = rows.map((row) => ({ row, ...openAiMilestoneEvents(row, now) }));
  const events = batches.flatMap((batch) => batch.events.map((item) => item.event));
  const { delivered, errors, invalid } = await deliverEvents(events);
  for (const batch of batches) {
    const accepted = batch.events.filter(({ event }) => delivered.has(event.id)).map(({ kind }) => kind);
    const rejected = batch.events.filter(({ event }) => invalid.has(event.id)).map(({ kind }) => kind);
    const skipped = [...batch.skipped, ...rejected];
    const error = batch.events.map(({ event }) => errors.get(event.id)).find(Boolean) ?? null;
    const completed = new Set([...batch.row.reportedKinds, ...batch.row.skippedKinds, ...skipped, ...accepted]);
    await prisma.openAiAdsMeasurement.updateMany({
      where: { userId: batch.row.userId, leaseToken, permissionRevokedAt: null },
      data: {
        reportedKinds: { push: accepted },
        skippedKinds: { push: skipped },
        nextAttemptAt: OPENAI_ADS_KINDS.every((kind) => completed.has(kind))
          ? new Date("9999-01-01T00:00:00Z")
          : new Date(now.getTime() + POLL_INTERVAL_MS),
        leaseToken: null,
        leaseExpiresAt: null,
        attempts: { increment: batch.events.length > 0 ? 1 : 0 },
        lastError: error,
      },
    });
  }
  const error = errors.values().next().value;
  return { sent: delivered.size, failed: errors.size > 0, ...(error ? { error } : {}) };
}
