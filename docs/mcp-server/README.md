# MCP Server

Use the MCP server when an AI assistant should validate, publish, or schedule posts for a user through SimplePost.

The MCP server is hosted by the Scheduler app and uses the Scheduler app's connected accounts. Users connect their social accounts once in the web app, then authorize the AI client with OAuth.

The ChatGPT app is text-only. Tools return model-readable text plus structured JSON data, and no embedded ChatGPT iframe or component UI is registered.

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

| Scope            | Allows                                                                                   |
| ---------------- | ---------------------------------------------------------------------------------------- |
| `accounts:read`  | Listing connected social accounts                                                        |
| `posts:read`     | Inspecting scheduled, posted, and failed posts                                           |
| `posts:validate` | Validating and previewing drafts                                                         |
| `posts:write`    | Uploading media, creating posts, editing scheduled posts, and discarding scheduled posts |

The MCP server does not expose raw social platform credentials to the AI client.

## Available Tools

| Tool                     | Purpose                                                                                       |
| ------------------------ | --------------------------------------------------------------------------------------------- |
| `list_accounts`          | Lists connected Scheduler accounts and returns the `accountId` values required by other tools |
| `upload_media`           | Uploads a ChatGPT file parameter to SimplePost storage and returns a public URL               |
| `validate_post`          | Checks text and media against platform rules without creating anything                        |
| `preview_post`           | Resolves accounts, media count, schedule time, and validation without writing anything        |
| `create_post`            | Publishes immediately or schedules for later                                                  |
| `inspect_posts`          | Lists scheduled, posted, or failed posts, or inspects a single post by ID                     |
| `update_scheduled_post`  | Edits a future scheduled post after validating the resulting content                          |
| `discard_scheduled_post` | Deletes a future scheduled post and its stored media                                          |

## Recommended Agent Workflow

1. Call `list_accounts`.
2. Ask the user to connect accounts in the Scheduler app if none are available.
3. Draft the post and choose target account IDs from `list_accounts`.
4. If media is needed, use a public URL or call `upload_media` when the client has raw file bytes.
5. Call `validate_post` or `preview_post`.
6. Ask for confirmation when content, accounts, media, or timing are not explicit.
7. Call `create_post` with `postingMode: "now"` or `postingMode: "schedule"`.
8. Inspect the returned summary and per-account results.
9. Use `inspect_posts` when the user asks what is scheduled, posted, or failed.
10. Use `update_scheduled_post` or `discard_scheduled_post` only for future scheduled posts after identifying the exact `postId`.

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

### `inspect_posts`

List posts by status:

```json
{
  "status": "scheduled",
  "page": 1,
  "limit": 10
}
```

Inspect one post before editing or discarding it:

```json
{
  "postId": "post_123"
}
```

`status` can be `scheduled`, `posted`, `failed`, or `all`. For `all`, `limit` is applied per status.

### `update_scheduled_post`

```json
{
  "postId": "post_123",
  "message": "Updated launch day copy",
  "scheduledFor": "2030-05-01T16:30:00Z"
}
```

The update is partial. Omitted fields keep their current values. Pass `media: null` or `media: []` to clear root media, and `thread: null` or `thread: []` to clear follow-up thread segments. The tool validates the resulting scheduled post before saving.

### `discard_scheduled_post`

```json
{
  "postId": "post_123"
}
```

Discarding deletes the future scheduled SimplePost record and best-effort deletes its stored media. It does not undo posts that were already published.

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
- It cannot edit or discard already published, failed, pending, or due-for-dispatch posts.
- It cannot read analytics or previous social media posts.

Manage social account connections in the Scheduler app.
