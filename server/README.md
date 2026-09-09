# @simple-post/server

[Automatic image fitting: crop or blurred padding](../docs/image-fitting.md).

Self-hosted HTTP API for posting to social media. Supports an immediate-posting subset of the Scheduler API with `x-api-key` authentication, file-based accounts, and no saved drafts, scheduling, or post history. See the [API comparison](https://docs.simplepost.social/api).

Full documentation, including the `accounts.json` schema and per-platform credential examples, lives at [`docs/http-server/README.md`](../docs/http-server/README.md).

## Quick start

```bash
# From the repository root (Node.js 20+ and Yarn 4.9.2):
yarn install --immutable
cp server/.env.example server/.env
# Edit .env: set SIMPLE_POST_API_KEY, point SIMPLE_POST_ACCOUNTS_FILE at your accounts JSON

yarn workspace @simple-post/server dev
```

In another terminal, export the same `SIMPLE_POST_API_KEY` you configured in `server/.env` (the server loading `.env` does not populate your shell):

```bash
curl http://localhost:3000/api/v1/accounts -H "x-api-key: $SIMPLE_POST_API_KEY"
```

## Accounts file (minimal example)

```json
{
  "accounts": [
    {
      "id": "telegram-news",
      "platform": "telegram",
      "platformAccountId": "@your_channel",
      "credentials": { "botToken": "123456:ABC..." }
    }
  ]
}
```

See [the full docs](../docs/http-server/README.md#accountsjson) for every supported platform.
