import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { assertFittedBytes } from "../src/verification/image-fit.js";
import { imageFitCases } from "../src/image-fit-cases.js";
import { materialize } from "../src/catalog.js";
import { mediaFiles } from "../src/media.js";
import { applicationSdk } from "../src/app-sdk.js";
import { account, config } from "./helpers.js";
import type { Post } from "@simple-post/sdk";

for (const mode of ["crop", "blur"] as const) {
  test(`fitted-image oracle distinguishes ${mode}, unchanged originals, and the wrong method`, async () => {
    const cfg = config();
    const scenario = materialize(
      imageFitCases.find((s) => s.id === `instagram.fit-portrait-${mode}`)!,
      account(),
      "mcp",
      "fit-contract",
      cfg.mediaBaseUrl,
    );
    const [file] = await mediaFiles(cfg, scenario.media);
    const source = await readFile(file.path);
    const fit = (imageFit: "crop" | "blur") =>
      applicationSdk().fitPostImages(
        {
          platforms: ["instagram"],
          content: { text: "Fit", media: [{ type: "image", path: file.path }] },
        } as Post,
        imageFit,
      );
    const correct = await fit(mode);
    const wrong = await fit(mode === "crop" ? "blur" : "crop");
    try {
      await assertFittedBytes(await readFile(correct.post.content.media![0].path!), source, "fitPortrait", scenario);
      await expect(assertFittedBytes(source, source, "fitPortrait", scenario)).rejects.toThrow();
      await expect(
        assertFittedBytes(await readFile(wrong.post.content.media![0].path!), source, "fitPortrait", scenario),
      ).rejects.toThrow();
      // Equal dimensions must not hide use of the wrong fitting method.
      const dimensions = await sharp(await readFile(correct.post.content.media![0].path!)).metadata();
      const disguised = await sharp(await readFile(wrong.post.content.media![0].path!))
        .resize(dimensions.width, dimensions.height, { fit: "fill" })
        .jpeg()
        .toBuffer();
      await expect(assertFittedBytes(disguised, source, "fitPortrait", scenario)).rejects.toThrow(
        "Fitting must preserve/crop the expected edge markers",
      );
      expect(await readFile(file.path)).toEqual(source);
    } finally {
      await correct.cleanup();
      await wrong.cleanup();
    }
  });
}

test("a resized plain blue image cannot impersonate preserved blur edge markers", async () => {
  const cfg = config();
  const s = materialize(
    imageFitCases.find((s) => s.id === "instagram.fit-portrait-blur")!,
    account(),
    "mcp",
    "fit-contract",
    cfg.mediaBaseUrl,
  );
  const [file] = await mediaFiles(cfg, s.media);
  const impostor = await sharp({ create: { width: 864, height: 1080, channels: 3, background: "#2596be" } })
    .jpeg()
    .toBuffer();
  await expect(assertFittedBytes(impostor, await readFile(file.path), "fitPortrait", s)).rejects.toThrow();
});

test("compatible image fitting requires byte-for-byte preservation", async () => {
  const cfg = config();
  const s = materialize(
    imageFitCases.find((s) => s.id === "instagram.fit-compatible-crop")!,
    account(),
    "mcp",
    "fit-contract",
    cfg.mediaBaseUrl,
  );
  const [file] = await mediaFiles(cfg, s.media);
  const source = await readFile(file.path);
  await assertFittedBytes(source, source, "image", s);
  const recompressed = await sharp(source).jpeg({ quality: 60 }).toBuffer();
  await expect(assertFittedBytes(recompressed, source, "image", s)).rejects.toThrow();
});

test("white padding cannot impersonate the blurred source background", async () => {
  const cfg = config();
  const s = materialize(
    imageFitCases.find((s) => s.id === "instagram.fit-portrait-blur")!,
    account(),
    "mcp",
    "fit-contract",
    cfg.mediaBaseUrl,
  );
  const [file] = await mediaFiles(cfg, s.media);
  const source = await readFile(file.path);
  const padded = await sharp({ create: { width: 864, height: 1080, channels: 3, background: "#ffffff" } })
    .composite([{ input: source, left: 162, top: 0 }])
    .jpeg()
    .toBuffer();
  await expect(assertFittedBytes(padded, source, "fitPortrait", s)).rejects.toThrow(
    "Padding must use the source background, not blank bars",
  );
});
