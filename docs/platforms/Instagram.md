# Instagram Platform-Specific Options

## Media Upload

The Instagram API requires all media to be uploaded to a public URL before posting. Unsubpost handles this for you by uploading your media to a temporary URL. You can use any S3-compatible storage provider like [AWS S3](https://aws.amazon.com/s3/), [DigitalOcean Spaces](https://www.digitalocean.com/products/spaces/), or [Cloudflare R2](https://www.cloudflare.com/products/r2/).

Set the following environment variables to use this feature:

```bash
S3_STORAGE_ACCESS_KEY_ID=
S3_STORAGE_SECRET_ACCESS_KEY=
S3_STORAGE_REGION=
S3_STORAGE_BUCKET=
S3_STORAGE_BASE_URL=
S3_STORAGE_ENDPOINT=
```

Check out the [Temporary Storage](https://docs.unsubpost.dev/dashboard/s3) documentation for setup instructions.

## Content Support

- **Media required**: Every Instagram post requires at least one image or video
- **Images**: 1-10 images per post (multiple images create a carousel)
- **Videos**: 1-10 videos per post (multiple videos create a carousel, all videos become Reels)
- **Captions**: Up to 2,200 characters

## Examples

### Single Image

```typescript
const content = {
  text: "Beautiful sunset! 🌅 #photography",
  media: [{ type: "image", path: "./sunset.jpg" }],
};
```

### Video (Reel)

```typescript
const content = {
  text: "Quick tutorial! ✨ #tutorial",
  media: [{ type: "video", path: "./tutorial.mp4" }],
};
```

### Carousel

```typescript
const content = {
  text: "Photo dump! 📸 #memories",
  media: [
    { type: "image", path: "./photo1.jpg" },
    { type: "image", path: "./photo2.jpg" },
    { type: "video", path: "./video.mp4" },
  ],
};
```

## Authentication

Posting on Instagram requires an Instagram Business Account Access Token and Business Account ID.

```bash
INSTAGRAM_BUSINESS_ACCESS_TOKEN=
INSTAGRAM_BUSINESS_ACCOUNT_ID=
```

Follow the [Instagram credentials guide](https://docs.unsubpost.dev/dashboard/instagram) to get your API keys.
