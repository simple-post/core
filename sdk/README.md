# @simple-post/sdk

Post to all social platforms with one TypeScript library: X, Telegram, YouTube, Instagram, Facebook, TikTok, Bluesky, Threads, LinkedIn, and Pinterest.

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

Credentials are provided per platform via environment variables or explicitly through `options.<platform>.credentials`. See the [platform guides](https://github.com/simple-post/core/tree/main/docs/platforms) for how to obtain them.

## Highlights

- One `Post` payload for every platform, validated with Zod schemas
- Media from local paths or URLs, with per-platform requirements checked up front
- Native reposts via `repost()` on platforms that support them
- Typed results and errors — no exceptions for expected posting failures
- Subpath exports for lightweight use: `@simple-post/sdk/validation`, `@simple-post/sdk/media-types`, `@simple-post/sdk/platform-names`

## Not managing raw credentials?

The same engine powers the rest of SimplePost — the [Scheduler app](https://simplepost.social), the [CLI](https://www.npmjs.com/package/@simple-post/cli), an HTTP API server, and an MCP server for AI clients. Pick the layer that fits at [github.com/simple-post/core](https://github.com/simple-post/core).

## Documentation

Full documentation lives in the [SimplePost core repository](https://github.com/simple-post/core/tree/main/docs/typescript-sdk).

## License

MIT
