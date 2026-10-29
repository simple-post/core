import { NextRequest } from "next/server";

import { POST } from "@/app/api/internal/ads-measurement/dispatch/route";
import { relayOpenAiMilestones } from "@/lib/analytics/openai-ads";
jest.mock("@/lib/analytics/openai-ads", () => ({ relayOpenAiMilestones: jest.fn() }));
function request(token = "Bearer test-dispatch-secret") {
  return new NextRequest("http://localhost/api/internal/ads-measurement/dispatch", {
    method: "POST",
    headers: { authorization: token },
  });
}
beforeEach(() => {
  jest.clearAllMocks();
});
it.each(["", "test-dispatch-secret", "Bearer wrong", "Bearer short", "Basic test-dispatch-secret"])(
  "rejects unauthorized relay calls: %s",
  async (token) => {
    const response = await POST(request(token));
    expect(response.status).toBe(401);
    expect(relayOpenAiMilestones).not.toHaveBeenCalled();
  },
);
it("delivers only measurement work and reports aggregate success", async () => {
  jest.mocked(relayOpenAiMilestones).mockResolvedValue({ sent: 4, failed: false });
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ sent: 4, failed: false });
  expect(relayOpenAiMilestones).toHaveBeenCalledTimes(1);
});
it("makes failed delivery visible to the scheduler for retry", async () => {
  jest.mocked(relayOpenAiMilestones).mockResolvedValue({ sent: 0, failed: true, error: "OpenAI measurement HTTP 503" });
  const response = await POST(request());
  expect(response.status).toBe(502);
});
it("does not leak database errors or credentials in scheduler responses", async () => {
  jest.mocked(relayOpenAiMilestones).mockRejectedValue(new Error("private database details"));
  const response = await POST(request());
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "Conversion delivery deferred" });
});
