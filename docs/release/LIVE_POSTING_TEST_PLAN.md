# Live posting integration test plan

Status: proposal only; no test infrastructure or product changes implemented.
Reviewed: 2026-09-05, Core 2 commit `2b2ccca`.

Build an on-demand acceptance suite that publishes controlled content to real social accounts through the actual MCP transport, CLI executable, and scheduler UI, then verifies the outcome on each platform. Keep the existing Jest tests. Use them for exhaustive validation and simulated failures; use live tests to prove that the complete integration works.

## Findings from Core 2

| Finding | Evidence and consequence |
| --- | --- |
| Eleven publishers share the SDK. | [`sdk/src/types/post.ts`](../../sdk/src/types/post.ts) and `sdk/src/publishers/`: X, Telegram, Instagram, Facebook, Threads, TikTok, YouTube, Pinterest, LinkedIn, Bluesky, DEV/Forem. |
| Existing coverage is substantial but primarily mocked. | TikTok publisher tests mock Axios; MCP option tests mock persistence, validation, and posting. CLI command tests launch a real process for help/status, but there is no live posting suite or Playwright configuration in the reviewed tree. |
| There are four execution paths to test. | MCP has its own create/update handlers; UI and app-connected CLI use scheduler HTTP routes; local CLI calls the SDK directly. [`cli/src/lib/post/run.ts`](../../cli/src/lib/post/run.ts) shows both CLI branches. Testing one does not test the other. |
| TikTok defaults differ across interfaces. | [`resolveMcpAccountOptions`](../../scheduler/lib/mcp/tools/account-options.ts) supplies public privacy and recommended photo music when omitted. The UI requires a privacy choice and displays music off by default; SDK Direct Post requires a privacy choice and uses music only when explicitly true. |
| Empty descriptions differ from omitted descriptions. | SDK [`getTikTokPostText`](../../sdk/src/publishers/tiktok/validation.ts) preserves an explicit empty description using nullish fallback. The UI clears a description to `undefined`, and [`mergeAccountOptions`](../../scheduler/features/platform-options/merge-account-options.ts) removes empty strings. With a nonempty main message, clearing the override restores that message. Decide whether an explicitly blank caption must be expressible in the UI. |
| Scheduling is a separate persistence and dispatch path. | [`scheduled-dispatcher.ts`](../../scheduler/lib/posting/scheduled-dispatcher.ts) loads saved options, claims due posts, manages budgets, and calls the posting service. Saving a scheduled post is insufficient evidence that dispatch preserves its options. |
| A success flag is insufficient publication evidence. | TikTok video posting can return `NO_ERROR` with its publishing job ID when polling yields no public post ID. TikTok inbox upload is also a successful operation but is not publication. These outcomes require distinct assertions. |
| Account-level settings can be lost between schemas. | SDK options use platform keys; scheduler/MCP options use account IDs. Threads, per-account content overrides, and option availability also differ by interface. Build an explicit capability map instead of assuming identical features everywhere. |
| CLI release artifacts need separate attention. | The CLI declares an SDK semver dependency, while the scheduler uses the workspace SDK. Record the actually resolved SDK and test the built/packed candidate, plus a small installed-release smoke test when releasing packages. |

These are code observations and test targets, not a reproduction of the reported user's incident. No real accounts or production data were inspected.

## Recommended environment

Use the production SimplePost deployment, production platform application registrations, and normal storage/dispatch infrastructure, with a dedicated SimplePost test user connected to dedicated social test accounts. This exercises real OAuth permissions, verified media domains, deployed code, and the actual scheduler.

Use the normal product connection and authorization flows. Keep MCP OAuth credentials, CLI credentials, platform verifier credentials, and browser sessions in secret storage. The MCP endpoint authenticates MCP OAuth tokens; do not assume a scheduler API key is interchangeable. The test user should have normal access entitlements and traverse the normal authorization checks.

Start with one suitable account per platform. Add a second account where identity or audience variants require it: two accounts on the same platform, follower/friend relationships for privacy verification, and supported account/authentication types. Record account capabilities and scopes in a manifest containing secret references, not raw credentials. Do not share rotating refresh tokens between independent CLI and scheduler credential stores without a defined ownership strategy; serialize shared account use or use independently connected accounts.

The future runner must resolve and allowlist exact test user/account/resource IDs before publishing. It must fail if an expected account is missing, disabled, belongs to another user, or has an unexpected identity. Set a per-run post budget and serialize publishing to each account. A dry run lists the scenarios, targets, intended audiences, and estimated post count without publishing.

Production validates deployed behavior. For pre-release testing, the same suite should accept a candidate deployment with isolated application data and deliberately configured real account access. A production-only run cannot establish that undeployed changes work. Do not automatically deploy as part of the test runner.

## Harness design

Use TypeScript and Playwright Test as the coordinator. Its projects can separate interfaces and environments; API requests and browser actions can share assertions and reports. Browsers are only needed for the scheduler UI and selected platform verification. This fits [Playwright projects](https://playwright.dev/docs/test-projects) and [API testing](https://playwright.dev/docs/api-testing).

| Adapter | Exercise the real boundary | Required checks |
| --- | --- | --- |
| MCP | Official MCP client over Streamable HTTP to `/mcp`, with normal OAuth; initialize, discover tools/schema, upload/validate/preview/create/inspect/update/discard as applicable. | Check protocol errors, tool `isError`, structured output, per-account results, saved options, and final platform state. Calling imported tool functions is not MCP integration coverage. |
| CLI, app accounts | Spawn the built CLI binary using `--app-account-id` with isolated configuration. | Flags, JSON input, local uploads, authenticated scheduler calls, stdout/stderr, exit code, account identity, and actual published content. Current posting flow sends `postingMode: "now"`; do not invent CLI scheduling support. |
| CLI, local accounts | Spawn the same binary using `--account platform:alias` and dedicated local credentials. | Real SDK publishing, media staging, platform options, credential refresh/persistence, and target selection. Include one mixed local/app target case. |
| Scheduler UI | Playwright Chromium drives account selection, compose, uploads, platform controls, preview, draft, edit, post now, and schedule. | Set options through visible controls. Reload to verify persistence. Observe network responses and UI feedback without replacing the publishing action with a direct API call. |

Define a reusable scenario as: ID, platform, applicable interfaces, account capabilities, media fixture, user intent, explicit input options, expected normalized platform fields, expected lifecycle, verification method, quota cost, and cleanup strategy. Generate cases from this catalog for each supported adapter.

Expected values must be independently specified. Do not calculate expected privacy/music/text using the same production helpers being tested. For example, explicitly selecting `SELF_ONLY` must result in `SELF_ONLY`, regardless of any current default helper.

Retain existing Jest tests for deterministic checks. Add a local integration layer using the real app, database, serializers, SDK, and a controlled platform boundary where needed. This catches option propagation, exact outgoing request fields, idempotency, and failure handling without spending live posting quota. Label it separately from live coverage.

MCP protocol coverage does not establish whether ChatGPT or Claude chooses the right tool arguments from natural language. Keep a small optional conversational acceptance pack for real client behavior and widgets, with explicit test-account targeting. It should not be a dependency of deterministic posting tests.

## Coverage policy

Cover every supported feature and option value, plus known interactions and limits. Do not promise an exhaustive Cartesian product of all text, media, audiences, accounts, and timing: that is unbounded and quickly consumes platform quotas.

For each option, distinguish omitted, explicitly false/zero/empty, and explicitly set values where valid. Exercise minimum, typical, maximum, and invalid boundaries in deterministic tests; choose representative valid boundaries for live runs. Test invalid requests locally or through non-publishing validation when possible. They must produce useful errors and no post.

Require a basic live case for each supported platform/content type through each applicable interface. Run every option value live somewhere it is supported, and test its transport/persistence through every supported interface deterministically. Expand interaction coverage using pairwise combinations, with explicit full combinations for privacy regressions and other high-risk behavior. A full profile can expand these cases across all adapters in resumable batches.

Maintain a platform × feature × interface × verification matrix. Every row must be tested, deliberately unsupported, pending, or blocked with a reason. Missing accounts and unavailable permissions must never disappear as green skips. Schema changes should trigger a coverage-inventory check; an independent expected-behavior catalog prevents tests from simply accepting whatever the current schema says.

### Platform inventory to turn into scenarios

This inventory is grounded in the current SDK schemas and repository guides. Confirm each platform's current API behavior and account permissions while implementing its verifier. Features supported by a social network but absent from SimplePost are product gaps, not silently assumed test coverage.

| Platform | Main scenarios and options |
| --- | --- |
| TikTok | Single photo, ordered carousel, video; direct post and inbox upload; all creator-supported privacy choices; recommended music on/off/omitted; title/description fallbacks and empty values; cover index; comments, duet/stitch where applicable; disclosure combinations. |
| Instagram | Single image, video/Reel, image and supported mixed carousels; attachment order, captions, media processing, permalink; both supported Instagram/Facebook authentication routes where accounts are available. |
| Facebook | Text, single/multiple photos, video, captions; `publishAt` platform scheduling versus SimplePost scheduling. |
| Threads | Text, images/carousels, video and supported mixed media; captions, reply target, thread ordering, canonical links. |
| X | Text, images, video; replies, threads, supported quote/repost behavior; partial thread failures and account selection. |
| Bluesky | Text, images, video; links/facets as implemented; replies with root/parent references, threads, quote/repost; supported OAuth/app-password paths. |
| LinkedIn | Text, single/multiple images, video; public versus connections visibility and captions. |
| YouTube | Video; title, description, tags, category, playlist, thumbnail, made-for-kids, public/private/unlisted, `publishAt`; verify actual processing and metadata. |
| Pinterest | Image/video pin; board selection, title, description, link, alt text; missing/invalid board and wrong media counts. |
| Telegram | Text, image, video, albums; caption placement, HTML/Markdown/MarkdownV2, replies and threads; exact chat/channel destination. |
| DEV/Forem | Markdown article and supported media embedding; title, published/draft, tags, series, canonical URL, description, organization, instance selection. |

Across platforms include Unicode/emoji, hashtags, newlines, links, absent text, local file versus remote URL, actual bytes versus declared MIME/size, media order, duplicates, per-account content overrides, multiple accounts on the same platform, and multi-platform partial success. Include thread/reply/quote/repost only where the interface exposes it; report any mismatch explicitly.

### TikTok first: concrete scenario groups

1. Photo Direct Post: one image and a small ordered carousel; music true/false/omitted; description omitted/custom/empty; explicit allowed privacy. Verify separate title and description, hashtags, cover, order, audience, and music state.
2. Privacy propagation: each creator-supported audience through all four adapters, both photos and video. With two connected TikTok accounts, use different explicit audiences and confirm settings are not swapped. Through MCP/UI, also save, edit, reload, schedule, and dispatch with those settings.
3. Video Direct Post: with/without caption and embedded audio; explicit title override; supported comments/duet/stitch settings. Recommended photo music is not a video soundtrack selector. Invalid photo-only options must be handled consistently.
4. Inbox uploads: photos and videos, with/without descriptions, through each adapter. Expected outcome is inbox delivery; choosing a specific music track and finishing publication in TikTok is a separate manual/mobile acceptance step.
5. SimplePost drafts: save without uploading, reload, change options, and schedule. Keep SimplePost `postingMode: "draft"` distinct from TikTok `publishMode: "draft"`.
6. Boundaries: 1/35/36 photos, cover first/last/out-of-range, title 90/91 and description 4000/4001 UTF-16 units, emoji boundaries, unsupported formats, mixed image/video, absent/unsupported privacy, and incompatible disclosure/interaction settings. Use deterministic tests for the full boundary set; budget selected valid live cases.
7. Editing: reorder/remove photos, change photo to video, turn music off after on, change audience, clear title/description, duplicate a draft, and switch accounts. Verify both controls and persisted values.

The current MCP public-default behavior requires a product decision before becoming a passing contract. TikTok's current guidance specifies explicit audience selection with no default, and choices derived from creator info. Recommend explicit privacy selection across all interfaces; track the current mismatch as a known issue instead of blessing it in golden tests. See [TikTok sharing guidelines](https://developers.tiktok.com/docs/en/content-sharing-guidelines).

## Proving the result on the platform

Each live case must collect three levels of evidence:

1. **Requested:** exact scenario input, selected account, expected audience/options, media hashes and order, and build versions.
2. **Accepted by SimplePost:** transport result, persisted settings where applicable, per-account/segment outcome, publishing job handle, and correlation IDs. When available, attach narrowly scoped, redacted server diagnostics showing normalized outgoing fields. Do not add credential dumps or whole-account logging.
3. **Observed on the platform:** use independent read APIs when they expose the required fields, otherwise a logged-in platform browser view. Confirm target account, text, media, audience, and relevant settings. Public visibility can additionally use a separate viewer session; restricted audiences need suitable viewer relationships. A missing public permalink alone does not prove a private post failed.

Write platform-specific verifier contracts before implementing each platform's cases: what can be read, which scopes/accounts are needed, what requires owner UI/manual inspection, and how deletion works. Verification must not merely read back SimplePost's submitted JSON. For music, test whether recommended music was applied, not a particular song chosen by TikTok.

TikTok distinguishes processing, inbox delivery, and completed publication; public post IDs may be absent for restricted visibility or moderation. Its [status API](https://developers.tiktok.com/doc/content-posting-api-reference-get-video-status) does not by itself prove all requested metadata or music settings. Preserve publishing handles even when a public ID is returned; if the current response loses information needed by a verifier, record a minimal observability/API prerequisite for later implementation.

Use bounded polling with separate deadlines for upload, processing, publication, and verification. Timeout after possible acceptance means **inconclusive**, not permission to publish again. Do not treat an internal job ID as a public post ID. Mark each assertion as automated or manually verified; absence of an available verifier is **needs verification**, never full success.

## Scheduling and failure cases

Create scheduled posts through MCP and the real UI, inspect saved values, reload/edit them, and let the actual production dispatcher run. Verify no publication before the due time, eventual publication within an agreed dispatch/processing allowance, correct account/options/media, and no duplicate publication over subsequent dispatch cycles.

Include canceled posts, rescheduling, draft-to-scheduled conversion, per-account overrides, media URLs remaining accessible until execution, timezone display/UTC storage, and platform-native scheduling versus SimplePost scheduling. Use local integration tests for DST boundaries, concurrent dispatch claims, crashes, partial failures, credential expiration, retries, and platform throttling. Do not manipulate production clocks, inject faults into customer traffic, or manually force a global dispatch just for a test.

Exercise a small live reconnect/refresh scenario with designated accounts. Keep routine content tests independent of interactive OAuth login: bootstrap through supported flows, reuse protected sessions, and report expired authorization as an actionable preflight failure. Browser session storage follows [Playwright authentication guidance](https://playwright.dev/docs/auth).

## Run control, reporting, and cleanup

Run the live suite manually on a local machine. Neither default `yarn test` nor normal PR CI should publish to real platforms. Keep credentials and a persistent run journal locally, with one active live run per account set.

The local runner provides `smoke`, `regression`, `lifecycle`, `negative`, and `full` profiles, with platform/interface/scenario filters, posting budgets, and run IDs for recovery. See the [local setup and run instructions](../../e2e/README.md) for the implemented commands and current coverage.

Before publishing, render the execution matrix and quota estimate. TikTok documents a creator posting cap that is typically around 15 posts per day, shared across API clients; the actual allowance varies. Even a small four-interface matrix can exceed it. Use configurable conservative budgets, platform responses, and persisted run history; defer remaining cases instead of repeatedly probing or using accounts to circumvent limits. See [TikTok posting caps](https://developers.tiktok.com/docs/en/content-sharing-guidelines).

Disable automatic whole-test retries for live publish cases. Store a durable run journal before each mutation and immediately after receiving a result. MCP exposes an idempotency key; reuse it for a known logical request. The app CLI currently generates a new UUID for each invocation, and local posting has no universal cross-platform idempotency guarantee. Therefore never blindly rerun either CLI after ambiguous submission. Resume verification of known posts and reconcile unresolved attempts first.

Report HTML plus machine-readable results: scenario/interface/platform, deployment revision, CLI and resolved SDK versions, sanitized request/options, timestamps, expected versus observed fields, SimplePost and platform IDs, screenshots/traces when relevant, and cleanup state. Protect traces and attachments because they can contain credentials and private content. Record trace evidence on the original attempt rather than relying on a retry to collect it.

Use statuses **passed**, **failed**, **blocked**, **inconclusive**, **needs manual verification**, and **unsupported**. A report with required blocked or unverified cases is incomplete, even if every executed assertion passed. Show coverage denominator and remaining work, not only a pass percentage.

Use original media fixtures with known hashes, formats, sizes, and recognizable order. Keep fixture source URLs valid through processing. Track run identity separately from caption text so empty-caption tests remain genuinely empty. Keep a durable ledger of only test-created resources.

Cleanup runs after verification: delete only exact run-owned post IDs when the platform supports deletion; cancel remaining test schedules; remove uploaded fixtures only after consumers finish. Deleting a SimplePost record is not evidence that the external post was deleted. Where APIs cannot delete or verify the content, produce an owner review/cleanup queue with links or job IDs. Preserve failed-case evidence before cleanup and support recovery after an interrupted runner. Avoid bulk deletion by text search or account-wide sweeps.

## Implementation sequence and acceptance criteria

| Phase | Deliverable | Done when |
| --- | --- | --- |
| 1. Contracts and account setup | Capability matrix, desired defaults/empty-field semantics, fixtures, account manifest, verifier/read/delete feasibility, deployment/version strategy. | Every platform and interface has an explicit coverage/verification status; TikTok privacy behavior is agreed; account bootstrap is documented. |
| 2. Harness and one vertical case | Playwright coordinator, four adapters, preflight, durable journal, report, manual trigger. | One TikTok photo case with explicit privacy/music/description runs through all four paths and has platform evidence, with no blind retry or credential leakage. |
| 3. TikTok regression suite | Photo/video, privacy/music/text permutations, inbox versus draft, option editing, actual scheduling, deterministic boundary coverage. | Requested settings survive every supported path; silent fallback and ambiguous-success cases are detected; manual-only verification is visible. |
| 4. All-platform coverage | At least one real case for each supported content type/platform/interface, then platform options and valid interactions. | The matrix accounts for all eleven platforms; every untested/unsupported feature has a recorded reason; cases can resume across quota windows. |
| 5. Operational regression coverage | Multi-account/platform outcomes, threads/quotes/reposts, identity, refresh, media lifetime, scheduling/duplicate prevention, installed package smoke. | A maintainer can choose a change-relevant profile, run it, understand failures, and finish cleanup without reading test internals. |

Each production incident should add a named regression scenario and a deterministic test at the failing boundary. The live suite should verify the fix against the platform and retain that coverage for later substantial releases.

The immediate next step after agreeing on this proposal is Phase 1: choose the dedicated accounts and resolve TikTok privacy defaults and blank-caption semantics. This proposal authorizes no posting and creates no accounts, deployments, scheduled jobs, or test code.
