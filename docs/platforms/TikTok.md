# TikTok Publisher

The TikTok publisher allows you to post videos and photos to TikTok using the TikTok Content Posting API.

## Features

- **Video Upload**: Upload MP4 videos up to 4GB
- **Photo Upload**: Upload JPEG/PNG images up to 50MB
- **Dual Publishing Modes**:
  - **Direct Post**: Automatically publishes content immediately
  - **Draft Upload**: Uploads content to your TikTok inbox for later review and publishing
- **Privacy Controls**: Set visibility to public, friends only, or private
- **Interaction Settings**: Control comments, duets, and stitching
- **Chunked Upload**: Handles large files with efficient chunked uploading

## Platform-Specific Options

### TikTok-Specific Options

| Option         | Type                                 | Default    | Description                                                        |
| -------------- | ------------------------------------ | ---------- | ------------------------------------------------------------------ |
| `publishMode`  | `"draft" \| "public"`                | `"public"` | `"public"` for immediate publishing, `"draft"` for inbox upload    |
| `visibility`   | `"public" \| "friends" \| "private"` | `"public"` | Who can view the content (only for `publishMode: "public"`)        |
| `allowComment` | `boolean`                            | `true`     | Allow users to comment (only for `publishMode: "public"`)          |
| `allowDuet`    | `boolean`                            | `true`     | Allow users to create duets (only for `publishMode: "public"`)     |
| `allowStitch`  | `boolean`                            | `true`     | Allow users to stitch the video (only for `publishMode: "public"`) |

## Important Notes for Unaudited Apps

⚠️ **Unaudited TikTok apps have restrictions:**

- Your TikTok account **must be set to private** to use this API
- To set your account to private: Open TikTok app → Settings → Privacy → Private Account
- Once your app is audited by TikTok, you can post publicly
- [Learn more about app review](https://developers.tiktok.com/doc/content-sharing-guidelines/)

## Content Requirements

### Videos

- **Format**: MP4 (recommended)
- **Duration**: 3 seconds to 10 minutes
- **Resolution**: Minimum 360x360 pixels, Maximum 4096x4096 pixels
- **Size**: Up to 4GB
- **Frame Rate**: 23 to 60 FPS

### Photos

- **Format**: JPEG, PNG
- **Resolution**: Minimum 360x360 pixels, Maximum 4096x4096 pixels
- **Size**: Up to 50MB

### Captions

- **Length**: Maximum 150 characters
- **Content**: Must comply with TikTok's community guidelines

## Examples

### Video Upload (Direct Post)

Publish video immediately to TikTok:

```typescript
const result = await post({
  content: {
    text: "Check out this awesome video! 🎥✨ #viral #fyp #trending",
    media: [
      {
        type: "video",
        path: "./video.mp4",
        title: "My Amazing TikTok Video",
        description: "A fun and engaging video for TikTok!",
      },
    ],
  },
  platforms: ["tiktok"],
  options: {
    tiktok: {
      publishMode: "public", // Publish immediately
      // Note: Use "private" for unaudited apps
      visibility: "private", // "public", "friends", or "private"
      allowComment: true,
      allowDuet: true,
      allowStitch: true,
    },
  },
});
```

### Video Upload to Draft

Upload video to your TikTok inbox for later review and publishing in the app:

```typescript
const result = await post({
  content: {
    text: "Check out this awesome video! 🎥✨ #viral #fyp #trending",
    media: [
      {
        type: "video",
        path: "./video.mp4",
        title: "My Amazing TikTok Video",
        description: "A fun and engaging video for TikTok!",
      },
    ],
  },
  platforms: ["tiktok"],
  options: {
    tiktok: {
      publishMode: "draft", // Upload to inbox (drafts)
      // Note: Privacy settings are set when you publish from the TikTok app
    },
  },
});
```

### Photo Upload (Direct Post)

```typescript
const result = await post({
  content: {
    text: "Amazing memories captured! 📸 #memories #photooftheday #aesthetic",
    media: [
      {
        type: "image",
        path: "./photo.jpg",
        caption: "Beautiful moment captured in time",
      },
    ],
  },
  platforms: ["tiktok"],
  options: {
    tiktok: {
      publishMode: "public", // Publish immediately
      visibility: "private", // Use "private" for unaudited apps
      allowComment: true,
    },
  },
});
```

### Photo Upload to Draft

```typescript
const result = await post({
  content: {
    text: "Amazing memories captured! 📸 #memories #photooftheday #aesthetic",
    media: [
      {
        type: "image",
        path: "./photo.jpg",
        caption: "Beautiful moment captured in time",
      },
    ],
  },
  platforms: ["tiktok"],
  options: {
    tiktok: {
      publishMode: "draft", // Upload to inbox
    },
  },
});
```

### Using URLs

Instead of local file paths, you can use publicly accessible URLs:

```typescript
const result = await post({
  content: {
    text: "Video from the cloud! #fyp",
    media: [{ type: "video", url: "https://cdn.example.com/video.mp4" }],
  },
  platforms: ["tiktok"],
});
```

## Authentication

Set your TikTok access token as an environment variable:

```bash
TIKTOK_ACCESS_TOKEN=your_access_token_here
```
