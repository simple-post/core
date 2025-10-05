# Media Thumbnails Feature

This document explains how media thumbnails work in the SimplePost Scheduler.

## Overview

The app automatically generates thumbnails for all uploaded media:

- **Images**: Resized to max 400x400px while maintaining aspect ratio
- **Videos**: First frame extracted and resized to 400px width

Thumbnails are stored alongside the original files in Cloudflare R2.

## How It Works

### Upload Flow

1. User selects media files in the schedule form
2. Files are sent to `POST /api/posts` as FormData
3. For each file:
   - Original file is uploaded to R2
   - Thumbnail is generated using Sharp (images) or FFmpeg (videos)
   - Thumbnail is uploaded to R2 with `_thumb.jpg` suffix
   - Both URLs are saved to database

### Storage Structure

```
R2 Bucket:
└── uploads/
    └── {userId}/
        ├── {timestamp}-{random}.jpg      # Original image
        ├── {timestamp}-{random}_thumb.jpg # Image thumbnail
        ├── {timestamp}-{random}.mp4      # Original video
        └── {timestamp}-{random}_thumb.jpg # Video thumbnail
```

### Database Schema

```sql
CREATE TABLE media_file (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL,
  url TEXT NOT NULL,           -- Original file URL
  thumbnail_url TEXT,          -- Thumbnail URL (nullable)
  type TEXT NOT NULL,          -- "image" or "video"
  filename TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
```

## Implementation Details

### Thumbnail Generation (`lib/thumbnail.ts`)

**Image Thumbnails** (using Sharp):

```typescript
await sharp(buffer)
  .resize(400, 400, {
    fit: "inside",
    withoutEnlargement: true,
  })
  .jpeg({ quality: 80 })
  .toBuffer();
```

**Video Thumbnails** (using FFmpeg):

```typescript
ffmpeg(stream).screenshots({
  count: 1,
  folder: "/tmp",
  size: "400x?",
});
```

### API Integration (`app/api/posts/route.ts`)

```typescript
// Generate and upload thumbnail
let thumbnailUrl: string | undefined;
const thumbnail = await generateThumbnail(buffer, file.name, file.type);
if (thumbnail) {
  const thumbnailKey = generateFileKey(session.user.id, thumbnail.filename);
  thumbnailUrl = await uploadToR2(thumbnail.buffer, thumbnailKey, "image/jpeg");
}
```

## UI Display

### Posts List (`components/posts-list.tsx`)

- Shows thumbnail for images/videos in the post preview
- Falls back to original image URL if thumbnail is missing
- Shows "VIDEO" badge for video posts
- Displays media count badge if multiple files

### Media Upload Preview (`components/media-upload.tsx`)

- Shows live preview of uploaded images
- Shows video preview with play icon overlay
- Grid layout with hover effects

## Performance Benefits

### Without Thumbnails

- Load 10MB video just to show preview ❌
- Load full-size images (e.g., 5MB) ❌
- Slow page load, wasted bandwidth ❌

### With Thumbnails

- Load ~50KB thumbnail instead ✅
- Fast page load ✅
- Better UX on mobile ✅
- Save 99% bandwidth ✅

### Example Savings

For a page with 10 posts, each with a 5MB image:

- **Without thumbnails**: 50MB download
- **With thumbnails**: 500KB download
- **Savings**: 99% reduction

## Configuration

### Thumbnail Size

Edit `lib/thumbnail.ts` to change thumbnail dimensions:

```typescript
// Current: 400x400
.resize(400, 400, {
  fit: "inside",
  withoutEnlargement: true,
})

// For larger thumbnails:
.resize(800, 800, {
  fit: "inside",
  withoutEnlargement: true,
})
```

### Thumbnail Quality

Adjust JPEG quality (1-100):

```typescript
// Current: 80% quality
.jpeg({ quality: 80 })

// Higher quality (larger file):
.jpeg({ quality: 90 })

// Lower quality (smaller file):
.jpeg({ quality: 60 })
```

### Video Frame Selection

Currently extracts the first frame. To extract from a specific time:

```typescript
ffmpeg(stream).screenshots({
  timestamps: ["50%"], // Extract from middle
  // or
  timestamps: ["00:00:02"], // Extract at 2 seconds
});
```

## Dependencies

- **Sharp** (`sharp@0.34.4`): Fast image processing in Node.js
- **FFmpeg** (`fluent-ffmpeg@2.1.3`): Video processing wrapper
- **FFmpeg Installer** (`@ffmpeg-installer/ffmpeg@1.1.0`): FFmpeg binary

## Troubleshooting

### Thumbnails Not Generated

**Symptoms**: Original file shows, but no thumbnail

**Possible causes**:

1. FFmpeg not installed (for videos)
2. Image/video format not supported
3. File too large or corrupted

**Solution**:

- Check server logs for thumbnail generation errors
- Verify file format is supported
- Ensure FFmpeg is installed and accessible

### Thumbnail Generation Slow

**Symptoms**: Post creation takes too long

**Solutions**:

1. **Process thumbnails in background** (recommended for production):

   ```typescript
   // Queue thumbnail generation job
   await queue.add("generate-thumbnail", { fileId, url });
   ```

2. **Reduce thumbnail size**:

   ```typescript
   .resize(200, 200) // Smaller = faster
   ```

3. **Skip video thumbnails**:
   ```typescript
   if (mimeType.startsWith("video/")) {
     return null; // Skip video thumbnails
   }
   ```

### Memory Issues

**Symptoms**: Server crashes when processing large videos

**Solutions**:

1. **Limit file size**:

   ```typescript
   if (file.size > 100 * 1024 * 1024) {
     // 100MB
     throw new Error("File too large");
   }
   ```

2. **Stream processing** instead of loading entire file
3. **Use background workers** for thumbnail generation

## Future Enhancements

Potential improvements:

- [ ] Multiple thumbnail sizes (small, medium, large)
- [ ] Lazy thumbnail generation (on-demand)
- [ ] Background job queue for async processing
- [ ] WebP format for better compression
- [ ] Animated GIF thumbnails for videos
- [ ] Smart cropping (face detection)
- [ ] Blurhash placeholders
- [ ] Progressive image loading

## Testing

### Manual Testing

1. Upload an image → verify thumbnail appears in post list
2. Upload a video → verify thumbnail shows first frame
3. Upload multiple files → verify all thumbnails generated
4. Check R2 bucket → verify thumbnails stored with `_thumb.jpg` suffix

### Automated Testing

```typescript
describe("Thumbnail Generation", () => {
  it("should generate thumbnail for image", async () => {
    const buffer = await fs.readFile("test-image.jpg");
    const result = await generateImageThumbnail(buffer, "test.jpg");
    expect(result.buffer.length).toBeLessThan(buffer.length);
  });

  it("should generate thumbnail for video", async () => {
    const buffer = await fs.readFile("test-video.mp4");
    const result = await generateVideoThumbnail(buffer, "test.mp4");
    expect(result.filename).toContain("_thumb.jpg");
  });
});
```

## Cost Impact

### R2 Storage

- Original file: ~5MB
- Thumbnail: ~50KB
- **Additional cost**: ~$0.00075/month per file

### Processing

- Thumbnail generation: ~1 second per file
- **Compute cost**: Negligible on most hosting platforms

### Bandwidth Savings

- Without thumbnails: 5MB per preview
- With thumbnails: 50KB per preview
- **Savings**: 99% reduction = significant cost savings with R2's free egress

## Security Considerations

1. **File validation**: Check file type before processing
2. **Size limits**: Prevent DOS via large files
3. **Sandboxing**: FFmpeg runs in isolated process
4. **Input sanitization**: Validate filenames to prevent path traversal

## Migration

If you have existing media without thumbnails:

```typescript
// Run migration script
async function backfillThumbnails() {
  const media = await prisma.mediaFile.findMany({
    where: { thumbnailUrl: null }
  });

  for (const file of media) {
    // Download original
    const response = await fetch(file.url);
    const buffer = await response.arrayBuffer();

    // Generate thumbnail
    const thumbnail = await generateThumbnail(
      Buffer.from(buffer),
      file.filename,
      file.type
    );

    if (thumbnail) {
      // Upload and update
      const thumbnailUrl = await uploadToR2(...);
      await prisma.mediaFile.update({
        where: { id: file.id },
        data: { thumbnailUrl }
      });
    }
  }
}
```

## See Also

- `lib/thumbnail.ts` - Thumbnail generation logic
- `lib/r2.ts` - R2 upload utilities
- `app/api/posts/route.ts` - API integration
- `components/posts-list.tsx` - UI display
