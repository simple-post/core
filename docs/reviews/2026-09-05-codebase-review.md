# SDK and scheduler code review — 2026-09-05

## Scope and method

Reviewed the SDK and scheduler in `simple-post/core`, starting at
`fad2764` on `main`. The completed fix branch was rebased onto `2b2ccca`
(the latest main at the start of implementation). Upstream TikTok and error
sanitization changes are retained.
Focus areas: the public publishing entry points,
publisher initialization, media preparation and validation, scheduled dispatch,
API/MCP post mutations, account-result persistence, storage cleanup, authentication,
quota checks, and the existing tests and CI configuration. The HTTP server and CLI
were checked where they consume shared SDK behavior; they were not independently
audited. `core2/` was excluded.

This is a source review with local regression tests, not a production penetration
test or a complete provider-API compatibility audit. External publishing, billing,
and production database operations were not exercised. Findings below name the
functions containing the evidence so they remain useful after line numbers change.

P1 means a substantial publishing or data-integrity problem; P2 means a narrower
correctness, operational, or maintenance issue. “Fixed” refers to this review's PR.
All numbered findings below are addressed; operational limits are explicit.

## Findings at a glance

| ID  | Priority | Finding                                                                              | Disposition |
| --- | -------- | ------------------------------------------------------------------------------------ | ----------- |
| C01 | P1       | SDK initialization failure aborts the entire multi-platform call                     | Fixed       |
| C02 | P1       | One account's media failure can interrupt other publishers and trigger early cleanup | Fixed       |
| C03 | P1       | Dispatch, edits, and deletion race on stale post snapshots                           | Fixed       |
| C04 | P2       | Stale recovery can report failure for a post another run completed                   | Fixed       |
| C05 | P2       | Overdue scheduled posts disappear from the scheduled-post list                       | Fixed       |
| C06 | P2       | OAuth regression test reaches an unmocked database dependency                        | Fixed       |
| C07 | P1       | Deleting a post can delete media still referenced by another post                    | Fixed       |
| C08 | P2       | Dispatch rate budgets count posts instead of actual platform operations              | Fixed       |
| C09 | P1       | Crash recovery and thread retries can duplicate already published content            | Fixed       |
| C10 | P2       | Concurrent draft promotion can overconsume the final quota slot                      | Fixed       |
| C11 | P2       | JSON sanitization does not handle cycles despite its documented contract             | Fixed       |
| C12 | P2       | Pinterest option overrides discard an environment-provided board ID                  | Fixed       |
| C13 | P2       | Some SDK token-refresh calls have no request timeout                                 | Fixed       |

## Fixed findings

### C01 — SDK initialization failures lose multi-platform outcomes

**Evidence:** `sdk/src/index.ts`, `post`, `repost`, and `quote`; constructors in
`sdk/src/publishers/x/index.ts` and the other publisher modules.

The entry points construct each publisher before entering the publisher's own
error-handling method. Constructors throw `PostError` for missing credentials.
For a request targeting Telegram, X, and Bluesky, a successful Telegram publish
followed by missing X credentials rejects the entire call. The caller never gets
Telegram's success result, and Bluesky is never attempted. Retrying the whole
request can duplicate the Telegram post.

**Change:** Wrap construction and invocation in a per-platform error boundary.
Return the original structured `PostError` code/message/details for the failed
platform, preserve previous results, and continue through remaining platforms.
Unexpected errors become `OTHER`. This applies to posts, reposts, native quotes,
and the ordinary-post fallback for quotes.

**Regression coverage:** `sdk/tests/PublishingApi.test.ts` tests failures both
during construction and during invocation, preserves successful destinations
before and after the failure, and checks unexpected errors.

**Compatibility:** These top-level APIs now resolve to a result map for
initialization failures rather than rejecting. Callers should inspect each
platform's `error`, consistent with normal publishing failures. Direct publisher
constructors retain their existing throwing behavior.

### C02 — Media preparation failures escape the account result boundary

**Evidence:** `scheduler/lib/posting/index.ts`, `postSegmentsToAccount` and
`postToAccountsInternal`.

The scheduler starts multiple accounts with `Promise.all` and cleans up their
shared `MediaResolver` in `finally`. Media resolution and credential loading
previously occurred outside the segment-level error boundary. If one account's
download rejects while another is still uploading, `Promise.all` rejects early
and cleanup runs while the other account still needs its files. The whole batch
can fail without retaining successful account outcomes. A later reply's media
failure also discards the already-published root from the returned result.

**Change:** Convert preparation/credential exceptions into failed account or
thread-segment results. Keep prior segment IDs, mark subsequent segments skipped,
and let the other accounts finish before shared cleanup.

**Regression coverage:** `scheduler/tests/lib/posting/batch-failures.test.ts`
holds one publisher open while another account fails, verifies cleanup has not
run, then completes publishing and checks both outcomes. A second test publishes
a root, fails the reply's media preparation, and verifies that the root ID and
individual segment outcomes survive.

This retains outcomes within a running process. It does not provide durable
progress across process termination; see C09.

### C03 — Post claims, edits, and deletion use stale snapshots

**Evidence:** `scheduler/lib/posting/scheduled-dispatcher.ts`, `claimPosts` and
`claimReposts`; `scheduler/lib/db/index.ts`, `updatePost` and `deletePost`;
`scheduler/app/api/v1/posts/[id]/route.ts`; `scheduler/lib/mcp/tools/posts.ts`.

Three concrete interleavings were possible:

1. The dispatcher selects a due post. The user edits the message or moves its
   schedule into the future. The dispatcher's status-only update still succeeds
   because the post remains `scheduled`, and it publishes the old content/time.
2. An API/MCP edit reads an editable post and performs asynchronous validation.
   The dispatcher claims it in the meantime. The unconditional edit overwrites
   that claim, potentially returning it to the scheduled queue while the original
   publisher is still running.
3. API deletion removes uploaded media before attempting the database deletion,
   and the database operation does not exclude a pending publish or repost.

**Change:** Claims match the selected `updatedAt` and scheduled time as well as
status. Automatic repost claims also require `published` status. API/MCP edits
pass the read snapshot's status and timestamp into the atomic Prisma update.
Conflicts produce a reload-and-retry error (`409` through the HTTP error handler).
Deletes match the snapshot timestamp, exclude pending publishes/reposts, and
complete before any file deletion starts. MCP discard uses the same guard.

**Regression coverage:** Dispatcher tests simulate edits/rescheduling between
selection and claim. `scheduler/tests/lib/db/posts.test.ts` verifies ownership,
version/status predicates, conflict conversion, and the unchanged-snapshot path.

**Version protection:** A PostgreSQL trigger makes `updatedAt` strictly advance
by at least one millisecond for every update, including direct dispatcher writes.
This closes the same-millisecond hole without changing the API snapshot format.
A real PostgreSQL test forces an identical timestamp and verifies a stale edit
cannot overwrite the intervening change. This remains optimistic concurrency
control; publishing durability is handled separately in C09.

### C04 — Stale recovery emits events for rows it did not change

**Evidence:** `scheduler/lib/posting/scheduled-dispatcher.ts`,
`recoverStalePendingPosts` and `recoverStalePendingReposts`.

Recovery first selects old pending rows, then mutates by ID/status without
rechecking the cutoff. It dispatches failure webhooks for every selected post,
even when the update no longer matches because another run published or recovered
it. A refreshed pending row can also be failed using an obsolete selection.

**Change:** Recheck `updatedAt < cutoff` at mutation time. For posts, perform
conditional per-row recovery and send a failure webhook only when that row was
actually changed. Repost recovery also rechecks the cutoff.

**Regression coverage:** Dispatcher tests cover mixed recovered/completed rows,
webhook cardinality, and a repost that no longer matches the stale condition.

**Limit:** The webhook is still not transactional with the database update. A
crash between those steps can lose the event. A transactional outbox remains an
appropriate reliability improvement.

### C05 — The scheduled list hides a delayed queue

**Evidence:** `scheduler/lib/db/index.ts`, `getScheduledPosts`.

The query requires `status = scheduled` and `scheduledFor > now`. When dispatch is
late, rate-limited, or a provider is disabled, the post stays scheduled but its
timestamp moves into the past. It disappears from the scheduled list, while the
status-count endpoint still counts it as scheduled. Operators lose visibility
precisely when they need to inspect the backlog.

**Change:** List all scheduled posts, still ordered by scheduled time and
paginated. Use the same predicate for the data query and count.

**Regression coverage:** `scheduler/tests/lib/db/posts.test.ts` includes an
overdue scheduled row and verifies the shared list/count predicate.

### C06 — An OAuth unit test unexpectedly calls the database

**Evidence:** `scheduler/tests/app/mcp-oauth-authorize-route.test.ts` and
`scheduler/app/api/oauth/authorize/route.ts`.

The route initializes a trial with `ensureTrialStarted`, but the existing test
only mocks the subscription gate and OAuth helpers. The baseline suite returned
500 instead of the expected 200 in the null-nonce test: **344 passed, 1 failed**.

**Change:** Mock trial initialization and assert the authenticated user is passed
to it. Production OAuth behavior is unchanged. Trial-helper behavior continues
to have its own dedicated tests.

## Additional findings fixed in the completed PR

### C07 — Shared media can be deleted while another post still needs it

**Evidence/reproduction:** Duplicating a post reuses its storage URLs. The old
`deleteStorageUrl` deleted those objects as soon as the original post was deleted.
References in thread JSON, account overrides and option thumbnails were invisible
to root-media-only cleanup. A concurrent save could also race a reference check.

**Fix:** `storage-lifecycle.ts` tracks deletion candidates by canonical owned
storage key, with a 24-hour grace period. `PostsModel` queues the complete old
content transactionally on edits and deletes, including nested JSON media.
Collection runs during scheduled dispatch, scans all of the user's remaining
post media/options/overrides/threads, and retains any reachable object. Both saves
and collection lock the user's database row. Collection commits a `deleting`
tombstone before external deletion; a racing save rejects the unavailable media.
Successful deletions retain tombstones. Interrupted deletions are retried.
Legacy cleanup callers now queue candidates instead of deleting synchronously.

**Coverage:** Real PostgreSQL tests duplicate root, thread, override-thread and
thumbnail references, delete the original, and verify no storage deletion. They
then remove the last reference, pause deletion, and verify a concurrent duplicate
is rejected before saving a broken URL. Provider storage calls are mocked.

**Limits:** Collection requires dispatch to run. Objects removed from posts are
retained for at least 24 hours; objects never attached to a saved post are not
inventoried by this migration. Reachability currently scans each user's saved
content. A normalized reference index can optimize large accounts later without
changing the locking/tombstone protocol. Previously deleted media is not restored.

### C08 — Rate budgeting undercounts actual publishing operations

**Evidence:** Counting recent post rows treated two accounts on one platform as
one operation, ignored per-account thread overrides, and allowed separate workers
to reserve the same remaining capacity. Failed attempts did not count.

**Fix:** `durable-publish.ts` commits a `PublishAttempt` for each account/segment
or repost immediately before SDK publishing. A PostgreSQL advisory lock keyed by
normalized platform serializes the sliding-window count and reservation across
API, MCP and scheduler processes. Database time defines the authoritative window.
X and Twitter share one budget. Existing conservative limits remain 15 operations
per minute per platform, or 10 for Forem. Failed requests consume capacity;
reused successes and media-preparation failures do not. History is retained for a
day and has indexes for collection and per-run summaries.

Dispatch selection now counts each remaining account's effective thread and
subtracts successful checkpoints. This is only a scheduling estimate: the shared
reservation is authoritative. Long threads can advance across windows. Local
capacity exhaustion reschedules automatic posts/reposts for the next minute,
retaining successful segments. `platformSummary.sent` counts actual reserved
attempts for the claimed posts, not selected rows or estimated thread cost.

**Coverage:** 24 concurrent operations across different accounts and both X
aliases produce exactly 15 SDK calls and nine local-limit responses against a
real PostgreSQL database. Separate tests cover checkpoint replay without charging
again. Dispatcher tests cover account overrides and partial progress.

**Limits:** These are application safety limits, not a complete model of every
provider's changing account/app/endpoint quotas. Provider API errors are retained
and treated conservatively by C09; arbitrary provider errors are not automatically
replayed and no unsupported Retry-After guarantee is implied.

### C09 — Crashes and partial thread retries can duplicate published content

**Evidence/reproduction:** The old pipeline saved aggregate results after the
batch. A worker could disappear after provider acceptance but before persistence.
The retry form created a new post, so even saved partial threads restarted roots.

**Fix:** A durable checkpoint identifies each post/account/operation/segment.
Intent is committed before publishing; results are saved immediately afterward.
Success stores only sanitized result data and necessary provider chain metadata,
never refreshed credentials. Retries use the existing post ID and reuse successful
segments. Prefix fingerprints prevent changing already published content while
allowing correction of segments conclusively rejected before publication. X reply
IDs and Bluesky URI/CID root/parent references are rebuilt from saved results.
Successful account results survive retries targeting only failed accounts.

`started` and `unknown` results block automatic replay. Conclusive SDK content or
credential failures and failures before media preparation completes remain
retryable. Transport and generic API errors may follow provider acceptance and
therefore require checking the provider. Older failed posts without a durable
record cannot be blindly replayed: inspect the platform and explicitly duplicate
only the content still needed, except conclusively unattempted account failures.

**Reconciliation:** Authenticated `GET /api/v1/posts/{id}/reconcile` exposes the
owned post's checkpoint states and versions. After verifying the provider and
ensuring the old worker has stopped, `POST` to the same endpoint with
`accountId`, `operation`, `segment`, the returned `updatedAt`, `confirmed: true`,
and `outcome: "published"` or `"not_published"`. Published outcomes also require
`platformPostId`; Bluesky requires `bluesky: { uri, cid }`. An optional `postUrl`
can be supplied. The endpoint rejects other users' posts, pending operations and
stale confirmations. Retry the existing post afterward; reconciliation itself
sends nothing to a social platform. The endpoint is documented in OpenAPI.

**Coverage:** PostgreSQL tests pause a live publish and race another attempt,
reuse a persisted result, simulate lost responses, change fingerprints, correct
preparation failures, and reconcile with ownership/status/version guards. Full
X and Bluesky pipeline tests fail a reply then resume it without republishing
the root, checking the actual SDK reply options.

**Limits:** This provides durable progress and safe handling of ambiguity, not
exactly-once external delivery. Provider acceptance and the database commit are
not a distributed transaction. Human confirmation must reflect a real provider
check; do not mark an operation unpublished while an old worker may still run.
Explicit duplication intentionally creates independent publishing work.

### C10 — Concurrent draft promotion bypasses serialized quota checks

**Evidence:** HTTP PATCH and MCP `updateScheduledPost` checked allowance before
the update transaction. Two drafts could both observe the final trial slot and
then both become scheduled, while creation already used `lockUserForQuota`.

**Fix:** Both update paths now acquire the same user lock, evaluate quota through
the transaction client, and perform the snapshot-guarded post update before that
transaction commits. Credential/provider validation remains outside the lock.
Already charged failed posts retain their account allowance when retried.

**Coverage:** The disposable PostgreSQL suite creates nine charged X posts and
two drafts on a ten-post trial. Concurrent promotion attempts yield exactly one
scheduled post and one rejected attempt; the other remains draft. Existing MCP
regressions verify the update receives the transaction client.

### C11 — Circular and unusual error values break JSON serialization

**Evidence:** Original recursion overflowed on cycles, lost Dates and returned
unserializable bigints. The latest main already supplied ancestor tracking,
credential redaction, bounded depth and Date/bigint conversion.

**Fix:** Preserve that upstream fix and additionally normalize non-finite numbers
to JSON null before Prisma storage. Existing tests cover Axios credential fields,
cycles, shared noncyclic references, Date and bigint; a new regression covers
NaN and infinity. Arbitrary provider `toJSON` functions are never invoked.

### C12 — Pinterest option overrides discard the environment board

**Evidence:** A title-only override retained environment credentials but lost
`PINTEREST_BOARD_ID`, causing the required-board check to fail.

**Fix:** Merge each platform's environment defaults before user options. Explicit
platform values override defaults, and supplied credential objects still replace
environment credentials rather than mixing accounts. Pinterest's input schema
allows omitting the board so environment configuration can supply it; its publisher
still validates the final merged board before posting.

**Coverage:** Tests retain the environment board for a title-only override and
verify explicit board/credential replacement without mutating defaults.

### C13 — Static requests and media processing can wait indefinitely

**Evidence:** Configured Axios client timeouts do not apply to static requests.
The audit found unbounded Instagram/Threads refresh, X user lookup/refresh/repost,
Bluesky refresh, LinkedIn repost/uploads and Pinterest uploads. Instagram container
processing could also loop forever despite per-request deadlines.

**Fix:** Short static API calls have 30-second deadlines; whole-file LinkedIn and
Pinterest uploads allow ten minutes. Existing bounded download/chunk calls retain
their own deadlines. Instagram container polling has a ten-minute elapsed-time
limit (an in-flight request is still governed by its request timeout).

**Coverage:** Publisher tests assert refresh/lookup deadlines, verify Instagram
refresh failure stops before publishing, and advance a fake clock while an
Instagram container never finishes to verify polling terminates.

## Deployment and validation

Two additive migrations create publishing attempts/checkpoints, storage deletion
markers and supporting indexes, and enforce monotonic post timestamps. The Docker
runtime now includes the Prisma schema/migrations and runs `prisma migrate deploy`
before Next starts. A migration failure exits startup; it cannot silently serve
code against an older schema. Non-container deployments must run the same migration
command before starting the scheduler. No destructive data migration is required.

CI now provisions PostgreSQL 17, applies the full migration history, and runs the
same integration suite as local verification. Tests mock external publishing,
credential refresh and object deletion; they send no real social posts. Type,
lint, formatting, SDK/scheduler/CLI tests and a production build are checked before
merge. Local verification passed: SDK 364 tests, scheduler 421, CLI 46, PostgreSQL
integration 14 (845 total); `yarn check`, SDK distribution build and the scheduler
production webpack build also passed. Deployment outcome is recorded in the PR.

Operational limits remain: webhook delivery is not backed by a transactional
outbox; external outcomes can require reconciliation; legacy missing media cannot
be recovered; and storage candidates need the scheduled dispatcher to collect
them. These are stated explicitly rather than treating mocks as proof of external
provider behavior. `core2/` is untouched.
