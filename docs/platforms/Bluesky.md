# Bluesky Platform Specific Options

## Content Support

- **Text**: Up to 300 characters
- **Media**: Images (JPG, PNG, GIF, WebP) or MP4 video
- **Limit**: Up to 4 images or 1 video per post; images and video cannot be mixed
- **Video limits**: 300,000,000 bytes (300 MB) and 600 seconds (10 minutes)
- **Requirements**: Must have text, images, or a video (no empty posts)

## Platform-Specific Options

Bluesky supports OAuth access tokens and app passwords. Both support video publishing.

### `credentials`

Provide Bluesky credentials for the SDK to post content:

```typescript
const blueskyCredentials = {
  accessToken: "BLUESKY_ACCESS_TOKEN",
  refreshToken: "BLUESKY_REFRESH_TOKEN", // optional
  did: "did:plc:yourdid",
  pdsUrl: "https://bsky.social",
  dpopPublicJwk: {
    /* DPoP public JWK (OAuth) */
  },
  dpopPrivateJwk: {
    /* DPoP private JWK (OAuth) */
  },
};

await post({
  content: { text: "Hello Bluesky!" },
  platforms: ["bluesky"],
  options: {
    bluesky: {
      credentials: blueskyCredentials,
    },
  },
});
```

## Examples

### Basic Posts

```typescript
// Text only
const content = { text: "Hello Bluesky!" };

// Image only
const content = { media: [{ type: "image", path: "./photo.jpg" }] };

// Combined
const content = {
  text: "Check out this photo!",
  media: [{ type: "image", path: "./photo.jpg" }],
};
```

## Video publishing across interfaces

The SDK, Scheduler, MCP tools, CLI, and both HTTP APIs share the same video publisher and validation rules. Video can be posted without text, in a reply, or alongside a quote. The upload is streamed to Bluesky's video service, and the post is created only after processing succeeds. Reusing an already processed video reuses its blob.

Use MP4 files (`.mp4` or `.m4v`); SimplePost does not transcode MOV or WebM inputs. When supplied, `durationSec` is checked before publishing. Actual duration and codec requirements are also enforced by Bluesky during processing. Actual file size is checked before uploading, even if caller-provided metadata is missing or inaccurate.

Bluesky-hosted accounts need a verified email and available video upload quota. Provider errors are returned if these requirements are not met. Processing stops with an error after five minutes, without creating a post. Existing SimplePost OAuth connections use `atproto transition:generic`, which allows minting the required service token; reconnecting is not required just to enable video.

Sources: [Bluesky upload flow](https://bsky.network/docs/about-bluesky-content/video/), [current video limits](https://github.com/bluesky-social/social-app/blob/main/src/lib/constants.ts), [OAuth permissions](https://atproto.com/specs/oauth).

### SDK

```typescript
await post({
  content: {
    text: "A quick demo",
    media: [{ type: "video", path: "./demo.mp4", description: "A walkthrough of the app", durationSec: 60 }],
  },
  platforms: ["bluesky"],
  options: {
    bluesky: { credentials: { identifier: "alice.bsky.social", appPassword: process.env.BLUESKY_APP_PASSWORD! } },
  },
});
```

Use `url` instead of `path` for remote files. The SDK's optional video `description` becomes the video's accessibility text.

### Scheduler and CLI

In the Scheduler, select a Bluesky account and attach one MP4 in the existing media picker, then publish or schedule it.

```bash
# Local OAuth account
simplepost post --account bluesky:main --text "A quick demo" --video ./demo.mp4

# Scheduler-connected account (get its ID with simplepost account)
simplepost post --app-account-id "<bluesky-account-id>" --text "A quick demo" --video ./demo.mp4
```

### HTTP API and MCP

For either HTTP API, send the usual `POST /api/v1/posts` request. For MCP, use `create_post` with the same fields below (or `validate_post` to check the content first). Upload local files using the interface's existing media upload endpoint/tool and use the returned URL.

```json
{
  "message": "A quick demo",
  "accountIds": ["<bluesky-account-id>"],
  "media": [
    {
      "type": "video",
      "id": "video-1",
      "url": "https://cdn.example.com/demo.mp4",
      "filename": "demo.mp4",
      "size": 1024000,
      "durationSec": 60
    }
  ]
}
```

The Scheduler API and MCP also accept `postingMode: "schedule"` with `scheduledFor` for future publishing. The self-hosted HTTP server publishes immediately.

## Authentication

To post on Bluesky you can set the following environment variables:

```bash
BLUESKY_ACCESS_TOKEN=
BLUESKY_REFRESH_TOKEN=
BLUESKY_DID=
BLUESKY_PDS_URL=
```

If you're using OAuth tokens, Bluesky requires DPoP. The scheduler app stores DPoP keys automatically, but for the SDK you should pass `dpopPublicJwk` and `dpopPrivateJwk` in `options.bluesky.credentials`.
