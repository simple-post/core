# Plugin extensions release

This release adds a SimplePost sidebar workspace and thread editor alongside the existing MCP Apps. It requires Node.js 22 or newer and PostgreSQL migrations through `20260929170000_plugin_extensions`. The existing Docker image already uses Node 22 and runs `prisma migrate deploy` before starting the Scheduler; CI now matches that runtime.

## Included

- Global **SimplePost** entrypoint: interactive day/week/month calendar, recurring slots, draft/scheduled/published/failed lists, pagination, account health, recoverable working copies, and preferences.
- Thread **Post editor** entrypoint: persistent working copies, shared and per-account writing, root attachments and thread replies, platform options, and live `@simple-post/preview-react` previews for every selected account. Existing nested attachments and options survive editing.
- Slot, post, multi-post, and active editor selections attached to chat through MCP Apps model context. Explicit chat buttons send requests; selecting a slot never schedules a post. Hosts without selection attachments can receive the selected context in an explicit chat request.
- AI edits arrive as proposals. Applying a proposal changes the working copy; saving, scheduling, and publishing are separate actions. Sparse proposals preserve other destination variants and options.
- User timezone, default view, and default account preferences. Local scheduling uses the chosen IANA zone and rejects ambiguous or nonexistent clock-change times. Existing scheduled timestamps do not move when preferences change. An editor's planned local time and timezone are retained with its working copy.
- Onboarding skill and an empty-account connection screen that reuse the existing `/accounts` OAuth flow. Refresh after connecting; the workspace infers the browser timezone on first use and preserves saved preferences.
- Explicit schedule/publish review, optional image fitting for users with that feature, version checks, atomic commit receipts, and guarded publishing retries.

## Dev-first rollout

Main deploys to `https://dev.simplepost.social` through the configured hosting pipeline. Dev has its own database; apply its migrations locally before merging. The repository's GitHub `release.yml` is for npm SDK/CLI tags; this Scheduler release does not require an npm tag.

1. Confirm the dev service uses its dev database and storage configuration, with `NEXT_PUBLIC_APP_URL=https://dev.simplepost.social`. OAuth metadata, accounts handoffs, and widget URLs derive from that origin. Check the existing scheduled-post dispatcher is configured for dev.
2. From the release branch, apply migrations locally to the **dev database** using the explicit connection below. Confirm migration `20260929170000_plugin_extensions` is applied and the status reports no pending migrations. The additive migration can precede the application deployment.
3. Merge the PR to main after CI passes and the dev migration is complete. Capture the deployed commit SHA. Wait for the main-triggered dev deployment to finish, then inspect startup logs for successful Next.js startup. Docker's entrypoint repeats `prisma migrate deploy` safely; already applied migrations are skipped.
4. Enable `PLUGIN_EXTENSIONS` in **dev** only. Add it to dev's existing `GLOBAL_FEATURES` list, preserving any enabled features, then redeploy/restart. Alternatively, grant it to the dev test user with the existing per-user feature-grant mechanism. Leave production rollout settings unchanged during dev testing.
5. Install a dev copy of the plugin. Its `.mcp.json` must point to `https://dev.simplepost.social/mcp`, while including root `plugin.json` and the `skills/` directory. The checked-in `.mcp.json` points to production, so change the URL only in the dev test copy. Give the dev listing a distinct name such as SimplePost Dev. Connect through the dev OAuth endpoint with all normal posting scopes.
6. Verify discovery and read-only behavior first: sidebar workspace, thread editor, preferences, and legacy calendar/preview tools. Opening either new entrypoint must not create or schedule posts. For onboarding, use a test user with no connected destinations; the connection link must open dev's `/accounts`.
7. Connect at least one dedicated social test account and check the timezone displayed under the calendar. Use chat to write a draft (or expand **Edit manually**), save it, and verify every selected destination's live preview, switch a platform variant, close/reopen and recover the working copy, then check that text, media, options, variants, and planned time remain intact.
8. Select a calendar slot and ask chat for help. Verify selection attachment/removal, separate AI proposals, manual application, and preservation of other variants. Test schedule review without confirming, then confirm one explicitly chosen test schedule; verify its exact time in the dev web app. Check conflict handling by editing the saved post in another view. Use the existing results/reconciliation/retry interfaces for interrupted or failed publishing.
9. After dev passes, promote the tested commit through the production deployment workflow, verify migrations/startup, grant the feature to a production test user, and repeat the actual-host smoke checks. For public rollout, add `PLUGIN_EXTENSIONS` to production's existing `GLOBAL_FEATURES`, preserving current flags, then refresh plugin discovery.

Run the local migration commands from the repository root. Set `DEV_DATABASE_URL` locally to the existing dev database connection; do not rely on a default `.env` connection or share the connection string in chat. The required expansion prevents these commands from falling back to another database if the variable is unset or empty.

```sh
DATABASE_URL="${DEV_DATABASE_URL:?Set DEV_DATABASE_URL to the dev database connection}" yarn workspace @simple-post/scheduler prisma migrate deploy
DATABASE_URL="${DEV_DATABASE_URL:?Set DEV_DATABASE_URL to the dev database connection}" yarn workspace @simple-post/scheduler prisma migrate status
```

A dev Scheduler still sends to real connected social accounts. Saving a draft is the first write test. Publishing or leaving a test schedule active requires choosing the exact test destination and content. Cancel an unwanted test schedule before its due time.

For example, `GLOBAL_FEATURES=IMAGE_FITTING,PLUGIN_EXTENSIONS` enables both features. Keep the dispatch cron and its secret configured; that cron also sweeps expired working copies and unreferenced uploads. The production plugin MCP URL remains `https://app.simplepost.social/mcp`.

The workspace remains off for ungranted users until the rollout flag is enabled. Removing `PLUGIN_EXTENSIONS` hides new discovery and rejects new extension actions; existing publishing, drafts, scheduled posts, and legacy MCP Apps continue working. Keep the additive database tables during rollback. Rolling back an application binary does not reverse a post already scheduled or sent to a social platform.

## Compatibility and durability

The twelve existing MCP tools and these resources remain registered with unchanged launch behavior:

- `ui://simplepost/schedule-v1.html`
- `ui://simplepost/schedule-v2.html`
- `ui://simplepost/post-preview-v1.html`

New resources are `ui://simplepost/workspace-v1.html` and `ui://simplepost/post-editor-v1.html`. Both MCP `2025-11-25` and `2026-07-28` are supported. Managed post output adds `updatedAt`; legacy calls can omit the new optional `expectedUpdatedAt` guard.

The REST PATCH handler and editor commits use the same posting service, retaining validation, media ingestion, quotas, durable publishing checkpoints, cleanup, progress streaming, webhook behavior, and failed-post recovery. A first editor commit creates a draft with an idempotency key before scheduling or publishing.

Working copies expire after seven inactive days, with at most 500 unexpired copies per user. Saves and proposals retain owned uploads until expiry. The existing storage sweep deletes expired copies, while saved posts retain their own media. Local widget state retains edits that have not yet reached the server when the host supports widget state. A mismatched server revision pauses saving and provides a download of local edits; the UI never silently overwrites the newer copy.

An interrupted publish can leave a working copy locked. Inspect its saved post and durable platform results before any further action. Open a fresh copy only if the saved post remains editable; pending, published, and failed posts go through the existing results/reconciliation/retry interfaces. This prevents a lost response from blindly repeating a social post.

`/mcp-ui/runtime.js` is uncached and chooses the current hashed bundles. Widget builds retain existing hashes when building into an existing artifact. Missing historical hashes during a rolling deployment redirect without caching to the current bundle for that widget; the versioned mount functions and legacy payload contracts remain supported. Current hashes continue to use normal static-file serving. Already loaded widget code continues using the compatible APIs.

## Verification

Run these from the repository root:

```sh
yarn workspace @simple-post/scheduler check
yarn workspace @simple-post/scheduler test --runInBand
yarn workspace @simple-post/scheduler build
yarn workspace @simple-post/e2e extensions:smoke
```

The browser smoke command requires built widgets and installed Playwright Chromium. It uses a local fixture host and performs no database or social writes. It exercises calendar/slot selection, chat, autosave, live previews, variant isolation, review, onboarding, editor launch, and narrow layout.

PostgreSQL integration tests require a **disposable localhost** database named `simplepost_review`, with migrations applied, configured through `INTEGRATION_DATABASE_URL`:

```sh
yarn workspace @simple-post/scheduler jest -c jest.integration.config.cjs --runInBand
```

The integration config rejects other database names/hosts. CI runs migrations, concurrency/reliability tests, and the browser smoke command. Live OAuth return, extension discovery, and deliberate platform publishing remain checks in the real target host before announcing public availability.

## Sidebar discovery troubleshooting

The global entrypoint is `open_simplepost_workspace`; its tool metadata must contain `_meta["openai/ui"].entrypoints: [{"type":"global"}]`, a UI resource URI, a tool icon, and an input schema accepting `{}`. The protocol regression tests check these descriptors alongside the legacy tools.

The [OpenAI extension specification](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md#platform-support) defines browser support as the **Work browser**, explicitly excluding classic ChatGPT. A calendar opened by a conversational tool call in classic ChatGPT is not proof that sidebar extensions are available there.

After deploying to dev, verify `PLUGIN_EXTENSIONS` for the connected dev user, refresh the connection's tools/metadata, and open a new conversation. For a local plugin install, confirm its `.mcp.json` points to `https://dev.simplepost.social/mcp` and reconnect/refresh that plugin. Test the SimplePost global entrypoint and Post editor thread tab in an extension-capable host. A production connection cannot discover a feature enabled only on dev. If the metadata is present and the entry is still absent, record the host/version and connection type; do not change working metadata merely to guess around unsupported host UI.

The editor now starts with destination selection and live previews. Manual writing, attachments, threads, and platform options are under **Edit manually**. Publishing time is shown in **Review schedule**, and scheduling/publishing still require explicit confirmation. Choosing a calendar day opens its day view; selecting an actual slot attaches that slot to chat.
