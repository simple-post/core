import { NextRequest } from "next/server";

import { GET } from "@/app/api/v1/accounts/[id]/avatar/route";
import { requireAuth } from "@/lib/middleware/auth";
import { fetchFreshProfilePicture } from "@/lib/oauth/profile-picture";
import { prisma } from "@/lib/prisma";
import { decryptConnectedAccountSecrets } from "@/lib/security/connected-account-secrets";

jest.mock("@/lib/middleware/auth", () => ({ requireAuth: jest.fn() }));
jest.mock("@/lib/oauth/profile-picture", () => ({ fetchFreshProfilePicture: jest.fn() }));
jest.mock("@/lib/prisma", () => ({
  prisma: {
    connectedAccount: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  },
}));
jest.mock("@/lib/security/connected-account-secrets", () => ({
  decryptConnectedAccountSecrets: jest.fn(),
}));

const requireAuthMock = requireAuth as jest.Mock;
const fetchFreshProfilePictureMock = fetchFreshProfilePicture as jest.Mock;
const decryptConnectedAccountSecretsMock = decryptConnectedAccountSecrets as jest.Mock;
const prismaMock = prisma as unknown as {
  connectedAccount: { findUnique: jest.Mock; update: jest.Mock };
};
const fetchMock = jest.fn();

function storedAccount(platform: "linkedin" | "threads", profilePicture: string | null) {
  return {
    id: `account-${platform}`,
    userId: "user-1",
    platform,
    profilePicture,
    accessToken: "encrypted-access-token",
    refreshToken: null,
    tokenMetadata: null,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = fetchMock as unknown as typeof fetch;
  requireAuthMock.mockResolvedValue({ user: { id: "user-1" } });
  prismaMock.connectedAccount.update.mockResolvedValue({});
  decryptConnectedAccountSecretsMock.mockImplementation((account) => ({
    ...account,
    accessToken: "decrypted-access-token",
  }));
});

describe("account avatar route", () => {
  it.each([
    {
      platform: "linkedin" as const,
      staleUrl: "https://media.licdn.com/stale.jpg",
      freshUrl: "https://media.licdn.com/fresh.jpg",
    },
    {
      platform: "threads" as const,
      staleUrl: "https://scontent-old.cdninstagram.com/stale.jpg",
      freshUrl: "https://scontent-new.cdninstagram.com/fresh.jpg",
    },
  ])("refreshes an expired $platform avatar URL and persists it", async ({ platform, staleUrl, freshUrl }) => {
    const account = storedAccount(platform, staleUrl);
    prismaMock.connectedAccount.findUnique.mockResolvedValue(account);
    fetchFreshProfilePictureMock.mockResolvedValue(freshUrl);
    fetchMock
      .mockResolvedValueOnce(new Response("expired", { status: 403, headers: { "Content-Type": "text/plain" } }))
      .mockResolvedValueOnce(
        new Response(Uint8Array.from([1, 2, 3]), { status: 200, headers: { "Content-Type": "image/jpeg" } }),
      );

    const response = await GET(new NextRequest(`http://localhost/api/v1/accounts/${account.id}/avatar`), {
      params: Promise.resolve({ id: account.id }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(fetchFreshProfilePictureMock).toHaveBeenCalledWith(platform, "decrypted-access-token");
    expect(prismaMock.connectedAccount.update).toHaveBeenCalledWith({
      where: { id: account.id },
      data: { profilePicture: freshUrl },
    });
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([staleUrl, freshUrl]);
  });

  it("repairs a missing Threads avatar from the provider", async () => {
    const account = storedAccount("threads", null);
    const freshUrl = "https://scontent-new.cdninstagram.com/fresh.jpg";
    prismaMock.connectedAccount.findUnique.mockResolvedValue(account);
    fetchFreshProfilePictureMock.mockResolvedValue(freshUrl);
    fetchMock.mockResolvedValue(
      new Response(Uint8Array.from([1, 2, 3]), { status: 200, headers: { "Content-Type": "image/jpeg" } }),
    );

    const response = await GET(new NextRequest(`http://localhost/api/v1/accounts/${account.id}/avatar`), {
      params: Promise.resolve({ id: account.id }),
    });

    expect(response.status).toBe(200);
    expect(fetchFreshProfilePictureMock).toHaveBeenCalledWith("threads", "decrypted-access-token");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
