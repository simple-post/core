import { randomUUID } from "node:crypto";

import { Prisma, type BillingNotification } from "@prisma/client";

import { isTestUserEmail } from "@/lib/auth/test-users";
import { getBillingStatus } from "@/lib/billing/subscriptions";
import { env } from "@/lib/env";
import { createLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { EmailDeliveryError, sendNotificationEmail, type NotificationEmail } from "@/lib/resend/notification-email";

import { formatFounderFrom, renderBillingEmail, renderSetupReminderEmail } from "./billing-email";

const log = createLogger("billing-notifications");
const TRIAL_NOTICE_MS = 24 * 60 * 60_000;
// The provider retains its idempotency key for 24 hours.
const SAFE_RETRY_MS = 23 * 60 * 60_000;
const LEASE_MS = 90_000;

const readyToSend = (now: Date) => ({
  status: "pending",
  nextAttemptAt: { lte: now },
  OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }],
});

export async function enqueueTrialEndingNotifications(now: Date) {
  const deadline = new Date(now.getTime() + TRIAL_NOTICE_MS);
  // Prisma stores these timestamp columns in UTC, even if the database session uses local time.
  const trials = await prisma.$queryRaw<Array<{ id: string; userId: string; expiresAt: Date }>>`
    SELECT t.id, t."userId", t."expiresAt"
    FROM "free_trial" t
    WHERE t."expiresAt" > (${now}::timestamptz AT TIME ZONE 'UTC')
      AND t."expiresAt" <= (${deadline}::timestamptz AT TIME ZONE 'UTC')
      AND NOT EXISTS (
        SELECT 1 FROM "billing_notification" n WHERE n."userId" = t."userId"
          AND n.kind = 'trial_ending' AND n."effectiveAt" = t."expiresAt"
      )
    ORDER BY t."expiresAt", t.id
    LIMIT 100`;
  if (trials.length === 0) return;
  await prisma.billingNotification.createMany({
    skipDuplicates: true,
    data: trials.map((trial) => ({
      key: `trial-ending/${trial.id}/${trial.expiresAt.toISOString()}`,
      userId: trial.userId,
      kind: "trial_ending",
      occurredAt: now,
      effectiveAt: trial.expiresAt,
      nextAttemptAt: now,
    })),
  });
}

function readFrozenMessage(value: Prisma.JsonValue | null): NotificationEmail | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  if (!["from", "to", "replyTo", "subject", "html", "text"].every((key) => typeof value[key] === "string")) return;
  return value as unknown as NotificationEmail;
}

async function prepareEmail(notice: BillingNotification, now: Date): Promise<NotificationEmail | null> {
  const user = await prisma.user.findUnique({
    where: { id: notice.userId },
    select: {
      email: true,
      freeTrial: { select: { expiresAt: true } },
      publishingPreferences: { select: { timeZone: true } },
    },
  });
  if (!user || isTestUserEmail(user.email)) return null;

  const common = {
    appUrl: env.NEXT_PUBLIC_APP_URL,
    effectiveAt: notice.effectiveAt,
    timeZone: user.publishingPreferences?.timeZone ?? "UTC",
  };
  let content: ReturnType<typeof renderBillingEmail>;
  switch (notice.kind) {
    case "trial_ending": {
      if (
        notice.effectiveAt.getTime() <= now.getTime() ||
        user.freeTrial?.expiresAt.getTime() !== notice.effectiveAt.getTime()
      ) {
        return null;
      }
      const billing = await getBillingStatus(notice.userId);
      if (billing.accessType !== "trial") return null;
      const affectedPosts = await prisma.post.count({
        where: { userId: notice.userId, status: "scheduled", scheduledFor: { gte: notice.effectiveAt } },
      });
      content = renderBillingEmail({ ...common, kind: "trial_ending", affectedPosts });
      break;
    }
    case "paid_cancellation": {
      content = renderBillingEmail({ ...common, kind: "paid_cancellation", occurredAt: notice.occurredAt });
      break;
    }
    case "setup_reminder": {
      if (notice.consentRecipient !== user.email) return null;
      const billing = await getBillingStatus(notice.userId);
      if (!billing.active || billing.usage.connectedAccounts > 0) return null;
      const publishedPosts = await prisma.post.count({
        where: { userId: notice.userId, status: "published" },
        take: 1,
      });
      if (publishedPosts > 0) return null;
      content = renderSetupReminderEmail(common.appUrl);
      break;
    }
    default: {
      throw new Error("Unknown billing notification kind");
    }
  }
  return {
    ...content,
    from: formatFounderFrom(env.RESEND_FROM_ADDRESS),
    to: user.email,
    replyTo: env.BILLING_EMAIL_REPLY_TO,
  };
}

async function deliver(notice: BillingNotification) {
  const now = new Date();
  const leaseToken = randomUUID();
  const claim = await prisma.billingNotification.updateMany({
    where: { key: notice.key, ...readyToSend(now) },
    data: { leaseToken, leaseUntil: new Date(now.getTime() + LEASE_MS), attempts: { increment: 1 } },
  });
  if (claim.count === 0) return;
  const where = { key: notice.key, leaseToken, status: "pending" };
  const release = async (data: Prisma.BillingNotificationUpdateManyMutationInput) =>
    prisma.billingNotification.updateMany({ where, data: { ...data, leaseToken: null, leaseUntil: null } });

  try {
    if (notice.firstAttemptAt && now.getTime() - notice.firstAttemptAt.getTime() >= SAFE_RETRY_MS) {
      await release({ status: "failed", lastError: "retry_window_exhausted" });
      log.error({ kind: notice.kind }, "Billing email requires operator review");
      return;
    }
    const current = await prepareEmail(notice, now);
    const frozen = readFrozenMessage(notice.message);
    if (notice.message && !frozen) {
      await release({ status: "failed", lastError: "invalid_frozen_message" });
      return;
    }
    if (!current || (frozen && frozen.to !== current.to)) {
      await release({ status: "cancelled", message: Prisma.DbNull, lastError: "no_longer_eligible" });
      return;
    }
    const message = frozen ?? current;
    if (!frozen) {
      const saved = await prisma.billingNotification.updateMany({
        where,
        data: { firstAttemptAt: now, message: { ...message } },
      });
      if (!saved.count) return;
    }
    if (notice.kind === "setup_reminder") {
      // A withdrawal clears the lease. Check again immediately before handing off to Resend.
      const currentClaim = await prisma.billingNotification.count({ where });
      if (currentClaim === 0) return;
    }
    const providerMessageId = await sendNotificationEmail(message, notice.key);
    await release({ status: "sent", sentAt: new Date(), providerMessageId, message: Prisma.DbNull, lastError: null });
  } catch (error) {
    const lastError = error instanceof EmailDeliveryError ? `provider_status_${error.status}` : "delivery_failed";
    const terminal =
      error instanceof EmailDeliveryError && error.status < 500 && ![408, 409, 429].includes(error.status);
    if (terminal) {
      await release({ status: "failed", lastError });
      log.error({ kind: notice.kind, lastError }, "Billing email permanently rejected");
    } else {
      const backoff = Math.min(60_000 * 2 ** Math.min(notice.attempts, 6), 60 * 60_000);
      await release({ nextAttemptAt: new Date(Date.now() + backoff), lastError });
      log.warn({ kind: notice.kind, lastError }, "Billing email deferred");
    }
  }
}

export async function dispatchBillingNotification(key: string) {
  if (env.SELF_HOSTED) return;
  try {
    const notice = await prisma.billingNotification.findUnique({ where: { key } });
    if (notice) await deliver(notice);
  } catch {
    // The durable queue retries this independently of publishing and Stripe.
    log.error("Billing email dispatch failed");
  }
}

export async function dispatchBillingNotifications() {
  if (env.SELF_HOSTED) return;
  try {
    await enqueueTrialEndingNotifications(new Date());
    const due = await prisma.billingNotification.findMany({
      where: readyToSend(new Date()),
      orderBy: { nextAttemptAt: "asc" },
      take: 10,
      select: { key: true },
    });
    for (let offset = 0; offset < due.length; offset += 3) {
      await Promise.all(due.slice(offset, offset + 3).map(({ key }) => dispatchBillingNotification(key)));
    }
  } catch {
    log.error("Billing email sweep failed");
  }
}
