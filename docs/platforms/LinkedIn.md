# LinkedIn Platform Specific Options

## Content Support

- **Text**: Up to 3000 characters
- **Media**: Images (JPG, PNG) or Videos (MP4)
- **Limit**: Up to 9 images or 1 video (no mixed media)
- **Requirements**: Must have text or media (no empty posts)

## Platform-Specific Options

### `visibility`

Control who can see the post:

- `PUBLIC` (default)
- `CONNECTIONS`

```typescript
await post({
  content: { text: "Posting to LinkedIn" },
  platforms: ["linkedin"],
  options: {
    linkedin: {
      visibility: "CONNECTIONS",
    },
  },
});
```

## Examples

### Basic Posts

```typescript
// Text only
const content = { text: "LinkedIn update!" };

// Image post
const content = {
  text: "New product screenshots",
  media: [{ type: "image", path: "./photo.jpg" }],
};

// Video post
const content = {
  text: "Demo video",
  media: [{ type: "video", path: "./video.mp4", title: "Demo", description: "Short demo video" }],
};
```

## Authentication

To post on LinkedIn you need:

```bash
LINKEDIN_ACCESS_TOKEN=
LINKEDIN_MEMBER_ID=
```

You can also pass credentials via `options.linkedin.credentials` if you are managing tokens yourself.
