# Facebook Platform-Specific Options

## Content Support

- **Text**: Plain text posts with up to 63,206 characters
- **Images**: Up to 10 per post (JPG, PNG)
- **Videos**: Single video only (MP4, MOV) with title/description
- **Restriction**: Videos cannot be mixed with other media

## Platform Options

Posting on Facebook supports the `publishAt` option to schedule posts.

```typescript
facebook: {
  publishAt?: string;  // Schedule post
}
```

### `publishAt`

Schedule a post for publication at a specific date and time. Use ISO string format: `"2030-01-01T12:00:00Z"`

## Examples

### Text Post

```typescript
const content = { text: "Hello Facebook! 👋" };
```

### Images

```typescript
const content = {
  text: "Weekend photos! 📸",
  media: [
    { type: "image", path: "./photo1.jpg" },
    { type: "image", path: "./photo2.jpg" },
  ],
};
```

### Video

```typescript
const content = {
  media: [
    {
      type: "video",
      path: "./video.mp4",
      title: "My Video",
      description: "Video description",
    },
  ],
};
```

### Scheduled Post

```typescript
const options = {
  facebook: {
    publishAt: "2024-12-31T12:00:00Z",
  },
};
```

### Using URLs

Instead of local file paths, you can use publicly accessible URLs:

```typescript
const content = {
  text: "Photo from the cloud!",
  media: [{ type: "image", url: "https://cdn.example.com/photo.jpg" }],
};
```

## Authentication

To post on a Facebook Page, set the following environment variables:

```bash
FACEBOOK_PAGE_ACCESS_TOKEN=
FACEBOOK_PAGE_ID=
```

Follow the [Facebook credentials guide](https://github.com/simple-post/core/blob/main/docs/platforms/Facebook.md) to get your API keys.
