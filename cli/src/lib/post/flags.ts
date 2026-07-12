import { Flags } from "@oclif/core";

export const postFlags = {
  interactive: Flags.boolean({
    char: "i",
    default: false,
    description: "Run prompt-based interactive mode",
    helpGroup: "Workflow",
  }),
  account: Flags.string({
    multiple: true,
    description:
      "Stored account selection in the form <platform>:<alias>. Repeat to post through multiple connected accounts.",
    helpGroup: "Targets",
  }),
  "app-account-id": Flags.string({
    multiple: true,
    description:
      'SimplePost app account ID, shown by "simplepost account". Repeat to post through multiple app accounts.',
    helpGroup: "Targets",
  }),
  text: Flags.string({
    description: "Text content",
    helpGroup: "Content",
  }),
  image: Flags.string({
    multiple: true,
    description: "Image path or URL. Repeat to attach multiple images.",
    helpGroup: "Media",
  }),
  video: Flags.string({
    multiple: true,
    description: "Video path or URL. Repeat to attach multiple videos.",
    helpGroup: "Media",
  }),
  "media-json": Flags.string({
    description: "JSON array of media entries or a path to a JSON file",
    helpGroup: "JSON Input",
  }),
  "post-json": Flags.string({
    description: "Full Post payload JSON or a path to a JSON file",
    helpGroup: "JSON Input",
  }),
  "options-json": Flags.string({
    description: "PostOptions JSON or a path to a JSON file",
    helpGroup: "JSON Input",
  }),
  "log-level": Flags.string({
    description: "SDK log level (none, error, warn, info)",
    helpGroup: "Advanced",
  }),
  "strict-mode": Flags.boolean({
    allowNo: true,
    description: "Enable SDK strict mode (use --no-strict-mode to disable)",
    helpGroup: "Advanced",
  }),
  "x-reply-to-id": Flags.string({
    description: "X reply target tweet ID",
    helpGroup: "X",
  }),
  "telegram-chat-id": Flags.string({
    description: "Telegram chat ID",
    helpGroup: "Telegram",
  }),
  "telegram-parse-mode": Flags.string({
    description: "Telegram parse mode",
    helpGroup: "Telegram",
  }),
  "youtube-tags": Flags.string({
    description: "Comma-separated YouTube tags",
    helpGroup: "YouTube",
  }),
  "youtube-category-id": Flags.string({
    description: "YouTube category ID",
    helpGroup: "YouTube",
  }),
  "youtube-playlist-id": Flags.string({
    description: "YouTube playlist ID",
    helpGroup: "YouTube",
  }),
  "youtube-made-for-kids": Flags.boolean({
    allowNo: true,
    description: "Mark YouTube content as made for kids (use --no-youtube-made-for-kids to disable)",
    helpGroup: "YouTube",
  }),
  "youtube-publish-at": Flags.string({
    description: "YouTube scheduled publish timestamp",
    helpGroup: "YouTube",
  }),
  "youtube-privacy-status": Flags.string({
    description: "YouTube privacy status",
    helpGroup: "YouTube",
  }),
  "facebook-publish-at": Flags.string({
    description: "Facebook scheduled publish timestamp",
    helpGroup: "Facebook",
  }),
  "tiktok-publish-mode": Flags.string({
    description: "TikTok publish mode",
    helpGroup: "TikTok",
  }),
  "tiktok-visibility": Flags.string({
    description: "TikTok visibility",
    helpGroup: "TikTok",
  }),
  "tiktok-allow-comment": Flags.boolean({
    allowNo: true,
    description: "Allow TikTok comments (use --no-tiktok-allow-comment to disable)",
    helpGroup: "TikTok",
  }),
  "tiktok-allow-duet": Flags.boolean({
    allowNo: true,
    description: "Allow TikTok duets (use --no-tiktok-allow-duet to disable)",
    helpGroup: "TikTok",
  }),
  "tiktok-allow-stitch": Flags.boolean({
    allowNo: true,
    description: "Allow TikTok stitches (use --no-tiktok-allow-stitch to disable)",
    helpGroup: "TikTok",
  }),
  "linkedin-visibility": Flags.string({
    description: "LinkedIn visibility",
    helpGroup: "LinkedIn",
  }),
  "pinterest-board-id": Flags.string({
    description: "Pinterest board ID",
    helpGroup: "Pinterest",
  }),
  "pinterest-title": Flags.string({
    description: "Pinterest title",
    helpGroup: "Pinterest",
  }),
  "pinterest-description": Flags.string({
    description: "Pinterest description",
    helpGroup: "Pinterest",
  }),
  "pinterest-link": Flags.string({
    description: "Pinterest link URL",
    helpGroup: "Pinterest",
  }),
  "pinterest-alt-text": Flags.string({
    description: "Pinterest alt text",
    helpGroup: "Pinterest",
  }),
  "tumblr-blog-identifier": Flags.string({
    description: "Tumblr blog identifier",
    helpGroup: "Tumblr",
  }),
  "tumblr-state": Flags.string({
    description: "Tumblr post state",
    helpGroup: "Tumblr",
    options: ["published", "queue", "draft", "private"],
  }),
  "tumblr-publish-on": Flags.string({
    description: "Tumblr queue publish timestamp",
    helpGroup: "Tumblr",
  }),
  "tumblr-tags": Flags.string({
    description: "Comma-separated Tumblr tags",
    helpGroup: "Tumblr",
  }),
  "tumblr-source-url": Flags.string({
    description: "Tumblr content source URL",
    helpGroup: "Tumblr",
  }),
  "tumblr-slug": Flags.string({
    description: "Tumblr post URL slug",
    helpGroup: "Tumblr",
  }),
} as const;
