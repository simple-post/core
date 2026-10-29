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
const POLL_INTERVAL_MS = 60_000;
const LEASE_MS = 30_000;
const BATCH_SIZE = 50;

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
  }
  const identity = createHash("sha256").update(row.user.id).digest("hex");
  const emailHash = createHash("sha256").update(email, "utf8").digest("hex");
  for (const { kind, at, path, data } of milestones) {
    if (done.has(kind) || !at) continue;
    const timestamp = at.getTime();
    if (!Number.isFinite(timestamp) || timestamp > now.getTime()) continue;
    if (timestamp < grant || now.getTime() - timestamp >= MAX_EVENT_AGE_MS) {
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
        user: { emails_sha256: [emailHash] },
        data,
      },
    });
  }
  return { events, skipped };
}

/** One bounded batch per scheduled dispatch; failures never fail billing or publishing. */
export async function relayOpenAiMilestones(now = new Date()) {
  if (!openAiAdsConfigured()) return { sent: 0, failed: false };
  const leaseToken = randomUUID();
  const leaseAvailable = { OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }] };
  const candidates = await prisma.openAiAdsMeasurement.findMany({
    where: {
      permissionRevokedAt: null,
      permissionGrantedAt: { lte: now },
      nextAttemptAt: { lte: now },
      ...leaseAvailable,
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
  let error: string | null = null;
  if (events.length > 0) {
    try {
      const response = await fetch(
        `https://bzr.openai.com/v1/events?pid=${encodeURIComponent(process.env.OPENAI_ADS_PIXEL_ID!)}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.OPENAI_CONVERSIONS_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ events }),
          signal: AbortSignal.timeout(3000),
          redirect: "error",
        },
      );
      if (!response.ok) error = `OpenAI measurement HTTP ${response.status}`;
    } catch {
      error = "OpenAI measurement request failed";
    }
  }
  for (const batch of batches) {
    const completed = new Set([
      ...batch.row.reportedKinds,
      ...batch.row.skippedKinds,
      ...batch.skipped,
      ...batch.events.map((item) => item.kind),
    ]);
    await prisma.openAiAdsMeasurement.updateMany({
      where: { userId: batch.row.userId, leaseToken, permissionRevokedAt: null },
      data: {
        ...(error
          ? {}
          : { reportedKinds: { push: batch.events.map((item) => item.kind) }, skippedKinds: { push: batch.skipped } }),
        nextAttemptAt:
          !error && OPENAI_ADS_KINDS.every((kind) => completed.has(kind))
            ? new Date("9999-01-01T00:00:00Z")
            : new Date(now.getTime() + POLL_INTERVAL_MS),
        leaseToken: null,
        leaseExpiresAt: null,
        attempts: { increment: events.length > 0 ? 1 : 0 },
        lastError: error,
      },
    });
  }
  return { sent: error ? 0 : events.length, failed: error !== null };
}
