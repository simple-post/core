# Bluesky Platform Specific Options

## Content Support

- **Text**: Up to 300 characters
- **Media**: Images (JPG, PNG, GIF, WebP)
- **Limit**: Maximum 4 images per post
- **Requirements**: Must have text or images (no empty posts)

## Platform-Specific Options

Bluesky uses OAuth access tokens and requires platform credentials.

### `credentials`

Provide Bluesky credentials for the SDK to post content:

```typescript
const blueskyCredentials = {
  accessToken: "BLUESKY_ACCESS_TOKEN",
  refreshToken: "BLUESKY_REFRESH_TOKEN", // optional
  did: "did:plc:yourdid",
  pdsUrl: "https://bsky.social",
  dpopPublicJwk: { /* DPoP public JWK (OAuth) */ },
  dpopPrivateJwk: { /* DPoP private JWK (OAuth) */ },
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

## Authentication

To post on Bluesky you can set the following environment variables:

```bash
BLUESKY_ACCESS_TOKEN=
BLUESKY_REFRESH_TOKEN=
BLUESKY_DID=
BLUESKY_PDS_URL=
```

If you're using OAuth tokens, Bluesky requires DPoP. The scheduler app stores DPoP keys automatically, but for the SDK you should pass `dpopPublicJwk` and `dpopPrivateJwk` in `options.bluesky.credentials`.
