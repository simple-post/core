import { NextRequest } from "next/server";

import { DELETE, GET, POST } from "@/app/api/v1/setup-reminder/route";
import { requireBrowserSession } from "@/lib/middleware/auth";
import { prisma } from "@/lib/prisma";

jest.mock("@/lib/middleware/auth", () => ({ requireBrowserSession: jest.fn() }));
jest.mock("@/lib/prisma", () => ({
  prisma: {
    billingNotification: { findUnique: jest.fn(), createMany: jest.fn(), updateMany: jest.fn() },
    connectedAccount: { findFirst: jest.fn() },
  },
}));

const user = {
  id: "new-user",
  email: "new-user@example.invalid",
  emailVerified: true,
  createdAt: new Date(Date.now() - 60_000),
};

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(requireBrowserSession).mockResolvedValue({ user } as never);
  jest.mocked(prisma.connectedAccount.findFirst).mockResolvedValue(null);
});

function request(method: string, origin?: string) {
  return new NextRequest("http://localhost:3000/api/v1/setup-reminder", {
    method,
    headers: origin ? { origin } : {},
  });
}

it("records consent and schedules day two only after an explicit request", async () => {
  const status = await GET(request("GET"));
  expect(await status.json()).toEqual({ available: true, pending: false });
  expect(prisma.billingNotification.createMany).not.toHaveBeenCalled();

  jest.mocked(prisma.billingNotification.findUnique).mockResolvedValue({ status: "pending" } as never);
  const response = await POST(request("POST"));
  expect(await response.json()).toEqual({ available: false, pending: true });
  expect(prisma.billingNotification.createMany).toHaveBeenCalledWith({
    data: expect.objectContaining({
      key: "setup-reminder/v1/new-user",
      consentRecipient: user.email,
      occurredAt: expect.any(Date),
      nextAttemptAt: new Date(user.createdAt.getTime() + 48 * 60 * 60_000),
    }),
    skipDuplicates: true,
  });
});

it("rejects a cross-origin opt-in and allows the account owner to withdraw", async () => {
  const foreign = await POST(request("POST", "https://example.invalid"));
  expect(foreign.status).toBe(403);
  expect(prisma.billingNotification.createMany).not.toHaveBeenCalled();

  const response = await DELETE(request("DELETE"));
  expect(response.status).toBe(200);
  expect(prisma.billingNotification.updateMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { key: "setup-reminder/v1/new-user", status: "pending" },
      data: expect.objectContaining({
        status: "cancelled",
        consentWithdrawnAt: expect.any(Date),
        leaseToken: null,
      }),
    }),
  );
});
