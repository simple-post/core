import { NextRequest } from "next/server";

import { DELETE } from "@/app/api/v1/accounts/[id]/route";
import { FarcasterProtocolError, revokeFarcasterSigner } from "@/lib/farcaster/snapchain";
import { requireAuth } from "@/lib/middleware/auth";
import { prisma } from "@/lib/prisma";

jest.mock("@/lib/farcaster/snapchain", () => ({
  FarcasterProtocolError: class FarcasterProtocolError extends Error {},
  revokeFarcasterSigner: jest.fn(),
}));
jest.mock("@/lib/middleware/auth", () => ({ requireAuth: jest.fn() }));
jest.mock("@/lib/prisma", () => ({
  prisma: { connectedAccount: { delete: jest.fn(), findUnique: jest.fn() } },
}));

const requireAuthMock = requireAuth as jest.MockedFunction<typeof requireAuth>;
const revokeMock = revokeFarcasterSigner as jest.MockedFunction<typeof revokeFarcasterSigner>;
const deleteMock = prisma.connectedAccount.delete as jest.Mock;
const findUniqueMock = prisma.connectedAccount.findUnique as jest.Mock;

const request = new NextRequest("https://simplepost.example/api/v1/accounts/account-1", { method: "DELETE" });
const context = { params: Promise.resolve({ id: "account-1" }) };

beforeEach(() => {
  jest.clearAllMocks();
  requireAuthMock.mockResolvedValue({ user: { id: "user-1" } } as Awaited<ReturnType<typeof requireAuth>>);
  findUniqueMock.mockResolvedValue({
    accessToken: "aa".repeat(32),
    id: "account-1",
    platform: "farcaster",
    platformAccountId: "123",
    refreshToken: null,
    tokenMetadata: { protocol: "snapchain-key-add-v1" },
    userId: "user-1",
  });
});

it("self-revokes a protocol-native signer before deleting the account", async () => {
  const response = await DELETE(request, context);

  expect(response.status).toBe(200);
  expect(revokeMock).toHaveBeenCalledWith(123, "aa".repeat(32));
  expect(deleteMock).toHaveBeenCalledWith({ where: { id: "account-1" } });
  expect(revokeMock.mock.invocationCallOrder[0]).toBeLessThan(deleteMock.mock.invocationCallOrder[0]);
});

it("keeps the account when on-protocol revocation fails", async () => {
  revokeMock.mockRejectedValue(new FarcasterProtocolError("Snapchain unavailable"));

  const response = await DELETE(request, context);

  expect(response.status).toBe(502);
  await expect(response.json()).resolves.toEqual(
    expect.objectContaining({ code: "FARCASTER_REVOCATION_FAILED", error: expect.stringContaining("not deleted") }),
  );
  expect(deleteMock).not.toHaveBeenCalled();
});

it("does not attempt protocol revocation for legacy account records", async () => {
  findUniqueMock.mockResolvedValue({
    accessToken: "legacy-secret",
    id: "account-1",
    platform: "farcaster",
    platformAccountId: "123",
    refreshToken: null,
    tokenMetadata: { hubUrl: "legacy.example:2283" },
    userId: "user-1",
  });

  const response = await DELETE(request, context);

  expect(response.status).toBe(200);
  expect(revokeMock).not.toHaveBeenCalled();
  expect(deleteMock).toHaveBeenCalled();
});
