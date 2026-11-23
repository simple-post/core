import { NextRequest } from "next/server";

import { POST } from "@/app/api/internal/scheduled-posts/dispatch/route";
import { relayOpenAiMilestones } from "@/lib/analytics/openai-ads";
import { dispatchDueScheduledPosts } from "@/lib/posting/scheduled-dispatcher";

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
});
