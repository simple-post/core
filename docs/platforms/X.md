# X Platform Specific Options

## Content Support

- **Text**: Standard character limits
- **Media**: Images (JPG, PNG, GIF, WebP), Videos (MP4, MOV)
- **Limit**: Maximum 4 media files per post
- **Requirements**: Must have text OR media (no empty posts)

## Platform-Specific Options

Posting on X supports the following platform-specific options:

### `replyToId`

The ID of the post you want to reply to. Use this to reply to posts or create threads.

```typescript
await post({
  content: { text: "This is a reply to a post" },
  platforms: ["x"],
  options: { x: { replyToId: 123465789 } },
});
```

## Examples

### Basic Posts

```typescript
// Text only
const content = { text: "Hello X!" };

// Media only
const content = { media: [{ type: "image", path: "./photo.jpg" }] };

// Combined
const content = {
  text: "Check out these photos!",
  media: [
    { type: "image", path: "./photo1.jpg" },
    { type: "image", path: "./photo2.jpg" },
  ],
};
```

### Threading

```typescript
// First tweet
const firstTweet = await post({
  content: { text: "Thread: 1/2" },
  platforms: ["x"],
});

// Reply to create thread
await post({
  content: { text: "Thread: 2/2" },
  platforms: ["x"],
  options: { x: { replyToId: firstTweet.get("x")?.id } },
});
```

### Using URLs

Instead of local file paths, you can use publicly accessible URLs:

```typescript
const content = {
  text: "Photo from the cloud!",
  media: [{ type: "image", url: "https://cdn.example.com/photo.jpg" }],
};
```

## Authentication

X recommends OAuth 2.0 for new integrations. The SDK accepts OAuth 2.0 user credentials in three combinations — pick whichever fits how your app holds and rotates tokens.

| Mode | What you provide | What the SDK does |
| --- | --- | --- |
| **Access token only** | `clientId`, `accessToken` (+ optional `expiresAt`) | Uses the access token as-is. Never calls the refresh endpoint. If X returns 401, the call fails — your app is responsible for issuing a fresh token. |
| **Refresh token only** | `clientId`, `refreshToken` (+ `clientSecret` for confidential clients) | Exchanges the refresh token for a fresh access token on first call, then refreshes again as needed during the publisher's lifetime. |
| **Both** | `clientId`, `accessToken`, `expiresAt`, `refreshToken` (+ `clientSecret` for confidential clients) | Uses the cached access token while it's still valid; refreshes only when it's within 60s of expiry. |

### ⚠️ Refresh token rotation

X rotates refresh tokens on every successful refresh: each call to `/2/oauth2/token` returns a brand-new `refresh_token` *and* invalidates the old one. **The SDK does not persist credentials for you.** Every time a refresh happens, the new tokens are returned in `result.extraData.refreshedCredentials`:

```typescript
Map(1) {
  'x' => {
    id: '1948513212514570680',
    error: 'NO_ERROR',
    extraData: {
      refreshedCredentials: {
        accessToken: 'NEW_USER_ACCESS_TOKEN',
        refreshToken: 'NEW_USER_REFRESH_TOKEN',
        expiresAt: 1234567890 // New Unix expiration timestamp
      }
    }
  }
}
```

It is **your** responsibility to write these back to wherever you store the user's credentials (your database, a vault, or `.env` for local dev). If you keep using the previous refresh token, the next refresh will fail with `invalid_grant`.

### Environment variables

The CLI examples and any code that calls `post()` without explicit credentials will load OAuth 2.0 credentials from these environment variables:

```bash
X_CLIENT_ID=
X_CLIENT_SECRET=    # only required for confidential OAuth 2.0 clients
X_ACCESS_TOKEN=     # optional — use for access-token-only mode
X_EXPIRES_AT=       # optional — Unix timestamp of access-token expiry
X_REFRESH_TOKEN=    # optional — use for refresh-token mode
```

At least one of `X_ACCESS_TOKEN` / `X_REFRESH_TOKEN` must be provided.

Follow the [X credentials guide](https://github.com/simple-post/core/blob/main/docs/platforms/X.md) to obtain these values.

## Posting on behalf of a user (programmatic credentials)

If your app stores per-user X tokens, pass them via `options.x.credentials` instead of using env vars:

```typescript
// Mode 1: access token only — no refresh attempted
await post({
  content: { text: "Hello!" },
  platforms: ["x"],
  options: {
    x: {
      credentials: {
        clientId: "X_APP_CLIENT_ID",
        accessToken: "USER_ACCESS_TOKEN",
      },
    },
  },
});

// Mode 2: refresh token only — SDK refreshes on first use
await post({
  content: { text: "Hello!" },
  platforms: ["x"],
  options: {
    x: {
      credentials: {
        clientId: "X_APP_CLIENT_ID",
        clientSecret: "X_APP_CLIENT_SECRET", // omit for public/PKCE-only clients
        refreshToken: "USER_REFRESH_TOKEN",
      },
    },
  },
});

// Mode 3: both — SDK uses the cached access token until it expires
const result = await post({
  content: { text: "Hello!" },
  platforms: ["x"],
  options: {
    x: {
      credentials: {
        clientId: "X_APP_CLIENT_ID",
        clientSecret: "X_APP_CLIENT_SECRET",
        accessToken: "USER_ACCESS_TOKEN",
        expiresAt: 1234567890, // Unix timestamp when the access token expires
        refreshToken: "USER_REFRESH_TOKEN",
      },
    },
  },
});

// If a refresh happened, persist the new tokens — see "Refresh token rotation" above.
const refreshed = result.get("x")?.extraData?.refreshedCredentials;
if (refreshed) {
  await saveUserTokens(refreshed); // your code
}
```

```typescript
Map(1) {
  'x' => {
    id: '1948513212514570680',
    error: 'NO_ERROR',
    extraData: {
      refreshedCredentials: {
        accessToken: 'NEW_USER_ACCESS_TOKEN',
        refreshToken: 'NEW_USER_REFRESH_TOKEN',
        expiresAt: 1234567890 // New Unix expiration timestamp
      }
    }
  }
}
```
