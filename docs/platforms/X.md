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

## Authentication

To post on X you need to set the following environment variables:

```bash
X_API_KEY=
X_API_SECRET=
X_ACCESS_TOKEN=
X_ACCESS_SECRET=
```

Follow the [X credentials guide](https://docs.unsubpost.dev/x) to get your API keys.

## Posting on behalf of a user

If you have have an X app that your users connect to, you can also post on behalf of a user using their access token. In this case, you need to pass the app OAuth 2.0 client ID and secret, and the user's tokens (access token, refresh token, and expiration timestamp) in the `credentials`.

```typescript
const userCredentials = {
  clientId: "X_APP_CLIENT_ID",
  clientSecret: "X_APP_CLIENT_SECRET",
  accessToken: "USER_ACCESS_TOKEN",
  refreshToken: "USER_REFRESH_TOKEN",
  expiresAt: 1234567890, // Unix timestamp when the token expires
};

await post({
  content: { text: "Hello from X using OAuth credentials!" },
  platforms: ["x"],
  options: {
    x: { credentials: userCredentials },
  },
});
```

The SDK will take care of checking if the user's access token is expired and refreshing it if needed. If the user's access token is expired and needs to be refreshed, the `post` function will return the new access token, refresh token and expiration timestamp in the `extraData` property of the result. It is important to update the new user credentials in your database, as the old ones will stop working.

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
