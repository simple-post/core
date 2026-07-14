# @simple-post/sdk

Post to all social platforms with one TypeScript library: X, Telegram, YouTube, Instagram, Facebook, TikTok, Bluesky, Threads, LinkedIn, Pinterest, and DEV/Forem.

```bash
npm install @simple-post/sdk
```

## Quick start

```typescript
import { post } from "@simple-post/sdk";

// Single platform
await post({
  content: { text: "Hello world!" },
  platforms: ["x"],
});

// Multiple platforms, with media
await post({
  content: {
    text: "Check out this video!",
    media: [{ type: "video", path: "./video.mp4" }],
  },
  platforms: ["x", "youtube"],
});
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
  platforms: ["x", "bluesky", "instagram"],
});
```

Use `target` instead when every selected platform shares one target. A
platform omitted from `targets` receives an ordinary post.

Credentials are provided per platform via environment variables or explicitly through `options.<platform>.credentials`. See the [platform guides](https://github.com/simple-post/core/tree/main/docs/platforms) for how to obtain them.

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

Full documentation lives in the [SimplePost core repository](https://github.com/simple-post/core/tree/main/docs/typescript-sdk).

For upgrade guarantees and release changes, see the [SDK compatibility policy](https://github.com/simple-post/core/blob/main/docs/release/SDK_COMPATIBILITY.md), [migration notes](https://github.com/simple-post/core/blob/main/docs/release/MIGRATIONS.md), and repository [changelog](https://github.com/simple-post/core/blob/main/CHANGELOG.md).

## License

MIT
