import { test, expect } from "@playwright/test";
import { applicationSdk } from "../src/app-sdk.js";
import type { PostOptions } from "@simple-post/sdk";
import { catalog, materialize } from "../src/catalog.js";
import { account, config } from "./helpers.js";
import { mediaFiles } from "../src/media.js";
const { validateContentForPlatform } = applicationSdk();
for (const scenario of catalog.filter((c) => c.interfaces.length > 0 && !c.expectedError)) {
  test(`SDK accepts live fixture contract: ${scenario.id}`, async () => {
    const cfg = config(),
      s = materialize(scenario, account(), "mcp", "contract", cfg.mediaBaseUrl);
    const files = await mediaFiles(cfg, s.media);
    const result = validateContentForPlatform(
      s.platform,
      { text: s.message, media: files.map((m) => ({ type: m.type, url: m.url, size: m.size })) },
      { [s.platform]: s.options } as PostOptions,
    );
    expect(result.errors, `The live suite must not submit unsupported content for ${s.id}`).toEqual([]);
    expect(
      result.warnings.filter((w) => /first.*(posted|sent)|ignore|images only/.test(w.message)),
      `No silent attachment truncation in ${s.id}`,
    ).toEqual([]);
  });
}
const boundaries = [
  ["bluesky", 300, 301],
  ["threads", 500, 501],
  ["linkedin", 3000, 3001],
  ["telegram", 4096, 4097],
  ["facebook", 63206, 63207],
  ["forem", 100000, 100001],
] as const;
for (const [platform, limit, over] of boundaries)
  test(`${platform} text limit ${limit}/${over} rejects before a live API call`, () => {
    expect(validateContentForPlatform(platform, { text: "a".repeat(limit) }).isValid).toBe(true);
    expect(validateContentForPlatform(platform, { text: "a".repeat(over) }).isValid).toBe(false);
  });

for (const id of ["telegram.album-11-invalid", "telegram.album-caption-1025-invalid"])
  test(`SDK rejects ${id} before publishing`, async () => {
    const cfg = config(),
      scenario = catalog.find((c) => c.id === id)!;
    const s = materialize(scenario, account(), "mcp", "contract", cfg.mediaBaseUrl);
    const media = await mediaFiles(cfg, s.media);
    const result = validateContentForPlatform("telegram", { text: s.message, media });
    expect(result.isValid).toBe(false);
    expect(JSON.stringify(result.errors)).toMatch(new RegExp(s.expectedError!, "i"));
  });
