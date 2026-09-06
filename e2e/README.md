# Real-account posting acceptance tests

This workspace exercises the deployed MCP server over Streamable HTTP, the actual CLI process (app and local accounts), and the scheduler's browser UI. Successful live cases visit the resulting social post in a separate browser context and verify its author, caption, media, and configured platform settings. The suite is manually invoked; ordinary `yarn test` never publishes.

Real-account runs now have saved receipts and platform evidence. See [LIVE_STATUS.md](LIVE_STATUS.md) for the current verified coverage and blockers, backed by per-run journals and artifacts. Local tests validate the runner, CLI parsing and HTTP requests, MCP transport, fixture contracts, scheduling assertions, and browser observers against controlled pages; those checks alone are not evidence of a live-platform pass. Platform markup and owner-session requirements can change.

## Coverage

Run `yarn e2e:plan` from the repository root for the scenario matrix. All eleven platforms have smoke cases across MCP, CLI app, CLI local, and UI. The catalog also covers supported photos/video, missing captions, remote/local media, carousels, flags versus JSON, threads/replies, privacy, platform metadata, and draft/edit/schedule/cancel lifecycles. TikTok includes photo count, cover selection, music on/off/omitted, custom/empty/fallback descriptions, all four audience values, inbox uploads, comments/duet/stitch, disclosure, and invalid boundaries.

Telegram albums are covered through all four posting interfaces: photos, videos, mixed attachments, empty captions, formatted captions, replies, threads, remote URLs, CLI JSON, 10/11-item boundaries, 1024/1025-character captions, and scheduled/draft-edit/cancel paths where those interfaces support them. The verifier checks every attachment, mixed-media order, video playability, and that the album caption appears once.

The CLI groups separate `--image` and `--video` flags by type. For an interleaved order such as photo–video–photo, the adapter uses the existing `--media-json` input alongside the normal text/platform flags, or `--post-json` for the full JSON scenario. `telegram.album-mixed-flags` separately exercises images followed by video using the individual flags. Tests cover both paths rather than assuming shell flag order is preserved.

The catalog describes current SimplePost capabilities, not every feature a social network offers. The SDK supports one Bluesky MP4 video and ordered Threads carousels with up to 20 attachments, including mixed images and videos. YouTube playlist publishing remains in the catalog and option inventory for coverage, but its live scenario is paused as explicitly unsupported because it needs unapproved OAuth scopes. Other gaps, such as multiple-account fan-out, automatic reposts/quotes, platform-native `publishAt`, refresh-token fault injection, and exhaustive media size/codec combinations remain in existing unit coverage or the design backlog; they are not claimed as live coverage. Plans and reports include an option inventory, and a local check fails if the SDK adds an unclassified platform option. See [the design plan](../docs/release/LIVE_POSTING_TEST_PLAN.md) for the broader roadmap.

Hosted live runs also read `/api/v1/posts/{id}/reconcile`: each published root/reply must have a successful durable record matching its platform ID, and drafts/cancellations must have no publishing records. This requires the scheduler migrations and publishing-reliability changes from `main` through `b8f058f`. CLI-local publishes directly and has no scheduler checkpoints. These checks supplement the independent social-platform visit; they do not automatically reconcile uncertain posts.

## Install and inspect without accounts

```sh
yarn install --immutable
yarn workspace @simple-post/sdk build
yarn workspace @simple-post/cli build
yarn workspace @simple-post/e2e exec playwright install chromium
yarn e2e:check
yarn e2e:test
yarn e2e:plan
yarn e2e:plan --all --interface mcp,cli-app,cli-local,ui
```

The small original JPEG/WebP images and four-second MP4 videos are included in `fixtures/generated`. The videos have a synthetic tone or no audio. Regenerate with `yarn e2e:fixtures` (requires ffmpeg; images use sharp). Image colors let the browser verifier catch reversed carousel order rather than checking only the attachment count. Fixture hashes are recorded per run.

Contract validation and option inventory load the SDK from the selected application workspace. With no live configuration this defaults to the local repository. When `config.cliCommand` points to another checkout’s `cli/bin/run.js`, that checkout is selected automatically; `cliEntry` remains independent for credential reading. Optional `config.appRoot` overrides that inference, with relative paths resolved against the config file. For a one-off offline run, use `yarn e2e:test --app-root /path/to/application`. Output records the selected root. The target workspace must have its dependencies installed and SDK built; the harness never copies SDK sources or artifacts between checkouts. Offline checks do not require accounts or a complete live configuration.

## Local publishing reliability checks

```sh
yarn e2e:reliability
```

This runs the SDK and scheduler regressions added on `main`, including Telegram multipart albums, credential merging, Instagram processing timeouts, partial failures, startup CLI resolution, and the database integration tests for quotas, shared media, stale edits, and durable recovery. Additional HTTP-handler tests verify that retrying a failed thread publishes only its missing reply, that retries cannot add accounts or replay uncertain legacy posts, and that reconciliation requires the owner, explicit confirmation, and a current record version.

The command uses the same application-root selection and creates a temporary PostgreSQL cluster on a free loopback port, applies the real migrations, runs the checks, then stops and removes the cluster. PostgreSQL tools (`initdb`, `pg_ctl`, `createdb`) must be on PATH; no database URL or test-account configuration is needed. It does not use your configured application database. Platform publishing and storage deletion are mocked in these fault tests. The 24-hour storage collector is exercised with due dates moved only in this disposable database, not by waiting or changing production clocks. These checks complement `yarn e2e:test`; neither command publishes real posts.

## Sign in and discover the test configuration

Use your test user on the real deployment. You only need connected accounts for the platforms you want to test. From the repository root:

```sh
yarn e2e:setup https://app.simplepost.social --platform tiktok
```

A browser opens for normal sign-in. Setup detects the authenticated session automatically, saves it privately, and discovers the user ID, connected account IDs, platform identities, TikTok audience/interaction capabilities, and Pinterest boards. A single account or board is selected automatically; multiple choices get a short prompt. No API key or hand-entered user/account IDs are required. Setup never posts or uploads media.

To reuse an existing CLI login instead:

```sh
# If needed, first sign in normally with the CLI configured for your test user:
node cli/bin/run.js connect
# Reuse that connection and its normal secret store:
yarn e2e:setup --from-cli --platform tiktok
```

`--cli-config-dir /path/to/config` selects a different CLI directory; otherwise setup uses the CLI's normal environment/default directory. The runner reads the scheduler token through the CLI's existing keychain/encrypted/plain secret-store implementation without copying it into the test manifest. Encrypted stores still need their normal unlock password (`SIMPLE_POST_CONFIG_PASSWORD`) for unattended runs.

Website setup selects UI tests by default; CLI setup selects `cli-app`. Add `--mcp` to setup when you also want MCP tests. It opens the normal OAuth consent flow and reuses the saved website session when available:

```sh
yarn e2e:setup https://app.simplepost.social --platform tiktok --mcp
```

MCP authorization is a separate client authorization, so it still needs your consent. Selecting UI tests after CLI-only setup requires a browser session too: rerun setup with the app URL. You can select interfaces explicitly using `E2E_INTERFACES`.

Setup writes ignored `e2e/config.local.json` and `.local/setup-report.json`. Rerunning it preserves selected accounts and calibrated verification settings, and refuses to replace an existing configuration with a different user's account. Use `--config /path/to/another/config.json` for another test user or deployment. `--account-id ID` chooses a specific connected account without a prompt. `--platform` accepts a comma-separated list; omitting it discovers the available connected platforms. An observed script-asset fingerprint is recorded when the site exposes one; it is not a claimed deployed Git SHA. Set `deploymentRevision` explicitly if you need an exact release identifier.

Fixture hosting is automatic for URL-consuming cases: at live-run time the runner uploads the needed original fixtures through the deployment's normal upload endpoint, records their URLs in `.local/media.json`, checks their bytes, and reuses them on later runs. MCP still exercises `upload_media` against those source URLs. UI and local-file CLI cases use their own normal upload paths. No S3 settings are needed for these app-backed paths. An explicit `mediaBaseUrl` remains available for separately hosted sources. TikTok still requires the deployment's upload domain/prefix to be verified for its application.

Some information is not exposed by the scheduler: social-platform owner sessions, certain public profile/channel identifiers, playlists/reply targets, and UI selectors for observing privacy or music. Setup reports the discoverable gaps rather than inventing values. We can calibrate these from the logged-in social pages during the first run; they are not expected to be guessed from the API response. To save an owner browser session:

```sh
yarn e2e:auth https://www.tiktok.com/@YOUR_HANDLE .local/auth/tiktok.json
```

Resume in Playwright Inspector after login to save it. Sessions at `.local/auth/PLATFORM.json` are picked up automatically. Public verification can work without an owner session; private posts and owner settings generally require one.

For advanced configuration, `config.example.json` remains a reference. `username` is the browser identity; `apiUsername` preserves the scheduler value (which may be an email or null). YouTube `resources.channelId` identifies the actual channel, which can differ from a scheduler Google user ID. `localPlatformAccountId` handles equivalent identities stored differently by local CLI connections. `cli-local` tests additionally require the CLI's own platform credentials; connecting accounts on the site enables the `cli-app` path. Specialized scenarios require their own resources and platform-side verifiers, as listed in the plan.

## Platform-side verification

For X, use `--headed`: X returned HTTP 403 to the headless browser during live verification, while its normal visible guest page worked. The verifier supports both the signed-in tweet layout and the current guest articles, selects the exact receipt permalink even for captionless posts and threads, and checks the direct parent of replies. Set `accounts.x.resources.replyToId` to an existing verified test post ID; a post already created by the smoke case can be reused without publishing an extra setup post. X reply verification needs no custom field selector.

Telegram private chats cannot be verified through public `t.me/username/message` embeds. Setup recognizes positive chat IDs as private chats. Save a Telegram Web session with `yarn e2e:auth https://web.telegram.org/ .local/auth/telegram.json`, then identify the actual test-bot conversation and configure `observer.telegramWeb` with its numeric `botPeerId` and `botUsername`, plus the content selectors. Preflight requires the saved session and configured observer. The verifier checks the logged-in recipient ID, bot conversation, incoming-message direction, exact caption, and saved submission time window before inspecting media. Bot API message IDs differ from the recipient’s Web message IDs; both are recorded in the observation artifact. Captionless messages also require a unique match within that time window; ambiguous or unavailable history fails verification without reposting. Public test channels can use the public embed verifier.

Live output distinguishes submission, saved receipts, publishing records, and platform verification. Verification retries report their reason; missing Telegram channels/messages fail immediately. A successful saved receipt is retained if platform verification fails or the run is interrupted. Resume using the same run ID after correcting the observer; do not create a new run just to check an existing post.

The verifier navigates to a post permalink, checks it is on the intended platform, scopes assertions to the post, verifies the author, and compares captions, loaded images and their order, and video readiness. It saves screenshots and an observation record. It rejects login/profile pages as post permalinks. If the CLI returns only a non-public publishing handle, it attempts to discover the unique scenario marker on the configured profile; if it cannot identify exactly one post, verification fails without submitting again.

Default selectors live in `src/verification/browser.ts`. Override an account's `observer.root`, `author`, `text`, `title`, `images`, or `video` when its platform markup differs. `observer.open` is an ordered array of selectors to click on the post page (for example expanding a caption or opening owner settings). `nextImage` advances a carousel that mounts only one photo at a time. Such carousels also need a `mediaCount` probe so visiting two slides cannot hide a third, unwanted slide.

For Telegram albums, the root must contain the complete album associated with its first message ID. `observer.mediaItems` can select the ordered photo wrappers and video elements when combining `images` and `video` selectors is insufficient. Each video must be a playable `<video>` element. Configure `observer.open` to expose the media if necessary; a preview containing only the first attachment must fail verification.

Additional settings must have an **independent platform-side observation**, not a copy of SimplePost's saved options. Configure `observer.fields` by semantic field name. For example, if an owner setting is represented by a selected radio item, a probe can read its actual text:

```json
{
  "privacyLevel": {
    "selector": "[role=menuitemradio][aria-checked=true]",
    "scope": "page",
    "values": {
      "PUBLIC_TO_EVERYONE": "Everyone",
      "SELF_ONLY": "Only me"
    }
  }
}
```

This is probe syntax, not a claim that every platform uses that selector. A text probe uses exact text; `attribute` compares a DOM attribute; `count: true` compares the number of matching elements. `values` maps semantic values to the platform's displayed values. `scope` defaults to the post; use `page` for a settings popover rendered outside it. For music, an observed track indicator can map `true` to `1` and `false` to `0` with a count probe, if that platform's UI actually distinguishes those states. Never equate a sent `autoAddMusic` flag with observed music.

YouTube uses independent owner readback through the Scheduler endpoint discovered during setup. Setup calls `/api/v1/accounts/{id}/youtube/library` and stores the actual channel ID returned by YouTube. Playlist publishing is currently paused in the e2e catalog because it needs unapproved OAuth scopes; the `youtube.playlist` scenario remains classified in coverage and is reported as explicitly unsupported with that reason. Other verification calls `/api/v1/accounts/{id}/youtube/videos/{videoId}` and checks channel ownership, title/description, privacy, made-for-kids, tags, category, and custom-thumbnail image content. It still visits the YouTube post in the browser. `observer.youtubeAccessTokenEnv` remains an optional fallback for direct Google Data API readback; the runner never extracts encrypted scheduler credentials.

Private YouTube videos require owner Google API proof of the exact receipt ID, discovered channel, title, description, privacy and every requested setting, plus the original fixture byte count, source duration (within 100 ms), 720×1280 source dimensions, exactly one video stream, and successful processing. Processed content duration must also match, allowing up to one second of padding (the live API reports `PT5S` for the 4000 ms source). The isolated browser must visit that exact video and display YouTube's private-video notice. Observation artifacts label this `private-view/ownerAPI` with `publicVisualProof: false` and the actual owner media data. Public and unlisted videos still require the browser's content and playable-frame checks. Missing owner data or an unsupported setting fails; private proof never substitutes for requested public visibility.

LinkedIn `PUBLIC` visibility can be proven by a fresh unauthenticated browser visiting the exact receipt permalink and verifying the marker, full content/media, the exact configured `/in/` profile URL, and author name against the connected account's display name. All LinkedIn observations require that exact profile URL; a matching display name cannot override a wrong profile link. Artifacts label this `unauthenticated-public-view`; they do not claim an observed visibility icon. `CONNECTIONS` still requires an owner visibility observation. UI YouTube thumbnail uploads retain the original scenario definition; their generated upload URLs are checked by SHA256 against the fixture both before submission and on saved-post readback.

Initial composer navigation retries HTTP 502/503 at most twice, with 1s/2s backoff. A 200 response stuck on the exact empty `Loading...` shell can be reloaded once before any form action; other missing-field errors fail. Scheduler API GET reads retry only 502/503/504 with the same three-attempt bound. Mutations and unknown submission outcomes are never retried.

TikTok inbox delivery is not publication. Inbox cases require `inbox-verification`, an `observer.inboxUrl`, and a `lifecycle` observation. If the relevant inbox/editing UI is available only in the mobile app, those cases remain blocked/manual; Playwright does not automate native mobile apps. Similarly, unavailable privacy/disclosure/thumbnail observations are incomplete coverage rather than green tests.

TikTok's UI now exposes **No description** for an explicitly empty description override while retaining a nonempty main message. The harness uses that control and checks the outgoing payload. Current MCP omitted music defaults to on while other interfaces default to off; the catalog records that difference explicitly. Tests use explicit privacy for ordinary live cases and do not change production defaults.

## Run a bounded batch

Select a platform with `--platform`. This filters test selection and preflight checks; other platforms do not need to be configured. Without this option, the configured platforms are selected. For all Telegram scenarios:

```sh
yarn e2e:plan --platform telegram --all
yarn e2e:live --platform telegram --all
```

The live command enables real posting and automatically generates and prints a unique run ID. No environment variables are needed. Omitting `--all` defaults to smoke tests. The default automatic budget covers the selected scenarios. Explicit numeric limits, account limits, verification requirements, and the stop-on-first-failure rule still apply. Use `--list` to list tests without account access, or `--headed` to show the browser.

Setup saves defaults for the interfaces you authenticated. Explicitly select interfaces as needed; add `cli-local` once local platform credentials exist:

```sh
yarn e2e:live --platform tiktok --profile regression --interface mcp,cli-app,cli-local,ui
```

Profiles are `smoke`, `full`, `regression`, `lifecycle`, and `negative`; `--all` is shorthand for `--profile full`. `--scenario` filters by scenario ID substring. `--platform` and `--interface` accept comma-separated names or repeated flags. `--config` selects another test configuration. `yarn e2e:live --help` and `yarn e2e:plan --help` list the options. Existing `E2E_*` variables remain supported; command-line options override matching variables. Missing accounts, expired sessions, permission gaps, and unmet field verifiers fail visibly. Unsupported interface combinations appear separately in the coverage matrix.

For example, preview just the Telegram mixed-album cases:

```sh
yarn e2e:plan --platform telegram --profile regression --scenario album-mixed
```

Use the same selection with `yarn e2e:live` after setup to publish and verify them. Budgets count each Telegram album attachment as a separate external message, including the 10-item boundary case.

`maxPosts` defaults to `"auto"`, which budgets for the selected supported cases, including every Telegram album attachment and thread segment. Resuming retains previous reservations and does not count them twice. Set a positive number for a fixed run limit; a selection that cannot fit fails before posting. Startup output shows the calculated budget and any missing scenario setup. `perPlatformBudget` counts conservative 24-hour usage across run IDs in the same `runDir`. A rejected CLI request is still budgeted as a possible post: a regression might unexpectedly publish it. TikTok limits can be lower than configured budgets and are shared with other clients. Respect platform quota responses and resume on a later day; do not multiply accounts to bypass a limit.

Scheduling cases create posts through MCP or UI, retain and inspect saved options, edit/reload drafts, and wait for the **real dispatcher**. They never force production dispatch, change clocks, or edit production databases. New schedules default to 1–2 minutes ahead (`scheduleDelayMinutes: 1`), chosen after uploads and draft preparation finish. Actual dispatch and platform verification can take additional time. The CLI currently only exposes immediate posting, so scheduling cases are explicitly unsupported there.

## Resume, evidence, and cleanup

Each `yarn e2e:live` invocation takes a private snapshot of the configuration for all workers and reporters. Configuration edits apply on the next invocation, including when resuming the same run ID.

Each mutation has a durable journal entry before submission. Playwright runs one worker with **zero retries** and stops the batch on its first failure. To resume, repeat the same selection with `--run-id ID` using the ID printed by the original run. This continues verification of accepted receipts or finishes unstarted cases. Starting without that ID creates a new run and can publish additional posts. A changed scenario/account/deployment cannot silently reuse an old receipt. An interrupted submission with no receipt is marked ambiguous and is never automatically resubmitted.

For an interrupted positive submission with no receipt, recovery reads the complete published history in pages of 100, capped at 20 pages. It filters by the journal creation time and exact account, caption, media count, and successful account result, then checks saved options before recording a unique match. Invalid pagination, changing counts, duplicate matches, or an incomplete scan fail without recovering or resubmitting. Expected-error scenarios cannot recover a published receipt this way.

To perform read-only verification of recorded receipts:

```sh
yarn e2e:live --platform telegram --all --verify-only --run-id YOUR_PREVIOUS_RUN_ID
```

This mode does not create posts or transition saved drafts. It rechecks successful published receipts even if they were previously verified, so corrected observers can audit earlier passes. Ordinary resume still skips verified cases. Reconcile any ambiguous attempt on the social platform and in the scheduler before using a new run ID. A crashed process leaves `.local/runs/.live.lock`; only remove that lock after verifying no runner remains and reviewing pending submissions. Do not erase journals to reset quota accounting.

Open the latest HTML report from the repository root with `yarn e2e:report`.

Artifacts are scoped to each run under `.local/runs/RUN_ID/`, including `test-results/`, `html/`, `results.json`, `{coverage,report,cleanup,run}.json`, per-scenario receipts, sanitized CLI output, and platform screenshots. `aggregate.json` at the run root is journal-first across every run ID and records both the latest status and whether a scenario-interface has ever been verified. Open a specific report with `yarn e2e:report --run-id RUN_ID`. `report.json` shows the selected denominator, verified cases, unsupported combinations, and incomplete cases. The cleanup ledger lists exact run-owned posts and pending schedules. It is written even on failure; do not delete unrelated posts by searching for a caption marker.

Cancel tests remove only the scheduled/draft post they created through the same customer interface. Other external posts remain for review and manual deletion. The runner deliberately does not assume that deleting a SimplePost record deletes the social post. Media uploaded during an interrupted setup may also require storage lifecycle cleanup. Artifacts may contain private test content; keep them private. Keep browser authentication state, OAuth tokens, and CLI secret stores separate from any reports you share. Traces are off because they can expose session credentials.

Run the suite locally using the commands above. Keep `runDir` on persistent local storage so receipts, posting budgets, and recovery history survive interrupted runs.
