import { loginCallbackUrl } from "@/lib/auth/callback-url";

const origin = "https://app.simplepost.social";

it("preserves an OAuth continuation through magic-link URL encoding", () => {
  const callback =
    "/oauth/authorize?response_type=code&redirect_uri=https://chatgpt.com/connector/oauth/test&scope=openid+posts:write&code_challenge=abc-_&state=state%2Bwith%26values";
  const resolved = loginCallbackUrl(callback, origin);
  const magicLink = new URL("/api/auth/magic-link/verify", origin);
  magicLink.searchParams.set("callbackURL", resolved);
  const roundTrip = new URL(magicLink.searchParams.get("callbackURL")!);
  expect(roundTrip.origin).toBe(origin);
  expect(roundTrip.pathname).toBe("/oauth/authorize");
  expect(roundTrip.searchParams.get("redirect_uri")).toBe("https://chatgpt.com/connector/oauth/test");
  expect(roundTrip.searchParams.get("scope")).toBe("openid posts:write");
  expect(roundTrip.searchParams.get("state")).toBe("state+with&values");
  expect(roundTrip.searchParams.get("code_challenge")).toBe("abc-_");
});

it.each([
  "https://evil.example/path",
  "//evil.example/path",
  "javascript:alert(1)",
  "https://user:password@app.simplepost.social/",
])("rejects unsafe callback %s", (callback) => {
  expect(() => loginCallbackUrl(callback, origin)).toThrow("must belong to SimplePost");
});

it("accepts normal protected routes and same-origin absolute callbacks", () => {
  expect(loginCallbackUrl("/schedule?tab=drafts", origin)).toBe(`${origin}/schedule?tab=drafts`);
  expect(loginCallbackUrl(`${origin}/oauth/authorize?scope=posts:read`, origin)).toBe(
    `${origin}/oauth/authorize?scope=posts:read`,
  );
});
