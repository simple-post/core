import { NextRequest } from "next/server";

import { DEFAULT_MCP_SCOPE } from "@/lib/mcp/config";
import { allowsMcpRestRequest } from "@/lib/mcp/rest-scopes";

const readOnly = "openid email accounts:read posts:read";
const request = (path: string, method = "GET", body?: unknown) =>
  new NextRequest(`http://localhost:3000${path}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
  });

it.each(["/api/v1/accounts", "/api/v1/accounts/id/tiktok/creator-info", "/api/v1/posts", "/api/v1/posts/calendar"])(
  "permits read-only access to %s",
  async (path) => {
    expect(await allowsMcpRestRequest(request(path), readOnly)).toBe(true);
  },
);

it.each([
  ["/api/v1/posts", "POST"],
  ["/api/v1/posts/id", "PATCH"],
  ["/api/v1/posts/id", "DELETE"],
  ["/api/v1/posts/id/repost", "POST"],
  ["/api/v1/upload", "POST"],
  ["/api/v1/upload/presign", "POST"],
  ["/api/v1/accounts/id", "DELETE"],
  ["/api/v1/posting-slots", "PUT"],
  ["/api/v1/unknown", "GET"],
])("denies read-only credentials on %s %s", async (path, method) => {
  expect(await allowsMcpRestRequest(request(path, method), readOnly)).toBe(false);
  expect(await allowsMcpRestRequest(request(path, method), DEFAULT_MCP_SCOPE)).toBe(true);
});

it("enforces separate read scopes", async () => {
  expect(await allowsMcpRestRequest(request("/api/v1/posts"), "accounts:read")).toBe(false);
  expect(await allowsMcpRestRequest(request("/api/v1/accounts"), "posts:read")).toBe(false);
});

it("enforces validation grants without consuming the body, and blocks stored image fitting", async () => {
  const plain = request("/api/v1/validation", "POST", { message: "Test" });
  expect(await allowsMcpRestRequest(plain, readOnly)).toBe(false);
  expect(await allowsMcpRestRequest(plain, "posts:validate")).toBe(true);
  await expect(plain.json()).resolves.toEqual({ message: "Test" });
  const fit = () => request("/api/v1/validation", "POST", { imageFit: { method: "blur" } });
  expect(await allowsMcpRestRequest(fit(), readOnly)).toBe(false);
  expect(await allowsMcpRestRequest(fit(), "posts:validate")).toBe(false);
  expect(await allowsMcpRestRequest(fit(), DEFAULT_MCP_SCOPE)).toBe(true);
  expect(await allowsMcpRestRequest(plain, "posts:read")).toBe(false);
});

it("fails closed for malformed validation requests", async () => {
  const invalid = new NextRequest("http://localhost:3000/api/v1/validation", { method: "POST", body: "{" });
  expect(await allowsMcpRestRequest(invalid, readOnly)).toBe(false);
});
