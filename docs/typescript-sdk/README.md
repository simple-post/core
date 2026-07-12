# TypeScript SDK

The simplest way to use SimplePost - integrate directly into your TypeScript project with a unified interface for all social platforms.

Use the SDK when you control the TypeScript runtime and want the least abstraction between your app or agent and the platform publishers. The [HTTP API server](../http-server/README.md), [Scheduler app](../scheduler-app/README.md), [CLI](../cli/README.md), and [MCP server](../mcp-server/README.md) all build on this package.

## Quick Start

**Already have credentials?** Jump straight to posting:

```typescript
import { post } from "@simple-post/sdk";

// Single platform
await post({
  content: { text: "Hello world!" },
  platforms: ["x"],
});

// Multiple platforms
await post({
  content: { text: "Cross-platform posting!" },
  platforms: ["x", "facebook"],
});

// With media as files
await post({
  content: {
    text: "Check out this video!",
    media: [{ type: "video", path: "./video.mp4" }],
  },
  platforms: ["x", "youtube"],
});

// With media as URLs
await post({
  content: {
    text: "Check out this video!",
    media: [{ type: "video", url: "https://cdn.example.com/video.mp4" }],
  },
  platforms: ["x", "youtube"],
});
```

**Need credentials?** Use the public [platform guides](../platforms/), or run the open-source repository with your own platform apps and credentials.

## Installation

The package is published on the public npm registry:

```bash
npm install @simple-post/sdk
# or
yarn add @simple-post/sdk
# or
pnpm add @simple-post/sdk
```

## Usage

### Credentials Setup

Set up credentials using environment variables. The public [platform guides](../platforms/) explain what each platform requires.

### Basic Posting

The `post()` function takes content and target platforms:

#### Simple post

Posting text is straightforward:

```typescript
import { post } from "@simple-post/sdk";

post({
  content: {
    text: "Hey, this is a simple post",
  },
  platforms: ["x", "facebook"],
});
```

The function returns a `Map` of results for each platform, including the post ID and error message if posting failed.

```typescript
Map(2) {
  'x' => { id: '1947334111111111111', error: 'NO_ERROR' },
  'facebook' => { id: '1234567890', error: 'NO_ERROR' }
}
```

When errors occur, the result contains the error message and detailed information.

```typescript
Map(1) {
  'x' => {
    error: 'API_ERROR',
    message: 'Failed to post content: Error: Request failed with code 403',
    details: {
      detail: 'You are not allowed to create a Tweet with duplicate content.',
      type: 'about:blank',
      title: 'Forbidden',
      status: 403
    }
  }
}
```

#### Media Posts

Media items accept either a local `path` or a public `url`. The SDK downloads or uploads as needed.

Post images and videos by adding a `media` array:

```typescript
// Single video
const results = await post({
  content: {
    text: "Check out my awesome video!",
    media: [{ type: "video", path: "./video.mp4", title: "My Video" }],
  },
  platforms: ["x", "youtube", "instagram"],
});

// Single video with URL
const results = await post({
  content: {
    text: "Check out my awesome video!",
    media: [{ type: "video", url: "https://cdn.example.com/video.mp4", title: "My Video" }],
  },
  platforms: ["x", "youtube", "instagram"],
});

// Multiple images (carousel)
const results = await post({
  content: {
    text: "Here are some great photos!",
    media: [
      { type: "image", path: "./image1.jpg" },
      { type: "image", path: "./image2.jpg" },
      { type: "image", path: "./image3.jpg" },
    ],
  },
  platforms: ["x", "instagram"],
});
```

#### Replies

Reply to an X post:

```typescript
await post({
  content: { text: "Great point!" },
  platforms: ["x"],
  options: {
    x: { replyToId: "1234567890" },
  },
});
```

#### Threads

Create a thread on X:

```typescript
const threadPosts = [
  "This is a thread about TypeScript! 🧵 1/3",
  "TypeScript gives you better developer experience 2/3",
  "And helps catch bugs early! 3/3",
];

let previousId: string | undefined;

for (const text of threadPosts) {
  const results = await post({
    content: { text },
    platforms: ["x"],
    options: {
      x: previousId ? { replyToId: previousId } : undefined,
    },
  });

  previousId = results.get("x")?.id;
}
```

#### Channels and DMs

Specify which chat to post to:

```typescript
await post({
  content: { text: "Hello Telegram!" },
  platforms: ["telegram"],
  options: {
    telegram: { chatId: "1234567890" },
  },
});
```

## Configuration Options

### Strict Mode

By default, SimplePost adapts content to platform limits (e.g., X allows 4 images, Instagram allows 10). Enable strict mode to fail instead of adapting:

```typescript
await post({
  content: { text: "Cross-platform post" },
  platforms: ["x", "instagram"],
  options: {
    common: { strictMode: true },
  },
});
```

### Logging

Control what gets logged to the console:

```typescript
await post({
  content: { text: "Debug this post" },
  platforms: ["x"],
  options: {
    common: { logLevel: "info" }, // "none" | "error" | "warn" | "info"
  },
});
```

**Log levels:**

- `none` - No SDK logs
- `error` - Only errors (default)
- `warn` - Errors and warnings
- `info` - Everything

## Platform Specifics

For detailed platform-specific documentation, check out the platform guides:

- [X](../platforms/X.md)
- [Telegram](../platforms/Telegram.md)
- [Instagram](../platforms/Instagram.md)
- [Facebook](../platforms/Facebook.md)
- [Threads](../platforms/Threads.md)
- [TikTok](../platforms/TikTok.md)
- [YouTube](../platforms/YouTube.md)
- [Pinterest](../platforms/Pinterest.md)
- [Tumblr](../platforms/Tumblr.md)
- [LinkedIn](../platforms/LinkedIn.md)
- [Bluesky](../platforms/Bluesky.md)

## Examples

For more examples, check out the [`/examples`](../../examples) directory.

## What's Next?

- **Need help with credentials?** → [platform guides](../platforms/)
- **Want an HTTP API?** → [HTTP API server docs](../http-server/README.md)
- **Need a web UI?** → [Scheduler app docs](../scheduler-app/README.md)
- **Need terminal posting?** → [CLI docs](../cli/README.md)
- **Need AI assistant posting?** → [MCP server docs](../mcp-server/README.md)
- **Found a bug?** → [Open an issue](https://github.com/simple-post/core/issues)
