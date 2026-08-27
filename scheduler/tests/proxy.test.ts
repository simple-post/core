import { unstable_doesMiddlewareMatch } from "next/dist/experimental/testing/server/middleware-testing-utils";
import { NextRequest } from "next/server";

import { config, proxy } from "../proxy";

function proxyMatches(url: string): boolean {
  return unstable_doesMiddlewareMatch({ config, nextConfig: {}, url });
}

it("bypasses Proxy for the streaming multipart upload endpoint", () => {
  expect(proxyMatches("/api/v1/upload")).toBe(false);
  expect(proxyMatches("/api/v1/upload/")).toBe(false);
});

it("keeps other protected API endpoints behind Proxy", () => {
  expect(proxyMatches("/api/v1")).toBe(true);
  expect(proxyMatches("/api/v1/upload/presign")).toBe(true);
  expect(proxyMatches("/api/v1/posts")).toBe(true);
  expect(proxyMatches("/api/connect/x")).toBe(true);
});

it("allows OpenAI to fetch OpenID discovery metadata cross-origin", () => {
  const response = proxy(new NextRequest("https://app.simplepost.social/.well-known/openid-configuration"));

  expect(response.headers.get("access-control-allow-origin")).toBe("*");
  expect(response.headers.get("access-control-allow-methods")).toContain("GET");
});
