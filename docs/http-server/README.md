# @simple-post/server

Self-hosted HTTP API for posting to social media. Speaks the same `/api/v1` request and response shapes as the SimplePost scheduler app, so the same client code targets either deployment.

## Overview

The server is a thin, stateless wrapper around `@simple-post/sdk`. Accounts and credentials live in a JSON file you provide; there is no database, no UI, no OAuth flows, and no scheduling. Posts publish synchronously and the response includes per-account results.

Use this interface when:

- You want a self-contained backend you can drop on a VM, in a Docker container, or behind a reverse proxy.
- You manage social platform credentials yourself (you have the tokens) and do not need a UI to connect accounts.
- You only need immediate posting — the scheduler app handles `postingMode: "schedule"`.

If you want scheduling, OAuth-based account connection, multi-user accounts, or an MCP server, run the [scheduler app](../scheduler-app/README.md) instead. The HTTP contract is the same on both, so you can migrate later without rewriting client code.

## Endpoints

All `/api/v1/*` endpoints require an API key in the `x-api-key` header. `/health` and `/media/*` are public.

| Method | Path                     | Purpose                                                                 |
| ------ | ------------------------ | ----------------------------------------------------------------------- |
| GET    | `/health`                | Liveness check                                                          |
| GET    | `/api/v1/accounts`       | List configured accounts (without credentials)                          |
| POST   | `/api/v1/upload`         | Stream an image or video through the server, returns a `MediaFile`      |
| POST   | `/api/v1/upload/presign` | Create a direct S3/R2 upload URL and `MediaFile` reference              |
| POST   | `/api/v1/validation`     | Validate a draft against the rules of each target account               |
| POST   | `/api/v1/posts`          | Publish a post (only `postingMode: "now"` is supported on this server)  |
| GET    | `/media/:filename`       | Public read for uploaded media; platforms fetch URLs returned by upload |

Endpoints the scheduler exposes that this server **does not**: `/api/v1/posts/[id]`, `/api/oauth/*`, `/api/connect/*`, `/api/cli/*`, `/api/auth/*`, `/api/internal/scheduled-posts/dispatch`, `/mcp`. Use the scheduler app if you need any of those.

## Configuration

### Environment variables

| Variable                       | Required    | Description                                                                                                  |
| ------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------ |
| `SIMPLE_POST_API_KEY`          | Yes         | Shared secret clients pass in the `x-api-key` header.                                                        |
| `SIMPLE_POST_ACCOUNTS_FILE`    | Yes\*       | Path to the JSON file describing your connected accounts. Without it, `/api/v1/posts` rejects everything.    |
| `SIMPLE_POST_PUBLIC_URL`       | Recommended | Public URL where this server is reachable. Used to build media URLs. Defaults to `http://localhost:${PORT}`. |
| `SIMPLE_POST_STORAGE_DIR`      | No          | Local directory for uploaded files. Defaults to `./data` next to the binary.                                 |
| `PORT`                         | No          | HTTP port. Defaults to `3000`.                                                                               |
| `TRUST_PROXY`                  | No          | Exact Express `trust proxy` value for a proxy you control. Disabled by default.                              |
| `S3_STORAGE_*`                 | No          | S3-compatible credentials, bucket, endpoint, and public base URL used by `/api/v1/upload/presign`.           |
| `RATE_LIMIT_MAX_REQUESTS`      | No          | Max requests per IP in a 15-minute window for all routes. Defaults to `300`.                                 |
| `RATE_LIMIT_AUTH_MAX_REQUESTS` | No          | Max requests per IP in a 15-minute window for authenticated API routes. Defaults to `100`.                   |

\* The server boots without it, but only `/health`, `/api/v1/accounts` (returning `{accounts: []}`), and `/media/*` are useful in that state.

### `accounts.json`

The accounts file is a JSON document with a single `accounts` array. Each entry describes one connected social account and provides the credentials to post on its behalf.

```json
{
  "accounts": [
    {
      "id": "x-main",
      "platform": "x",
      "label": "Main brand X account",
      "username": "yourbrand",
      "platformAccountId": "1234567890",
      "credentials": { ... },
      "options": { ... }
    }
  ]
}
```

| Field               | Required | Description                                                                                                                                                                         |
| ------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                | Yes      | Stable identifier you reference in `accountIds` when posting. Must be unique across the file.                                                                                       |
| `platform`          | Yes      | One of `x`, `telegram`, `facebook`, `instagram`, `youtube`, `tiktok`, `bluesky`, `threads`, `linkedin`, `pinterest`, `tumblr`. The legacy alias `twitter` maps to `x`.              |
| `label`             | No       | Human-readable name surfaced in `GET /api/v1/accounts`.                                                                                                                             |
| `username`          | No       | Used to build post URLs returned in `postingResults[].postUrl` (e.g. `https://x.com/<username>/status/...`).                                                                        |
| `platformAccountId` | Varies   | Required for Telegram (used as `chatId`) and Facebook (used as `pageId`). Optional elsewhere.                                                                                       |
| `profilePicture`    | No       | Returned by `GET /api/v1/accounts` for UI display.                                                                                                                                  |
| `credentials`       | Yes      | Platform-specific credentials. Shapes mirror `PostOptions[platform].credentials` in `@simple-post/sdk`. See examples below.                                                         |
| `options`           | No       | Platform-specific defaults (e.g. YouTube `privacyStatus`, LinkedIn `visibility`). Mirrors `PostOptions[platform]` minus `credentials`. Per-request `accountOptions` override these. |

The server validates the file at startup. Unknown platforms, duplicate IDs, or malformed JSON cause it to refuse to boot — fail fast on misconfiguration.

### Per-platform credential examples

The shapes below match the SDK's credential schemas (`sdk/src/types/post.ts`). Anything missing here is also documented per platform under [`docs/platforms/`](../platforms).

#### X (Twitter)

App credentials (OAuth 1.0a):

```json
{
  "id": "x-main",
  "platform": "x",
  "username": "yourbrand",
  "credentials": {
    "apiKey": "...",
    "apiSecret": "...",
    "accessToken": "...",
    "accessSecret": "..."
  }
}
```

User credentials (OAuth 2.0 with PKCE):

```json
{
  "id": "x-main",
  "platform": "x",
  "username": "yourbrand",
  "credentials": {
    "clientId": "...",
    "clientSecret": "...",
    "accessToken": "...",
    "refreshToken": "...",
    "expiresAt": 1234567890
  },
  "options": { "replyToId": "1234567890" }
}
```

#### Telegram

`platformAccountId` is the chat or channel id (`@channelname` or numeric).

```json
{
  "id": "telegram-news",
  "platform": "telegram",
  "platformAccountId": "@your_channel",
  "credentials": { "botToken": "123456:ABC..." },
  "options": { "parseMode": "HTML" }
}
```

#### YouTube

Long-lived (refresh token):

```json
{
  "id": "youtube-main",
  "platform": "youtube",
  "credentials": {
    "clientId": "...",
    "clientSecret": "...",
    "refreshToken": "..."
  },
  "options": {
    "privacyStatus": "public",
    "categoryId": "22",
    "thumbnailPath": "/srv/simplepost/thumbs/launch.jpg"
  }
}
```

Per-request `accountOptions` can also set `thumbnailUrl` for a public custom thumbnail uploaded through `/api/v1/upload`.

Short-lived (direct access token):

```json
{
  "id": "youtube-main",
  "platform": "youtube",
  "credentials": { "accessToken": "ya29...." }
}
```

#### Facebook

`platformAccountId` is the Page id and is required for URL generation.

```json
{
  "id": "fb-page",
  "platform": "facebook",
  "platformAccountId": "1234567890",
  "credentials": {
    "pageAccessToken": "...",
    "pageId": "1234567890"
  }
}
```

#### Instagram

`businessAccountId` is the Instagram Business Account id (separate from the page id).

```json
{
  "id": "ig-business",
  "platform": "instagram",
  "credentials": {
    "accessToken": "...",
    "businessAccountId": "17841...",
    "graphApi": "instagram"
  }
}
```

#### TikTok

```json
{
  "id": "tiktok-creator",
  "platform": "tiktok",
  "username": "yourbrand",
  "credentials": { "accessToken": "..." },
  "options": { "publishMode": "public", "privacyLevel": "SELF_ONLY" }
}
```

#### Bluesky

App password (simplest):

```json
{
  "id": "bsky-main",
  "platform": "bluesky",
  "credentials": {
    "identifier": "yourbrand.bsky.social",
    "appPassword": "xxxx-xxxx-xxxx-xxxx"
  }
}
```

OAuth (if you already have OAuth tokens):

```json
{
  "id": "bsky-main",
  "platform": "bluesky",
  "username": "yourbrand.bsky.social",
  "platformAccountId": "did:plc:...",
  "credentials": {
    "accessToken": "...",
    "refreshToken": "...",
    "did": "did:plc:...",
    "pdsUrl": "https://bsky.social"
  }
}
```

#### Threads

```json
{
  "id": "threads-main",
  "platform": "threads",
  "username": "yourbrand",
  "credentials": { "accessToken": "...", "userId": "1234567890" }
}
```

#### LinkedIn

```json
{
  "id": "linkedin-page",
  "platform": "linkedin",
  "credentials": { "accessToken": "...", "memberId": "..." },
  "options": { "visibility": "PUBLIC" }
}
```

#### Pinterest

`boardId` is required and lives on `options` (or per-request `accountOptions`).

```json
{
  "id": "pinterest-main",
  "platform": "pinterest",
  "credentials": { "accessToken": "..." },
  "options": { "boardId": "987654321" }
}
```

## Running

### Development

```bash
cd server
yarn install
yarn dev
```

### Production (local)

```bash
yarn build
yarn start
```

### Production with PM2

```bash
yarn build
yarn start:pm2
```

### Docker

The included `Dockerfile` builds the SDK and server, drops privileges to a non-root user, and runs PM2. The accounts file and storage directory must be mounted in.

```bash
docker build -t simple-post-server -f server/Dockerfile .

docker run -p 3000:3000 \
  -e SIMPLE_POST_API_KEY=your-secret-api-key \
  -e SIMPLE_POST_PUBLIC_URL=https://posts.example.com \
  -e SIMPLE_POST_ACCOUNTS_FILE=/config/accounts.json \
  -e SIMPLE_POST_STORAGE_DIR=/data \
  -v /path/on/host/accounts.json:/config/accounts.json:ro \
  -v simple-post-data:/data \
  simple-post-server
```

The image exposes port 3000 and includes a healthcheck that hits `/health`.

## API reference

### `GET /api/v1/accounts`

Returns every configured account without credentials.

```json
{
  "accounts": [
    {
      "id": "x-main",
      "platform": "x",
      "label": "Main brand X account",
      "username": "yourbrand",
      "platformAccountId": "1234567890",
      "profilePicture": null
    }
  ]
}
```

### `POST /api/v1/upload`

Uploads a single file (multipart, field name `file`). Returns a `MediaFile` you can pass into `/api/v1/posts` or `/api/v1/validation`.

```bash
curl -X POST https://posts.example.com/api/v1/upload \
  -H "x-api-key: $SIMPLE_POST_API_KEY" \
  -F "file=@photo.jpg"
```

```json
{
  "id": "f04a4...",
  "url": "https://posts.example.com/media/f04a4...jpg",
  "type": "image",
  "filename": "photo.jpg",
  "size": 184320
}
```

The returned `url` points at this server's public `/media/:filename` route. Platforms fetch it to obtain the bytes, so the URL **must** be reachable from the public internet — set `SIMPLE_POST_PUBLIC_URL` accordingly.

Limits: 500MB per file. The multipart parser streams to disk, caps files/fields/parts, and verifies the file signature against the declared media type before finalizing it. Supported types are JPEG, PNG, GIF, WebP, MP4, MOV, and WebM.

### `POST /api/v1/upload/presign`

For large uploads, configure the `S3_STORAGE_*` variables and upload directly to S3-compatible storage instead of routing bytes through this process:

```bash
curl -X POST https://posts.example.com/api/v1/upload/presign \
  -H "x-api-key: $SIMPLE_POST_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"filename":"clip.mp4","contentType":"video/mp4","size":10485760}'
```

The response contains a 15-minute `uploadUrl`, required PUT headers, and a ready-to-use `media` object. PUT exactly the declared number of bytes to `uploadUrl`, then pass `media` to validation or posting. `S3_STORAGE_BASE_URL` must be publicly reachable by the social platforms.

```bash
curl -X PUT "$UPLOAD_URL" \
  -H "Content-Type: video/mp4" \
  --data-binary @clip.mp4
```

Browser uploads also require a bucket CORS rule. For Cloudflare R2, allow only the origins that host your client and the headers actually sent by the PUT:

```json
[
  {
    "AllowedOrigins": ["https://your-app.example.com"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

Presigned URLs are bearer credentials until they expire. Do not log them or expose them beyond the client performing the upload.

### `POST /api/v1/validation`

Checks whether a draft satisfies the rules of every targeted account before you commit to publishing.

```bash
curl -X POST https://posts.example.com/api/v1/validation \
  -H "x-api-key: $SIMPLE_POST_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Hello from SimplePost",
    "media": [],
    "accountIds": ["x-main", "telegram-news"]
  }'
```

Returns per-account validation results, the union of platform rules, and a top-level `summary.isValid`. Same shape as the scheduler.

### `POST /api/v1/posts`

Publishes immediately to every account in `accountIds`.

```bash
curl -X POST https://posts.example.com/api/v1/posts \
  -H "x-api-key: $SIMPLE_POST_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Launching today!",
    "accountIds": ["x-main", "telegram-news"],
    "postingMode": "now"
  }'
```

Request body:

```ts
{
  message: string;
  accountIds: string[];                 // at least one
  postingMode: "now";                   // "schedule" returns 400 on this server
  media?: MediaFile[];                  // from /api/v1/upload, or external URLs
  accountOptions?: { [accountId]: { ... } };   // override per-account options for this post
  accountOverrides?: { [accountId]: { message?: string; media?: MediaFile[] } };
}
```

Response:

```json
{
  "post": {
    "id": "9b6c...",
    "message": "Launching today!",
    "accountIds": ["x-main", "telegram-news"],
    "media": [],
    "scheduledFor": "2026-05-02T12:34:56.000Z",
    "status": "published",
    "createdAt": "2026-05-02T12:34:56.000Z",
    "publishedAt": "2026-05-02T12:34:57.000Z"
  },
  "postingResults": [
    {
      "accountId": "x-main",
      "platform": "x",
      "success": true,
      "postId": "...",
      "postUrl": "https://x.com/yourbrand/status/..."
    },
    { "accountId": "telegram-news", "platform": "telegram", "success": true, "postId": "..." }
  ],
  "summary": { "successCount": 2, "failureCount": 0, "overallSuccess": true }
}
```

If any platform fails, the response is still 201 — inspect `summary.overallSuccess` and `postingResults[].success`. Validation failures and account lookup failures return 400 before any platform is touched.

## Errors

Standard JSON error shape:

```json
{ "error": "Validation failed", "code": "VALIDATION_ERROR", "details": [...] }
```

| Status | Code                    | Cause                                                               |
| ------ | ----------------------- | ------------------------------------------------------------------- |
| 400    | `BAD_REQUEST`           | Bad input — missing accounts, scheduling mode requested, etc.       |
| 400    | `VALIDATION_ERROR`      | Body doesn't match the schema, or platform validation rules failed. |
| 401    | —                       | Missing or invalid `x-api-key`.                                     |
| 404    | `NOT_FOUND`             | Unknown route or media file.                                        |
| 500    | `INTERNAL_SERVER_ERROR` | Unexpected failure inside the server or SDK.                        |

## Differences from the scheduler app

Both expose the same `/api/v1/*` shapes. Differences you'll observe in practice:

- **No scheduling.** `postingMode` must be `"now"`. Pass `"schedule"` and you get a 400.
- **No account connection flow.** Accounts come from the JSON file you write, not OAuth.
- **No multi-user model.** The API key gates all access; everyone using it shares the same set of accounts.
- **No persistence.** The `post` object in the response has fresh ids and is not stored anywhere — query it from `postingResults` if you need it.
- **Media storage.** Multipart uploads land on local disk and serve from `/media/:filename`. When `S3_STORAGE_*` is configured, `/api/v1/upload/presign` lets clients PUT directly to S3/R2 and use the returned public media URL.
- **No token refresh persistence.** The SDK still refreshes tokens during a request, but the new tokens are not written back anywhere — long-lived refresh tokens (X user tokens, YouTube, Bluesky OAuth) keep working because the SDK gets a fresh access token on every call.

## Related interfaces

- [Scheduler app](../scheduler-app/README.md) — UI, account connections, scheduling, MCP server, multi-user.
- [TypeScript SDK](../typescript-sdk/README.md) — call the publishing layer in-process, no HTTP.
- [CLI](../cli/README.md) — terminal workflows talking to either the server or the scheduler.
