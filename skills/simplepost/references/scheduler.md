# SimplePost Scheduler App

Use the Scheduler app when humans need a browser UI and when AI clients need account-backed MCP access.

## What It Provides

- User login and account ownership.
- Social account connection through OAuth or platform-specific manual setup.
- Encrypted connected-account secret storage.
- Browser compose, preview, validation, posting, drafts, and scheduling.
- S3-compatible media upload with public URLs.
- Per-account platform options, including custom YouTube thumbnails via `thumbnailUrl`.
- `/mcp` remote MCP server for AI assistants.
- `/api/v1/*` routes used by the app, scheduler-connected CLI, MCP, and user-managed API keys.

## Local Development

```bash
yarn install
cp scheduler/.env.example scheduler/.env
yarn workspace @simple-post/scheduler db:migrate
yarn workspace @simple-post/scheduler dev
```

`NEXT_PUBLIC_APP_URL` should match the reachable app URL used for OAuth callbacks, CLI authorization, and MCP metadata.

## Scheduled Dispatch

Scheduled posts require a trusted worker or cron to call:

```bash
curl -X POST "$NEXT_PUBLIC_APP_URL/api/internal/scheduled-posts/dispatch" \
  -H "Authorization: Bearer $SCHEDULED_POST_DISPATCH_SECRET"
```

## API Keys

Users can create API keys on the Scheduler app API Keys page. The raw key is shown once, stored only as a SHA-256 hash, and can later be deactivated or rotated. Use it as a bearer token:

```bash
curl -H "Authorization: Bearer $SIMPLEPOST_API_KEY" \
  "$NEXT_PUBLIC_APP_URL/api/v1/accounts"
```

The OpenAPI document at `/api/openapi.json` includes the `apiBearerAuth` security scheme and API-key management routes.

## Agent Guidance

- MCP cannot connect, disconnect, or re-authenticate social accounts. Direct users to the Scheduler app Accounts page.
- Use Scheduler-connected accounts for OAuth-backed user workflows.
- Use the self-hosted HTTP server instead when no UI, OAuth, user model, or scheduling is needed.
