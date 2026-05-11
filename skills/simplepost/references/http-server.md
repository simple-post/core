# SimplePost HTTP API

Use the HTTP API for service-to-service posting from any language. The self-hosted server is a stateless wrapper around `@simple-post/sdk`; the Scheduler app exposes a related `/api/v1` contract with accounts, uploads, posts, validation, and scheduling.

## Self-Hosted Server

Use this when:

- You manage platform credentials yourself.
- You want a small API server without database, UI, OAuth flows, or scheduling.
- You only need immediate publishing.

Required header for `/api/v1/*`:

```text
x-api-key: SIMPLE_POST_API_KEY
```

Core endpoints:

- `GET /health`
- `GET /api/v1/accounts`
- `POST /api/v1/upload`
- `POST /api/v1/validation`
- `POST /api/v1/posts`
- `GET /media/:filename`

The self-hosted server supports only:

```json
{ "postingMode": "now" }
```

Use the Scheduler app for `postingMode: "schedule"` or `"draft"`.

## Media Upload

Upload returns a `MediaFile` that can be passed to validation or posting:

```bash
curl -X POST https://posts.example.com/api/v1/upload \
  -H "x-api-key: $SIMPLE_POST_API_KEY" \
  -F "file=@photo.jpg"
```

The returned URL must be publicly reachable by social platforms. Configure `SIMPLE_POST_PUBLIC_URL` correctly.

## Post Request

```json
{
  "message": "Launching today",
  "accountIds": ["x-main", "telegram-news"],
  "postingMode": "now",
  "media": [],
  "accountOptions": {
    "x-main": { "replyToId": "1234567890" }
  },
  "accountOverrides": {
    "telegram-news": { "message": "Telegram-specific copy" }
  }
}
```

Validation failures and unknown accounts return `400` before any platform is touched. Platform failures after publishing attempts are returned in `postingResults`; inspect `summary.overallSuccess`.

## Accounts File

The self-hosted server reads configured accounts from `SIMPLE_POST_ACCOUNTS_FILE`. Each account needs a stable `id`, `platform`, `credentials`, and optional platform defaults in `options`. The platform credential shapes mirror `PostOptions[platform].credentials` in the SDK.

