/* eslint-disable unicorn/no-await-expression-member -- Keep database assertions beside their operations. */
import { NextRequest } from "next/server";

import axios from "axios";

import { GET as listAccounts } from "@/app/api/v1/accounts/route";
import { requireAuth } from "@/lib/middleware/auth";
import { getConnectedAccountCredentialStatus } from "@/lib/oauth/credential-health";
import { upsertConnectedAccount } from "@/lib/oauth/upsert";
import { recordMetaCredentialRejection } from "@/lib/posting/credential-rejection";
import { prisma } from "@/lib/prisma";
import {
  decryptConnectedAccountSecrets,
  encryptConnectedAccountSecrets,
} from "@/lib/security/connected-account-secrets";
import { validateAccountReadiness } from "@/lib/validation/account-readiness";
import { validatePostForResolvedAccounts } from "@/lib/validation/post-validation";
import type { ConnectedAccount } from "@/types";

// Exercise the real SDK, encrypted persistence, refresh logic and PostgreSQL locks.
// Provider I/O is the only substituted boundary; no Instagram content is published.
jest.mock("axios");
jest.mock("@/lib/middleware/auth", () => ({ requireAuth: jest.fn() }));
const userId = "instagram-rejection-review";
const rejection = { reason: "session_revoked" as const, code: 190, status: 401, subcode: 0 };
const providerError = {
  response: {
    status: 401,
    data: { error: { code: 190, error_subcode: 0, message: "The session has been invalidated." } },
  },
  config: { headers: { Authorization: "Bearer DO_NOT_STORE" } },
};
const params = {
  message: "Photo",
  media: [
    {
      id: "photo",
      filename: "photo.jpg",
      size: 1024,
      type: "image" as const,
      url: "https://example.invalid/photo.jpg",
    },
  ],
};
const storedAccount = () => prisma.connectedAccount.findUniqueOrThrow({ where: { id: "instagram-review" } });
const snapshot = async () => decryptConnectedAccountSecrets(await storedAccount()) as ConnectedAccount;
const reconnect = () =>
  upsertConnectedAccount({
    userId,
    platform: "instagram",
    platformAccountId: "remote",
    accessToken: "new-session",
    refreshToken: null,
    expiresAt: new Date(Date.now() + 60 * 86_400_000),
    scope: null,
    username: "test",
    displayName: null,
    email: null,
    profilePicture: null,
  });

beforeEach(async () => {
  jest.resetAllMocks();
  jest.mocked(requireAuth).mockResolvedValue({ user: { id: userId } } as never);
  process.env.S3_STORAGE_ACCESS_KEY_ID = "offline-review";
  process.env.S3_STORAGE_SECRET_ACCESS_KEY = "offline-review";
  process.env.S3_STORAGE_REGION = "us-east-1";
  process.env.S3_STORAGE_BUCKET = "offline-review";
  process.env.S3_STORAGE_BASE_URL = "https://example.invalid";
  delete process.env.SELF_HOSTED;
  await prisma.publishCheckpoint.deleteMany();
  await prisma.publishAttempt.deleteMany();
  await prisma.storageDeletion.deleteMany();
  await prisma.user.deleteMany();
  await prisma.user.create({
    data: {
      id: userId,
      name: "Instagram review",
      email: "instagram-review@example.invalid",
      freeTrial: { create: { expiresAt: new Date(Date.now() + 86_400_000) } },
    },
  });
  await prisma.connectedAccount.create({
    data: {
      id: "instagram-review",
      userId,
      platform: "instagram",
      platformAccountId: "remote",
      expiresAt: new Date(Date.now() + 60 * 86_400_000),
      updatedAt: new Date("2026-09-27T05:25:33Z"),
      ...encryptConnectedAccountSecrets({ accessToken: "old-session", tokenMetadata: { preserved: true } }),
    },
  });
});
afterAll(async () => prisma.$disconnect());

it("serializes simultaneous revocations into one durable transition without changing tokens", async () => {
  const account = await snapshot();
  const before = await storedAccount();
  const outcomes = await Promise.all(
    Array.from({ length: 10 }, () => recordMetaCredentialRejection(account, rejection)),
  );
  expect(outcomes.filter((result) => result === "recorded")).toHaveLength(1);
  expect(outcomes.filter((result) => result === "already_blocked")).toHaveLength(9);
  const stored = await storedAccount();
  expect(stored.accessToken).toBe(before.accessToken);
  expect(stored.credentialRefreshBlockedAt).toBeInstanceOf(Date);
  expect(stored.tokenMetadata).toHaveProperty("__encrypted");
  expect((await snapshot()).tokenMetadata).toMatchObject({ preserved: true, credentialRejection: rejection });
});

it("records production-shaped preflight rejection and skips later provider calls until reconnect", async () => {
  const account = await snapshot();
  jest.mocked(axios.get).mockRejectedValueOnce(providerError);
  const first = validatePostForResolvedAccounts({ ...params, accounts: [account] });
  expect(first.summary.errors).toEqual([]);
  await validateAccountReadiness(first, params);
  expect(first.summary.isValid).toBe(false);
  const blocked = await snapshot();
  expect(getConnectedAccountCredentialStatus(blocked)).toMatchObject({ state: "reauth_required", action: "reconnect" });
  expect(blocked.tokenMetadata).toMatchObject({ credentialRejection: rejection });
  expect(JSON.stringify(first.summary)).not.toContain("DO_NOT_STORE");
  // Use the stale, healthy snapshot just as an already loaded scheduled-post batch would.
  const second = validatePostForResolvedAccounts({ ...params, accounts: [account] });
  await validateAccountReadiness(second, params);
  expect(second.summary.isValid).toBe(false);
  expect(axios.get).toHaveBeenCalledTimes(1);
  expect(axios.post).not.toHaveBeenCalled();
});

it("rechecks the new session when reconnect completes during an old provider request", async () => {
  const old = await snapshot();
  let started!: () => void;
  let reject!: (error: unknown) => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  jest
    .mocked(axios.get)
    .mockImplementationOnce(() => {
      started();
      return new Promise((_resolve, rejectRequest) => {
        reject = rejectRequest;
      });
    })
    .mockResolvedValueOnce({ data: { data: [{ quota_usage: 0, config: { quota_total: 100 } }] } });
  const validation = validatePostForResolvedAccounts({ ...params, accounts: [old] });
  expect(validation.summary.errors).toEqual([]);
  const pending = validateAccountReadiness(validation, params);
  await ready;
  await reconnect();
  reject(providerError);
  await pending;
  expect(validation.summary.isValid).toBe(true);
  const current = await snapshot();
  expect(current.accessToken).toBe("new-session");
  expect(current.credentialRefreshBlockedAt).toBeNull();
  expect(axios.get).toHaveBeenCalledTimes(2);
  expect(jest.mocked(axios.get).mock.calls[1][1]).toMatchObject({ headers: { Authorization: "Bearer new-session" } });
});

it("reconnect clears the rejection while preserving account identity and queued post targets", async () => {
  const account = await snapshot();
  await prisma.post.create({
    data: {
      id: "queued-instagram-review",
      userId,
      message: "Queued",
      status: "scheduled",
      scheduledFor: new Date(Date.now() + 86_400_000),
      accounts: { connect: { id: account.id } },
    },
  });
  await recordMetaCredentialRejection(account, rejection);
  await reconnect();
  expect(await recordMetaCredentialRejection(account, rejection)).toBe("stale");
  const current = await snapshot();
  expect(current).toMatchObject({
    id: account.id,
    accessToken: "new-session",
    credentialRefreshBlockedAt: null,
    tokenMetadata: null,
  });
  expect(getConnectedAccountCredentialStatus(current).state).toBe("healthy");
  expect(
    await prisma.post.findUniqueOrThrow({ where: { id: "queued-instagram-review" }, include: { accounts: true } }),
  ).toMatchObject({ status: "scheduled", accounts: [expect.objectContaining({ id: account.id })] });
});

it.each([429, 503])("does not set a permanent flag for provider status %s", async (status) => {
  jest.mocked(axios.get).mockRejectedValueOnce({ ...providerError, response: { ...providerError.response, status } });
  const validation = validatePostForResolvedAccounts({ ...params, accounts: [await snapshot()] });
  await validateAccountReadiness(validation, params);
  expect(axios.get).toHaveBeenCalledTimes(1);
  expect((await storedAccount()).credentialRefreshBlockedAt).toBeNull();
});

it.each(["facebook", "threads"] as const)(
  "records %s preflight revocation through the real SDK and blocks the account",
  async (platform) => {
    const created = await prisma.connectedAccount.create({
      data: {
        id: `${platform}-review`,
        userId,
        platform,
        platformAccountId: "remote",
        expiresAt: platform === "threads" ? new Date(Date.now() + 60 * 86_400_000) : null,
        ...encryptConnectedAccountSecrets({ accessToken: "old-session" }),
      },
    });
    const account = decryptConnectedAccountSecrets(created) as ConnectedAccount;
    jest.mocked(axios.get).mockRejectedValueOnce({
      ...providerError,
      response: { status: 400, data: { error: { code: 190, error_subcode: 458 } } },
    });
    const validation = validatePostForResolvedAccounts({ message: "Hello", media: [], accounts: [account] });
    expect(validation.summary.errors).toEqual([]);
    await validateAccountReadiness(validation, { message: "Hello", media: [] });
    expect(validation.summary.isValid).toBe(false);
    expect(JSON.stringify(validation.summary)).not.toContain("DO_NOT_STORE");
    const stored = decryptConnectedAccountSecrets(
      await prisma.connectedAccount.findUniqueOrThrow({ where: { id: account.id } }),
    ) as ConnectedAccount;
    expect(stored.credentialRefreshBlockedAt).toBeInstanceOf(Date);
    expect(stored.tokenMetadata).toMatchObject({
      credentialRejection: { reason: "authorization_removed", code: 190, status: 400, subcode: 458 },
    });
    expect(getConnectedAccountCredentialStatus(stored)).toMatchObject({
      state: "reauth_required",
      message: expect.stringContaining("authorization for SimplePost was removed"),
    });
  },
);

it("exposes reconnect impact only for the owner's queued targets, with no credential data", async () => {
  const account = await snapshot();
  await recordMetaCredentialRejection(account, rejection);
  await prisma.user.create({ data: { id: "other-owner", name: "Other", email: "other@example.invalid" } });
  for (const post of [
    { id: "queued", status: "scheduled", userId },
    { id: "published-target", status: "pending", userId, accountResults: { [account.id]: { success: true } } },
    { id: "draft", status: "draft", userId },
    { id: "other-post", status: "scheduled", userId: "other-owner" },
  ])
    await prisma.post.create({
      data: {
        ...post,
        message: "Photo",
        accounts: { connect: { id: account.id } },
      },
    });
  const response = await listAccounts(new NextRequest("http://localhost/api/v1/accounts"));
  expect(response.status).toBe(200);
  const data = await response.json();
  expect(data.accounts).toEqual([
    expect.objectContaining({
      id: account.id,
      credentialStatus: expect.objectContaining({ state: "reauth_required", affectedQueuedPosts: 1 }),
    }),
  ]);
  for (const privateValue of ["old-session", "accessToken", 'refreshToken"', "tokenMetadata", "__encrypted"])
    expect(JSON.stringify(data)).not.toContain(privateValue);
});
