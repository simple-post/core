# TikTok Publisher

The TikTok publisher allows you to post videos and photos to TikTok using the TikTok Content Posting API.

## Features

- **Video Upload**: Upload MP4 videos up to 4GB
- **Photo Upload**: Upload JPEG/PNG images up to 50MB
- **Dual Publishing Modes**:
  - **Direct Post**: Automatically publishes content immediately
  - **Draft Upload**: Uploads content to your TikTok inbox for later review and publishing
- **Creator Info Checks**: Queries TikTok creator info before Direct Post
- **Privacy Controls**: Uses the privacy options returned by TikTok creator info
- **Interaction Settings**: Control comments, duets, and stitching when available
- **Chunked Upload**: Handles large files with efficient chunked uploading

## Platform-Specific Options

### TikTok-Specific Options

| Option                        | Type                                                                                      | Default | Description                                                                  |
| ----------------------------- | ----------------------------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------- |
| `title`                       | `string`                                                                                  | none    | TikTok title/caption. If omitted, the post text is used.                     |
| `publishMode`                 | `"draft" \| "public"`                                                                     | public  | `"public"` for immediate publishing, `"draft"` for inbox upload              |
| `privacyLevel`                | `"PUBLIC_TO_EVERYONE" \| "MUTUAL_FOLLOW_FRIENDS" \| "FOLLOWER_OF_CREATOR" \| "SELF_ONLY"` | none    | Required for Direct Post. Must be selected from TikTok creator info options. |
| `visibility`                  | `"public" \| "friends" \| "private"`                                                      | none    | Legacy alias for `privacyLevel`. Prefer `privacyLevel` for new integrations. |
| `allowComment`                | `boolean`                                                                                 | `false` | Allow users to comment. Must be manually enabled for Direct Post.            |
| `allowDuet`                   | `boolean`                                                                                 | `false` | Allow users to create duets. Videos only. Must be manually enabled.          |
| `allowStitch`                 | `boolean`                                                                                 | `false` | Allow users to stitch the video. Videos only. Must be manually enabled.      |
| `commercialContentDisclosure` | `boolean`                                                                                 | `false` | Turn on when the post promotes yourself, a brand, product, or service.       |
| `discloseYourBrand`           | `boolean`                                                                                 | `false` | Marks creator-owned promotional content.                                     |
| `discloseBrandedContent`      | `boolean`                                                                                 | `false` | Marks third-party branded content or paid partnership content.               |

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
      // Must be one of the privacy_level_options returned by creator_info/query.
      privacyLevel: "SELF_ONLY",
      allowComment: true,
      allowDuet: false,
      allowStitch: false,
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
      privacyLevel: "SELF_ONLY",
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
  options: {
    tiktok: {
      publishMode: "public",
      privacyLevel: "SELF_ONLY",
    },
  },
});
```

## Authentication

Set your TikTok access token as an environment variable:

```bash
TIKTOK_ACCESS_TOKEN=your_access_token_here
```
