import { NextRequest } from "next/server";

import { hasAllowedOrigin } from "@/lib/middleware/origin";

const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;

afterEach(() => {
  process.env.NEXT_PUBLIC_APP_URL = originalAppUrl;
});

function request(origin?: string): NextRequest {
  return new NextRequest("https://app.simplepost.social/api/v1/upload", {
    method: "POST",
    headers: origin ? { origin } : undefined,
  });
}

it("allows same-origin browser requests", () => {
  process.env.NEXT_PUBLIC_APP_URL = "https://app.simplepost.social/path";

  expect(hasAllowedOrigin(request("https://app.simplepost.social"))).toBe(true);
});

it("rejects cross-origin browser requests", () => {
  process.env.NEXT_PUBLIC_APP_URL = "https://app.simplepost.social";

  expect(hasAllowedOrigin(request("https://attacker.example"))).toBe(false);
});

it("allows non-browser clients without an Origin header", () => {
  expect(hasAllowedOrigin(request())).toBe(true);
});

it("fails closed when the configured app URL is invalid", () => {
  process.env.NEXT_PUBLIC_APP_URL = "not a URL";

  expect(hasAllowedOrigin(request("https://app.simplepost.social"))).toBe(false);
});
