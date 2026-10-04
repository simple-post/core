# SimplePost for Zapier

A [Zapier Platform CLI](https://docs.zapier.com/platform/reference/cli-docs) integration that publishes, schedules, and validates SimplePost social media posts through the Scheduler API, and triggers Zaps when posts publish or fail.

## What it includes

| Type | Key | Label | API |
| --- | --- | --- | --- |
| Auth | — | API key (custom auth) | `GET /api/v1/accounts` |
| Trigger | `new_published_post` | New Published Post | REST hook on `post.published`, polling fallback `GET /api/v1/posts?type=past` |
| Trigger | `new_failed_post` | New Failed Post | REST hook on `post.failed`, polling fallback `GET /api/v1/posts?type=failed` |
| Trigger (hidden) | `account_list` | Account dropdown | `GET /api/v1/accounts` |
| Action | `create_post` | Create Post | `POST /api/v1/posts` |
| Action | `validate_post` | Validate Post | `POST /api/v1/validation` |
| Search | `find_account` | Find Account | `GET /api/v1/accounts` |

Notes on behavior:

- Users connect with an `sp_api_` key from **API keys** in SimplePost. Keys need a plan with API access. The SimplePost URL field defaults to `https://app.simplepost.social`. Self-hosted Schedulers must use HTTPS.
- **Accounts** is a dropdown. Preview-only accounts are hidden.
- **Media** accepts files from earlier Zap steps or public URLs. The integration reads only the response headers to detect image or video. The Scheduler then copies the file into its own storage before publishing.
- **Publish now** waits for every platform to respond, and Zapier allows 30 seconds per action. For videos or many accounts, schedule the post a few minutes ahead.
- When a publish-now post fails on any platform, the action raises a Zap error that names the failed and successful platforms.
- **Deduplication key** maps to the API `idempotencyKey`. When it is set, a replayed Zap run returns the original post instead of posting twice.
- Each Zap that uses a trigger registers one webhook endpoint. The Scheduler allows 10 endpoints per user.
- Trigger output is the same for webhook deliveries and polling samples: `id`, `event`, `eventCreatedAt`, `status`, `message`, `url`, `publishedAt`, `errorMessage`, and `accountResults[]`.

## Development

This package is standalone and is not part of the Yarn workspace. The Zapier CLI builds with npm in a temporary directory from `package-lock.json`. Integrations run on Node.js 22.

```bash
cd integrations/zapier
npm ci
npm test        # node:test unit tests and appTester tests with nock
npm run check   # zapier-platform validate: schema and integration checks
npm run build   # build/build.zip and build/source.zip
```

To try it against a real account:

```bash
npx zapier-platform login
npx zapier-platform register "SimplePost"   # first time only; writes .zapierapprc
npx zapier-platform push
```

Then build a Zap in the Zapier editor with the private version. See [PUBLISHING.md](PUBLISHING.md) for the public release steps.
