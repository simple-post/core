import { test, expect, type Browser, type Route } from "@playwright/test";
import { verifyOnPlatform, VerificationSetupError } from "../src/verification/browser.js";
import {
  VerificationHttpError,
  verificationRetry,
  retryAfterMs,
  isVerificationLoginUrl,
} from "../src/verification/retry.js";
import { account, config } from "./helpers.js";
import type { Materialized, PostingResult } from "../src/types.js";

import { telegramWebMessage, verifyTelegramWebAlbum, verifyTelegramWebReply } from "../src/verification/telegram.js";
import { verifyYouTubeMetadata } from "../src/verification/youtube.js";
import { budgetPoll, VerificationDeadlineError, withVerificationBudget } from "../src/verification/retry.js";
import { serve, json } from "./helpers.js";

const defaults = { now: 20_000, deadline: 90_000, lastNavigation: 0, pollsSinceNavigation: 0, rateLimits: 0 };
test("retry policy bounds throttling and honors both Retry-After formats", () => {
  expect(retryAfterMs("2.5", 0)).toBe(2500);
  expect(retryAfterMs("Thu, 01 Jan 1970 00:00:25 GMT", 20_000)).toBe(5000);
  expect(retryAfterMs("garbage", 0)).toBeUndefined();
  expect(verificationRetry({ ...defaults, error: new VerificationHttpError(429, "7") })).toEqual({
    retry: true,
    delayMs: 7000,
    reload: true,
  });
  for (const extra of [{ rateLimits: 3 }, { deadline: 25_000 }, {}]) {
    expect(verificationRetry({ ...defaults, ...extra, error: new VerificationHttpError(429, "60") })).toEqual({
      retry: false,
    });
  }
  expect(verificationRetry({ ...defaults, rateLimits: 3, error: new VerificationHttpError(429, "1") })).toEqual({
    retry: false,
  });
  expect(verificationRetry({ ...defaults, deadline: 25_000, error: new VerificationHttpError(429, "5") })).toEqual({
    retry: false,
  });
});
test("404 and 5xx remain retryable, auth does not, stale pages poll before reload", () => {
  for (const status of [404, 500, 502, 503, 504])
    expect(verificationRetry({ ...defaults, error: new VerificationHttpError(status) }).retry).toBe(true);
  for (const status of [400, 401, 403])
    expect(verificationRetry({ ...defaults, error: new VerificationHttpError(status) }).retry).toBe(false);
  expect(verificationRetry({ ...defaults, error: new Error("author not yet ready") })).toEqual({
    retry: true,
    delayMs: 1000,
    reload: false,
  });
  expect(verificationRetry({ ...defaults, pollsSinceNavigation: 1, error: new Error("missing") })).toEqual({
    retry: true,
    delayMs: 1000,
    reload: true,
  });
  expect(
    verificationRetry({ ...defaults, lastNavigation: 19_000, pollsSinceNavigation: 1, error: new Error("missing") }),
  ).toEqual({ retry: true, delayMs: 1000, reload: false });
});
test("login detection does not classify profile/post readiness as authentication", () => {
  for (const url of [
    "https://x.com/i/flow/login",
    "https://tiktok.com/passport/web/login",
    "https://instagram.com/accounts/login/",
    "https://facebook.com/checkpoint/",
  ])
    expect(isVerificationLoginUrl(url)).toBe(true);
  for (const url of ["https://x.com/testuser", "https://x.com/testuser/status/123", "https://tiktok.com/@testuser"])
    expect(isVerificationLoginUrl(url)).toBe(false);
});
const scenario: Materialized = {
  id: "retry-test",
  platform: "x",
  token: "retry-marker",
  message: "retry-marker",
  expectedText: "retry-marker",
  media: [],
  options: {},
  tags: [],
  interfaces: ["mcp"],
  expectedFields: {},
};
const observer = account({
  observer: {
    profileUrl: "https://x.com/testuser",
    root: "article",
    author: ".author",
    text: ".caption",
    open: [],
    fields: {},
  },
});
const receipt: PostingResult = { success: true, postId: "123" };
const html =
  '<article><a href="/testuser/status/123">post</a><a class="author">testuser</a><p class="caption">retry-marker</p></article>';
async function routed(browser: Browser, handler: (route: Route) => Promise<void>) {
  // verifyOnPlatform owns its context. Intercept creation to install routes before any page can navigate.
  const facade = Object.create(browser) as Browser;
  facade.newContext = async (options) => {
    const context = await browser.newContext(options);
    await context.setOffline(true);
    await context.route("**/*", handler);
    return context;
  };
  return facade;
}
for (const status of [401, 403, 429])
  test(`HTTP ${status} stops without blindly retrying`, async ({ browser }, info) => {
    let requests = 0;
    const controlled = await routed(browser, async (route) => {
      requests++;
      await route.fulfill({ status, headers: { "retry-after": "120" }, body: "unavailable" });
    });
    const before = browser.contexts().length;
    const start = Date.now();
    await expect(
      verifyOnPlatform(controlled, config({ verifyTimeoutMs: 10_000 }), scenario, observer, receipt, info.outputDir),
    ).rejects.toThrow(status === 429 ? "429" : VerificationSetupError);
    expect(Date.now() - start).toBeLessThan(4000);
    expect(requests).toBe(1);
    expect(browser.contexts()).toHaveLength(before);
  });
for (const status of [404, 503, 429])
  test(`HTTP ${status} can recover to a fully verified native post`, async ({ browser }, info) => {
    let requests = 0;
    const controlled = await routed(browser, async (route) => {
      requests++;
      await route.fulfill(
        requests === 1
          ? { status, headers: { "retry-after": "1" }, body: "not ready" }
          : { contentType: "text/html", body: html },
      );
    });
    await verifyOnPlatform(
      controlled,
      config({ verifyTimeoutMs: 10_000 }),
      scenario,
      observer,
      receipt,
      info.outputDir,
    );
    expect(requests).toBe(2);
  });
test("discovery polls the same profile until its delayed exact post appears", async ({ browser }, info) => {
  let profiles = 0;
  let posts = 0;
  const controlled = await routed(browser, async (route) => {
    if (new URL(route.request().url()).pathname === "/testuser") {
      profiles++;
      await route.fulfill({
        contentType: "text/html",
        body: `<script>setTimeout(() => document.body.innerHTML = ${JSON.stringify(html)}, 6200)</script>`,
      });
    } else {
      posts++;
      await route.fulfill({ contentType: "text/html", body: html });
    }
  });
  await verifyOnPlatform(
    controlled,
    config({ verifyTimeoutMs: 15_000 }),
    scenario,
    observer,
    { success: true },
    info.outputDir,
  );
  expect(profiles).toBe(1);
  expect(posts).toBe(1);
});
test("deadline interrupts an in-flight navigation and closes its context", async ({ browser }, info) => {
  const controlled = await routed(browser, async () => {});
  const before = browser.contexts().length;
  const start = Date.now();
  await expect(
    verifyOnPlatform(controlled, { ...config(), verifyTimeoutMs: 350 }, scenario, observer, receipt, info.outputDir),
  ).rejects.toThrow(/deadline|verification failed/i);
  expect(Date.now() - start).toBeLessThan(2000);
  expect(browser.contexts()).toHaveLength(before);
});
test("deadline bounds explicit assertion polling without accepting wrong authors", async ({ browser }, info) => {
  const controlled = await routed(browser, async (route) =>
    route.fulfill({
      contentType: "text/html",
      body: html.replace('class="author">testuser', 'class="author" href="/wronguser">wronguser'),
    }),
  );
  const before = browser.contexts().length;
  const start = Date.now();
  await expect(
    verifyOnPlatform(controlled, { ...config(), verifyTimeoutMs: 650 }, scenario, observer, receipt, info.outputDir),
  ).rejects.toThrow();
  expect(Date.now() - start).toBeLessThan(2200);
  expect(browser.contexts()).toHaveLength(before);
});
for (const body of ["<h1>Log in to TikTok</h1>", "Drag the slider to fit the puzzle"])
  test(`TikTok setup signal: ${body}`, async ({ browser }, info) => {
    const controlled = await routed(browser, async (route) => route.fulfill({ contentType: "text/html", body }));
    const start = Date.now();
    await expect(
      verifyOnPlatform(
        controlled,
        config({ verifyTimeoutMs: 10_000 }),
        { ...scenario, platform: "tiktok" },
        account({ observer: { ...observer.observer, profileUrl: "https://www.tiktok.com/@testuser" } }),
        receipt,
        info.outputDir,
      ),
    ).rejects.toThrow(VerificationSetupError);
    expect(Date.now() - start).toBeLessThan(3000);
  });

test("a confirmed login redirect stops with the lane-classifier error name", async ({ browser }, info) => {
  let requests = 0;
  const controlled = await routed(browser, async (route) => {
    requests++;
    await route.fulfill({
      contentType: "text/html",
      body: '<script>history.replaceState(null, "", "/i/flow/login")</script><h1>Sign in</h1>',
    });
  });
  await expect(
    verifyOnPlatform(controlled, config({ verifyTimeoutMs: 10_000 }), scenario, observer, receipt, info.outputDir),
  ).rejects.toMatchObject({ name: "VerificationSetupError" });
  expect(requests).toBe(1);
});

test("a late challenge interrupts ongoing post readiness checks", async ({ browser }, info) => {
  const controlled = await routed(browser, async (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<script>setTimeout(() => document.body.innerHTML = "<h1>Session expired</h1>", 300)</script>',
    }),
  );
  const start = Date.now();
  await expect(
    verifyOnPlatform(controlled, config({ verifyTimeoutMs: 20_000 }), scenario, observer, receipt, info.outputDir),
  ).rejects.toMatchObject({ name: "VerificationSetupError" });
  expect(Date.now() - start).toBeLessThan(4000);
});

test("a stale post is reloaded only after an existing-page retry", async ({ browser }, info) => {
  let requests = 0;
  const controlled = await routed(browser, async (route) => {
    requests++;
    await route.fulfill({ contentType: "text/html", body: requests === 1 ? "not propagated" : html });
  });
  const start = Date.now();
  await verifyOnPlatform(controlled, config({ verifyTimeoutMs: 20_000 }), scenario, observer, receipt, info.outputDir);
  expect(Date.now() - start).toBeGreaterThan(10_000);
  expect(requests).toBe(2);
});

test("repeated 429s exhaust a finite retry budget and retain setup classification", async ({ browser }, info) => {
  let requests = 0;
  const controlled = await routed(browser, async (route) => {
    requests++;
    await route.fulfill({ status: 429, headers: { "retry-after": "0" }, body: "rate limited" });
  });
  await expect(
    verifyOnPlatform(controlled, config({ verifyTimeoutMs: 20_000 }), scenario, observer, receipt, info.outputDir),
  ).rejects.toMatchObject({ name: "VerificationSetupError", message: expect.stringContaining("429 rate-limit") });
  expect(requests).toBe(4);
});

test("delayed author hydration retries existing content without reloading it", async ({ browser }, info) => {
  let requests = 0;
  const controlled = await routed(browser, async (route) => {
    requests++;
    const pending = html.replace('<a class="author">testuser</a>', '<a class="author" href="/pending">pending</a>');
    await route.fulfill({
      contentType: "text/html",
      body: `${pending}<script>setTimeout(() => {const a = document.querySelector('.author'); a.textContent = 'testuser'; a.setAttribute('href', '/testuser')}, 4200)</script>`,
    });
  });
  await verifyOnPlatform(controlled, config({ verifyTimeoutMs: 12_000 }), scenario, observer, receipt, info.outputDir);
  expect(requests).toBe(1);
});

test("concurrent verification budgets do not cancel another platform context", async ({ browser }, info) => {
  const before = browser.contexts().length;
  const controlled = await routed(browser, async (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<script>setTimeout(() => document.body.innerHTML = ${JSON.stringify(html)}, 1200)</script>`,
    }),
  );
  const results = await Promise.allSettled([
    verifyOnPlatform(
      controlled,
      { ...config(), verifyTimeoutMs: 350 },
      scenario,
      observer,
      receipt,
      info.outputPath("short"),
    ),
    verifyOnPlatform(
      controlled,
      config({ verifyTimeoutMs: 5000 }),
      scenario,
      observer,
      receipt,
      info.outputPath("long"),
    ),
  ]);
  expect(results.map((result) => result.status)).toEqual(["rejected", "fulfilled"]);
  expect(browser.contexts()).toHaveLength(before);
});

const youtubeScenario = { ...scenario, platform: "youtube" as const };
const youtubeOwner = account({
  resources: { channelId: "UCowner" },
  observer: {
    profileUrl: "https://www.youtube.com/channel/UCowner",
    youtubeAccessTokenEnv: "VERIFY_RETRY_GOOGLE_TOKEN",
    open: [],
    fields: {},
  },
});
const youtubeReceipt = { success: true, postId: "abcdefghijk" };

for (const phase of ["headers", "body"] as const)
  test(`YouTube direct fetch cancels pending ${phase} at the verification deadline`, async () => {
    const originalFetch = globalThis.fetch;
    const oldToken = process.env.VERIFY_RETRY_GOOGLE_TOKEN;
    process.env.VERIFY_RETRY_GOOGLE_TOKEN = "offline";
    let calls = 0;
    let active = 0;
    globalThis.fetch = async (_url, init) => {
      calls++;
      const signal = init!.signal!;
      active++;
      if (phase === "headers")
        return new Promise<Response>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              active--;
              reject(signal.reason);
            },
            { once: true },
          );
        });
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"items":['));
            signal.addEventListener(
              "abort",
              () => {
                active--;
                controller.error(signal.reason);
              },
              { once: true },
            );
          },
        }),
        { headers: { "content-type": "application/json" } },
      );
    };
    const start = Date.now();
    try {
      await expect(
        withVerificationBudget(undefined, 200, (budget) =>
          verifyYouTubeMetadata(youtubeScenario, youtubeOwner, youtubeReceipt, config(), budget),
        ),
      ).rejects.toThrow(/deadline/);
      expect(Date.now() - start).toBeLessThan(1200);
      expect(active).toBe(0);
      expect(calls).toBe(1); // channels.mine and subsequent reads cannot run after cancellation.
    } finally {
      globalThis.fetch = originalFetch;
      if (oldToken === undefined) delete process.env.VERIFY_RETRY_GOOGLE_TOKEN;
      else process.env.VERIFY_RETRY_GOOGLE_TOKEN = oldToken;
    }
  });

for (const status of [401, 403, 429, 503])
  test(`YouTube direct metadata ${status} preserves auth/retry classification`, async () => {
    const originalFetch = globalThis.fetch;
    const oldToken = process.env.VERIFY_RETRY_GOOGLE_TOKEN;
    process.env.VERIFY_RETRY_GOOGLE_TOKEN = "offline";
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return new Response("unavailable", { status, headers: { "retry-after": "7" } });
    };
    try {
      const operation = verifyYouTubeMetadata(youtubeScenario, youtubeOwner, youtubeReceipt, config());
      if (status === 401 || status === 403)
        await expect(operation).rejects.toMatchObject({
          name: "VerificationSetupError",
          message: expect.stringContaining(String(status)),
        });
      else await expect(operation).rejects.toMatchObject({ status, retryAfter: "7", source: "metadata" });
      expect(calls).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
      if (oldToken === undefined) delete process.env.VERIFY_RETRY_GOOGLE_TOKEN;
      else process.env.VERIFY_RETRY_GOOGLE_TOKEN = oldToken;
    }
  });

for (const status of [429, 503])
  test(`scheduler YouTube readback exposes ${status} headers without internal retry`, async () => {
    let calls = 0;
    const server = await serve((_req, res) => {
      calls++;
      res.setHeader("Retry-After", "7");
      json(res, { error: "unavailable" }, status);
    });
    const oldToken = process.env.E2E_API_TOKEN;
    process.env.E2E_API_TOKEN = "offline";
    try {
      await expect(
        verifyYouTubeMetadata(
          youtubeScenario,
          {
            ...youtubeOwner,
            observer: { ...youtubeOwner.observer, youtubeAccessTokenEnv: undefined, youtubeReadback: true },
          },
          youtubeReceipt,
          config({ baseUrl: server.url }),
        ),
      ).rejects.toMatchObject({ status, retryAfter: "7", source: "metadata" });
      expect(calls).toBe(1);
      expect(
        verificationRetry({ ...defaults, error: new VerificationHttpError(status, "7", "metadata") }),
      ).toMatchObject({ retry: true, reload: false });
    } finally {
      if (oldToken === undefined) delete process.env.E2E_API_TOKEN;
      else process.env.E2E_API_TOKEN = oldToken;
      await server.close();
    }
  });

test("browser deadline cancels pending YouTube scheduler readback and closes both contexts", async ({
  browser,
}, info) => {
  let requests = 0;
  let connected = false;
  const server = await serve((_req, res) => {
    requests++;
    connected = true;
    res.on("close", () => {
      connected = false;
    });
    res.writeHead(200, { "content-type": "application/json" });
    res.write('{"video":'); // A real local API that never completes its body.
  });
  const originalToken = process.env.E2E_API_TOKEN;
  process.env.E2E_API_TOKEN = "offline";
  const before = browser.contexts().length;
  const controlled = await routed(browser, (route) =>
    route.fulfill({ contentType: "text/html", body: "<button>Sign in</button><h1>Video</h1>" }),
  );
  const start = Date.now();
  try {
    await expect(
      verifyOnPlatform(
        controlled,
        config({ baseUrl: server.url, verifyTimeoutMs: 450 }),
        youtubeScenario,
        {
          ...youtubeOwner,
          observer: { ...youtubeOwner.observer, youtubeAccessTokenEnv: undefined, youtubeReadback: true },
        },
        youtubeReceipt,
        info.outputDir,
      ),
    ).rejects.toThrow(/deadline/);
    expect(Date.now() - start).toBeLessThan(1500);
    await expect.poll(() => connected, { timeout: 500 }).toBe(false);
    expect(requests).toBe(1);
    expect(browser.contexts()).toHaveLength(before);
  } finally {
    if (originalToken === undefined) delete process.env.E2E_API_TOKEN;
    else process.env.E2E_API_TOKEN = originalToken;
    await server.close();
  }
});

for (const stage of ["session", "header", "message"] as const)
  test(`Telegram ${stage} readiness respects the caller budget`, async ({ page }) => {
    await page.context().setOffline(true);
    await page.route("**/*", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `${stage === "session" ? "" : '<script>localStorage.setItem("user_auth", JSON.stringify({id:123}))</script>'}${stage === "message" ? '<div class="chat-info"><span class="peer-title" data-peer-id="456">Bot</span></div>' : ""}`,
      }),
    );
    await page.goto("https://web.telegram.org/k/#@TestBot");
    const telegramOwner = account({
      platformAccountId: "123",
      observer: {
        profileUrl: "https://web.telegram.org/",
        open: [],
        fields: {},
        telegramWeb: { botPeerId: "456", botUsername: "TestBot" },
      },
    });
    const start = Date.now();
    await expect(
      withVerificationBudget(undefined, 400, (budget) =>
        telegramWebMessage(
          page,
          { ...scenario, platform: "telegram" },
          telegramOwner,
          { from: "2026-10-04T00:00:00Z", to: "2026-10-04T00:01:00Z" },
          budget,
        ),
      ),
    ).rejects.toThrow();
    expect(Date.now() - start).toBeLessThan(1200);
    // The standalone helper leaves ownership with the caller and schedules no later polling.
    expect(page.isClosed()).toBe(false);
  });

test("Telegram album/reply polling cancels on an early abort, not a 30-second drain", async ({ page }) => {
  await page.setContent("<article></article>");
  for (const helper of [
    (budget: Parameters<typeof telegramWebMessage>[4]) =>
      verifyTelegramWebAlbum(
        page,
        page.locator("article"),
        { ...scenario, media: ["video"] },
        "456",
        undefined,
        budget,
      ),
    (budget: Parameters<typeof telegramWebMessage>[4]) =>
      verifyTelegramWebReply(page.locator("article"), { replyToId: "123" }, undefined, budget),
  ]) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new VerificationSetupError("session expired")), 100);
    const start = Date.now();
    try {
      await expect(helper({ deadline: Date.now() + 30_000, signal: controller.signal })).rejects.toThrow(
        "session expired",
      );
    } finally {
      clearTimeout(timer);
    }
    expect(Date.now() - start).toBeLessThan(1000);
  }
});

test("budget polling awaits and joins its callback rather than abandoning it at timeout", async () => {
  let active = false;
  let calls = 0;
  await expect(
    withVerificationBudget(undefined, 100, (budget) =>
      budgetPoll(
        async () => {
          calls++;
          active = true;
          try {
            await new Promise<void>((resolve) =>
              budget.signal.addEventListener("abort", () => resolve(), { once: true }),
            );
          } finally {
            active = false;
          }
          return true;
        },
        { timeout: 30_000 },
        budget,
      ).toBe(true),
    ),
  ).rejects.toThrow(VerificationDeadlineError);
  expect(active).toBe(false);
  expect(calls).toBe(1);
});

test("an expired context-creation budget closes without ever creating a page", async ({ browser }, info) => {
  let pages = 0;
  const before = browser.contexts().length;
  const controlled = {
    newContext: async (options: Parameters<Browser["newContext"]>[0]) => {
      const context = await browser.newContext(options);
      const newPage = context.newPage.bind(context);
      context.newPage = async () => {
        pages++;
        return newPage();
      };
      await new Promise((resolve) => setTimeout(resolve, 30));
      return context;
    },
  } as Browser;
  const start = Date.now();
  await expect(
    verifyOnPlatform(controlled, config({ verifyTimeoutMs: 1 }), scenario, observer, receipt, info.outputDir),
  ).rejects.toThrow(/deadline/);
  expect(Date.now() - start).toBeLessThan(1000);
  expect(pages).toBe(0);
  expect(browser.contexts()).toHaveLength(before);
});

test("a legitimate Sign in navigation button does not block native verification", async ({ browser }, info) => {
  const controlled = await routed(browser, (route) =>
    route.fulfill({ contentType: "text/html", body: "<nav><button>Sign in</button></nav>" + html }),
  );
  await verifyOnPlatform(controlled, config({ verifyTimeoutMs: 2000 }), scenario, observer, receipt, info.outputDir);
});

test("deadline diagnostics preserve the last assertion as the cause", async () => {
  let last: unknown;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new VerificationDeadlineError(last)), 150);
  try {
    await expect(
      budgetPoll(
        () => "wrong",
        { message: "Exact owner must match", intervals: [1000] },
        {
          deadline: Date.now() + 30_000,
          signal: controller.signal,
          onFailure: (error) => {
            last = error;
          },
        },
      ).toBe("owner"),
    ).rejects.toMatchObject({
      name: "VerificationDeadlineError",
      message: expect.stringContaining("Exact owner must match"),
      cause: last === undefined ? expect.any(Error) : last,
    });
  } finally {
    clearTimeout(timer);
  }
});

test("deadline retains the in-flight missing-video assertion instead of an earlier author diagnostic", async ({
  browser,
}, info) => {
  const controlled = await routed(browser, (route) =>
    route.fulfill({
      contentType: "text/html",
      body:
        html.replace('<a class="author">testuser</a>', '<a class="author" href="/pending">pending</a>') +
        '<script>setTimeout(() => { const author = document.querySelector(".author"); author.textContent = "testuser"; author.setAttribute("href", "/testuser"); }, 80)</script>',
    }),
  );
  // Repeat the real deadline/locator-timeout race; no mocked assertions or relaxed proof.
  for (let attempt = 0; attempt < 3; attempt++) {
    const before = browser.contexts().length;
    await expect(
      verifyOnPlatform(
        controlled,
        config({ verifyTimeoutMs: 600 }),
        { ...scenario, media: ["video"] },
        observer,
        receipt,
        info.outputPath(String(attempt)),
      ),
    ).rejects.toThrow("Every requested video must be present");
    expect(browser.contexts()).toHaveLength(before);
  }
});
