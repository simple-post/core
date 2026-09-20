# SimplePost TypeScript SDK

Use `@simple-post/sdk` when building or editing a TypeScript app or agent that can publish in-process.

## Basic Posting

```typescript
import { post } from "@simple-post/sdk";

const results = await post({
  content: {
    text: "Hello from SimplePost",
    media: [{ type: "image", url: "https://cdn.example.com/image.jpg" }],
  },
  platforms: ["x", "telegram", "linkedin"],
});
```

`post()` returns a `Map<Platform, PostResult>`. Check every platform result; one platform can fail while others succeed.

## Media

SDK media accepts local paths or public URLs:

```typescript
await post({
  content: {
    text: "Video post",
    media: [{ type: "video", path: "./video.mp4", title: "Launch demo" }],
  },
  platforms: ["x", "youtube"],
});
```

For multi-platform media preparation, use `prepareMedia()` and always call `cleanup()`:

```typescript
import { post, prepareMedia } from "@simple-post/sdk";

const prepared = await prepareMedia({
  content: { media: [{ type: "video", url: "https://cdn.example.com/video.mp4" }] },
  platforms: ["youtube", "x", "facebook"],
});

try {
  await post(prepared.post);
} finally {
  await prepared.cleanup();
}
```

## Options

Use `options.common` for shared behavior and platform keys for platform-specific settings:

```typescript
await post({
  content: { text: "Replying from SimplePost" },
  platforms: ["x"],
  options: {
    common: { strictMode: true, logLevel: "info" },
    x: { replyToId: "1234567890" },
  },
});
```

Credentials can come from environment variables or `options[platform].credentials`. Avoid hardcoding credentials in source code.

## Validation Helpers

Use exported schemas and helpers when building integrations:

- `PostSchema`
- `PlatformSchema`
- `createPostSchema`
- `validationRequestSchema`
- `getValidationRulesForPlatform`
- `validateContentForPlatform`

