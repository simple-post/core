# YouTube Platform-Specific Options

## Content Support

- **Videos only**: MP4, MOV, AVI, WMV, FLV, WebM
- **Required**: Video file + title
- **Optional**: Description, custom thumbnail (JPG/PNG)

## Posting Videos or Shorts

You can post both regular YouTube videos and YouTube Shorts using the same code. The YouTube API doesn't differentiate between them — after uploading, YouTube automatically classifies videos based on their parameters. To have a video classified as a Short, it needs to be:

- Vertical with 1080x1920 resolution
- Shorter than 60 seconds

See the [Shorts example](../../examples/youtube/postShort.ts) for more details.

## Platform-Specific Options

Posting on YouTube supports multiple platform-specific options.

```typescript
await post({
  content: {
    media: [{ type: "video", path: "./video.mp4", title: "My Video" }],
  },
  platforms: ["youtube"],
  options: {
    youtube: {
      privacyStatus: "unlisted",
      tags: ["tutorial", "education"],
      categoryId: "27",
      playlistId: "PL1234567890",
      thumbnailPath: "./thumbnail.jpg",
      selfDeclaredMadeForKids: true,
      publishAt: "2024-12-31T12:00:00Z",
    },
  },
});
```

### `privacyStatus`

The privacy status of the video. Possible values are `public`, `private`, and `unlisted`. Defaults to `private`.

### `tags`

An array of string tags to add to the video.

### `categoryId`

The category ID for the video. Category IDs vary and must be fetched from the YouTube API. The [interactive YouTube guide](https://docs.simplepost.social/youtube) will help you get the category ID. Here's a snapshot of common category IDs:

| Category ID | Category Name         |
| ----------- | --------------------- |
| 1           | Film & Animation      |
| 2           | Autos & Vehicles      |
| 10          | Music                 |
| 15          | Pets & Animals        |
| 17          | Sports                |
| 18          | Short Movies          |
| 19          | Travel & Events       |
| 20          | Gaming                |
| 21          | Videoblogging         |
| 22          | People & Blogs        |
| 23          | Comedy                |
| 24          | Entertainment         |
| 25          | News & Politics       |
| 26          | Howto & Style         |
| 27          | Education             |
| 28          | Science & Technology  |
| 29          | Nonprofits & Activism |
| 30          | Movies                |
| 31          | Anime/Animation       |
| 32          | Action/Adventure      |
| 33          | Classics              |
| 34          | Comedy                |
| 35          | Documentary           |
| 36          | Drama                 |
| 37          | Family                |
| 38          | Foreign               |
| 39          | Horror                |
| 40          | Sci-Fi/Fantasy        |
| 41          | Thriller              |
| 42          | Shorts                |
| 43          | Shows                 |
| 44          | Trailers              |

### `playlistId`

The playlist ID to add the video to. Find your playlist ID by going to [YouTube Studio](https://studio.youtube.com/), clicking on your playlist, and checking the URL: `https://studio.youtube.com/playlist/<PLAYLIST_ID>/edit`.

### `thumbnailPath` / `thumbnailUrl`

Custom thumbnail image for the uploaded YouTube video. Use `thumbnailPath` for a local JPG/PNG file in SDK or self-hosted server contexts, or `thumbnailUrl` for a public thumbnail URL such as a Scheduler upload URL. When both a media thumbnail and an option thumbnail are present, the YouTube option wins.

### `selfDeclaredMadeForKids`

Set to `true` if the video is made for kids. Defaults to `false`.

### `publishAt`

Schedule a video for publication at a specific date and time. The video will appear in YouTube Studio as scheduled. Use the JavaScript ISO string format: `"2030-01-01T12:00:00Z"`

## Examples

### Basic Upload

```typescript
const content = {
  media: [
    {
      type: "video",
      path: "./video.mp4",
      title: "My Video",
      description: "Optional description",
    },
  ],
};
```

### Full Options

```typescript
const content = {
  media: [
    {
      type: "video",
      path: "./video.mp4",
      title: "My Video",
      description: "Full description",
    },
  ],
};

const options = {
  youtube: {
    privacyStatus: "unlisted",
    tags: ["tutorial", "education"],
    categoryId: "27",
    thumbnailPath: "./thumb.jpg",
    publishAt: "2024-12-31T12:00:00Z",
  },
};
```

### Using URLs

Instead of local file paths, you can use publicly accessible URLs:

```typescript
const content = {
  media: [
    {
      type: "video",
      url: "https://cdn.example.com/video.mp4",
      title: "My Video",
    },
  ],
};
```

## Authentication

To post on YouTube, set the following environment variables:

```bash
YOUTUBE_CLIENT_ID=
YOUTUBE_CLIENT_SECRET=
YOUTUBE_REFRESH_TOKEN=
```

Follow the [YouTube credentials guide](https://docs.simplepost.social/youtube) to get your API keys.
