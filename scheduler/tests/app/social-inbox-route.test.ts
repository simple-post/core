import { NextRequest } from "next/server";

import { GET } from "@/app/api/v1/social/inbox/route";
import { requireAuth } from "@/lib/middleware/auth";
import { getSocialInbox } from "@/lib/social/activity";

jest.mock("@/lib/middleware/auth", () => ({ requireAuth: jest.fn() }));
jest.mock("@/lib/social/activity", () => ({ getSocialInbox: jest.fn() }));

const requireAuthMock = requireAuth as jest.Mock;
const getSocialInboxMock = getSocialInbox as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  requireAuthMock.mockResolvedValue({ user: { id: "user-1" } });
  getSocialInboxMock.mockResolvedValue({ items: [] });
});

it("passes only bounded, owned inbox filters to the social service", async () => {
  const response = await GET(
    new NextRequest("http://localhost/api/v1/social/inbox?kind=comment&accountId=account-1&platform=x&limit=25"),
  );

  expect(response.status).toBe(200);
  expect(getSocialInboxMock).toHaveBeenCalledWith("user-1", {
    kind: "comment",
    accountId: "account-1",
    platform: "x",
    cursor: undefined,
    limit: 25,
  });
});

it.each(["mentioning", "", "COMMENT"])('rejects invalid inbox kind "%s"', async (kind) => {
  const response = await GET(new NextRequest(`http://localhost/api/v1/social/inbox?kind=${kind}`));

  expect(response.status).toBe(400);
  expect(getSocialInboxMock).not.toHaveBeenCalled();
});

it.each(["0", "2.5", "101", "hello"])('rejects unbounded or non-integer limit "%s"', async (limit) => {
  const response = await GET(new NextRequest(`http://localhost/api/v1/social/inbox?limit=${limit}`));

  expect(response.status).toBe(400);
  expect(getSocialInboxMock).not.toHaveBeenCalled();
});
