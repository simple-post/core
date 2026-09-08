import { telegramText } from "./telegram-text";

import type { Content, Platform, PostOptions } from "../types/post";
import type { ValidationIssue } from "../types/validation";

/** Pure, browser-safe validation of the exact metadata used by publishers. */
export function validateFinalOptions(platform: Platform, content: Content, options?: PostOptions): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (code: string, field: string, message: string, actual?: number, limit?: number) =>
    issues.push({ platform, severity: "error", code, field, message, actual, limit });
  const length = (field: string, value: string | undefined, limit: number) => {
    const actual = [...(value ?? "")].length;
    if (actual > limit)
      add(
        `${field}_too_long`,
        field,
        `${platform} ${field} is ${actual} characters; the limit is ${limit}. Shorten this field.`,
        actual,
        limit,
      );
  };
  const video = content.media?.find((item) => item.type === "video");
  if (platform === "youtube") {
    const settings = options?.youtube;
    const tags = settings?.tags ?? [];
    const tagLength = tags.reduce(
      (total, tag) => total + [...tag].length + (/\s/.test(tag) ? 2 : 0),
      Math.max(0, tags.length - 1),
    );
    if (tagLength > 500)
      add(
        "tags_too_long",
        "tags",
        "YouTube tags exceed 500 characters including commas and quotes around tags containing spaces. Remove or shorten tags.",
        tagLength,
        500,
      );
    if (tags.some((tag) => !tag.trim() || /[<>]/.test(tag)))
      add("tags_invalid", "tags", "YouTube tags must be nonempty and cannot contain < or >.");
    if (settings?.categoryId && !/^\d+$/.test(settings.categoryId))
      add("category_invalid", "categoryId", "Choose a valid numeric YouTube video category.");
    if (settings?.playlistId)
      add(
        "youtube_playlist_unavailable",
        "playlistId",
        "Playlist assignment is currently unavailable. Remove this option and assign the playlist in YouTube Studio.",
      );
  }
  if (platform === "pinterest") {
    const settings = options?.pinterest;
    length("title", settings?.title ?? video?.title, 100);
    const image = content.media?.[0];
    length("altText", settings?.altText ?? (image?.type === "image" ? image.caption : undefined), 500);
    length("link", settings?.link, 2048);
    if (settings?.link && !/^https?:\/\//i.test(settings.link))
      add("link_invalid", "link", "Pinterest destination links must use HTTP or HTTPS.");
    // Missing board is resolved by account/environment options; once present its ID must be numeric.
    if (settings?.boardId !== undefined && !/^\d+$/.test(settings.boardId))
      add("board_invalid", "boardId", "Select a valid Pinterest board (a numeric board ID).");
  }
  if (platform === "forem") {
    const settings = options?.forem;
    const article = getForemArticle(content, settings);
    const titleLength = [...article.title.replaceAll(/\s/gu, "")].length;
    if (titleLength > 128)
      add(
        "title_too_long",
        "title",
        "Forem titles cannot exceed 128 non-whitespace characters. Supply a shorter title.",
        titleLength,
        128,
      );
    if (!article.title.trim()) add("title_required", "title", "Supply a nonempty article title.");
    length("bodyMarkdown", article.bodyMarkdown, 100_000);
    if (/^---\s*\n/.test(article.bodyMarkdown))
      add(
        "frontmatter_unsupported",
        "text",
        "Remove YAML front matter and use the title, tags, published, and other article options. Front matter can override validated metadata.",
      );
    if ((settings?.tags?.length ?? 0) > 4) add("too_many_tags", "tags", "Forem articles allow up to four tags.");
    if (settings?.tags?.some((tag) => !/^[\p{L}\p{N}]{1,30}$/u.test(tag)))
      add("tag_invalid", "tags", "Forem tags must contain 1–30 letters or numbers, without spaces or punctuation.");
  }
  if (platform === "telegram") {
    // The publisher defaults text-only messages to HTML; media captions default to plain text.
    const mode = options?.telegram?.parseMode ?? (content.media?.length ? undefined : "HTML");
    const parsed = telegramText(content.text ?? "", mode);
    if (parsed.error) add("telegram_entities_invalid", "text", parsed.error);
    if (parsed.warning)
      issues.push({
        platform,
        severity: "warning",
        code: "telegram_entities_unverified",
        field: "text",
        message: parsed.warning,
      });
    const limit = content.media?.length ? 1024 : 4096;
    // Telegram uses UTF-16 offsets for text entities.
    if (parsed.text.length > limit)
      add(
        "telegram_text_too_long",
        "text",
        `Telegram ${content.media?.length ? "captions" : "messages"} allow ${limit} characters after formatting entities are parsed. Shorten this text.`,
        parsed.text.length,
        limit,
      );
    if (options?.telegram?.replyTo && !/^\d+$/.test(options.telegram.replyTo))
      add("reply_target_invalid", "replyTo", "Telegram reply targets must be numeric message IDs.");
  }
  if (platform === "facebook" && video) {
    length("description", video.description ?? content.text, 63_206);
  }
  if (platform === "youtube" || platform === "facebook") {
    const publishAt = platform === "youtube" ? options?.youtube?.publishAt : options?.facebook?.publishAt;
    if (publishAt) {
      const when = Date.parse(publishAt);
      if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(publishAt) || !Number.isFinite(when))
        add("publish_time_invalid", "publishAt", "Use a valid ISO 8601 publication time with a timezone.");
      else if (when <= Date.now())
        add(
          "publish_time_past",
          "publishAt",
          "The native publication time must be in the future. Remove it to publish now.",
        );
      else if (platform === "facebook" && when - Date.now() < 10 * 60_000)
        add(
          "publish_time_out_of_range",
          "publishAt",
          "Facebook native scheduling must be at least 10 minutes ahead. Use SimplePost scheduling for nearer dates.",
        );
      if (platform === "facebook" && when - Date.now() > 30 * 86_400_000)
        issues.push({
          platform,
          severity: "warning",
          code: "native_schedule_window_unverified",
          field: "publishAt",
          message:
            "Facebook native scheduling windows differ by endpoint. Use SimplePost scheduling for dates more than 30 days away.",
        });
    }
  }
  return issues;
}

/** Keep validation and the Forem request body on one serialization path. */
export function getForemArticle(
  content: Content,
  settings?: PostOptions["forem"],
): { title: string; bodyMarkdown: string } {
  const title =
    settings?.title ??
    (content.text
      ?.trim()
      .split("\n")[0]
      .replace(/^#+\s*/, "") ||
      "Article");
  const markdownMedia = (content.media ?? []).map((item) =>
    item.type === "image" ? `![${item.caption || "image"}](${item.url})` : `[Video](${item.url})`,
  );
  return { title, bodyMarkdown: [content.text?.trim(), ...markdownMedia].filter(Boolean).join("\n\n") };
}
