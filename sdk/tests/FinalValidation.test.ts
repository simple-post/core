import { validateContentForPlatform } from "../src/validation";
import { validateInspectedMedia } from "../src/validation/media-rules";

import type { Platform } from "../src/types/post";

const image = { type: "image" as const, url: "https://example.com/photo.jpg" };
const video = { type: "video" as const, url: "https://example.com/video.mp4", title: "Video" };

it.each(["x", "instagram", "bluesky", "facebook", "linkedin", "pinterest", "youtube"] as Platform[])(
  "blocks attachment loss for %s",
  (platform) => {
    const media = platform === "youtube" ? [video, video] : Array.from({ length: 30 }, () => image);
    const result = validateContentForPlatform(platform, { text: "Post", media });
    expect(result.errors.some((issue) => /too_many/.test(issue.code))).toBe(true);
    expect(result.isValid).toBe(false);
  },
);
it("validates final YouTube options, byte boundaries, tags, and scheduling", () => {
  const content = { text: "fallback ".repeat(100), media: [video] };
  expect(
    validateContentForPlatform("youtube", content, { youtube: { title: "Short", description: "é".repeat(2500) } })
      .isValid,
  ).toBe(true);
  const invalid = validateContentForPlatform("youtube", content, {
    youtube: {
      title: "<bad>",
      description: "é".repeat(2501),
      tags: ["a ".repeat(250)],
      publishAt: "2020-01-01T00:00:00Z",
    },
  });
  expect(invalid.errors).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code: "description_too_long", actual: 5002, limit: 5000 }),
      expect.objectContaining({ code: "title_invalid_characters" }),
      expect.objectContaining({ code: "tags_too_long" }),
      expect.objectContaining({ code: "publish_time_past" }),
    ]),
  );
});
it("uses Bluesky graphemes and checks the independent UTF-8 cap", () => {
  expect(validateContentForPlatform("bluesky", { text: "👨‍👩‍👧‍👦".repeat(100) }).isValid).toBe(true);
  expect(validateContentForPlatform("bluesky", { text: "e\u0301".repeat(300) }).isValid).toBe(true);
  expect(validateContentForPlatform("bluesky", { text: "a".repeat(301) }).errors[0].actual).toBe(301);
  expect(validateContentForPlatform("bluesky", { text: "👨‍👩‍👧‍👦".repeat(121) }).errors).toContainEqual(
    expect.objectContaining({ code: "text_bytes_exceeded" }),
  );
});
it("validates Pinterest overrides instead of unused common text", () => {
  expect(
    validateContentForPlatform(
      "pinterest",
      { text: "x".repeat(900), media: [image] },
      { pinterest: { description: "x".repeat(800), boardId: "123" } },
    ).isValid,
  ).toBe(true);
  const result = validateContentForPlatform(
    "pinterest",
    { text: "ok", media: [image] },
    { pinterest: { description: "x".repeat(801), title: "x".repeat(101), altText: "x".repeat(501), boardId: "bad" } },
  );
  expect(result.errors.map((issue) => issue.code)).toEqual(
    expect.arrayContaining(["description_too_long", "title_too_long", "altText_too_long", "board_invalid"]),
  );
});
it("validates Forem final body, title, tags and front matter", () => {
  expect(
    validateContentForPlatform(
      "forem",
      { text: "Article" },
      { forem: { title: "x".repeat(129), tags: ["bad-tag"] } },
    ).errors.map((issue) => issue.code),
  ).toEqual(expect.arrayContaining(["title_too_long", "tag_invalid"]));
  expect(validateContentForPlatform("forem", { text: "---\ntitle: hidden\n---\nBody" }).errors).toContainEqual(
    expect.objectContaining({ code: "frontmatter_unsupported" }),
  );
});
it("parses Telegram HTML before measuring length and catches invalid markup", () => {
  expect(validateContentForPlatform("telegram", { text: `<b>${"&amp;".repeat(4096)}</b>` }).isValid).toBe(true);
  for (const text of ["<b>unclosed", "<script>text</script>", "<b><i>crossed</b></i>", "plain & bad"])
    expect(validateContentForPlatform("telegram", { text }).errors).toContainEqual(
      expect.objectContaining({ code: "telegram_entities_invalid" }),
    );
  expect(
    validateContentForPlatform(
      "telegram",
      { text: "**markdown**" },
      { telegram: { chatId: "1", parseMode: "MarkdownV2" } },
    ).warnings,
  ).toContainEqual(expect.objectContaining({ code: "telegram_entities_unverified" }));
});
it("applies dimension and animation boundaries to actual metadata", () => {
  const media = { contentType: "image/jpeg", size: 1024, width: 864, height: 1080, frames: 1 };
  expect(validateInspectedMedia("instagram", media, { mediaCount: 1 })).toEqual([]);
  expect(validateInspectedMedia("instagram", { ...media, width: 540 }, { mediaCount: 1 })).toContainEqual(
    expect.objectContaining({ code: "media_aspect_ratio_unsupported", actual: 0.5 }),
  );
  expect(validateInspectedMedia("telegram", { ...media, width: 9000, height: 2000 }, { mediaCount: 1 })).toContainEqual(
    expect.objectContaining({ code: "media_width_plus_height_unsupported" }),
  );
  expect(
    validateInspectedMedia("x", { ...media, contentType: "image/gif", frames: 351 }, { mediaCount: 2 }).map(
      (issue) => issue.code,
    ),
  ).toEqual(expect.arrayContaining(["animated_gif_must_be_alone", "media_animation_frames_unsupported"]));
  expect(validateInspectedMedia("linkedin", { ...media, width: 6020, height: 6020 }, { mediaCount: 1 })).toContainEqual(
    expect.objectContaining({ code: "media_pixel_count_unsupported" }),
  );
});
