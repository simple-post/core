---
name: simplepost
description: Publish, schedule, draft, preview, inspect, or manage social posts with SimplePost, or integrate SimplePost through MCP, CLI, HTTP, or TypeScript. Use for SimplePost actions and integrations; do not use for generic social copywriting.
license: MIT
metadata:
  hermes:
    tags: [social-media, publishing, scheduling, mcp]
    category: social-media
---

# SimplePost

Use SimplePost to turn an explicit posting request into a reliable result across connected social accounts. Preserve the user's content and intent, choose the interface that fits the environment, and report the exact post and per-account outcome.

## Choose the interface

- Use **MCP** for an AI assistant acting on accounts connected at `app.simplepost.social`. This is the preferred route for publishing, drafts, scheduling, previews, and queue management. Read [references/mcp.md](references/mcp.md).
- Use the **CLI** for immediate posting from a terminal, local coding agent, script, or CI job. Read [references/cli.md](references/cli.md).
- Use the **HTTP API** when another service or a non-TypeScript application needs to publish. Read [references/http-server.md](references/http-server.md).
- Use the **TypeScript SDK** when adding in-process publishing to a TypeScript application. Read [references/sdk.md](references/sdk.md).
- Use the **Scheduler app** for account connection, browser composition, human previews, hosted scheduling, or self-hosted deployment. Read [references/scheduler.md](references/scheduler.md).

Do not mix payload shapes between interfaces. MCP, the hosted API, and connected CLI accounts target `accountIds`; direct SDK and local CLI publishing use platform options and locally managed credentials.

## Posting workflow

1. Determine the requested action: publish now, schedule, save a draft, preview, inspect, edit, discard, or integrate SimplePost. Preserve supplied copy exactly unless the user asks for writing or adaptation.
2. Resolve real targets before acting. With MCP, call `list_accounts`; with CLI, run `simplepost account`. Never invent account IDs, aliases, board IDs, chat IDs, or post IDs.
3. Resolve missing essentials such as the target account, required media, or scheduled time. A request to publish exact content to named accounts is sufficient authorization to publish; do not insert an extra confirmation step. Preview when the user asks or when essential details remain ambiguous.
4. Prepare media in the interface-supported form. MCP and HTTP require public or SimplePost-managed URLs. The CLI and SDK can accept local files. Preserve media metadata returned by SimplePost.
5. For scheduled posts, convert relative language to a future ISO 8601 datetime with an offset or `Z`. Ask for the user's timezone only when it cannot be inferred safely.
6. Execute once. For MCP `create_post`, always supply a new idempotency key for a new intended post and reuse that same key for any retry. Never retry a write with a new key after a timeout or uncertain result.
7. Inspect the complete result. A successful call can contain per-account or per-thread failures. Report the exact root post, thread segments, timing, targets, warnings, and platform results.

## Boundaries

- Account connection, disconnection, and reauthorization happen in the SimplePost web app. Do not search accounts or posts when the requested account action is unsupported.
- SimplePost can edit or discard drafts and future scheduled posts. It cannot edit, delete, or undo a post already published to a social platform; direct the user to that platform.
- SimplePost records posting state, but it does not currently expose social-network engagement analytics through its MCP tools. Do not claim reach, click, impression, or engagement analysis from post records.
- Keep credentials out of prompts, source files, logs, and visible responses. Use OAuth, environment variables, the CLI secret store, or server-side account storage.
- Check returned trial or billing eligibility before writing. If SimplePost denies a post for allowance or plan reasons, explain the returned reason and do not retry to bypass it.

## Content model

- The root message is the first post. Use `thread` for ordered follow-up segments on X, Bluesky, Threads, and Telegram. Other targets receive only the root and should surface a warning.
- Use `accountOverrides` or account-scoped options when the user wants platform-specific copy or settings. Do not mechanically rewrite content for every platform unless requested.
- Keep platform variants in one post. When some accounts get a single long post and others get a thread (for example X and LinkedIn long form, Bluesky and Threads as a thread), put the long text in the shared `message` and give each thread account an override with its own `message` and `thread`. Do not create separate posts per platform.
- To quote an earlier post through MCP, find the exact SimplePost record with `inspect_posts` and pass its ID as `quotePostId`. Never infer a post ID from text.
- Drafts may be saved even when validation fails. Clearly distinguish “saved as a draft” from “valid and ready to publish,” and report the returned per-account errors.

## Result standard

For every preview, draft, schedule, edit, discard, or publish result, make the outcome auditable in the visible response:

- show the exact root text and ordered thread segments, plus any per-account custom content;
- identify the selected account names or platforms;
- include the absolute scheduled time and timezone when relevant;
- surface validation warnings and partial failures once;
- include returned post URLs or IDs when useful;
- mention whether SimplePost scheduled an automatic repost when the result says it did.
