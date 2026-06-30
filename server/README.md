# @simple-post/server

Self-hosted HTTP API for posting to social media. Speaks the same `/api/v1` contract as the SimplePost scheduler app.

Full documentation, including the `accounts.json` schema and per-platform credential examples, lives at [`docs/http-server/README.md`](../docs/http-server/README.md).

## Quick start

```bash
cd server
yarn install

cp .env.example .env
# Edit .env: set SIMPLE_POST_API_KEY, point SIMPLE_POST_ACCOUNTS_FILE at your accounts JSON

yarn dev
```

Then:

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
