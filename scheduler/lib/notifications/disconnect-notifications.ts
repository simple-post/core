import { randomUUID } from "node:crypto";

import { getReconnectImpact } from "@/lib/accounts/reconnect-impact";
import { getPlatformName } from "@/lib/config";
import { env } from "@/lib/env";
import { createLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { EmailDeliveryError, sendNotificationEmail, type NotificationEmail } from "@/lib/resend/notification-email";

import { renderDisconnectEmail } from "./disconnect-email";

import type { AccountDisconnectNotification, Prisma } from "@prisma/client";

const log = createLogger("disconnect-notifications");
const LEASE_MS = 90_000;
// Resend retains idempotency keys for 24h. Never automatically retry an ambiguous send after that window.
export const DISCONNECT_EMAIL_RETRY_WINDOW_MS = 23 * 60 * 60_000;

const eligible = (now: Date) => ({
  status: "pending",
  nextAttemptAt: { lte: now },
  OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }],
});

async function enqueueDisconnects(): Promise<number> {
  // Compare the current episode with its notification in SQL; previously notified accounts must not starve new ones.
  const episodes = await prisma.$queryRaw<Array<{ accountId: string; disconnectedAt: Date }>>`
    SELECT a.id AS "accountId", a."credentialRefreshBlockedAt" AS "disconnectedAt"
    FROM "connected_account" a
    LEFT JOIN "account_disconnect_notification" n
      ON n."accountId" = a.id AND n."disconnectedAt" = a."credentialRefreshBlockedAt"
    WHERE a."credentialRefreshBlockedAt" IS NOT NULL AND n.id IS NULL
    ORDER BY a."credentialRefreshBlockedAt" ASC, a.id ASC
    LIMIT 100`;
  if (episodes.length === 0) return 0;
  const nextAttemptAt = new Date();
  const result = await prisma.accountDisconnectNotification.createMany({
    data: episodes.map((episode) => ({ ...episode, nextAttemptAt })),
    skipDuplicates: true,
  });
  return result.count;
}

function storedMessage(value: Prisma.JsonValue | null): NotificationEmail | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  if (!["from", "to", "subject", "html", "text"].every((key) => typeof value[key] === "string")) return;
  return value as unknown as NotificationEmail;
}

async function deliver(
  notification: AccountDisconnectNotification,
): Promise<"sent" | "cancelled" | "deferred" | "failed"> {
  const now = new Date();
  const leaseToken = randomUUID();
  const claimed = await prisma.accountDisconnectNotification.updateMany({
    where: { id: notification.id, ...eligible(now) },
    data: { leaseToken, leaseUntil: new Date(now.getTime() + LEASE_MS), attempts: { increment: 1 } },
  });
  if (claimed.count === 0) return "deferred";
  const where = { id: notification.id, leaseToken, status: "pending" };
  const finish = async (
    status: "sent" | "cancelled" | "failed",
    data: Prisma.AccountDisconnectNotificationUpdateManyMutationInput = {},
  ) => {
    const result = await prisma.accountDisconnectNotification.updateMany({
      where,
      data: { ...data, status, leaseToken: null, leaseUntil: null },
    });
    if (result.count === 0) return "deferred" as const;
    if (status === "failed")
      log.error(
        { notificationId: notification.id, accountId: notification.accountId, reason: data.lastError },
        "Disconnect email requires operator review",
      );
    return status;
  };
  try {
    const account = await prisma.connectedAccount.findUnique({
      where: { id: notification.accountId },
      select: {
        id: true,
        userId: true,
        platform: true,
        username: true,
        displayName: true,
        credentialRefreshBlockedAt: true,
        user: { select: { email: true } },
      },
    });
    if (!account || account.credentialRefreshBlockedAt?.getTime() !== notification.disconnectedAt.getTime())
      return await finish("cancelled", { lastError: "account_reconnected_or_removed" });
    const firstAttemptAt = notification.firstAttemptAt ?? now;
    if (now.getTime() - firstAttemptAt.getTime() >= DISCONNECT_EMAIL_RETRY_WINDOW_MS) {
      return await finish("failed", { lastError: "retry_window_exhausted" });
    }
    let message = storedMessage(notification.message);
    if (notification.message && !message) return await finish("failed", { lastError: "invalid_stored_message" });
    if (message && message.to !== account.user.email)
      return await finish("cancelled", { lastError: "recipient_changed" });
    if (!message) {
      const impact = await getReconnectImpact(account.userId, [account.id]);
      const count = impact.get(account.id) ?? 0;
      message = {
        from: env.RESEND_FROM_ADDRESS,
        to: account.user.email,
        ...renderDisconnectEmail({
          platformName: getPlatformName(account.platform),
          accountLabel: account.username
            ? account.username.startsWith("@")
              ? account.username
              : `@${account.username}`
            : account.displayName,
          affectedQueuedPosts: count,
          appUrl: env.NEXT_PUBLIC_APP_URL,
        }),
      };
      const frozen = await prisma.accountDisconnectNotification.updateMany({
        where,
        data: { firstAttemptAt, message: message as unknown as Prisma.InputJsonValue },
      });
      if (frozen.count === 0) return "deferred";
    }
    // Re-read immediately before I/O: pending notices for a reconnect must not be sent.
    const current = await prisma.connectedAccount.findUnique({
      where: { id: account.id },
      select: { credentialRefreshBlockedAt: true, user: { select: { email: true } } },
    });
    if (
      current?.credentialRefreshBlockedAt?.getTime() !== notification.disconnectedAt.getTime() ||
      current.user.email !== message.to
    )
      return await finish("cancelled", { lastError: "account_or_recipient_changed" });
    const providerMessageId = await sendNotificationEmail(message, `account-disconnect/${notification.id}`);
    const outcome = await finish("sent", { sentAt: new Date(), providerMessageId, lastError: null });
    if (outcome === "sent")
      log.info({ accountId: account.id, notificationId: notification.id }, "Disconnect email accepted");
    return outcome;
  } catch (error) {
    const attempts = notification.attempts + 1;
    const delay = Math.min(60_000 * 2 ** Math.min(attempts - 1, 6), 60 * 60_000);
    const lastError =
      error instanceof EmailDeliveryError ? `provider_status_${error.status}` : "delivery_or_persistence_failed";
    await prisma.accountDisconnectNotification.updateMany({
      where,
      data: { leaseToken: null, leaseUntil: null, lastError, nextAttemptAt: new Date(Date.now() + delay) },
    });
    log.warn(
      { notificationId: notification.id, accountId: notification.accountId, lastError },
      "Disconnect email deferred",
    );
    return "deferred";
  }
}

/** Run after the existing dispatch/refresh sweep, including when no posts are due. */
export async function dispatchDisconnectNotifications(): Promise<void> {
  try {
    const queued = await enqueueDisconnects();
    const notifications = await prisma.accountDisconnectNotification.findMany({
      where: eligible(new Date()),
      orderBy: { createdAt: "asc" },
      take: 10,
    });
    // Each claim is made immediately before delivery, not at the start of a potentially slow batch.
    let index = 0;
    const outcomes = await Promise.all(
      Array.from({ length: Math.min(3, notifications.length) }, async () => {
        const result: string[] = [];
        while (index < notifications.length) {
          const notification = notifications[index++];
          try {
            result.push(await deliver(notification));
          } catch {
            // A failed claim/retry write must not strand the rest of this batch or leave unawaited sends.
            log.error({ notificationId: notification.id }, "Disconnect email persistence failed; retry on next sweep");
            result.push("deferred");
          }
        }
        return result;
      }),
    );
    if (queued || notifications.length > 0)
      log.info({ queued, outcomes: outcomes.flat() }, "Disconnect notification sweep completed");
  } catch {
    // Notification infrastructure must never fail posting or leak recipients/payloads in error logs.
    log.error("Disconnect notification sweep failed; pending notifications will be retried");
  }
}
