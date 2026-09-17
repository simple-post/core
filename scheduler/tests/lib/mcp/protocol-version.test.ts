import { NextRequest } from "next/server";

import { POST } from "@/app/mcp/route";
import { assertActiveSubscription } from "@/lib/billing/subscriptions";
import { hasFeature } from "@/lib/features";
import { authenticateMcpToken } from "@/lib/mcp/oauth";

const TOOL_NAMES = [
  "list_accounts",
  "get_tiktok_creator_info",
  "upload_media",
  "validate_post",
  "preview_post",
  "show_post_preview",
  "create_post",
  "inspect_posts",
  "get_schedule",
  "show_schedule",
  "update_scheduled_post",
  "discard_scheduled_post",
];

jest.mock("@modelcontextprotocol/ext-apps/server", () => ({
  RESOURCE_MIME_TYPE: "text/html;profile=mcp-app",
  registerAppResource: (
    server: { registerResource: (...args: unknown[]) => unknown },
    name: string,
    uri: string,
    config: Record<string, unknown>,
    callback: (...args: unknown[]) => unknown,
  ) => server.registerResource(name, uri, config, callback),
  registerAppTool: (
    server: { registerTool: (...args: unknown[]) => unknown },
    name: string,
    config: Record<string, unknown>,
    callback: (...args: unknown[]) => unknown,
  ) => server.registerTool(name, config, callback),
}));
jest.mock("@/lib/features", () => ({ hasFeature: jest.fn() }));
jest.mock("@/lib/billing/subscriptions", () => ({ assertActiveSubscription: jest.fn() }));
jest.mock("@/lib/mcp/oauth", () => ({ isMcpToken: () => true, authenticateMcpToken: jest.fn() }));
jest.mock("@/lib/mcp/review-logging", () => ({ shouldLogReviewMcpExchange: () => false }));

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(hasFeature).mockResolvedValue(true);
  jest.mocked(assertActiveSubscription).mockResolvedValue(undefined as never);
  jest.mocked(authenticateMcpToken).mockResolvedValue({
    user: { id: "user", email: "test@example.com" },
    session: {
      scope: "accounts:read posts:read posts:validate posts:write",
      clientId: "test-client",
    },
  } as never);
});

function modernRequest(method: string): NextRequest {
  return new NextRequest("https://app.simplepost.social/mcp", {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      authorization: "Bearer test-secret",
      "content-type": "application/json",
      "mcp-method": method,
      "mcp-protocol-version": "2026-07-28",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params: {
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientInfo": { name: "test-client", version: "1.0.0" },
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    }),
  });
}

function legacyRequest(method: string): NextRequest {
  return new NextRequest("https://app.simplepost.social/mcp", {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      authorization: "Bearer test-secret",
      "content-type": "application/json",
      "mcp-protocol-version": "2025-11-25",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: {} }),
  });
}

function expectToolSurface(body: { result: { tools: Array<{ name: string }> } }): void {
  expect(body.result.tools.map((tool) => tool.name)).toEqual(TOOL_NAMES);
}

it("publishes the complete tool surface over MCP 2026-07-28", async () => {
  const response = await POST(modernRequest("tools/list"));
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(body).toMatchObject({ jsonrpc: "2.0", id: 1 });
  expectToolSurface(body);
  expect(body.result.tools.find((tool: { name: string }) => tool.name === "create_post")).toMatchObject({
    inputSchema: {
      type: "object",
      properties: {
        accountIds: { type: "array" },
        imageFit: { type: "string" },
        message: { type: "string" },
      },
    },
  });
});

it("keeps JSON responses and the complete tool surface for MCP 2025-11-25 clients", async () => {
  const response = await POST(legacyRequest("tools/list"));
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("application/json");
  expectToolSurface(body);
});
