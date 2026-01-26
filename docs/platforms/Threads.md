# Threads Platform Specific Options

## Content Support

- **Text**: Up to 500 characters
- **Media**: One image or one video
- **Limit**: Maximum 1 media item per post
- **Requirements**: Must have text or media (no empty posts)

## Platform-Specific Options

Threads does not require additional options beyond credentials.

## Examples

### Basic Posts

```typescript
// Text only
const content = { text: "Hello Threads!" };

// Image post
const content = {
  text: "Launching something new today.",
  media: [{ type: "image", path: "./photo.jpg" }],
};

// Video post
const content = {
  text: "Quick update video",
  media: [{ type: "video", path: "./video.mp4" }],
};
```

## Authentication

To post on Threads you need:

```bash
THREADS_ACCESS_TOKEN=
THREADS_USER_ID=
```

If you're posting on behalf of a user via OAuth, pass these credentials via `options.threads.credentials`.
