import { validationCases } from "./validation-cases.js";
import type { Interface, MediaKey, Platform, Scenario } from "./types.js";

const hosted: Interface[] = ["ui", "mcp", "cli-app"];
export const imageFitCases: Scenario[] = [];
for (const imageFit of ["crop", "blur"] as const) {
  for (const [platform, name, media] of [
    ["instagram", "portrait", ["fitPortrait"]],
    ["instagram", "format", ["webp"]],
    ["instagram", "carousel", ["image2", "fitPortrait"]],
    ["telegram", "dimensions", ["largeImage"]],
    ["tiktok", "dimensions", ["largeImage"]],
    ["linkedin", "pixels", ["largeImage"]],
    ["bluesky", "bytes", ["fitNoise"]],
  ] satisfies Array<[Platform, string, MediaKey[]]>) {
    imageFitCases.push({
      id: `${platform}.fit-${name}-${imageFit}`,
      platform,
      media,
      options: {},
      imageFit,
      tags: ["full", "image-fit", "regression"],
      interfaces: [...hosted],
    });
  }
  for (const imageFitReview of ["validate_post", "preview_post"] as const)
    imageFitCases.push({
      id: `instagram.fit-${imageFitReview}-${imageFit}`,
      platform: "instagram",
      media: ["fitPortrait"],
      options: {},
      imageFit,
      imageFitReview,
      tags: ["full", "image-fit", "regression"],
      interfaces: ["mcp"],
    });
  for (const input of ["json", "remote"] as const)
    imageFitCases.push({
      id: `instagram.fit-${input}-${imageFit}`,
      platform: "instagram",
      media: ["fitPortrait"],
      options: {},
      imageFit,
      input,
      tags: ["full", "image-fit", "regression"],
      interfaces: input === "json" ? ["cli-app"] : ["mcp", "cli-app"],
    });
  imageFitCases.push({
    id: `instagram.fit-compatible-${imageFit}`,
    platform: "instagram",
    media: ["image"],
    options: {},
    imageFit,
    tags: ["full", "image-fit", "regression"],
    // The UI intentionally offers fitting only for incompatible images.
    interfaces: ["mcp", "cli-app"],
  });
  for (const mode of ["schedule", "draft-edit"] as const)
    imageFitCases.push({
      id: `instagram.fit-${mode}-${imageFit}`,
      platform: "instagram",
      media: ["fitPortrait"],
      options: {},
      imageFit,
      mode,
      tags: ["full", "image-fit", "lifecycle"],
      interfaces: ["ui", "mcp"],
    });
}

// Fitting must not erase unrelated validation errors. These call validate_post
// only and never create a provider post.
for (const id of ["instagram.validation-short-reel", "tiktok.validation-cover-index"]) {
  const original = validationCases.find((s) => s.id === id)!;
  imageFitCases.push({
    ...original,
    id: original.id.replace(".validation-", ".fit-unfixable-"),
    imageFit: "blur",
    tags: ["full", "image-fit", "negative"],
  });
}
