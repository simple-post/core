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
  "strict-mode": Flags.string({
    description: "SDK strict mode (true or false)",
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
  "youtube-made-for-kids": Flags.string({
    description: "YouTube selfDeclaredMadeForKids option (true or false)",
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
  "tiktok-allow-comment": Flags.string({
    description: "TikTok allow comment (true or false)",
    helpGroup: "TikTok",
  }),
  "tiktok-allow-duet": Flags.string({
    description: "TikTok allow duet (true or false)",
    helpGroup: "TikTok",
  }),
  "tiktok-allow-stitch": Flags.string({
    description: "TikTok allow stitch (true or false)",
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
} as const;
