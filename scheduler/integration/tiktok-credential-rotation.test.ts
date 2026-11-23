import { refreshConnectedAccountIfNeeded } from "@/lib/oauth/credential-health";
import { prisma } from "@/lib/prisma";
import {
  decryptConnectedAccountSecrets,
  encryptConnectedAccountSecrets,
} from "@/lib/security/connected-account-secrets";

const userId = "tiktok-credential-rotation";
const accountId = "tiktok-credential-rotation-account";
const now = new Date("2026-12-01T08:00:00Z");
const where = { id: accountId };

beforeEach(async () => {
  process.env.TIKTOK_CLIENT_KEY = "test-client";
  process.env.TIKTOK_CLIENT_SECRET = "test-secret";
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.user.create({
    data: { id: userId, name: "TikTok test", email: "tiktok-test@example.invalid" },
  });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.TIKTOK_CLIENT_KEY;
  delete process.env.TIKTOK_CLIENT_SECRET;
});

it("persists TikTok rotations across overlapping refreshes and profile writes", async () => {
  const original = decryptConnectedAccountSecrets(
    await prisma.connectedAccount.create({
      data: {
        ...where,
        userId,
        platform: "tiktok",
        platformAccountId: "creator",
        expiresAt: now,
        ...encryptConnectedAccountSecrets({ accessToken: "old-access", refreshToken: "first-refresh" }),
      },
    }),
  );
  let finishRefresh!: (response: Response) => void;
  let startRefresh!: () => void;
  const started = new Promise<void>((resolve) => {
    startRefresh = resolve;
  });
  const fetchMock = jest
    .spyOn(globalThis, "fetch")
    .mockImplementation(async () => {
      throw new Error("Unexpected extra refresh");
    })
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finishRefresh = resolve;
          startRefresh();
        }),
    );

  const first = refreshConnectedAccountIfNeeded(original, { now });
  await Promise.race([
    started,
    first.then(() => {
      throw new Error("Refresh finished before calling TikTok");
    }),
  ]);
  const overlapping = refreshConnectedAccountIfNeeded(original, { now });
  try {
    await expect(
      prisma.$transaction(async (client) => {
        await client.$executeRaw`SET LOCAL lock_timeout = '200ms'`;
        await client.connectedAccount.update({ where, data: { profilePicture: "new-avatar" } });
      }),
    ).rejects.toThrow(/lock timeout/i);
  } finally {
    finishRefresh(
      Response.json({
        access_token: "new-access",
        expires_in: 7200,
        refresh_token: "second-refresh",
        refresh_expires_in: 180 * 86_400,
      }),
    );
  }

  const [refreshed, skipped] = await Promise.all([first, overlapping]);
  expect(refreshed).toMatchObject({
    refreshed: true,
    status: { refreshTokenExpiresAt: "2027-05-30T08:00:00.000Z" },
    account: { expiresAt: new Date("2026-12-01T10:00:00Z") },
  });
  expect(skipped).toMatchObject({ refreshed: false, account: { accessToken: "new-access" } });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect((fetchMock.mock.calls[0]?.[1]?.body as URLSearchParams).get("refresh_token")).toBe("first-refresh");

  await prisma.connectedAccount.update({ where, data: { profilePicture: "new-avatar" } });
  fetchMock.mockResolvedValueOnce(
    Response.json({
      access_token: "latest-access",
      expires_in: 7200,
      refresh_token: "third-refresh",
      refresh_expires_in: 180 * 86_400 - 7200,
    }),
  );
  await refreshConnectedAccountIfNeeded(original, { now: new Date("2026-12-01T10:00:00Z") });

  expect((fetchMock.mock.calls[1]?.[1]?.body as URLSearchParams).get("refresh_token")).toBe("second-refresh");
  const stored = decryptConnectedAccountSecrets(await prisma.connectedAccount.findUniqueOrThrow({ where }));
  expect(stored).toMatchObject({
    accessToken: "latest-access",
    refreshToken: "third-refresh",
    profilePicture: "new-avatar",
    expiresAt: new Date("2026-12-01T12:00:00Z"),
    tokenMetadata: { refreshTokenExpiresAt: "2027-05-30T08:00:00.000Z" },
  });
});
