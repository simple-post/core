import { NextRequest } from "next/server";

import { GET, POST } from "@/app/api/connect/pending/[id]/route";
import { recordFunnelEvent } from "@/lib/analytics/events";
import { upsertConnectedAccount } from "@/lib/oauth";
import { handleFacebookCallback } from "@/lib/oauth/callbacks/facebook";
import { prisma } from "@/lib/prisma";

jest.mock("@/lib/middleware/auth", () => ({ requireAuth: async () => ({ user: { id: "user-1" } }) }));
jest.mock("@/lib/analytics/events", () => ({ recordFunnelEvent: jest.fn(), measurementFailure: () => "test_failure" }));
jest.mock("@/lib/oauth", () => ({ upsertConnectedAccount: jest.fn() }));
jest.mock("@/lib/prisma", () => ({
  prisma: {
    pendingOAuthConnection: { deleteMany: jest.fn(), create: jest.fn(), findFirst: jest.fn(), delete: jest.fn() },
    $transaction: jest.fn(),
  },
}));

it("retains AI origin through Facebook page selection and counts completion only after saving", async () => {
  const pending = {
    id: "pending-1",
    platform: "facebook",
    userId: "user-1",
    expiresAt: new Date(Date.now() + 60_000),
    data: {},
  };
  (prisma.pendingOAuthConnection.create as jest.Mock).mockImplementation(async (input: { data: { data: object } }) => {
    pending.data = input.data.data as object;
    return pending as never;
  });
  jest.mocked(prisma.pendingOAuthConnection.findFirst).mockResolvedValue(pending as never);
  jest
    .mocked(prisma.$transaction)
    .mockImplementation(async (callback: unknown) => (callback as (tx: typeof prisma) => Promise<unknown>)(prisma));
  const fetchMock = jest
    .spyOn(global, "fetch")
    .mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: "page-1", name: "Test Page", access_token: "provider-secret" }] })),
    );
  try {
    await handleFacebookCallback({
      userId: "user-1",
      platform: "facebook",
      baseURL: "https://simplepost.example",
      tokenData: {},
      accessToken: "private-token",
      refreshToken: null,
      expiresIn: undefined,
      scope: "pages_manage_posts",
      tokenMetadata: null,
      source: "assistant_handoff",
    });
    expect(pending.data).toMatchObject({ source: "assistant_handoff" });
    expect(recordFunnelEvent).not.toHaveBeenCalled();
    const params = { params: Promise.resolve({ id: pending.id }) };
    const picker = await GET(new NextRequest(`https://simplepost.example/api/connect/pending/${pending.id}`), params);
    const pickerText = JSON.stringify(await picker.json());
    expect(pickerText).not.toContain("provider-secret");
    expect(pickerText).not.toContain("source");
    const saved = await POST(
      new NextRequest(`https://simplepost.example/api/connect/pending/${pending.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectedAccountIds: ["page-1"] }),
      }),
      params,
    );
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ success: true, source: "assistant_handoff" });
    expect(upsertConnectedAccount).toHaveBeenCalledWith(
      expect.objectContaining({ platformAccountId: "page-1", userId: "user-1" }),
      prisma,
    );
    expect(recordFunnelEvent).toHaveBeenCalledWith("user-1", "social_connection_completed", {
      key: "pending:pending-1",
      properties: { platform: "facebook", source: "assistant_handoff" },
    });
  } finally {
    fetchMock.mockRestore();
  }
});
