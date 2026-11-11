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

it("applies a canonical landing locale to the first render and persists it without changing OAuth state", () => {
  const req = new NextRequest(
    "https://app.simplepost.social/oauth/authorize?ui_locale=ar&state=untouched&redirect_uri=https%3A%2F%2Fclient.example%2Fcb",
    {
      headers: { cookie: "session=private; ui_locale=ja", "accept-language": "fr" },
    },
  );
  const response = proxy(req);
  expect(response.headers.get("x-middleware-request-cookie")).toBe("session=private; ui_locale=ar");
  expect(response.cookies.get("ui_locale")?.value).toBe("ar");
  expect(response.headers.get("location")).toBeNull();
  expect(req.nextUrl.searchParams.get("state")).toBe("untouched");
  expect(req.nextUrl.searchParams.get("redirect_uri")).toBe("https://client.example/cb");
});

it.each(["unknown", "spa", "<script>"])("ignores invalid or noncanonical landing locale %s", (locale) => {
  const response = proxy(
    new NextRequest(`https://app.simplepost.social/login?ui_locale=${encodeURIComponent(locale)}`),
  );
  expect(response.cookies.get("ui_locale")).toBeUndefined();
});

it("matches browser entry pages but does not add proxy buffering to unrelated API or static routes", () => {
  for (const path of ["/", "/login", "/oauth/authorize", "/accounts", "/billing/plans"])
    expect(proxyMatches(path)).toBe(true);
  for (const path of [
    "/api/auth/sign-in",
    "/api/internal/job",
    "/_next/static/chunk.js",
    "/logo.svg",
    "/mcp-widgets/main.js",
  ])
    expect(proxyMatches(path)).toBe(false);
});

it("does not apply a page locale hint to API requests", () => {
  const response = proxy(new NextRequest("https://app.simplepost.social/api/v1/posts?ui_locale=ar"));
  expect(response.cookies.get("ui_locale")).toBeUndefined();
});
