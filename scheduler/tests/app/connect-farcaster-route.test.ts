import { NextRequest } from "next/server";

import { POST } from "@/app/api/connect/farcaster/route";
import { assertCanConnectAccount } from "@/lib/billing/subscriptions";
import { isSocialPlatformEnabled } from "@/lib/config";
import {
  completeFarcasterConnection,
  FarcasterProtocolError,
  prepareFarcasterConnection,
  revokeFarcasterSigner,
} from "@/lib/farcaster/snapchain";
import { requireAuth } from "@/lib/middleware/auth";
import { upsertConnectedAccount } from "@/lib/oauth/upsert";
import { prisma } from "@/lib/prisma";

jest.mock("@/lib/billing/subscriptions", () => ({ assertCanConnectAccount: jest.fn() }));
jest.mock("@/lib/config", () => {
  const actual = jest.requireActual("@/lib/config");
  return { ...actual, isSocialPlatformEnabled: jest.fn() };
});
jest.mock("@/lib/farcaster/snapchain", () => ({
  completeFarcasterConnection: jest.fn(),
  FarcasterProtocolError: class FarcasterProtocolError extends Error {},
  prepareFarcasterConnection: jest.fn(),
  revokeFarcasterSigner: jest.fn(),
}));
jest.mock("@/lib/middleware/auth", () => ({ requireAuth: jest.fn() }));
jest.mock("@/lib/oauth/upsert", () => ({ upsertConnectedAccount: jest.fn() }));
jest.mock("@/lib/prisma", () => ({
  prisma: { connectedAccount: { findUnique: jest.fn() } },
}));

const requireAuthMock = requireAuth as jest.MockedFunction<typeof requireAuth>;
const isSocialPlatformEnabledMock = isSocialPlatformEnabled as jest.MockedFunction<typeof isSocialPlatformEnabled>;
const prepareMock = prepareFarcasterConnection as jest.MockedFunction<typeof prepareFarcasterConnection>;
const completeMock = completeFarcasterConnection as jest.MockedFunction<typeof completeFarcasterConnection>;
const revokeMock = revokeFarcasterSigner as jest.MockedFunction<typeof revokeFarcasterSigner>;
const assertCanConnectMock = assertCanConnectAccount as jest.MockedFunction<typeof assertCanConnectAccount>;
const upsertMock = upsertConnectedAccount as jest.MockedFunction<typeof upsertConnectedAccount>;
const findUniqueMock = prisma.connectedAccount.findUnique as jest.Mock;

function request(body: unknown): NextRequest {
  return new NextRequest("https://simplepost.example/api/connect/farcaster", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  requireAuthMock.mockResolvedValue({ user: { id: "user-1" } } as Awaited<ReturnType<typeof requireAuth>>);
  isSocialPlatformEnabledMock.mockReturnValue(true);
  findUniqueMock.mockResolvedValue(null);
  upsertMock.mockResolvedValue(undefined);
  revokeMock.mockResolvedValue(undefined);
});

it("rejects connections while Farcaster is disabled for the deployment", async () => {
  isSocialPlatformEnabledMock.mockReturnValue(false);

  const response = await POST(
    request({ action: "prepare", custodyAddress: "0x1111111111111111111111111111111111111111" }),
  );

  expect(response.status).toBe(400);
  expect(prepareMock).not.toHaveBeenCalled();
});

it("prepares a custody-wallet authorization without accepting user signer secrets", async () => {
  prepareMock.mockResolvedValue({
    custodyAddress: "0x1111111111111111111111111111111111111111",
    fid: 123,
    requestToken: "enc:v1:opaque",
    signerExpiresInSeconds: 2_592_000,
    typedData: {
      domain: { name: "Farcaster KeyAdd", version: "1", chainId: 1 },
      types: { EIP712Domain: [], KeyAdd: [] },
      primaryType: "KeyAdd",
      message: { fid: 123, key: "0x01", keyType: 1, scopes: [1, 2], ttl: 2_592_000, nonce: 1, deadline: 2 },
    },
  } as unknown as Awaited<ReturnType<typeof prepareFarcasterConnection>>);

  const response = await POST(
    request({ action: "prepare", custodyAddress: "0x1111111111111111111111111111111111111111" }),
  );

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual(
    expect.objectContaining({ action: "sign", fid: 123, requestToken: "enc:v1:opaque" }),
  );
  expect(assertCanConnectMock).toHaveBeenCalledWith({
    userId: "user-1",
    platform: "farcaster",
    platformAccountId: "123",
  });
  expect(upsertMock).not.toHaveBeenCalled();
});

it("stores only the generated scoped signer through the encrypted account upsert", async () => {
  completeMock.mockResolvedValue({
    custodyAddress: "0x1111111111111111111111111111111111111111",
    expiresAt: new Date("2026-08-13T12:00:00.000Z"),
    fid: 123,
    requestFid: 456,
    scopes: [1, 2],
    signerPrivateKey: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    signerPublicKey: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    ttl: 2_592_000,
    username: "alice",
  });

  const response = await POST(
    request({ action: "complete", requestToken: "enc:v1:opaque", custodySignature: `0x${"11".repeat(65)}` }),
  );

  expect(response.status).toBe(200);
  expect(upsertMock).toHaveBeenCalledWith(
    expect.objectContaining({
      platform: "farcaster",
      platformAccountId: "123",
      scope: "cast:add cast:remove",
      tokenMetadata: expect.objectContaining({
        protocol: "snapchain-key-add-v1",
        requestFid: 456,
        scopes: [1, 2],
      }),
    }),
  );
  expect(upsertMock.mock.calls[0][0].tokenMetadata).not.toHaveProperty("hubUrl");
});

it("revokes a newly registered signer when local persistence fails", async () => {
  completeMock.mockResolvedValue({
    custodyAddress: "0x1111111111111111111111111111111111111111",
    expiresAt: new Date("2026-08-13T12:00:00.000Z"),
    fid: 123,
    requestFid: 456,
    scopes: [1, 2],
    signerPrivateKey: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    signerPublicKey: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    ttl: 2_592_000,
    username: "alice",
  });
  upsertMock.mockRejectedValue(new Error("database unavailable"));

  const response = await POST(
    request({ action: "complete", requestToken: "enc:v1:opaque", custodySignature: `0x${"11".repeat(65)}` }),
  );

  expect(response.status).toBe(500);
  expect(revokeMock).toHaveBeenCalledWith(123, "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
});

it("returns a safe client error for an invalid custody authorization", async () => {
  prepareMock.mockRejectedValue(new FarcasterProtocolError("The wallet is not the custody address"));

  const response = await POST(
    request({ action: "prepare", custodyAddress: "0x1111111111111111111111111111111111111111" }),
  );

  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toEqual(
    expect.objectContaining({ error: "The wallet is not the custody address" }),
  );
});
