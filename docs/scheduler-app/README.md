# Scheduler App

Use the Scheduler app when humans need a web UI to connect social accounts, compose posts, preview how they will look, publish immediately, or schedule for later.

The app is also the account hub for integrations. The MCP server, scheduler-connected CLI, API clients, and n8n node use the accounts stored in the Scheduler app.

## When To Use It

Choose the Scheduler app when:

- A person wants to write and review posts before they go live.
- You need connected accounts stored in one self-hosted web app.
- You want media upload, previews, validation, and scheduling in a browser.
- You want AI assistants to post through MCP using accounts the user already approved.

Use the [SDK](../typescript-sdk/README.md) or [HTTP API server](../http-server/README.md) instead when you are building a backend-only integration and do not need a user-facing app.

## What It Does

- Connects social accounts with OAuth or manual setup, depending on the platform.
- Stores connected account secrets encrypted in the app database.
- Lets users compose text posts with image or video media.
- Uploads media to S3-compatible storage and keeps public URLs for publishing.
- Validates drafts against platform rules before publishing.
- Shows previews and per-platform validation messages.
- Publishes immediately or saves scheduled posts for later dispatch.
- Shows scheduled, published, and failed posts.
- Exposes the remote MCP server at `/mcp`.
- Exposes API routes used by the app, CLI, MCP, and user-managed API keys.

Publishing still goes through `@simple-post/sdk`; the Scheduler app handles users, accounts, UI, storage, and scheduling around it.

## Local Setup

From the repo root:

```bash
yarn install
cp scheduler/.env.example scheduler/.env
```

Fill in `scheduler/.env`, then run:

```bash
yarn workspace @simple-post/scheduler db:migrate
yarn workspace @simple-post/scheduler dev
```

The app runs with Next.js. By default, `NEXT_PUBLIC_APP_URL=http://localhost:3000` is the local base URL used by OAuth callbacks, CLI authorization, and MCP metadata. `NEXT_PUBLIC_N8N_NODE_URL` optionally changes the n8n package/marketplace link shown on the API Keys page after the node is published.

## Required Services

| Service                  | Why it is needed                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------- |
| Postgres                 | Users, sessions, connected accounts, posts, and scheduled post records                            |
| S3-compatible storage    | Uploaded media, thumbnails, and files that need public URLs                                       |
| Better Auth secret       | App authentication and session signing                                                            |
| Scheduler encryption key | Encryption for connected account secrets                                                          |
| Resend                   | Email login / auth mail                                                                           |
| Social platform apps     | OAuth credentials for platforms such as X, Meta, Google, TikTok, LinkedIn, Pinterest, and Bluesky |

See [`scheduler/.env.example`](../../scheduler/.env.example) for the full list of environment variables.

## Self-Hosted Mode

Set `SELF_HOSTED=true` to disable all billing and Stripe integration. Every user gets unrestricted access (no plan limits on accounts, posts, CLI, or API), the billing UI is hidden, and no `STRIPE_*` environment variables are required. This is the recommended setup when you run the Scheduler app for yourself. It is off by default.

## Main Workflows

### Connect accounts

Open the app, go to Accounts, and connect the platforms you need. Most platforms use OAuth. Telegram uses a bot token and chat ID. You can connect multiple accounts from the same platform.

Connected accounts are then available to:

- The Scheduler app compose form.
- The MCP server.
- The CLI after `simplepost connect`.

### Create a post

Go to the compose screen, select one or more accounts, write the message, attach media if needed, and choose:

- `Post Now` to publish immediately.
- `Schedule for Later` to save a future post.

The form validates content against the selected accounts. It blocks publishing when a platform requirement is not met, such as missing required media or text that is too long.

### Schedule dispatch

Scheduled posts are stored in the database. A separate cron or worker should call the internal dispatch route. Each run also refreshes connected-account credentials that are nearing expiry, so run it regularly even when few posts are due:

```bash
curl -X POST "$NEXT_PUBLIC_APP_URL/api/internal/scheduled-posts/dispatch" \
  -H "Authorization: Bearer $SCHEDULED_POST_DISPATCH_SECRET"
```

Configure `SCHEDULED_POST_DISPATCH_SECRET` in the scheduler environment and run this command from trusted infrastructure only.

### Use AI integrations

The Integrations page shows how to connect MCP-compatible clients such as ChatGPT, Claude Code, Claude Desktop, Cursor, and Windsurf. The MCP server URL is:

```text
https://your-scheduler-domain.example/mcp
```

For details, read the [MCP server docs](../mcp-server/README.md).

### Use API keys

Open the Scheduler app and go to API Keys from the dashboard or user menu. Create a key, copy it immediately, and store it in your secret manager. The full key is shown only once; later the app only shows the saved prefix so you can identify it.

Use the key as a bearer token for authenticated `/api/v1/*` routes:

```bash
curl -H "Authorization: Bearer $SIMPLEPOST_API_KEY" \
  "$NEXT_PUBLIC_APP_URL/api/v1/accounts"
```

API keys are stored as SHA-256 hashes in Postgres. You can deactivate a key or rotate it from the API Keys page. Rotating deactivates the old key and returns a replacement once.

The generated OpenAPI document is available at `/api/openapi.json`. It includes `apiBearerAuth` for Scheduler API routes and the API-key management endpoints.

## Useful Routes

| Route                    | Purpose                                 |
| ------------------------ | --------------------------------------- |
| `/accounts`              | Manage connected social accounts        |
| `/schedule`              | Compose, publish, or schedule a post    |
| `/integrations`          | AI and MCP integration instructions     |
| `/api-keys`              | Create, rotate, and deactivate API keys |
| `/mcp`                   | Remote MCP server endpoint              |
| `/mcp-docs`              | Public MCP documentation page           |
| `/api/openapi.json`      | Generated Scheduler OpenAPI document    |
| `/api/v1/accounts`       | Authenticated connected account API     |
| `/api/v1/api-keys`       | Authenticated API-key management API    |
| `/api/v1/posts`          | Authenticated post create/list API      |
| `/api/v1/upload`         | Server-side media upload                |
| `/api/v1/upload/presign` | Direct S3/R2 upload URL generation      |

## Notes

- The Scheduler app is the best interface for account ownership and human review.
- The MCP server cannot connect accounts by itself; users connect accounts in the Scheduler app first.
- The CLI can use Scheduler accounts after `simplepost connect`.
- For backend-only posting without users or scheduling UI, use the [HTTP API server](../http-server/README.md).
