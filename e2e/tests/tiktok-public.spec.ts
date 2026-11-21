import { test, expect, type Browser } from "@playwright/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { account, config } from "./helpers.js";
import { catalog, materialize } from "../src/catalog.js";
import { assertRequirements } from "../src/preflight.js";
import { verifyOnPlatform } from "../src/verification/browser.js";

const owner = account({
  observer: {
    profileUrl: "https://www.tiktok.com/@testuser",
    storageState: "/must-not-load-owner-session.json",
    root: "article",
    author: ".author",
    text: ".caption",
    video: "video",
    open: [],
    fields: {},
  },
});
const scenario = materialize(
  catalog.find((s) => s.id === "tiktok.video")!,
  owner,
  "mcp",
  "public",
  "https://media.example.com",
);

test("TikTok public access can be observed as a guest; private audiences and music still require evidence", () => {
  expect(() => assertRequirements(scenario, owner)).not.toThrow();
  for (const privacyLevel of ["SELF_ONLY", "MUTUAL_FOLLOW_FRIENDS"])
    expect(() => assertRequirements({ ...scenario, expectedFields: { privacyLevel } }, owner)).toThrow(
      "BLOCKED before posting",
    );
  expect(() =>
    assertRequirements({ ...scenario, expectedFields: { ...scenario.expectedFields, autoAddMusic: false } }, owner),
  ).toThrow("autoAddMusic");
});

test("TikTok uploads-image requests music off without demanding observer music evidence; music scenarios still do", () => {
  const base = catalog.find((s) => s.id === "tiktok.uploads-image")!;
  for (const iface of ["ui", "mcp"] as const) {
    const uploads = materialize(base, owner, iface, "public", "https://media.example.com");
    expect(uploads.tags).toContain("uploads");
    expect(uploads.options.autoAddMusic, "upload photo posts still request music off").toBe(false);
    expect(uploads.expectedFields).toEqual({ privacyLevel: "PUBLIC_TO_EVERYONE" });
    expect(() => assertRequirements(uploads, owner)).not.toThrow();
    // Privacy evidence is retained for non-public audiences.
    expect(() =>
      assertRequirements(
        { ...uploads, expectedFields: { ...uploads.expectedFields, privacyLevel: "SELF_ONLY" } },
        owner,
      ),
    ).toThrow("BLOCKED before posting");
  }
  // Explicit expectedFields on an uploads-tagged photo case are still honoured.
  const explicit = materialize(
    { ...base, expectedFields: { autoAddMusic: false } },
    owner,
    "ui",
    "public",
    "https://media.example.com",
  );
  expect(explicit.expectedFields).toEqual({ privacyLevel: "PUBLIC_TO_EVERYONE", autoAddMusic: false });
  expect(() => assertRequirements(explicit, owner)).toThrow("autoAddMusic");
  // Existing music scenarios keep requiring platform observer evidence.
  for (const id of ["tiktok.photos-1-music-false-omitted", "tiktok.photos-2-music-true-custom", "tiktok.smoke"]) {
    const music = materialize(catalog.find((s) => s.id === id)!, owner, "ui", "public", "https://media.example.com");
    expect(music.expectedFields.autoAddMusic, `${id} expects music evidence`).toBe(
      id === "tiktok.photos-2-music-true-custom",
    );
    expect(() => assertRequirements(music, owner)).toThrow("autoAddMusic");
  }
});

test("an unresolved TikTok handle stops before opening an uncalibrated profile", async () => {
  let contexts = 0;
  const browser = {
    newContext: async () => {
      contexts++;
      throw new Error("Must not open the profile");
    },
  } as unknown as Browser;
  const uncalibrated = { ...owner, observer: { ...owner.observer, root: undefined } };
  const photo = materialize(
    catalog.find((s) => s.id === "tiktok.uploads-image")!,
    uncalibrated,
    "ui",
    "unresolved",
    "https://media.example.com",
  );
  await expect(
    verifyOnPlatform(
      browser,
      config(),
      photo,
      uncalibrated,
      { success: true, postId: "p_pub_url~v2.123", postUrl: uncalibrated.observer.profileUrl },
      "/must-not-write",
    ),
  ).rejects.toThrow("publish handle without a public post URL");
  expect(contexts).toBe(0);
});

for (const fault of ["none", "wrong-author", "wrong-receipt", "login", "missing-video", "challenge"] as const) {
  test(`TikTok public proof requires exact guest-visible content: ${fault}`, async ({ browser }) => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "tiktok-public-"));
    const video = (await readFile("fixtures/generated/video.mp4")).toString("base64");
    const guest = {
      newContext: async (options: Parameters<Browser["newContext"]>[0]) => {
        expect(options?.storageState).toEqual({ cookies: [], origins: [] });
        const context = await browser.newContext(options);
        await context.route("https://www.tiktok.com/**", (route) =>
          route.fulfill({
            contentType: "text/html; charset=utf-8",
            body:
              fault === "challenge"
                ? "<p>Drag the slider to fit the puzzle</p>"
                : fault === "login"
                  ? '<p>Sign in</p><script>history.replaceState({},"","/login")</script>'
                  : `<article><a class="author" href="/@${fault === "wrong-author" ? "impostor" : "testuser"}">${fault === "wrong-author" ? "impostor" : "testuser"}</a><p class="caption">${scenario.expectedText}</p>${fault === "missing-video" ? "" : `<video style="width:160px;height:160px" autoplay muted loop src="data:video/mp4;base64,${video}"></video>`}</article>${fault === "wrong-receipt" ? '<script>history.replaceState({},"","/@testuser/video/999")</script>' : ""}`,
          }),
        );
        return context;
      },
    } as Browser;
    try {
      const operation = verifyOnPlatform(
        guest,
        // Enough for one offline proof, shorter than the minimum 1000ms retry delay.
        config({ verifyTimeoutMs: 600 }),
        scenario,
        owner,
        { success: true, postId: "123", postUrl: "https://www.tiktok.com/@testuser/video/123" },
        dir,
      );
      if (fault === "none") {
        await operation;
        expect(JSON.parse(await readFile(path.join(dir, `${scenario.token}-observed.json`), "utf8"))).toMatchObject({
          verificationMode: "unauthenticated-public-view",
          observerAuthenticated: false,
          tiktokVisibilityProof: { platformPostId: "123", author: "testuser" },
        });
      } else
        await expect(operation).rejects.toThrow(
          {
            "wrong-author": "Platform post must belong to the configured test account",
            "wrong-receipt": "Platform permalink must match the returned post ID",
            login: "TikTok verification reached a login page",
            "missing-video": "Every requested video must be present",
            challenge: "TikTok requires an interactive verification challenge",
          }[fault],
        );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}

test("TikTok login page is a setup error before guest marker polling", async ({ browser }) => {
  test.setTimeout(10_000);
  const dir = await mkdtemp(path.join(os.tmpdir(), "tiktok-public-login-"));
  const guest = {
    newContext: async (options: Parameters<Browser["newContext"]>[0]) => {
      expect(options?.storageState).toEqual({ cookies: [], origins: [] });
      const context = await browser.newContext(options);
      await context.route("https://www.tiktok.com/**", (route) =>
        route.fulfill({
          contentType: "text/html; charset=utf-8",
          body: '<h1>Log in to TikTok</h1><script>history.replaceState({},"","/login")</script>',
        }),
      );
      return context;
    },
  } as Browser;
  const startedAt = Date.now();
  try {
    await expect(
      verifyOnPlatform(
        guest,
        config({ verifyTimeoutMs: 180_000 }),
        scenario,
        owner,
        { success: true, postId: "v_pub_file~v2-1.123456789" },
        dir,
      ),
    ).rejects.toThrow("TikTok verification reached a login page");
    expect(Date.now() - startedAt, "Login detection must not wait for the verification deadline").toBeLessThan(5_000);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
