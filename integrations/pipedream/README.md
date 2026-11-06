# SimplePost for Pipedream

Source for the SimplePost app in the [Pipedream component registry](https://github.com/PipedreamHQ/pipedream). `components/simplepost/` mirrors `components/simplepost/` in the Pipedream monorepo exactly, so publishing is a copy. This directory adds a local test harness around it.

## Components

| Component | Key | Kind |
| --- | --- | --- |
| Create Post | `simplepost-create-post` | Action: publish now, schedule, or save a draft, with media URLs, uploaded media, threads, per-account options and overrides, image fitting, quote posts, reposts, and idempotency keys |
| Validate Post | `simplepost-validate-post` | Action (read-only): check a post against each account's platform rules |
| Upload Media | `simplepost-upload-media` | Action: upload a `/tmp` file or URL to SimplePost storage and return a media object for **Create Post** |
| List Accounts | `simplepost-list-accounts` | Action (read-only): connected accounts and their IDs |
| Get Post | `simplepost-get-post` | Action (read-only): a post's status and per-account results |
| New Post Published (Instant) | `simplepost-post-published-instant` | Source: `post.published` webhook |
| New Post Failed (Instant) | `simplepost-post-failed-instant` | Source: `post.failed` webhook |

Authentication is a Scheduler API key (`Authorization: Bearer sp_api_...`) plus an optional base URL for self-hosted Schedulers. The sources register a webhook with `POST /api/v1/webhooks` on activation, verify `X-SimplePost-Signature` (HMAC-SHA256 over `${timestamp}.${rawBody}`) on every delivery, and delete the webhook on deactivation.

## Development

```bash
cd integrations/pipedream
npm install
npm test
```

The tests run every action and source against a fake Scheduler and check the registry conventions (keys, versions, annotations, README headings). Run Pipedream's own lint and CI checks before opening the upstream PR; [PUBLISHING.md](PUBLISHING.md) has the exact steps.

When you change a component after it is published, bump its `version` and the `version` in `components/simplepost/package.json` following [Pipedream's versioning rules](https://pipedream.com/docs/components/contributing/guidelines).
