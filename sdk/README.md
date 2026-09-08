# @simple-post/sdk

Post to all social platforms with one TypeScript library: X, Telegram, YouTube, Instagram, Facebook, TikTok, Bluesky, Threads, LinkedIn, Pinterest, and DEV/Forem.

```bash
npm install @simple-post/sdk
```

## Quick start

Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` (for example `@mychannel`), then give the bot permission to post in that chat. The chat ID is passed explicitly. [Telegram setup](https://docs.simplepost.social/telegram).

```typescript title="telegram-quickstart.ts"
import { post } from "@simple-post/sdk";

const botToken = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;
if (!botToken || !chatId) throw new Error("Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID");

const results = await post({
  content: { text: "Hello from SimplePost" },
  platforms: ["telegram"],
  options: { telegram: { chatId, credentials: { botToken } } },
});

const result = results.get("telegram");
console.log(result);
```

`post()` returns a `Map` with a result per platform, including the post ID or a typed error when posting failed.

To add commentary while quoting an existing post, use `quote()`. X, Bluesky,
Threads, and LinkedIn receive native quotes; other platforms publish the new
content as an ordinary post. LinkedIn commentary reshares cannot attach new
media, so quote media is omitted on LinkedIn while remaining available to the
other selected platforms.

```typescript
import { quote } from "@simple-post/sdk";

await quote({
  content: { text: "My take on this" },
  targets: {
    x: { postId: "x-post-id" },
    bluesky: {
      postId: "at://did:plc:source/app.bsky.feed.post/key",
      uri: "at://did:plc:source/app.bsky.feed.post/key",
      cid: "bluesky-record-cid",
    },
  },
  platforms: ["x", "bluesky"],
});
```

Use `target` instead when every selected platform shares one target. A
platform omitted from `targets` receives an ordinary post.

Credentials are provided per platform via environment variables or explicitly through `options.<platform>.credentials`. See the [platform guides](https://docs.simplepost.social/platforms) for how to obtain them.

## Highlights

- One `Post` payload for every platform, validated with Zod schemas
- Media from local paths or URLs, with per-platform requirements checked up front
- Native reposts via `repost()` on platforms that support them
- Native quotes with automatic ordinary-post fallback on unsupported platforms
- Typed results and errors — no exceptions for expected posting failures
- Subpath exports for lightweight use: `@simple-post/sdk/validation`, `@simple-post/sdk/media-types`, `@simple-post/sdk/platform-names`

## Not managing raw credentials?

The same engine powers the rest of SimplePost — the [Scheduler app](https://app.simplepost.social), the [CLI](https://www.npmjs.com/package/@simple-post/cli), an HTTP API server, and an MCP server for AI clients. Pick the layer that fits at [github.com/simple-post/core](https://github.com/simple-post/core).

## Documentation

Read the [SDK guide](https://docs.simplepost.social/sdk), [platform limits](https://docs.simplepost.social/platform-matrix), and [published versus hosted behavior](https://docs.simplepost.social/release-policy#published-packages-and-hosted-features). The docs check examples against published SDK 1.3.3; the main branch can contain later changes.

For upgrade guarantees and release changes, see the [SDK compatibility policy](https://github.com/simple-post/core/blob/main/docs/release/SDK_COMPATIBILITY.md), [migration notes](https://github.com/simple-post/core/blob/main/docs/release/MIGRATIONS.md), and repository [changelog](https://github.com/simple-post/core/blob/main/CHANGELOG.md).

## License

MIT

## TikTok photos and music

TikTok supports 1–35 photos, optional recommended music (`autoAddMusic`), and upload-to-inbox mode (`publishMode: "draft"`) for manual music selection and publishing. The SDK supports these options; hosted interfaces add their own permissions, upload limits, and consent flows. See [TikTok requirements and examples](https://docs.simplepost.social/tiktok).

## Bluesky video

Bluesky supports one MP4 video per post (300 MB, 10 minutes), including replies and quotes, with OAuth or app-password credentials. The SDK uploads and waits for processing before creating the post. Hosted interfaces impose additional [upload limits](https://docs.simplepost.social/publishing#upload-limits), including 50 MiB per file in the web app. See [Bluesky requirements and examples](https://docs.simplepost.social/bluesky).

## Validation runtime

Video publishing requires FFmpeg (`ffprobe` on PATH, or `FFPROBE_PATH`). The provided Docker images include it. See [publishing validation](VALIDATION.md) for shared checks, actionable errors, and provider-side limitations.

For local video publishing, install FFmpeg (`ffprobe` on PATH), or set an absolute `FFPROBE_PATH`. Video inspection failures block publishing before upload. See the [validation coverage and runtime requirements](https://github.com/simple-post/core/blob/main/sdk/VALIDATION.md).
