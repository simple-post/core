import type { Options, Platform } from "../types.js";
// Explicit interface contract: adding a CLI flag should add a round-trip case here.
const flags: Partial<Record<Platform, Record<string, string>>> = {
  x: { replyToId: "x-reply-to-id" },
  telegram: { chatId: "telegram-chat-id", parseMode: "telegram-parse-mode" },
  youtube: {
    tags: "youtube-tags",
    categoryId: "youtube-category-id",
    playlistId: "youtube-playlist-id",
    selfDeclaredMadeForKids: "youtube-made-for-kids",
    publishAt: "youtube-publish-at",
    privacyStatus: "youtube-privacy-status",
  },
  facebook: { publishAt: "facebook-publish-at" },
  tiktok: {
    publishMode: "tiktok-publish-mode",
    autoAddMusic: "tiktok-auto-add-music",
    title: "tiktok-title",
    description: "tiktok-description",
    photoCoverIndex: "tiktok-photo-cover-index",
    privacyLevel: "tiktok-privacy-level",
    visibility: "tiktok-visibility",
    allowComment: "tiktok-allow-comment",
    allowDuet: "tiktok-allow-duet",
    allowStitch: "tiktok-allow-stitch",
  },
  linkedin: { visibility: "linkedin-visibility" },
  pinterest: {
    boardId: "pinterest-board-id",
    title: "pinterest-title",
    description: "pinterest-description",
    link: "pinterest-link",
    altText: "pinterest-alt-text",
  },
  forem: {
    title: "forem-title",
    tags: "forem-tags",
    published: "forem-published",
    canonicalUrl: "forem-canonical-url",
  },
};
export function optionFlags(platform: Platform, options: Options): { args: string[]; remaining: Options } {
  const args: string[] = [],
    remaining: Options = {};
  for (const [key, value] of Object.entries(options)) {
    const flag = flags[platform]?.[key];
    if (!flag || value === null) {
      remaining[key] = value;
      continue;
    }
    if (typeof value === "boolean") args.push(`--${value ? "" : "no-"}${flag}`);
    else args.push(`--${flag}`, Array.isArray(value) ? value.join(",") : String(value));
  }
  return { args, remaining };
}
