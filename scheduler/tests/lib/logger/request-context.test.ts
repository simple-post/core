import { NextRequest } from "next/server";

import { apiLogger } from "@/lib/logger";
import { rememberRequestUser, requestErrorContext } from "@/lib/logger/request-context";
import { prisma } from "@/lib/prisma";
import { handleApiError } from "@/lib/utils/errors";

jest.mock("@/lib/prisma", () => ({ prisma: { connectedAccount: { findMany: jest.fn() } } }));
jest.mock("@/lib/logger", () => ({
  apiLogger: { error: jest.fn(), warn: jest.fn() },
  serializeError: (error: Error) => ({ name: error.name, message: error.message }),
}));
const findMany = prisma.connectedAccount.findMany as jest.Mock;
beforeEach(() => jest.clearAllMocks());

it("isolates concurrent users and keeps identity out of API responses", async () => {
  const first = new NextRequest("https://example.com/api/v1/upload?secret=hidden");
  const second = new NextRequest("https://example.com/api/v1/upload");
  rememberRequestUser(first, { id: "one", email: "one@example.com" });
  rememberRequestUser(second, { id: "two", email: "two@example.com" });
  findMany.mockImplementation(async ({ where }) => [{ id: where.userId, platform: "x", username: where.userId }]);
  const contexts = await Promise.all([requestErrorContext(first), requestErrorContext(second)]);
  expect(contexts.map((context) => context.userEmail)).toEqual(["one@example.com", "two@example.com"]);
  expect(contexts[0].requestPath).toBe("/api/v1/upload");
  expect(contexts[0].connectedAccounts).toEqual([{ id: "one", platform: "x", username: "one" }]);
  expect(findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { userId: "one" },
      select: { id: true, platform: true, username: true, displayName: true, platformAccountId: true },
    }),
  );
  const response = await handleApiError(new Error("Storage failed"), first);
  expect(apiLogger.error).toHaveBeenCalledWith(
    expect.objectContaining({ userEmail: "one@example.com", connectedAccounts: contexts[0].connectedAccounts }),
    "Unexpected API error",
  );
  expect(await response.json()).toEqual({ error: "Storage failed", code: "INTERNAL_SERVER_ERROR" });
});

it("retains the email and original error when account lookup fails", async () => {
  const req = new NextRequest("https://example.com/api/v1/upload");
  rememberRequestUser(req, { id: "one", email: "one@example.com" });
  findMany.mockRejectedValue(new Error("Database unavailable"));
  const response = await handleApiError(new Error("Original failure"), req);
  expect(response.status).toBe(500);
  expect(apiLogger.error).toHaveBeenCalledWith(
    expect.objectContaining({
      userEmail: "one@example.com",
      connectedAccountsStatus: "unavailable (account lookup failed)",
      err: { name: "Error", message: "Original failure" },
    }),
    "Unexpected API error",
  );
});

it("does not guess identities before authentication", async () => {
  const context = await requestErrorContext(new NextRequest("https://example.com/api/v1/upload"));
  expect(context.userIdentityStatus).toContain("unavailable");
  expect(context.userEmail).toBeUndefined();
  expect(findMany).not.toHaveBeenCalled();
});
