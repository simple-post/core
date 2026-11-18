import { getBillingStatus } from "@/lib/billing/subscriptions";
import { dispatchBillingNotification } from "@/lib/notifications/billing-notifications";
import { prisma } from "@/lib/prisma";
import { sendNotificationEmail } from "@/lib/resend/notification-email";

import type { BillingNotification } from "@prisma/client";

jest.mock("@/lib/billing/subscriptions", () => ({ getBillingStatus: jest.fn() }));
jest.mock("@/lib/prisma", () => ({
  prisma: {
    billingNotification: { count: jest.fn(), findUnique: jest.fn(), updateMany: jest.fn() },
    user: { findUnique: jest.fn() },
    post: { count: jest.fn() },
  },
}));
jest.mock("@/lib/resend/notification-email", () => ({
  ...jest.requireActual("@/lib/resend/notification-email"),
  sendNotificationEmail: jest.fn(),
}));

const expiresAt = new Date(Date.now() + 60 * 60_000);
const notice = {
  key: "trial-ending/one",
  userId: "user-one",
  kind: "trial_ending",
  effectiveAt: expiresAt,
  attempts: 0,
} as BillingNotification;

beforeEach(() => {
  jest.resetAllMocks();
  jest.replaceProperty(process, "env", {
    ...process.env,
    RESEND_FROM_ADDRESS: "SimplePost <auth@simplepost.social>",
    BILLING_EMAIL_REPLY_TO: "support@simplepost.social",
  });
  jest.mocked(prisma.billingNotification.findUnique).mockResolvedValue(notice);
  jest.mocked(prisma.billingNotification.updateMany).mockResolvedValue({ count: 1 });
  jest.mocked(prisma.user.findUnique).mockResolvedValue({
    email: "person@example.invalid",
    freeTrial: { expiresAt },
    publishingPreferences: { timeZone: "Europe/Berlin" },
  } as never);
});
afterEach(() => jest.restoreAllMocks());

it("drops a pending expiry notice if the user now has a paid plan", async () => {
  jest.mocked(getBillingStatus).mockResolvedValue({ accessType: "stripe" } as never);
  await dispatchBillingNotification(notice.key);
  expect(sendNotificationEmail).not.toHaveBeenCalled();
  expect(prisma.billingNotification.updateMany).toHaveBeenLastCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ status: "cancelled" }) }),
  );
});

it("uses the stable notice key and founder reply address for an affected trial", async () => {
  jest.mocked(getBillingStatus).mockResolvedValue({ accessType: "trial" } as never);
  jest.mocked(prisma.post.count).mockResolvedValue(1);
  jest.mocked(sendNotificationEmail).mockResolvedValue("provider-id");
  await dispatchBillingNotification(notice.key);
  expect(sendNotificationEmail).toHaveBeenCalledWith(
    expect.objectContaining({
      from: "Vlad from SimplePost <vlad@simplepost.social>",
      replyTo: "support@simplepost.social",
      text: expect.stringContaining("one post"),
    }),
    notice.key,
  );
  expect(prisma.billingNotification.updateMany).toHaveBeenLastCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ status: "sent", providerMessageId: "provider-id" }) }),
  );
});

it("sends a shorter expiry notice when the trial has no affected posts", async () => {
  jest.mocked(getBillingStatus).mockResolvedValue({ accessType: "trial" } as never);
  jest.mocked(prisma.post.count).mockResolvedValue(0);
  jest.mocked(sendNotificationEmail).mockResolvedValue("provider-id");
  await dispatchBillingNotification(notice.key);
  const [message] = jest.mocked(sendNotificationEmail).mock.calls[0];
  expect(message.text).toContain("reply and I’ll help");
  expect(message.text).not.toContain("posts lined up");
  expect(message.text).not.toContain("check your queue here");
});

it("only sends the setup reminder with a matching opt-in and no connected account", async () => {
  jest.mocked(prisma.billingNotification.findUnique).mockResolvedValue({
    ...notice,
    kind: "setup_reminder",
    consentRecipient: "person@example.invalid",
  });
  jest.mocked(prisma.post.count).mockResolvedValue(0);
  jest.mocked(prisma.billingNotification.count).mockResolvedValue(1);
  jest.mocked(sendNotificationEmail).mockResolvedValue("provider-id");
  jest.mocked(getBillingStatus).mockResolvedValue({ active: true, usage: { connectedAccounts: 1 } } as never);
  await dispatchBillingNotification(notice.key);
  expect(sendNotificationEmail).not.toHaveBeenCalled();

  jest.mocked(getBillingStatus).mockResolvedValue({ active: true, usage: { connectedAccounts: 0 } } as never);
  await dispatchBillingNotification(notice.key);
  expect(sendNotificationEmail).toHaveBeenCalledTimes(1);
  expect(sendNotificationEmail).toHaveBeenCalledWith(
    expect.objectContaining({ text: expect.stringContaining("You asked me to send a reminder") }),
    notice.key,
  );

  jest.mocked(prisma.billingNotification.findUnique).mockResolvedValue({
    ...notice,
    kind: "setup_reminder",
    consentRecipient: "previous@example.invalid",
  });
  await dispatchBillingNotification(notice.key);
  expect(sendNotificationEmail).toHaveBeenCalledTimes(1);
});
