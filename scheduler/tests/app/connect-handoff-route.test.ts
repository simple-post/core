import { NextRequest } from "next/server";

import { POST } from "@/app/api/connect/handoff/route";
import { createConnectionHandoff } from "@/lib/accounts/assistant-handoff";
import { recordFunnelEvent } from "@/lib/analytics/events";
import { isSocialPlatformEnabled } from "@/lib/config";
import { requireAuth } from "@/lib/middleware/auth";
import { getPlatformOAuthConfig } from "@/lib/oauth/config";
import { PaymentRequiredError, UnauthorizedError } from "@/lib/utils/errors";

jest.mock("@/lib/middleware/auth", () => ({ requireAuth: jest.fn() }));
jest.mock("@/lib/analytics/events", () => ({ recordFunnelEvent: jest.fn(), measurementFailure: () => "test_failure" }));
jest.mock("@/lib/oauth/config", () => ({ getPlatformOAuthConfig: jest.fn() }));
jest.mock("@/lib/config", () => ({ ...jest.requireActual("@/lib/config"), isSocialPlatformEnabled: jest.fn() }));

const request = (platform: string, token = createConnectionHandoff("user-1", platform)) =>
  new NextRequest("https://simplepost.example/api/connect/handoff", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ platform, handoffToken: token }),
  });
async function responseStatus(req: NextRequest) {
  const response = await POST(req);
  return response.status;
}
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(requireAuth).mockResolvedValue({ user: { id: "user-1" } } as never);
  jest.mocked(isSocialPlatformEnabled).mockReturnValue(true);
  jest.mocked(getPlatformOAuthConfig).mockReturnValue({ clientId: "configured" } as never);
});

it("prepares direct OAuth without connecting an account and measures only verified link opens", async () => {
  const token = createConnectionHandoff("user-1", "x");
  const response = await POST(request("x", token));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({ connectionType: "oauth", startUrl: `/api/connect/x?handoffToken=${token}` });
  expect(recordFunnelEvent).toHaveBeenCalledWith(
    "user-1",
    "social_connection_link_opened",
    expect.objectContaining({ properties: { platform: "x", source: "assistant_handoff" } }),
  );
});

it("opens a manual setup form without requiring an OAuth client", async () => {
  jest.mocked(getPlatformOAuthConfig).mockReturnValue(undefined);
  const response = await POST(request("forem"));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ connectionType: "manual" });
});

it.each(["other-user", "tampered"])("rejects %s links and measures the validation failure", async (value) => {
  const token = value === "other-user" ? createConnectionHandoff(value, "x") : "bad";
  expect(await responseStatus(request("x", token))).toBe(value === "other-user" ? 403 : 400);
  expect(recordFunnelEvent).toHaveBeenCalledWith(
    "user-1",
    "social_connection_failed",
    expect.objectContaining({ properties: expect.objectContaining({ entrypoint: "handoff_validation" }) }),
  );
});

it("preserves login and billing gates", async () => {
  for (const error of [new UnauthorizedError(), new PaymentRequiredError()]) {
    jest.mocked(requireAuth).mockRejectedValueOnce(error);
    expect(await responseStatus(request("x"))).toBe(error.statusCode);
  }
  expect(recordFunnelEvent).not.toHaveBeenCalled();
});

it("rejects unavailable, unknown, and unconfigured providers", async () => {
  jest.mocked(isSocialPlatformEnabled).mockReturnValueOnce(false);
  expect(await responseStatus(request("x"))).toBe(400);
  expect(await responseStatus(request("madeup"))).toBe(400);
  jest.mocked(getPlatformOAuthConfig).mockReturnValueOnce(undefined);
  expect(await responseStatus(request("x"))).toBe(400);
});
