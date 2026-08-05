import { unstable_doesMiddlewareMatch } from "next/dist/experimental/testing/server/middleware-testing-utils";

import { config } from "../proxy";

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
