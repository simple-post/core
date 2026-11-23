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

### Large video uploads

Facebook videos use the [Page video upload API](https://developers.facebook.com/docs/graph-api/reference/v25.0/page/videos). Permanent Simple Post storage URLs under `uploads/` are sent using `file_url` after downloading and validating the media. Local files and external URLs use the `start`, `transfer`, and `finish` upload phases. Each transfer streams only the byte range requested by Facebook; the SDK does not buffer the whole video into a multipart request.

An explicit local path takes precedence over a URL supplied alongside it. Temporary storage copies are not used for Facebook URL ingestion because they may be deleted before Facebook finishes fetching them. Both upload methods retain titles, descriptions, and scheduling options.

Transfers have a two-minute per-request limit and a ten-minute overall upload limit. After acceptance, the SDK polls processing for up to three minutes. Definite HTTP 413 rejections and failures before the final publishing phase remain safely retryable. An uncertain final response or processing outcome retains `API_ERROR` and the video ID when available, so the scheduler blocks duplicate publication until reconciliation. A processing timeout does not prove publication failed; inspect the retained video ID before retrying. No automatic retry resubmits the publishing request.

#### Live regression test

Use an isolated test Page with valid Page and storage credentials. The script forces `published=false`, verifies the processed video is unpublished and has the expected duration, then deletes the videos it created and the temporary test storage object. It saves IDs and results incrementally in a local JSON receipt. It does not publish a visible post or retry existing scheduler posts.

Generate a 24-second H.264/AAC fixture larger than 125 MB:

```bash
ffmpeg -f lavfi -i 'testsrc2=size=1280x720:rate=30' \
  -f lavfi -i 'sine=frequency=440:sample_rate=48000' \
  -t 24 -c:v libx264 -preset ultrafast -pix_fmt yuv420p \
  -b:v 50M -minrate 50M -maxrate 50M -bufsize 100M \
  -x264-params 'nal-hrd=cbr:filler=1' -c:a aac -b:a 128k \
  -movflags +faststart /tmp/facebook-large-test.mp4
yarn workspace @simple-post/sdk build
node --env-file=/path/to/test.env scripts/test-facebook-large-video.mjs \
  --live --page-id=TEST_PAGE_ID --video=/tmp/facebook-large-test.mp4 \
  --receipt=/tmp/facebook-large-test.json
```

Use `--mode=chunks` or `--mode=managed-url` to run one method. The URL method also requires the `S3_STORAGE_*` configuration. If cleanup fails, use the receipt to remove only the IDs and storage key created by that test.

Verified on 2026-10-16 with a **149,158,244-byte** fixture: both upload methods reached `video_status=ready`, Facebook reported the complete 24-second duration and `published=false`, and both test videos and the hosted fixture were deleted. The chunked run used 30 transfers; the URL run sent a 471-byte form. Automated coverage also reconstructs a 130 MiB upload from varying chunk boundaries and compares its SHA-256, and exercises rejection, timeout, provenance, scheduling, processing, and durable retry behavior.

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
