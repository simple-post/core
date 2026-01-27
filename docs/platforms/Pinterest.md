# Pinterest Platform Specific Options

## Content Support

- **Text**: Description up to 500 characters
- **Media**: One image or one video
- **Limit**: Maximum 1 media item per pin
- **Requirements**: Media is required, and `boardId` must be provided

## Platform-Specific Options

### `boardId` (required)

The board where the pin will be created.

### Optional fields

- `title`
- `description`
- `link`
- `altText`

```typescript
await post({
  content: {
    text: "A short description for the pin",
    media: [{ type: "image", path: "./photo.jpg" }],
  },
  platforms: ["pinterest"],
  options: {
    pinterest: {
      boardId: "1234567890123456789",
      title: "Pin title",
      link: "https://example.com",
      altText: "A descriptive alt text",
    },
  },
});
```

## Examples

### Basic Pins

```typescript
// Image pin
const content = {
  text: "Simple image pin",
  media: [{ type: "image", path: "./photo.jpg" }],
};

// Video pin
const content = {
  text: "Short demo video pin",
  media: [{ type: "video", path: "./video.mp4", title: "Demo video" }],
};
```

## Authentication

To post on Pinterest you need:

```bash
PINTEREST_ACCESS_TOKEN=
PINTEREST_BOARD_ID=
```

You can also pass the `boardId` in `options.pinterest` instead of using the environment variable.
