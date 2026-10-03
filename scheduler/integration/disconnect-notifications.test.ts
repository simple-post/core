/* eslint-disable unicorn/no-await-expression-member -- Keep assertions beside database operations. */
import {
  dispatchDisconnectNotifications,
  DISCONNECT_EMAIL_RETRY_WINDOW_MS,
} from "@/lib/notifications/disconnect-notifications";
import { refreshConnectedAccountIfNeeded } from "@/lib/oauth/credential-health";
import { upsertConnectedAccount } from "@/lib/oauth/upsert";
import { recordMetaCredentialRejection } from "@/lib/posting/credential-rejection";
import { prisma } from "@/lib/prisma";
import { sendNotificationEmail } from "@/lib/resend/notification-email";
import {
  decryptConnectedAccountSecrets,
  encryptConnectedAccountSecrets,
} from "@/lib/security/connected-account-secrets";
import type { ConnectedAccount } from "@/types";

// Real database, queue, account state and template. Delivery is the only mocked boundary.
jest.mock("@/lib/resend/notification-email", () => ({
  ...jest.requireActual("@/lib/resend/notification-email"),
  sendNotificationEmail: jest.fn(),
}));
const userId = "disconnect-notification-review";
const accountId = "disconnect-account";
const disconnectedAt = new Date("2026-10-04T08:00:00Z");
const notice = () =>
  prisma.accountDisconnectNotification.findFirstOrThrow({ where: { accountId }, orderBy: { createdAt: "desc" } });
const retryNow = () =>
  prisma.accountDisconnectNotification.updateMany({
    where: { accountId, status: "pending" },
    data: { nextAttemptAt: new Date(0) },
  });
const reconnect = () =>
  upsertConnectedAccount({
    userId,
    platform: "instagram",
    platformAccountId: "remote",
    accessToken: "NEW_SECRET",
    refreshToken: null,
    expiresAt: new Date(Date.now() + 60 * 86_400_000),
    scope: null,
    username: "test",
    displayName: null,
    email: null,
    profilePicture: null,
  });

beforeEach(async () => {
  jest.clearAllMocks();
  jest.mocked(sendNotificationEmail).mockReset().mockResolvedValue("provider-id");
  process.env.NEXT_PUBLIC_APP_URL = "https://app.simplepost.social";
  process.env.RESEND_FROM_ADDRESS = "SimplePost <auth@example.invalid>";
  delete process.env.SELF_HOSTED;
  await prisma.publishCheckpoint.deleteMany();
  await prisma.publishAttempt.deleteMany();
  await prisma.storageDeletion.deleteMany();
  await prisma.user.deleteMany();
  await prisma.user.create({
    data: {
      id: userId,
      name: "Owner",
      email: "owner@example.invalid",
      freeTrial: { create: { expiresAt: new Date(Date.now() + 86_400_000) } },
    },
  });
  await prisma.connectedAccount.create({
    data: {
      id: accountId,
      userId,
      platform: "instagram",
      platformAccountId: "remote",
      username: "test",
      expiresAt: new Date(Date.now() + 60 * 86_400_000),
      credentialRefreshBlockedAt: disconnectedAt,
      ...encryptConnectedAccountSecrets({ accessToken: "DO_NOT_STORE", tokenMetadata: { private: "DO_NOT_STORE" } }),
    },
  });
});
afterAll(async () => prisma.$disconnect());

it("ten concurrent sweeps send once and count only the owner's unfinished queued targets", async () => {
  await prisma.user.create({ data: { id: "other-user", name: "Other", email: "other@example.invalid" } });
  for (const post of [
    { id: "queued", status: "scheduled", userId },
    { id: "finished-target", status: "pending", userId, accountResults: { [accountId]: { success: true } } },
    { id: "draft", status: "draft", userId },
    { id: "other-queued", status: "scheduled", userId: "other-user" },
  ])
    await prisma.post.create({
      data: { ...post, message: "Never included", accounts: { connect: { id: accountId } } },
    });
  await Promise.all(Array.from({ length: 10 }, () => dispatchDisconnectNotifications()));
  await dispatchDisconnectNotifications();
  expect(sendNotificationEmail).toHaveBeenCalledTimes(1);
  expect(sendNotificationEmail).toHaveBeenCalledWith(
    expect.objectContaining({ to: "owner@example.invalid", text: expect.stringContaining("1 queued post needs") }),
    expect.stringMatching(/^account-disconnect\//),
  );
  expect(await prisma.accountDisconnectNotification.count()).toBe(1);
  expect(await notice()).toMatchObject({
    status: "sent",
    attempts: 1,
    providerMessageId: "provider-id",
    sentAt: expect.any(Date),
  });
  expect(JSON.stringify((await notice()).message)).not.toContain("DO_NOT_STORE");
  expect(JSON.stringify((await notice()).message)).not.toContain("Never included");
});

it("retries provider failure with the exact frozen message and key even if profile, queue or configuration changes", async () => {
  jest.mocked(sendNotificationEmail).mockRejectedValueOnce(new Error("temporary outage"));
  await dispatchDisconnectNotifications();
  const firstCall = jest.mocked(sendNotificationEmail).mock.calls[0];
  expect(await notice()).toMatchObject({
    status: "pending",
    attempts: 1,
    lastError: "delivery_or_persistence_failed",
    firstAttemptAt: expect.any(Date),
  });
  await prisma.connectedAccount.update({ where: { id: accountId }, data: { username: "changed-name" } });
  await prisma.post.create({
    data: {
      id: "late-queued",
      userId,
      message: "Later",
      status: "scheduled",
      accounts: { connect: { id: accountId } },
    },
  });
  process.env.RESEND_FROM_ADDRESS = "New <changed@example.invalid>";
  process.env.NEXT_PUBLIC_APP_URL = "https://changed.example.invalid";
  await retryNow();
  await dispatchDisconnectNotifications();
  expect(jest.mocked(sendNotificationEmail).mock.calls[1]).toEqual(firstCall);
  expect(await notice()).toMatchObject({ status: "sent", attempts: 2 });
});

it("recovers when delivery was accepted but recording success failed, reusing the same provider key", async () => {
  const update = prisma.accountDisconnectNotification.updateMany.bind(prisma.accountDisconnectNotification);
  let fail = true;
  const spy = jest.spyOn(prisma.accountDisconnectNotification, "updateMany").mockImplementation((args) => {
    if (args?.data.status === "sent" && fail) {
      fail = false;
      throw new Error("database write lost");
    }
    return update(args) as never;
  });
  try {
    await dispatchDisconnectNotifications();
    expect(await notice()).toMatchObject({ status: "pending", attempts: 1 });
    await retryNow();
    await dispatchDisconnectNotifications();
    expect(jest.mocked(sendNotificationEmail).mock.calls[1]).toEqual(jest.mocked(sendNotificationEmail).mock.calls[0]);
    expect(await notice()).toMatchObject({ status: "sent", attempts: 2 });
  } finally {
    spy.mockRestore();
  }
});

it("cancels an unsent notice when the user reconnects before a retry", async () => {
  jest.mocked(sendNotificationEmail).mockRejectedValueOnce(new Error("outage"));
  await dispatchDisconnectNotifications();
  expect(await notice()).toMatchObject({
    status: "pending",
    firstAttemptAt: expect.any(Date),
    message: expect.any(Object),
  });
  await reconnect();
  await retryNow();
  await dispatchDisconnectNotifications();
  expect(sendNotificationEmail).toHaveBeenCalledTimes(1);
  expect((await notice()).status).toBe("cancelled");
});

it("sends again for a genuinely new disconnect after a reconnect, never for repeated failures in one episode", async () => {
  await dispatchDisconnectNotifications();
  await reconnect();
  await prisma.connectedAccount.update({
    where: { id: accountId },
    data: { credentialRefreshBlockedAt: new Date(disconnectedAt.getTime() + 1000) },
  });
  await dispatchDisconnectNotifications();
  await dispatchDisconnectNotifications();
  expect(sendNotificationEmail).toHaveBeenCalledTimes(2);
  expect(jest.mocked(sendNotificationEmail).mock.calls[1][1]).not.toBe(
    jest.mocked(sendNotificationEmail).mock.calls[0][1],
  );
  expect(await prisma.accountDisconnectNotification.count({ where: { status: "sent" } })).toBe(2);
});

it("recovers an expired worker lease, but leaves a live claim alone", async () => {
  await prisma.accountDisconnectNotification.create({
    data: { accountId, disconnectedAt, leaseToken: "old-worker", leaseUntil: new Date(Date.now() + 90_000) },
  });
  await dispatchDisconnectNotifications();
  expect(sendNotificationEmail).not.toHaveBeenCalled();
  await prisma.accountDisconnectNotification.updateMany({ where: { accountId }, data: { leaseUntil: new Date(0) } });
  await dispatchDisconnectNotifications();
  expect(sendNotificationEmail).toHaveBeenCalledTimes(1);
  expect((await notice()).leaseToken).toBeNull();
});

it("stops ambiguous delivery retries before the provider's idempotency key can expire", async () => {
  await prisma.accountDisconnectNotification.create({
    data: { accountId, disconnectedAt, firstAttemptAt: new Date(Date.now() - DISCONNECT_EMAIL_RETRY_WINDOW_MS - 1000) },
  });
  await dispatchDisconnectNotifications();
  expect(sendNotificationEmail).not.toHaveBeenCalled();
  expect(await notice()).toMatchObject({ status: "failed", lastError: "retry_window_exhausted" });
});

it("cancels rather than sending a frozen message to an old owner address", async () => {
  jest.mocked(sendNotificationEmail).mockRejectedValueOnce(new Error("outage"));
  await dispatchDisconnectNotifications();
  await prisma.user.update({ where: { id: userId }, data: { email: "new@example.invalid" } });
  await retryNow();
  await dispatchDisconnectNotifications();
  expect(sendNotificationEmail).toHaveBeenCalledTimes(1);
  expect(await notice()).toMatchObject({ status: "cancelled", lastError: "recipient_changed" });
});

it("already notified disconnected accounts cannot starve a newer disconnect at the batch boundary", async () => {
  const older = new Date(disconnectedAt.getTime() - 86_400_000);
  await prisma.connectedAccount.createMany({
    data: Array.from({ length: 100 }, (_, i) => ({
      id: `old-${i}`,
      userId,
      platform: "instagram",
      platformAccountId: `old-${i}`,
      accessToken: "offline",
      credentialRefreshBlockedAt: older,
    })),
  });
  await prisma.accountDisconnectNotification.createMany({
    data: Array.from({ length: 100 }, (_, i) => ({ accountId: `old-${i}`, disconnectedAt: older, status: "sent" })),
  });
  await dispatchDisconnectNotifications();
  expect(sendNotificationEmail).toHaveBeenCalledTimes(1);
  expect((await notice()).status).toBe("sent");
});

it("notifies permanent failures on another platform but ignores transient refresh failures", async () => {
  await prisma.connectedAccount.update({
    where: { id: accountId },
    data: {
      platform: "linkedin",
      credentialRefreshBlockedAt: null,
      credentialRefreshRetryAt: new Date(Date.now() + 600_000),
      expiresAt: new Date(Date.now() + 60 * 86_400_000),
    },
  });
  await dispatchDisconnectNotifications();
  expect(sendNotificationEmail).not.toHaveBeenCalled();
  const stored = await prisma.connectedAccount.update({
    where: { id: accountId },
    data: { expiresAt: new Date(Date.now() - 60_000), credentialRefreshRetryAt: null },
  });
  const result = await refreshConnectedAccountIfNeeded(decryptConnectedAccountSecrets(stored) as ConnectedAccount, {
    reason: "background",
  });
  expect(result.account.credentialRefreshBlockedAt).toBeInstanceOf(Date);
  await dispatchDisconnectNotifications();
  expect(sendNotificationEmail).toHaveBeenCalledWith(
    expect.objectContaining({ subject: "Reconnect your LinkedIn account in SimplePost" }),
    expect.any(String),
  );
});

it.each(["instagram", "facebook", "threads"])(
  "emails the owner when %s revokes an otherwise unexpired session",
  async (platform) => {
    const account = await prisma.connectedAccount.update({
      where: { id: accountId },
      data: { platform, credentialRefreshBlockedAt: null },
    });
    expect(
      await recordMetaCredentialRejection(account, { reason: "session_revoked", code: 190, status: 401, subcode: 0 }),
    ).toBe("recorded");
    await dispatchDisconnectNotifications();
    expect(sendNotificationEmail).toHaveBeenCalledTimes(1);
    expect(jest.mocked(sendNotificationEmail).mock.calls[0][0].to).toBe("owner@example.invalid");
    expect((await notice()).status).toBe("sent");
  },
);

it("account deletion cascades pending notifications and infrastructure failures do not throw", async () => {
  await prisma.accountDisconnectNotification.create({ data: { accountId, disconnectedAt } });
  await prisma.connectedAccount.delete({ where: { id: accountId } });
  expect(await prisma.accountDisconnectNotification.count()).toBe(0);
  const spy = jest.spyOn(prisma, "$queryRaw").mockRejectedValueOnce(new Error("database unavailable"));
  try {
    await expect(dispatchDisconnectNotifications()).resolves.toBeUndefined();
  } finally {
    spy.mockRestore();
  }
  expect(sendNotificationEmail).not.toHaveBeenCalled();
});

it("a failed database claim leaves its notice retryable while other deliveries finish", async () => {
  await prisma.connectedAccount.create({
    data: {
      id: "second-account",
      userId,
      platform: "threads",
      platformAccountId: "second",
      accessToken: "offline",
      credentialRefreshBlockedAt: disconnectedAt,
    },
  });
  const update = prisma.accountDisconnectNotification.updateMany.bind(prisma.accountDisconnectNotification);
  let fail = true;
  const spy = jest.spyOn(prisma.accountDisconnectNotification, "updateMany").mockImplementation((args) => {
    if (args?.data.leaseToken && fail) {
      fail = false;
      throw new Error("database claim failed");
    }
    return update(args) as never;
  });
  try {
    await dispatchDisconnectNotifications();
    expect(sendNotificationEmail).toHaveBeenCalledTimes(1);
    expect(await prisma.accountDisconnectNotification.count({ where: { status: "pending" } })).toBe(1);
    await dispatchDisconnectNotifications();
    expect(sendNotificationEmail).toHaveBeenCalledTimes(2);
    expect(await prisma.accountDisconnectNotification.count({ where: { status: "sent" } })).toBe(2);
  } finally {
    spy.mockRestore();
  }
});

it("an old worker cannot overwrite a lease claimed by another worker", async () => {
  jest.mocked(sendNotificationEmail).mockImplementationOnce(async () => {
    await prisma.accountDisconnectNotification.updateMany({
      where: { accountId },
      data: { leaseToken: "new-worker", leaseUntil: new Date(Date.now() + 90_000) },
    });
    return "provider-id";
  });
  await dispatchDisconnectNotifications();
  expect(await notice()).toMatchObject({ status: "pending", leaseToken: "new-worker", providerMessageId: null });
  await prisma.accountDisconnectNotification.updateMany({ where: { accountId }, data: { leaseUntil: new Date(0) } });
  await dispatchDisconnectNotifications();
  expect((await notice()).status).toBe("sent");
  expect(jest.mocked(sendNotificationEmail).mock.calls[1]).toEqual(jest.mocked(sendNotificationEmail).mock.calls[0]);
});
