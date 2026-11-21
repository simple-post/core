import { handleYouTubeCallback } from "@/lib/oauth/callbacks/youtube";
import { upsertConnectedAccount } from "@/lib/oauth/upsert";
import { prisma } from "@/lib/prisma";
import {
  decryptConnectedAccountSecrets,
  encryptConnectedAccountSecrets,
} from "@/lib/security/connected-account-secrets";

const userId = "youtube-channel-review";
const originalFetch = global.fetch;
const fetchMock = jest.fn();
const channelId = "UC-authorized-channel";
const context = {
  userId,
  platform: "youtube",
  baseURL: "https://app.simplepost.social",
  tokenData: { access_token: "new-access" },
  accessToken: "new-access",
  refreshToken: "new-refresh",
  expiresIn: 3600,
  scope: "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly",
  tokenMetadata: null,
};

beforeEach(async () => {
  delete process.env.SELF_HOSTED;
  fetchMock.mockReset();
  global.fetch = fetchMock;
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.user.create({
    data: {
      id: userId,
      name: "YouTube review",
      email: "youtube-review@example.invalid",
      subscription: {
        create: { stripeCustomerId: "cus_youtube_review", planKey: "basic", status: "active" },
      },
    },
  });
  await prisma.connectedAccount.createMany({
    data: [
      {
        id: "youtube-legacy",
        userId,
        platform: "youtube",
        platformAccountId: "1234567890",
        expiresAt: new Date(Date.now() + 86_400_000),
        ...encryptConnectedAccountSecrets({ accessToken: "old-access", refreshToken: "old-refresh" }),
      },
      ...Array.from({ length: 4 }, (_, i) => ({
        id: `youtube-review-other-${i}`,
        userId,
        platform: "x",
        platformAccountId: `remote-${i}`,
        accessToken: "unused",
      })),
    ],
  });
  await prisma.post.create({
    data: {
      id: "youtube-scheduled-post",
      userId,
      message: "Scheduled video",
      status: "scheduled",
      scheduledFor: new Date(Date.now() + 86_400_000),
      accounts: { connect: { id: "youtube-legacy" } },
      accountOptions: { "youtube-legacy": { privacyStatus: "private" } },
    },
  });
  fetchMock.mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          items: [
            {
              id: channelId,
              snippet: { title: "My channel", customUrl: "@my-channel" },
            },
          ],
        }),
      ),
  );
});

afterAll(async () => {
  global.fetch = originalFetch;
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

it("reconnects a verified legacy row in place at the account limit and preserves scheduled post links", async () => {
  await handleYouTubeCallback(context);
  const accounts = await prisma.connectedAccount.findMany({ where: { userId } });
  expect(accounts).toHaveLength(5);
  const account = accounts.find((item) => item.id === "youtube-legacy")!;
  expect(account.platformAccountId).toBe(channelId);
  expect(account.displayName).toBe("My channel");
  expect(account.accessToken).not.toBe("new-access");
  expect(decryptConnectedAccountSecrets(account)).toMatchObject({
    accessToken: "new-access",
    refreshToken: "new-refresh",
  });
  const post = await prisma.post.findUniqueOrThrow({
    where: { id: "youtube-scheduled-post" },
    include: { accounts: true },
  });
  expect(post.accounts.map((item) => item.id)).toEqual(["youtube-legacy"]);
  expect(post.accountOptions).toEqual({ "youtube-legacy": { privacyStatus: "private" } });
});

it("serializes simultaneous legacy reconnects into one channel connection", async () => {
  await Promise.all(Array.from({ length: 4 }, () => handleYouTubeCallback(context)));
  const accounts = await prisma.connectedAccount.findMany({ where: { userId, platform: "youtube" } });
  expect(accounts).toHaveLength(1);
  expect(accounts[0]).toMatchObject({ id: "youtube-legacy", platformAccountId: channelId });
});

it("rolls back a stale identity verification without replacing credentials or post targets", async () => {
  const before = await prisma.connectedAccount.findUniqueOrThrow({ where: { id: "youtube-legacy" } });
  await expect(
    upsertConnectedAccount({
      userId,
      platform: "youtube",
      platformAccountId: channelId,
      previousIdentity: { platformAccountId: before.platformAccountId, updatedAt: new Date(0) },
      accessToken: "new-access",
      refreshToken: "new-refresh",
      expiresAt: null,
      scope: null,
      displayName: null,
      username: null,
      email: null,
      profilePicture: null,
    }),
  ).rejects.toMatchObject({ code: "profile_fetch_failed" });
  const after = await prisma.connectedAccount.findUniqueOrThrow({ where: { id: "youtube-legacy" } });
  expect(after).toEqual(before);
});
