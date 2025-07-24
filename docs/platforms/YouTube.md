# YouTube Platform Specific Options

## Content Support

- **Videos only**: MP4, MOV, AVI, WMV, FLV, WebM
- **Required**: Video file + title
- **Optional**: Description, custom thumbnail (JPG/PNG)

## Posting videos or Shorts

You can use the library to post both regular YouTube videos and YouTube Shorts. In fact, the YouTube API doesn't differentiate between the two, so you can use the same code to post both. After uploading the video, YouTube will automatically classify it as a video or a short based on its parameters. To have the video classified as a short, it needs to be:

- vertical with resolution of 1080x1920
- shorter than 60 seconds

See the [Shorts example](../../examples//youtube/postShort.ts) for more details.

## Platform Specific Options

Posting on YouTube supports multiple platform specific options.

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
      selfDeclaredMadeForKids: true,
      publishAt: new Date("2024-12-31T12:00:00Z"),
    },
  },
});
```

### `privacyStatus`

The privacy status of the video. Possible values are `public`, `private` and `unlisted`. Default is `private`.

### `tags`

A list of string tags to add to the video.

### `categoryId`

The category ID to add to the video. There is no fixed category ID list and it needs to be fetched from the YouTube API. The [interactive guide for YouTube](https://docs.unsubpost.dev/dashboard/youtube) will help you get the category ID. Here is a snapshot of the category ID list:

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

The playlist ID to add the video to. You can find your playlist ID by going to [YouTube Studio](https://studio.youtube.com/) and clicking on the playlist you want to add the video to. The playlist ID will be in the URL: `https://studio.youtube.com/playlist/<PLAYLIST_ID>/edit`.

### `selfDeclaredMadeForKids`

You can manually set the flag to `true` if the video is made for kids. Default is `false`.

### `publishAt`

You can use this to schedule a video for publication at a specific date and time. You will be able to see the video in YouTube Studio. You can use the JavaScript `Date` type to define the timstamp: `new Date("2030-01-01T12:00:00Z")`

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
      thumbnailPath: "./thumb.jpg",
    },
  ],
};

const options = {
  youtube: {
    privacyStatus: "unlisted",
    tags: ["tutorial", "education"],
    categoryId: "27",
    publishAt: new Date("2024-12-31T12:00:00Z"),
  },
};
```

## Authentication

To post on YouTube you need to set the following environment variables:

```bash
YOUTUBE_CLIENT_ID=
YOUTUBE_CLIENT_SECRET=
YOUTUBE_REFRESH_TOKEN=
```

Follow the [YouTube credentials guide](https://docs.unsubpost.dev/dashboard/youtube) to get your API keys.
