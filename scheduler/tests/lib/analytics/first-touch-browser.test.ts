import assert from "node:assert/strict";

import {
  acquisitionContext,
  captureFirstTouch,
  createFirstTouch,
  readFirstTouch,
  normalizeSource,
  FIRST_TOUCH_COOKIE,
  LAST_NON_DIRECT_COOKIE,
  SIGNUP_ENTRY_COOKIE,
} from "@/lib/analytics/first-touch";

function browser(
  run: (navigate: (href: string, referrer?: string, fresh?: boolean) => void, cookies: Map<string, string>) => void,
) {
  const descriptors = ["window", "document"].map((key) => Object.getOwnPropertyDescriptor(globalThis, key));
  const cookies = new Map<string, string>();
  const location = { current: new URL("https://simplepost.social/") };
  function documentFor(referrer: string) {
    return {
      referrer,
      get cookie() {
        return [...cookies].map(([k, v]) => `${k}=${v}`).join("; ");
      },
      set cookie(value: string) {
        const [key, ...rest] = value.split(";")[0].split("=");
        cookies.set(key, rest.join("="));
      },
    };
  }
  let doc = documentFor("");
  const win = {
    get location() {
      return location.current;
    },
    localStorage: { getItem: () => null },
  };
  Object.defineProperty(globalThis, "window", { configurable: true, value: win });
  Object.defineProperty(globalThis, "document", { configurable: true, get: () => doc });
  try {
    run((href, referrer = "", fresh = true) => {
      location.current = new URL(href);
      if (fresh) doc = documentFor(referrer);
      captureFirstTouch();
    }, cookies);
  } finally {
    ["window", "document"].forEach((key, i) => {
      const value = descriptors[i];
      if (value) Object.defineProperty(globalThis, key, value);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
}

test("keeps direct first touch while saving a later campaign, then preserves it on a direct return", () =>
  browser((navigate, cookies) => {
    navigate("https://simplepost.social/");
    const first = cookies.get(FIRST_TOUCH_COOKIE);
    navigate("https://simplepost.social/?utm_source=chatgpt&utm_medium=plugin&utm_campaign=listing&utm_content=setup");
    assert.equal(cookies.get(FIRST_TOUCH_COOKIE), first);
    const last = cookies.get(LAST_NON_DIRECT_COOKIE);
    assert.ok(last);
    navigate("https://app.simplepost.social/schedule");
    assert.equal(cookies.get(LAST_NON_DIRECT_COOKIE), last);
    const context = acquisitionContext([...cookies].map(([k, v]) => `${k}=${v}`).join("; "));
    assert.equal(context.source, "direct");
    assert.equal(context.lastNonDirect?.campaign, "listing");
    assert.equal(context.measurementVersion, "funnel-v2");
  }));

test("does not reuse an initial document referrer during SPA navigation", () =>
  browser((navigate, cookies) => {
    navigate("https://simplepost.social/", "https://www.google.com/search?q=private");
    const last = cookies.get(LAST_NON_DIRECT_COOKIE);
    navigate("https://simplepost.social/pricing", "", false);
    assert.equal(cookies.get(LAST_NON_DIRECT_COOKIE), last);
  }));

test("auth and checkout returns cannot replace a qualified source", () =>
  browser((navigate, cookies) => {
    navigate("https://simplepost.social/?utm_source=chatgpt");
    const last = cookies.get(LAST_NON_DIRECT_COOKIE);
    navigate("https://app.simplepost.social/schedule?checkout=success", "https://checkout.stripe.com/session");
    navigate("https://app.simplepost.social/accounts?success=x&utm_source=provider", "https://x.com/oauth");
    navigate("https://app.simplepost.social/schedule", "https://accounts.google.com/oauth");
    assert.equal(cookies.get(LAST_NON_DIRECT_COOKIE), last);
  }));

test("preserves assistant signup entry through login without calling it an acquisition source", () =>
  browser((navigate, cookies) => {
    navigate("https://app.simplepost.social/oauth/authorize?client_id=private&state=secret");
    navigate("https://app.simplepost.social/login");
    assert.equal(cookies.get(SIGNUP_ENTRY_COOKIE), "assistant_authorize");
    const context = acquisitionContext([...cookies].map(([k, v]) => `${k}=${v}`).join("; "));
    assert.equal(context.signupEntryPoint, "assistant_authorize");
    assert.equal(context.source, "direct");
    assert.ok(!JSON.stringify(context).includes("secret"));
  }));

test("accepts pre-upgrade v1 cookies and normalizes reporting aliases", () => {
  const touch = createFirstTouch("https://simplepost.social/?utm_source=chat.openai.com", "");
  delete touch.sourceMethod;
  const parsed = readFirstTouch(`${FIRST_TOUCH_COOKIE}=${encodeURIComponent(JSON.stringify(touch))}`);
  assert.deepEqual(parsed, touch);
  assert.equal(normalizeSource(parsed!.source), "chatgpt");
  assert.equal(acquisitionContext("").source, "unknown");
});
