# TypeScript SDK

The simplest way to use Unsubpost - integrate directly into your TypeScript project with a unified interface for all social platforms.

## Quick Start

**Already have credentials?** Jump straight to posting:

```typescript
import { post } from "@unsubpost/unsubpost";

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

// With media
await post({
  content: {
    text: "Check out this video!",
    media: [{ type: "video", path: "./video.mp4" }],
  },
  platforms: ["x", "youtube"],
});
```

**Need credentials?** Get them at [docs.unsubpost.dev](https://docs.unsubpost.dev), then continue below.

## Installation

Since this is a private package, you need to set up GitHub access first.

### 1. Create GitHub Personal Access Token

Go to [GitHub settings](https://github.com/settings/tokens) → Generate new token (classic):

- **Name:** "Unsubpost NPM Access"
- **Expiration:** No expiration
- **Permissions:** `read:packages` only

Store the token in an environment variable called `GITHUB_TOKEN` in your `.env` file or shell environment.

### 2. Configure Package Manager

#### npm / yarn v1 / pnpm

Add to `.npmrc`:

```bash
@unsubpost:registry=https://npm.pkg.github.com/
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

#### yarn v2+

Add to `.yarnrc.yml`:

```yaml
npmScopes:
  unsubpost:
    npmRegistryServer: "https://npm.pkg.github.com"
    npmAuthToken: "${GITHUB_TOKEN}"
```

### 3. Install

```bash
npm install @unsubpost/unsubpost
# or
yarn add @unsubpost/unsubpost
# or
pnpm add @unsubpost/unsubpost
```

## Usage

### Credentials Setup

Set up credentials using environment variables. Get platform-specific tokens at [docs.unsubpost.dev](https://docs.unsubpost.dev).

### Basic Posting

The `post()` function takes content and target platforms:

#### Simple post

Posting text is straightforward:

```typescript
import { post } from "@unsubpost/unsubpost";

post({
  content: {
    text: "Hey, this is a simple post",
  },
  platforms: ["x", "facebook"],
});
```

The function returns a `Map` of the results of the posting on each platform, the post ID and the error message if the posting failed.

```typescript
Map(2) {
  'x' => { id: '1947334111111111111', error: 'NO_ERROR' },
  'facebook' => { id: '1234567890', error: 'NO_ERROR' }
}
```

In case of an error, the result will contain the error message and the details of the error.

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

By default, Unsubpost adapts content to platform limits (e.g., X allows 4 images, Instagram allows 10). Enable strict mode to fail instead of adapting:

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
    common: { logLevel: "info" }, // "error" | "warning" | "info"
  },
});
```

**Log levels:**

- `error` - Only errors (default)
- `warning` - Errors and warnings
- `info` - Everything

## Plarform Specifics

For detailed platform specific documentation check out the platform specific docs:

- [X](../platforms/X.md)
- [Facebook](../platforms/Facebook.md)
- [Instagram](../platforms/Instagram.md)
- [YouTube](../platforms/YouTube.md)
- [Telegram](../platforms/Telegram.md)

## Examples

For more examples check out the [`/examples`](../../examples) directory.

## What's Next?

- **Need help with credentials?** → [docs.unsubpost.dev](https://docs.unsubpost.dev)
- **Want an HTTP API?** → [HTTP Server docs](../http-server/README.md) (coming soon)
- **Using N8N?** → [N8N Node docs](../n8n-node/README.md) (coming soon)
- **Found a bug?** → [Open an issue](https://github.com/unsubpost/unsubpost/issues)
