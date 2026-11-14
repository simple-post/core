# SimplePost for Activepieces

Source of the SimplePost [Activepieces](https://www.activepieces.com) piece. The `piece/` folder has the same layout as `packages/pieces/community/simplepost` in the [Activepieces monorepo](https://github.com/activepieces/activepieces), so you can copy it there without changes.

## What it does

Connection: a SimplePost API key (`sp_api_…`) plus an optional Base URL for self-hosted SimplePost. The connection is checked by listing your accounts. API keys require a plan with API access.

Actions:

| Action | API call | Notes |
| --- | --- | --- |
| Create Post | `POST /api/v1/posts` | Publish now, schedule, or save a draft. Supports media URLs, thread replies, per-account settings and content, auto-repost, quote posts, and an idempotency key. The step fails if publishing fails. |
| Validate Post | `POST /api/v1/validation` | Checks platform rules without creating anything. |
| Upload Media | `POST /api/v1/upload` | Uploads a file from an earlier step and returns a URL for Create Post. |
| Get Post | `GET /api/v1/posts/{id}` | Status, schedule time, errors, and published URLs. |
| List Accounts | `GET /api/v1/accounts` | Account IDs, platforms, and whether an account needs reconnecting. |
| Custom API Call | any `/api/v1/*` | Built in to Activepieces and authenticated with the connection. |

Triggers (webhooks):

| Trigger | SimplePost event |
| --- | --- |
| Post Published | `post.published` |
| Post Failed | `post.failed` |

When a flow is published, the trigger registers a webhook with `POST /api/v1/webhooks`. When the flow is disabled, it removes the webhook with `DELETE /api/v1/webhooks/{id}`. Every delivery is checked against the `X-SimplePost-Signature` HMAC before the flow runs. SimplePost allows 10 webhook endpoints per user, and each enabled trigger uses one.

Every action and trigger declares `audience`, `aiMetadata`, and `classification`, so Activepieces agents and MCP clients can use them. Outputs are flattened into table-friendly fields such as `post_id`, `status`, `post_urls`, and `results[]`.

## Develop and verify

Pieces build only inside an Activepieces checkout. The framework packages are no longer published to npm and get bundled into each piece at build time. To work on the piece:

```bash
git clone --depth 1 https://github.com/activepieces/activepieces.git ../activepieces
node integrations/activepieces/scripts/sync-to-activepieces.mjs ../activepieces
cd ../activepieces
bun install
npx turbo run build lint test --filter=@activepieces/piece-simplepost
npm run build-piece simplepost   # self-contained bundle + .tgz in packages/pieces/community/simplepost/dist
```

The sync script copies `piece/` into the checkout and adds the `tsconfig.base.json` path entry. You can run it again safely. To produce a build you publish yourself, pass `--type custom`, `--package-name @simple-post/piece-simplepost`, and `--logo-url <url>`. See [PUBLISHING.md](./PUBLISHING.md).

To try the piece in a local Activepieces, run `AP_DEV_PIECES=simplepost npm start` in the checkout. Then open http://localhost:4200 and sign in as `dev@ap.com` / `12345678`.

If edits are made in the checkout, copy them back into `piece/` before committing here.
