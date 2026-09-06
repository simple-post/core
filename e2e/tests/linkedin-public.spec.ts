import { test, expect, type Browser } from "@playwright/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { account, config, serve, json } from "./helpers.js";
import { materialize, catalog } from "../src/catalog.js";
import { verifyOnPlatform, verifyPage } from "../src/verification/browser.js";
import { assertRequirements } from "../src/preflight.js";

const owner = account({
  username: "owner@example.com",
  observer: {
    profileUrl: "https://www.linkedin.com/in/test-owner/",
    root: "article",
    author: ".author",
    text: ".caption",
    images: ".photo",
    open: [],
    fields: {},
    storageState: "/must-not-read-owner-session.json",
  },
});
const s = materialize(
  catalog.find((s) => s.id === "linkedin.visibility-public")!,
  owner,
  "mcp",
  "offline",
  "https://media.example.com",
);
test("LinkedIn PUBLIC guest proof is available but CONNECTIONS still requires owner visibility observation", () => {
  expect(() => assertRequirements(s, owner)).not.toThrow();
  expect(() => assertRequirements({ ...s, expectedFields: { visibility: "CONNECTIONS" } }, owner)).toThrow(
    "BLOCKED before posting",
  );
});
for (const fault of ["none", "wrong-author", "wrong-profile", "wrong-receipt"] as const) {
  test(`LinkedIn PUBLIC guest proof ${fault}`, async ({ browser }) => {
    const server = await serve((_req, res) =>
      json(res, {
        accounts: [
          {
            id: owner.id,
            userId: "user-1",
            platform: "linkedin",
            platformAccountId: owner.platformAccountId,
            displayName: "Test Owner",
          },
        ],
      }),
    );
    const dir = await mkdtemp(path.join(os.tmpdir(), "linkedin-public-"));
    const receipt = { success: true, postId: "urn:li:share:123456789" };
    let visits = 0;
    const isolated = {
      newContext: async (options: any) => {
        expect(options.storageState).toEqual({ cookies: [], origins: [] });
        const context = await browser.newContext(options);
        await context.route("https://www.linkedin.com/**", (route) => {
          visits++;
          return route.fulfill({
            contentType: "text/html; charset=utf-8",
            body: `<article><a class="author" href="/in/${fault === "wrong-profile" ? "impostor" : "test-owner"}">Test Owner${fault === "wrong-author" ? " WRONG" : ""}</a><p class="caption">${s.expectedText}</p><div class="photo" style="width:100px;height:100px;background:#2596be"></div></article>${fault === "wrong-receipt" ? '<script>history.replaceState({},"","/feed/update/urn:li:share:987654321")</script>' : ""}`,
          });
        });
        return context;
      },
    } as Browser;
    process.env.E2E_API_TOKEN = "offline-token";
    try {
      const operation = verifyOnPlatform(
        isolated,
        config({ baseUrl: server.url, verifyTimeoutMs: 1 }),
        s,
        owner,
        receipt,
        dir,
      );
      if (fault === "none") {
        await operation;
        const observation = JSON.parse(await readFile(path.join(dir, `${s.token}-observed.json`), "utf8"));
        expect(observation).toMatchObject({
          verificationMode: "unauthenticated-public-view",
          observerAuthenticated: false,
          linkedinVisibilityProof: {
            source: "unauthenticated-public-view",
            author: "Test Owner",
            platformPostId: receipt.postId,
          },
        });
      } else
        await expect(operation).rejects.toThrow(
          fault === "wrong-author"
            ? "Guest post author must exactly match"
            : fault === "wrong-profile"
              ? "Platform post must belong to the configured test account"
              : "Guest view must remain on the exact receipt permalink",
        );
      expect(visits).toBe(1);
    } finally {
      delete process.env.E2E_API_TOKEN;
      await server.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
}
test("ordinary LinkedIn post requires the canonical profile; matching display name cannot override a wrong href", async ({
  page,
}) => {
  test.setTimeout(40_000);
  const a = { ...owner, username: "Test Owner" };
  const ordinary = { ...s, expectedFields: {} };
  const html = (href: string) =>
    `<article><a class="author" href="${href}">Test Owner</a><p class="caption">${s.expectedText}</p><div class="photo" style="width:100px;height:100px;background:#2596be"></div></article>`;
  await page.setContent(html("https://de.linkedin.com/in/test-owner/?trk=public_post_feed-actor-name"));
  await verifyPage(page, ordinary, a);
  await page.setContent(html("https://www.linkedin.com/in/impostor/"));
  await expect(verifyPage(page, ordinary, a)).rejects.toThrow(
    "Platform post must belong to the configured test account",
  );
});
