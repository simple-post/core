# MCP Server

Use the MCP server when an AI assistant should validate, publish, or schedule posts for a user through SimplePost.

The MCP server is hosted by the Scheduler app and uses the Scheduler app's connected accounts. Users connect their social accounts once in the web app, then authorize the AI client with OAuth.

## When To Use It

Choose MCP when:

- The user wants to tell an AI assistant what to post.
- The assistant should discover available social accounts.
- The assistant should validate content before publishing.
- The assistant should schedule a post without handling raw social platform credentials.

Use the [CLI](../cli/README.md) for shell-driven agents and the [HTTP API server](../http-server/README.md) for backend-to-backend calls.

## Endpoint

For a deployed Scheduler app:

```text
https://your-scheduler-domain.example/mcp
```

Locally, with `NEXT_PUBLIC_APP_URL=http://localhost:3000`:

```text
http://localhost:3000/mcp
```

The public documentation page is available at:

```text
https://your-scheduler-domain.example/mcp-docs
```

## Authentication

The MCP server uses OAuth through the Scheduler app. The AI client receives a bearer token only after the user approves access.

Supported scopes:

| Scope            | Allows                             |
| ---------------- | ---------------------------------- |
| `accounts:read`  | Listing connected social accounts  |
| `posts:validate` | Validating and previewing drafts   |
| `posts:write`    | Uploading media and creating posts |

The MCP server does not expose raw social platform credentials to the AI client.

## Available Tools

| Tool            | Purpose                                                                                       |
| --------------- | --------------------------------------------------------------------------------------------- |
| `list_accounts` | Lists connected Scheduler accounts and returns the `accountId` values required by other tools |
| `upload_media`  | Uploads base64 image or video bytes to SimplePost storage and returns a public URL            |
| `validate_post` | Checks text and media against platform rules without creating anything                        |
| `preview_post`  | Resolves accounts, media count, schedule time, and validation without writing anything        |
| `create_post`   | Publishes immediately or schedules for later                                                  |

## Recommended Agent Workflow

1. Call `list_accounts`.
2. Ask the user to connect accounts in the Scheduler app if none are available.
3. Draft the post and choose target account IDs from `list_accounts`.
4. If media is needed, use a public URL or call `upload_media` when the client has raw file bytes.
5. Call `validate_post` or `preview_post`.
6. Ask for confirmation when content, accounts, media, or timing are not explicit.
7. Call `create_post` with `postingMode: "now"` or `postingMode: "schedule"`.
8. Inspect the returned summary and per-account results.

## Tool Inputs

### `validate_post` and `preview_post`

```json
{
  "message": "Launch day",
  "accountIds": ["account_123", "account_456"],
  "media": [
    {
      "type": "image",
      "url": "https://cdn.example.com/image.jpg"
    }
  ],
  "postingMode": "schedule",
  "scheduledFor": "2030-05-01T14:30:00Z"
}
```

### `create_post`

```json
{
  "message": "Launch day",
  "accountIds": ["account_123"],
  "postingMode": "now"
}
```

For scheduled posts, `scheduledFor` must be a future ISO 8601 datetime with a timezone offset or `Z`.

## Client Setup

### ChatGPT

In ChatGPT, open Apps and Connectors, enable developer mode, then add the Scheduler app MCP URL:

```text
https://your-scheduler-domain.example/mcp
```

### Claude Code

```bash
claude mcp add simplepost https://your-scheduler-domain.example/mcp
```

### Claude Desktop, Cursor, Windsurf, and other clients

Add a remote MCP server using the same `/mcp` URL. The client should start the OAuth flow automatically when it first needs authorization.

## What MCP Cannot Do

- It cannot connect, disconnect, or re-authenticate social accounts.
- It cannot expose social platform access tokens.
- It cannot edit, list, delete, or cancel scheduled posts.
- It cannot read analytics or previous social media posts.

Manage accounts and scheduled posts in the Scheduler app.
