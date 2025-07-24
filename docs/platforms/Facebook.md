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
  publishAt?: Date;  // Schedule post
}
```

### `publishAt`

Schedule a post for publication at a specific date and time. Use the JavaScript `Date` type to define the timestamp: `new Date("2030-01-01T12:00:00Z")`

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
    publishAt: new Date("2024-12-31T12:00:00Z"),
  },
};
```

## Authentication

To post on a Facebook Page, set the following environment variables:

```bash
FACEBOOK_PAGE_ACCESS_TOKEN=
FACEBOOK_PAGE_ID=
```

Follow the [Facebook credentials guide](https://docs.unsubpost.dev/facebook) to get your API keys.
