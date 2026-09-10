import { NextRequest } from "next/server";

import { POST } from "@/app/mcp/route";
import { assertActiveSubscription } from "@/lib/billing/subscriptions";
import { createLogger } from "@/lib/logger";
import { authenticateMcpToken } from "@/lib/mcp/oauth";
import { PaymentRequiredError } from "@/lib/utils/errors";

jest.mock("@/lib/billing/subscriptions", () => ({ assertActiveSubscription: jest.fn() }));
jest.mock("@/lib/mcp/oauth", () => ({ isMcpToken: () => true, authenticateMcpToken: jest.fn() }));
jest.mock("@/lib/mcp/server", () => ({ registerTools: jest.fn(), SERVER_INSTRUCTIONS: "test" }));
jest.mock("@/lib/mcp/config", () => ({
  DEFAULT_MCP_SCOPE: "posts:read",
  getAppBaseUrl: () => "https://app.simplepost.social",
  getMcpResourceUrl: () => "https://app.simplepost.social/mcp",
}));
jest.mock("@/lib/mcp/review-logging", () => ({ shouldLogReviewMcpExchange: () => false }));
jest.mock("@/lib/logger", () => ({
  createLogger: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() })),
  serializeError: (e: Error) => ({ name: e.name, message: e.message }),
}));
const log = jest.mocked(createLogger).mock.results[0].value;

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(authenticateMcpToken).mockResolvedValue({
    user: { id: "user", email: "test@example.com" },
    session: { scope: "posts:read", clientId: "claude-client" },
  } as never);
  jest.mocked(assertActiveSubscription).mockResolvedValue(undefined as never);
});
function request(body: string, authenticated = true) {
  return new NextRequest("https://app.simplepost.social/mcp", {
    method: "POST",
    body,
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(authenticated ? { authorization: "Bearer test-secret" } : {}),
    },
  });
}
it("returns an actionable terminal billing rejection without warning noise", async () => {
  jest.mocked(assertActiveSubscription).mockRejectedValueOnce(new PaymentRequiredError("Your trial has ended."));
  const response = await POST(request("{}"));
  expect(response.status).toBe(402);
  expect(await response.json()).toMatchObject({
    error: "subscription_required",
    retryable: false,
    message: "Your trial has ended.",
  });
  expect(log.info).toHaveBeenCalledWith(
    expect.objectContaining({ code: "PAYMENT_REQUIRED" }),
    "MCP billing gate denied",
  );
  expect(log.warn).not.toHaveBeenCalled();
});
it("keeps the authentication challenge while logging a safe reason", async () => {
  const response = await POST(request("{}", false));
  expect(response.status).toBe(401);
  expect(response.headers.get("www-authenticate")).toContain("resource_metadata");
  expect(log.info).toHaveBeenCalledWith(
    expect.objectContaining({ reason: "missing_bearer" }),
    "MCP authentication required",
  );
});
it("records a transport reason without logging the request body or credentials", async () => {
  const response = await POST(request("not-json-private-body"));
  expect(response.status).toBe(400);
  expect(log.warn).toHaveBeenCalledWith(
    expect.objectContaining({ statusCode: 400, rpcErrorCode: -32_700, reason: "invalid_json" }),
    "MCP transport request rejected",
  );
  expect(JSON.stringify(log.warn.mock.calls)).not.toMatch(/test-secret|private-body/);
});

it("identifies unsupported protocol versions without recording arbitrary header values", async () => {
  const req = request(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }));
  req.headers.set("mcp-protocol-version", "private-unsupported-value");
  const response = await POST(req);
  expect(response.status).toBe(400);
  expect(log.warn).toHaveBeenCalledWith(
    expect.objectContaining({ reason: "unsupported_protocol_version", userId: "user", rpcErrorCode: -32_000 }),
    "MCP transport request rejected",
  );
  expect(JSON.stringify(log.warn.mock.calls)).not.toContain("private-unsupported-value");
});

it("logs unsupported date versions and client identity without credentials", async () => {
  const req = request(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }));
  req.headers.set("mcp-protocol-version", "2099-01-01");
  const response = await POST(req);
  expect(response.status).toBe(400);
  expect(log.warn).toHaveBeenCalledWith(
    expect.objectContaining({
      requestedProtocolVersion: "2099-01-01",
      clientId: "claude-client",
      supportedProtocolVersions: expect.arrayContaining(["2025-11-25"]),
    }),
    "MCP transport request rejected",
  );
  expect(JSON.stringify(log.warn.mock.calls)).not.toContain("test-secret");
});
it("records successful transport recovery for the same client", async () => {
  const req = request(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }));
  req.headers.set("mcp-protocol-version", "2025-11-25");
  const response = await POST(req);
  expect(response.status).toBe(200);
  expect(log.info).toHaveBeenCalledWith(
    expect.objectContaining({ statusCode: 200, clientId: "claude-client", requestedProtocolVersion: "2025-11-25" }),
    "MCP transport request completed",
  );
});
