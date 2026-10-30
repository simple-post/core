import { NextRequest } from "next/server";

import { auth } from "@/lib/auth/auth";
import { assertActiveSubscription, assertPlanFeature } from "@/lib/billing/subscriptions";
import { requireAuth, requireReadAuth } from "@/lib/middleware/auth";
import { prisma } from "@/lib/prisma";
import { PaymentRequiredError, UnauthorizedError } from "@/lib/utils/errors";

jest.mock("@/lib/auth/auth", () => ({ auth: { api: { getSession: jest.fn() } } }));
jest.mock("@/lib/billing/subscriptions", () => ({
  assertActiveSubscription: jest.fn(),
  assertPlanFeature: jest.fn(),
}));
jest.mock("@/lib/logger/request-context", () => ({ rememberRequestUser: jest.fn() }));
jest.mock("@/lib/prisma", () => ({
  prisma: {
    cliToken: { findUnique: jest.fn(), update: jest.fn() },
    apiKey: { findUnique: jest.fn(), update: jest.fn() },
  },
}));

const session = { user: { id: "owner" }, session: { id: "session" } };
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(auth.api.getSession).mockResolvedValue(session as never);
  jest.mocked(assertPlanFeature).mockRejectedValue(new PaymentRequiredError());
  jest.mocked(assertActiveSubscription).mockImplementation(async (_user, _context, options) => {
    if (options?.allowExpiredTrialRead)
      return { active: false, subscription: null, trial: { status: "expired" } } as never;
    throw new PaymentRequiredError();
  });
});

it.each(["cli", "api"])("keeps %s bearer credentials on their existing paid-access checks", async (kind) => {
  const tokenModel = kind === "cli" ? prisma.cliToken : prisma.apiKey;
  jest.mocked(tokenModel.findUnique).mockResolvedValue({
    id: "credential",
    user: session.user,
    expiresAt: new Date("2099-01-01"),
    revokedAt: null,
  } as never);
  jest.mocked(tokenModel.update).mockResolvedValue({} as never);
  const request = new NextRequest("https://example.test/api/v1/posts", {
    headers: { authorization: `Bearer sp_${kind}_test-only` },
  });
  await expect(requireReadAuth(request)).rejects.toBeInstanceOf(PaymentRequiredError);
  expect(assertPlanFeature).toHaveBeenCalledWith(
    "owner",
    kind === "cli" ? "cliAccess" : "apiAccess",
    expect.any(Object),
  );
  expect(assertActiveSubscription).not.toHaveBeenCalled();
});

it("lets an authenticated expired-trial user inspect saved data but keeps writes gated", async () => {
  expect(await requireReadAuth(new NextRequest("https://example.test/api/v1/posts"))).toBe(session);
  expect(assertActiveSubscription).toHaveBeenCalledWith("owner", expect.any(Object), { allowExpiredTrialRead: true });
  for (const method of ["POST", "PATCH", "DELETE", "PUT"]) {
    await expect(requireAuth(new NextRequest("https://example.test/api/v1/posts", { method }))).rejects.toBeInstanceOf(
      PaymentRequiredError,
    );
  }
});

it("cannot turn a mutation into free access by using the read helper", async () => {
  await expect(
    requireReadAuth(new NextRequest("https://example.test/api/v1/posts", { method: "POST" })),
  ).rejects.toBeInstanceOf(PaymentRequiredError);
});

it("does not grant access to anonymous users or accounts without an expired trial", async () => {
  jest.mocked(auth.api.getSession).mockResolvedValueOnce(null);
  await expect(requireReadAuth(new NextRequest("https://example.test/api/v1/posts"))).rejects.toBeInstanceOf(
    UnauthorizedError,
  );
  jest.mocked(assertActiveSubscription).mockRejectedValueOnce(new PaymentRequiredError());
  await expect(requireReadAuth(new NextRequest("https://example.test/api/v1/posts"))).rejects.toBeInstanceOf(
    PaymentRequiredError,
  );
});

it("retains the existing access checks for active users", async () => {
  jest.mocked(assertActiveSubscription).mockResolvedValueOnce({ active: true } as never);
  expect(await requireReadAuth(new NextRequest("https://example.test/api/v1/posts"))).toBe(session);
  expect(assertActiveSubscription).toHaveBeenCalledWith("owner", expect.any(Object), { allowExpiredTrialRead: true });
});
