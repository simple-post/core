import { after, NextRequest } from "next/server";

import { POST } from "@/app/api/internal/scheduled-posts/dispatch/route";
import { relayOpenAiMilestones } from "@/lib/analytics/openai-ads";
import { dispatchDueScheduledPosts } from "@/lib/posting/scheduled-dispatcher";
import { runBackgroundInboxRefresh } from "@/lib/social/activity";

jest.mock("next/server", () => ({ ...jest.requireActual("next/server"), after: jest.fn() }));
jest.mock("@/lib/post-analytics/background", () => ({ runBackgroundAnalyticsRefresh: jest.fn() }));
jest.mock("@/lib/social/activity", () => ({ runBackgroundInboxRefresh: jest.fn() }));
jest.mock("@/lib/analytics/openai-ads", () => ({ relayOpenAiMilestones: jest.fn() }));
jest.mock("@/lib/posting/scheduled-dispatcher", () => ({ dispatchDueScheduledPosts: jest.fn() }));
const result = { dispatched: 1 };
function request(token = "test-dispatch-secret") {
  return new NextRequest("http://localhost/api/internal/scheduled-posts/dispatch", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
}
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(dispatchDueScheduledPosts).mockResolvedValue(result as never);
  jest.mocked(relayOpenAiMilestones).mockResolvedValue({ sent: 4, failed: false });
});
it("relays milestones after successful publishing without changing the dispatch response", async () => {
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(result);
  expect(jest.mocked(dispatchDueScheduledPosts).mock.invocationCallOrder[0]).toBeLessThan(
    jest.mocked(relayOpenAiMilestones).mock.invocationCallOrder[0],
  );
});
it.each(["network", "database"])("keeps publishing successful when measurement has a %s failure", async (failure) => {
  if (failure === "network") jest.mocked(relayOpenAiMilestones).mockResolvedValue({ sent: 0, failed: true });
  else jest.mocked(relayOpenAiMilestones).mockRejectedValue(new Error("database unavailable"));
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(result);
});
it("requires the existing internal dispatch authorization", async () => {
  const response = await POST(request("wrong"));
  expect(response.status).toBe(401);
  expect(relayOpenAiMilestones).not.toHaveBeenCalled();
  expect(dispatchDueScheduledPosts).not.toHaveBeenCalled();
  expect(after).not.toHaveBeenCalled();
});

it("returns the dispatch response before the inbox worker runs, even if inbox sync fails", async () => {
  jest.mocked(runBackgroundInboxRefresh).mockRejectedValueOnce(new Error("Inbox provider unavailable"));
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(result);
  expect(after).toHaveBeenCalledTimes(1);
  expect(runBackgroundInboxRefresh).not.toHaveBeenCalled();
  const [runInbox] = jest.mocked(after).mock.calls[0];
  if (typeof runInbox !== "function") throw new Error("Expected an after callback");
  await expect(runInbox()).resolves.toBeUndefined();
  expect(runBackgroundInboxRefresh).toHaveBeenCalledTimes(1);
});
