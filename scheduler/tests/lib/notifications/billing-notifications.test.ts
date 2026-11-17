import { getBillingStatus } from "@/lib/billing/subscriptions";
import { dispatchBillingNotification } from "@/lib/notifications/billing-notifications";
import { prisma } from "@/lib/prisma";
import { sendNotificationEmail } from "@/lib/resend/notification-email";

import type { BillingNotification } from "@prisma/client";

jest.mock("@/lib/billing/subscriptions", () => ({ getBillingStatus: jest.fn() }));
jest.mock("@/lib/prisma", () => ({
  prisma: {
    billingNotification: { findUnique: jest.fn(), updateMany: jest.fn() },
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
  jest.mocked(prisma.billingNotification.findUnique).mockResolvedValue(notice);
  jest.mocked(prisma.billingNotification.updateMany).mockResolvedValue({ count: 1 });
  jest.mocked(prisma.user.findUnique).mockResolvedValue({
    email: "person@example.invalid",
    freeTrial: { expiresAt },
    publishingPreferences: { timeZone: "Europe/Berlin" },
  } as never);
});

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
    expect.objectContaining({ replyTo: "support@simplepost.social", text: expect.stringContaining("one post") }),
    notice.key,
  );
  expect(prisma.billingNotification.updateMany).toHaveBeenLastCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ status: "sent", providerMessageId: "provider-id" }) }),
  );
});
