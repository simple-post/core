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
        config({ verifyTimeoutMs: 1 }),
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
            login: "Platform redirected to a profile/login page",
            "missing-video": "Every requested video must be present",
            challenge: "TikTok requires an interactive verification challenge",
          }[fault],
        );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}
