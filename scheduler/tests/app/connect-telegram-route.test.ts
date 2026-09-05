import { NextRequest } from "next/server";

import { POST } from "@/app/api/connect/telegram/route";
import { upsertConnectedAccount } from "@/lib/oauth/upsert";

jest.mock("@/lib/middleware/auth", () => ({ requireAuth: async () => ({ user: { id: "user-1" } }) }));
jest.mock("@/lib/config", () => ({ isSocialPlatformEnabled: () => true }));
jest.mock("@/lib/oauth/upsert", () => ({ upsertConnectedAccount: jest.fn() }));
const fetchMock = jest.fn();
const originalFetch = global.fetch;
const request = () =>
  new NextRequest("https://app.simplepost.social/api/connect/telegram", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ botToken: "123:test", chatId: "@my_bot" }),
  });
const response = (result: unknown) => new Response(JSON.stringify({ ok: true, result }));
beforeEach(() => {
  jest.clearAllMocks();
  fetchMock.mockReset();
  global.fetch = fetchMock;
});
afterAll(() => {
  global.fetch = originalFetch;
});
it("rejects the bot itself as a destination without persisting it", async () => {
  fetchMock
    .mockResolvedValueOnce(response({ id: 123, username: "my_bot" }))
    .mockResolvedValueOnce(response({ id: 123, type: "private", username: "my_bot" }));
  const result = await POST(request());
  expect(result.status).toBe(400);
  const body = await result.json();
  expect(body.error).toContain("destination is the bot itself");
  expect(upsertConnectedAccount).not.toHaveBeenCalled();
});
it("connects a real destination using Telegram's resolved numeric ID", async () => {
  fetchMock
    .mockResolvedValueOnce(response({ id: 123, username: "my_bot" }))
    .mockResolvedValueOnce(response({ id: 456, type: "private", username: "creator" }));
  const result = await POST(request());
  expect(result.status).toBe(200);
  expect(upsertConnectedAccount).toHaveBeenCalledWith(expect.objectContaining({ platformAccountId: "456" }));
});
