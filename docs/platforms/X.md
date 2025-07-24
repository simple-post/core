# X Platform Specific Options

## Content Support

- **Text**: Standard character limits
- **Media**: Images (JPG, PNG, GIF, WebP), Videos (MP4, MOV)
- **Limit**: Maximum 4 media files per post
- **Requirements**: Must have text OR media (no empty posts)

## Platform-Specific Options

Posting on X supports the following platform-specific options:

### `replyToId`

The ID of the post you want to reply to. Use this to reply to posts or create threads.

```typescript
await post({
  content: { text: "This is a reply to a post" },
  platforms: ["x"],
  options: { x: { replyToId: 123465789 } },
});
```

## Examples

### Basic Posts

```typescript
// Text only
const content = { text: "Hello X!" };

// Media only
const content = { media: [{ type: "image", path: "./photo.jpg" }] };

// Combined
const content = {
  text: "Check out these photos!",
  media: [
    { type: "image", path: "./photo1.jpg" },
    { type: "image", path: "./photo2.jpg" },
  ],
};
```

### Threading

```typescript
// First tweet
const firstTweet = await post({
  content: { text: "Thread: 1/2" },
  platforms: ["x"],
});

// Reply to create thread
await post({
  content: { text: "Thread: 2/2" },
  platforms: ["x"],
  options: { x: { replyToId: firstTweet.get("x")?.id } },
});
```

## Authentication

To post on X you need to set the following environment variables:

```bash
TWITTER_API_KEY=
TWITTER_API_SECRET=
TWITTER_ACCESS_TOKEN=
TWITTER_ACCESS_SECRET=
```

Follow the [X credentials guide](https://docs.unsubpost.dev/dashboard/x) to get your API keys.
