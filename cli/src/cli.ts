import { stdin as input, stdout as output } from "node:process";
import { access, readFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";

import { PlatformSchema, PostSchema, post, prepareMedia, type Platform, type Post, type PostOptions } from "@simple-post/sdk";

type ArgMap = Record<string, string | boolean | string[]>;

const HELP_TEXT = `simple-post - Post to multiple social platforms via @simple-post/sdk

Usage:
  simple-post --interactive
  simple-post --platforms x,telegram --text "Hello world" --telegram-chat-id "12345"
  simple-post --post-json ./post.json

Common arguments:
  -i, --interactive                Run prompt-based interactive mode
  -h, --help                       Show this help
  --platforms <list>               Comma-separated platforms (${PlatformSchema.options.join(", ")})
  --text <value>                   Text content
  --image <pathOrUrl>              Add image media (repeatable)
  --video <pathOrUrl>              Add video media (repeatable)
  --media-json <json>              JSON array of media entries
  --post-json <json|file>          Full Post payload JSON or path to JSON file
  --options-json <json|file>       PostOptions JSON or path to JSON file
  --prepare-media                  Pre-resolve media via SDK prepareMedia()

Platform options:
  --log-level <none|error|warn|info>
  --strict-mode <true|false>
  --x-reply-to-id <id>
  --telegram-chat-id <id>
  --telegram-parse-mode <HTML|Markdown|MarkdownV2>
  --youtube-tags <tag1,tag2>
  --youtube-category-id <id>
  --youtube-playlist-id <id>
  --youtube-made-for-kids <true|false>
  --youtube-publish-at <ISO timestamp>
  --youtube-privacy-status <public|private|unlisted>
  --facebook-publish-at <ISO timestamp>
  --tiktok-publish-mode <draft|public>
  --tiktok-visibility <public|friends|private>
  --tiktok-allow-comment <true|false>
  --tiktok-allow-duet <true|false>
  --tiktok-allow-stitch <true|false>
  --linkedin-visibility <PUBLIC|CONNECTIONS>
  --pinterest-board-id <id>
  --pinterest-title <value>
  --pinterest-description <value>
  --pinterest-link <url>
  --pinterest-alt-text <value>

Credentials:
  Credentials are loaded from environment variables by @simple-post/sdk.
`;

function isTruthy(value?: string | boolean): boolean {
  if (typeof value === "boolean") return value;
  if (!value) return false;
  return ["true", "1", "yes", "y"].includes(value.toLowerCase());
}

function parseBoolean(value: string | boolean | undefined, name: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "boolean") return value;
  if (["true", "1", "yes", "y"].includes(value.toLowerCase())) return true;
  if (["false", "0", "no", "n"].includes(value.toLowerCase())) return false;
  throw new Error(`Invalid boolean for --${name}: ${value}`);
}

function isUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function addArg(args: ArgMap, key: string, value: string | boolean): void {
  const current = args[key];
  if (current === undefined) {
    args[key] = value;
    return;
  }

  if (Array.isArray(current)) {
    current.push(String(value));
    return;
  }

  args[key] = [String(current), String(value)];
}

function parseArgs(argv: string[]): ArgMap {
  const args: ArgMap = {};

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("-")) continue;

    const key = token.replace(/^-+/, "");
    const next = argv[i + 1];
    if (!next || next.startsWith("-")) {
      addArg(args, key, true);
      continue;
    }

    addArg(args, key, next);
    i += 1;
  }

  if (args.i && !args.interactive) args.interactive = args.i;
  if (args.h && !args.help) args.help = args.h;

  return args;
}

async function parseJsonInput(raw: string): Promise<unknown> {
  try {
    await access(raw);
    const contents = await readFile(raw, "utf8");
    return JSON.parse(contents);
  } catch {
    return JSON.parse(raw);
  }
}

function toArray(value?: string | boolean | string[]): string[] {
  if (value === undefined || typeof value === "boolean") return [];
  if (Array.isArray(value)) return value;
  return [value];
}

function firstValue(value?: string | boolean | string[]): string | boolean | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function parsePlatforms(raw?: string | boolean): Platform[] {
  if (!raw || typeof raw === "boolean") return [];
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => PlatformSchema.parse(item));
}

function buildOptions(args: ArgMap): PostOptions | undefined {
  const options: PostOptions = {};

  const logLevelArg = firstValue(args["log-level"]);
  const strictModeArg = firstValue(args["strict-mode"]);
  const logLevel = typeof logLevelArg === "string" ? logLevelArg : undefined;
  const strictMode = parseBoolean(strictModeArg, "strict-mode");
  if (logLevel || strictMode !== undefined) {
    options.common = {
      ...(logLevel ? { logLevel: logLevel as NonNullable<PostOptions["common"]>["logLevel"] } : {}),
      ...(strictMode !== undefined ? { strictMode } : {}),
    };
  }

  if (typeof args["x-reply-to-id"] === "string") {
    options.x = { replyToId: args["x-reply-to-id"] };
  }

  if (typeof args["telegram-chat-id"] === "string" || typeof args["telegram-parse-mode"] === "string") {
    options.telegram = {
      ...(typeof args["telegram-chat-id"] === "string" ? { chatId: args["telegram-chat-id"] } : { chatId: "" }),
      ...(typeof args["telegram-parse-mode"] === "string"
        ? { parseMode: args["telegram-parse-mode"] as NonNullable<PostOptions["telegram"]>["parseMode"] }
        : {}),
    };
  }

  const youtubeTags = typeof args["youtube-tags"] === "string" ? args["youtube-tags"].split(",").map((t) => t.trim()).filter(Boolean) : undefined;
  if (
    youtubeTags ||
    typeof args["youtube-category-id"] === "string" ||
    typeof args["youtube-playlist-id"] === "string" ||
    firstValue(args["youtube-made-for-kids"]) !== undefined ||
    typeof args["youtube-publish-at"] === "string" ||
    typeof args["youtube-privacy-status"] === "string"
  ) {
    options.youtube = {
      ...(youtubeTags ? { tags: youtubeTags } : {}),
      ...(typeof args["youtube-category-id"] === "string" ? { categoryId: args["youtube-category-id"] } : {}),
      ...(typeof args["youtube-playlist-id"] === "string" ? { playlistId: args["youtube-playlist-id"] } : {}),
      ...(firstValue(args["youtube-made-for-kids"]) !== undefined
        ? {
            selfDeclaredMadeForKids: parseBoolean(
              firstValue(args["youtube-made-for-kids"]),
              "youtube-made-for-kids",
            ),
          }
        : {}),
      ...(typeof args["youtube-publish-at"] === "string" ? { publishAt: args["youtube-publish-at"] } : {}),
      ...(typeof args["youtube-privacy-status"] === "string"
        ? { privacyStatus: args["youtube-privacy-status"] as NonNullable<PostOptions["youtube"]>["privacyStatus"] }
        : {}),
    };
  }

  if (typeof args["facebook-publish-at"] === "string") {
    options.facebook = { publishAt: args["facebook-publish-at"] };
  }

  if (
    typeof args["tiktok-publish-mode"] === "string" ||
    typeof args["tiktok-visibility"] === "string" ||
    firstValue(args["tiktok-allow-comment"]) !== undefined ||
    firstValue(args["tiktok-allow-duet"]) !== undefined ||
    firstValue(args["tiktok-allow-stitch"]) !== undefined
  ) {
    options.tiktok = {
      ...(typeof args["tiktok-publish-mode"] === "string"
        ? { publishMode: args["tiktok-publish-mode"] as NonNullable<PostOptions["tiktok"]>["publishMode"] }
        : {}),
      ...(typeof args["tiktok-visibility"] === "string"
        ? { visibility: args["tiktok-visibility"] as NonNullable<PostOptions["tiktok"]>["visibility"] }
        : {}),
      ...(firstValue(args["tiktok-allow-comment"]) !== undefined
        ? {
            allowComment: parseBoolean(firstValue(args["tiktok-allow-comment"]), "tiktok-allow-comment"),
          }
        : {}),
      ...(firstValue(args["tiktok-allow-duet"]) !== undefined
        ? { allowDuet: parseBoolean(firstValue(args["tiktok-allow-duet"]), "tiktok-allow-duet") }
        : {}),
      ...(firstValue(args["tiktok-allow-stitch"]) !== undefined
        ? { allowStitch: parseBoolean(firstValue(args["tiktok-allow-stitch"]), "tiktok-allow-stitch") }
        : {}),
    };
  }

  if (typeof args["linkedin-visibility"] === "string") {
    options.linkedin = {
      visibility: args["linkedin-visibility"] as NonNullable<PostOptions["linkedin"]>["visibility"],
    };
  }

  if (
    typeof args["pinterest-board-id"] === "string" ||
    typeof args["pinterest-title"] === "string" ||
    typeof args["pinterest-description"] === "string" ||
    typeof args["pinterest-link"] === "string" ||
    typeof args["pinterest-alt-text"] === "string"
  ) {
    options.pinterest = {
      ...(typeof args["pinterest-board-id"] === "string" ? { boardId: args["pinterest-board-id"] } : { boardId: "" }),
      ...(typeof args["pinterest-title"] === "string" ? { title: args["pinterest-title"] } : {}),
      ...(typeof args["pinterest-description"] === "string" ? { description: args["pinterest-description"] } : {}),
      ...(typeof args["pinterest-link"] === "string" ? { link: args["pinterest-link"] } : {}),
      ...(typeof args["pinterest-alt-text"] === "string" ? { altText: args["pinterest-alt-text"] } : {}),
    };
  }

  return Object.keys(options).length > 0 ? options : undefined;
}

async function askInteractive(): Promise<Post> {
  const rl = createInterface({ input, output });
  try {
    const text = (await rl.question("Post text (optional): ")).trim();
    const platformAnswer = (await rl.question(`Platforms (comma-separated: ${PlatformSchema.options.join(", ")}): `)).trim();
    const platforms = parsePlatforms(platformAnswer);

    const media: Post["content"]["media"] = [];
    while (true) {
      const addMedia = (await rl.question("Add media? (y/n): ")).trim().toLowerCase();
      if (!["y", "yes"].includes(addMedia)) break;

      const typeInput = (await rl.question("Media type (image/video): ")).trim().toLowerCase();
      if (typeInput !== "image" && typeInput !== "video") {
        console.log("Skipping media: invalid type.");
        continue;
      }

      const source = (await rl.question("Path or URL: ")).trim();
      if (!source) continue;

      if (typeInput === "image") {
        const caption = (await rl.question("Caption (optional): ")).trim();
        media.push(
          isUrl(source)
            ? { type: "image", url: source, ...(caption ? { caption } : {}) }
            : { type: "image", path: source, ...(caption ? { caption } : {}) },
        );
      } else {
        const title = (await rl.question("Video title (optional): ")).trim();
        const description = (await rl.question("Video description (optional): ")).trim();
        media.push(
          isUrl(source)
            ? { type: "video", url: source, ...(title ? { title } : {}), ...(description ? { description } : {}) }
            : { type: "video", path: source, ...(title ? { title } : {}), ...(description ? { description } : {}) },
        );
      }
    }

    const commonLogLevel = (await rl.question("Log level (none/error/warn/info, optional): ")).trim();
    const strictModeRaw = (await rl.question("Strict mode? (true/false, optional): ")).trim();
    const telegramChatId = platforms.includes("telegram") ? (await rl.question("Telegram chat ID (optional): ")).trim() : "";
    const pinterestBoardId = platforms.includes("pinterest") ? (await rl.question("Pinterest board ID (optional): ")).trim() : "";

    const options: PostOptions = {};
    if (commonLogLevel || strictModeRaw) {
      options.common = {
        ...(commonLogLevel ? { logLevel: commonLogLevel as NonNullable<PostOptions["common"]>["logLevel"] } : {}),
        ...(strictModeRaw ? { strictMode: parseBoolean(strictModeRaw, "strict-mode") } : {}),
      };
    }

    if (telegramChatId) options.telegram = { chatId: telegramChatId };
    if (pinterestBoardId) options.pinterest = { boardId: pinterestBoardId };

    const result: Post = {
      platforms,
      content: {
        ...(text ? { text } : {}),
        ...(media.length > 0 ? { media } : {}),
      },
      ...(Object.keys(options).length > 0 ? { options } : {}),
    };

    return PostSchema.parse(result);
  } finally {
    rl.close();
  }
}

async function buildPostFromArgs(args: ArgMap): Promise<Post> {
  if (typeof args["post-json"] === "string") {
    const parsed = await parseJsonInput(args["post-json"]);
    return PostSchema.parse(parsed);
  }

  const platforms = parsePlatforms(firstValue(args.platforms));
  const text = typeof args.text === "string" ? args.text : undefined;

  const media: NonNullable<Post["content"]["media"]> = [];
  for (const imageValue of toArray(args.image)) {
    media.push(isUrl(imageValue) ? { type: "image", url: imageValue } : { type: "image", path: imageValue });
  }

  for (const videoValue of toArray(args.video)) {
    media.push(isUrl(videoValue) ? { type: "video", url: videoValue } : { type: "video", path: videoValue });
  }

  if (typeof args["media-json"] === "string") {
    const parsedMedia = await parseJsonInput(args["media-json"]);
    if (!Array.isArray(parsedMedia)) {
      throw new Error("--media-json must parse to an array");
    }
    media.push(...(parsedMedia as NonNullable<Post["content"]["media"]>));
  }

  let options = buildOptions(args);
  if (typeof args["options-json"] === "string") {
    const parsed = await parseJsonInput(args["options-json"]);
    options = { ...(options ?? {}), ...(parsed as PostOptions) };
  }

  const postInput: Post = {
    platforms,
    content: {
      ...(text ? { text } : {}),
      ...(media.length > 0 ? { media } : {}),
    },
    ...(options ? { options } : {}),
  };

  return PostSchema.parse(postInput);
}

async function run(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(HELP_TEXT);
    return;
  }

  const interactive = isTruthy(firstValue(args.interactive));
  const postData = interactive ? await askInteractive() : await buildPostFromArgs(args);

  const shouldPrepareMedia = isTruthy(firstValue(args["prepare-media"]));
  const payload = shouldPrepareMedia ? await prepareMedia(postData) : undefined;

  try {
    const results = await post(payload ? payload.post : postData);
    const outputRows = Array.from(results.entries()).map(([platform, result]) => ({ platform, ...result }));

    console.log(JSON.stringify(outputRows, null, 2));
  } finally {
    if (payload) {
      await payload.cleanup();
    }
  }
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`simple-post CLI error: ${message}`);
  process.exit(1);
});
