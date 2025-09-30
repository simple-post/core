# TikTok Publisher

The TikTok publisher allows you to post videos and photos to TikTok using the TikTok Content Posting API.

## Features

- **Video Upload**: Upload MP4 videos up to 4GB
- **Photo Upload**: Upload JPEG/PNG images up to 50MB
- **Draft Mode**: Save content as draft or publish immediately
- **Privacy Controls**: Set visibility to public, friends only, or private
- **Interaction Settings**: Control comments, duets, and stitching
- **Chunked Upload**: Handles large files with efficient chunked uploading

## Platform-Specific Options

### TikTok-Specific Options

| Option         | Type                                 | Default    | Description                                     |
| -------------- | ------------------------------------ | ---------- | ----------------------------------------------- |
| `publishMode`  | `"draft" \| "public"`                | `"public"` | Whether to save as draft or publish immediately |
| `visibility`   | `"public" \| "friends" \| "private"` | `"public"` | Who can view the content                        |
| `allowComment` | `boolean`                            | `true`     | Allow users to comment                          |
| `allowDuet`    | `boolean`                            | `true`     | Allow users to create duets                     |
| `allowStitch`  | `boolean`                            | `true`     | Allow users to stitch the video                 |

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

### Video Upload

```typescript
const content = {
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
      publishMode: "public"; // or "draft"
      visibility: "public"; // "public", "friends", or "private"
      allowComment: true;
      allowDuet: true;
      allowStitch: true;
    };
  };
```

### Photo Upload

```typescript
const content = {
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
      publishMode: "draft"; // Save as draft for review
      visibility: "public";
      allowComment: true;
      allowDuet: false; // Typically disabled for photos
      allowStitch: false; // Typically disabled for photos
    };
  };
```

## Authentication

Set your TikTok access token as an environment variable:

```bash
TIKTOK_ACCESS_TOKEN=your_access_token_here
```
