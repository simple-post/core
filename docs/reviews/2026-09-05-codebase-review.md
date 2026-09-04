# SDK and scheduler code review — 2026-09-05

## Scope and method

Reviewed the SDK and scheduler in `simple-post/core`, starting at
`fad2764` on `main`. The fix branch was subsequently rebased onto `d737a1d`
(the newer TikTok account-options change), with its MCP tests adapted and rerun.
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
“Follow-up” is explicitly outside its implementation.

## Findings at a glance

| ID | Priority | Finding | Disposition |
| --- | --- | --- | --- |
| C01 | P1 | SDK initialization failure aborts the entire multi-platform call | Fixed |
| C02 | P1 | One account's media failure can interrupt other publishers and trigger early cleanup | Fixed |
| C03 | P1 | Dispatch, edits, and deletion race on stale post snapshots | Fixed |
| C04 | P2 | Stale recovery can report failure for a post another run completed | Fixed |
| C05 | P2 | Overdue scheduled posts disappear from the scheduled-post list | Fixed |
| C06 | P2 | OAuth regression test reaches an unmocked database dependency | Fixed |
| C07 | P1 | Deleting a post can delete media still referenced by another post | Follow-up |
| C08 | P2 | Dispatch rate budgets count posts instead of actual platform operations | Follow-up |
| C09 | P1 | Crash recovery and thread retries can duplicate already published content | Partially mitigated; follow-up |
| C11 | P2 | JSON sanitization does not handle cycles despite its documented contract | Follow-up |
| C12 | P2 | Pinterest option overrides discard an environment-provided board ID | Follow-up |
| C13 | P2 | Some SDK token-refresh calls have no request timeout | Follow-up |

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

**Limits:** This reuses the existing timestamp and needs no migration. It is
optimistic concurrency control, not an exactly-once publishing guarantee. A
monotonic version counter and a real PostgreSQL concurrency test would strengthen
coverage, particularly for same-millisecond updates. Shared file ownership is a
separate issue (C07).

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

## Follow-up findings and recommended work

### C07 — Shared media can be deleted while another post still needs it

**Evidence:** `scheduler/components/post-form.tsx` initializes duplicate-post
media from `existingPost.media`; `scheduler/lib/utils/media-cleanup.ts` deletes
an owned storage URL without checking other references. Post API/MCP mutations
call these cleanup helpers. The upload-ownership check protects other users'
keys, but does not distinguish multiple posts belonging to the same user.

**Reproduction:** Publish a post with uploaded media, duplicate it for a future
date, then delete the original. Both posts use the same URL. Deleting the
original can remove the storage object needed by the scheduled duplicate.

**Impact:** Missing images/videos in saved posts and later publishing failures.
The deletion-order fix in C03 does not solve this cross-post ownership issue.

**Recommendation:** Introduce storage-object identity/reference tracking for root
media, thumbnails, per-account overrides, and thread media. Delete objects only
after references are removed and a delayed garbage-collection pass rechecks
reachability. Include duplicates and concurrent saves in integration tests.
Do not add a root-media-only check that leaves JSON-held references unprotected.
This needs a separate storage-lifecycle change and migration/design review.

### C08 — Rate budgeting undercounts multi-account and threaded publishing

**Evidence:** `scheduler/lib/posting/scheduled-dispatcher.ts`,
`getSentCountForPlatform` and the `costFor` calculation.

The recent-history query counts post rows, not actual account publishes or thread
segments. Within a run, platforms are deduplicated and charged once per shared
thread length. A post targeting two X accounts with three segments each costs
six platform operations, but reserves three slots. Account-specific thread
overrides are ignored. Concurrent dispatch runs also compute independent budgets.

**Impact:** Provider throttling under load; the summary's `sent` value is a
reservation estimate rather than a confirmed operation count.

**Recommendation:** Calculate cost for each remaining account's effective
segments, normalize aliases, and reserve provider/account budgets atomically
across runs. Record actual attempts and provider retry times. Add multi-account,
override, partial-retry, and concurrent-dispatch tests. Changing only the local
calculation would leave the history and cross-process problems intact.

### C09 — Partial progress is not durable and thread retries restart roots

**Evidence:** `scheduler/lib/posting/index.ts`, `postSegmentsToAccount`;
`scheduler/lib/posting/account-results.ts`; scheduler dispatch persistence;
`scheduler/components/post-form.tsx`, `getFailedRetryAccountIds`.

Account/segment results are primarily persisted after the batch completes. A
process can die after an external publish but before that success reaches the
database. Recovery labels it failed, leaving a retry unable to know what already
went live. Even when a partial thread result is saved, retry selection is by
failed account, and publishing starts with a fresh chain rather than resuming
after the last successful segment.

**Reproduction:** Publish a root successfully and fail the next reply; retry
that failed account. A new root is created. Alternatively, terminate a worker
after a provider accepts a post but before the batch result is persisted.

**Recommendation:** Persist account/segment checkpoints as work completes,
retain root/parent IDs and provider-specific chain metadata, and model ambiguous
provider outcomes explicitly. Resume known partial threads; require
reconciliation when a publish result is unknown. C01/C02 prevent avoidable loss
from ordinary exceptions but do not solve process-crash recovery.

### C11 — The JSON sanitizer recurses indefinitely on cyclic objects

**Evidence:** `scheduler/lib/utils/errors.ts`, `sanitizeForJson`.

The comment promises removal of circular references, but recursion has no
ancestor tracking. For `const details = {}; details.self = details`, calling the
helper recurses until a stack overflow. Raw provider/network error details can
contain object graphs even though ordinary request JSON cannot contain cycles.
The helper also returns `bigint` unchanged and turns `Date` into `{}`.

**Recommendation:** Define the desired JSON representation of cycles, dates,
bigints, non-finite values, and repeated non-cyclic references. Use ancestor
tracking, retain the current credential/error filtering, and test real error
shapes. Keep arbitrary raw objects out of persisted failure details.

### C12 — Pinterest defaults disappear when an option is overridden

**Evidence:** `sdk/src/utils/credentials.ts`, `getCredentialsFromEnv` and
`mergeOptions`; `sdk/src/publishers/pinterest/index.ts`, `validateOptions`.

Environment configuration supplies both Pinterest credentials and `boardId`.
When a caller supplies `options.pinterest` with only a title/description, merging
retains the environment credentials but discards the environment board. An
otherwise configured account then fails the required-board check.

**Recommendation:** Merge platform defaults before the supplied platform
options, preserving explicit override semantics. Test a title-only override,
an explicit board replacement, and supplied credentials. Audit other non-secret
platform defaults at the same time.

### C13 — Some SDK refresh requests can wait indefinitely

**Evidence:** Static refresh requests in `sdk/src/publishers/instagram/index.ts`
and `sdk/src/publishers/threads/index.ts` use bare `axios.get(...)`, whereas normal
publisher clients configure timeouts.

**Impact:** A refresh endpoint that accepts a connection but stalls can leave
direct SDK users waiting without the normal publisher deadline. Scheduler
credential refresh has its own handling and must be evaluated separately; the
client timeout does not automatically apply to a static Axios request.

**Recommendation:** Set explicit deadlines on refresh calls and media-upload
requests, and test timeout propagation. Choose separate limits for short
credential requests and potentially large uploads.

## Validation and remaining limits

- Baseline SDK: 18 suites, 317 tests passed.
- Baseline scheduler: 57 suites passed, 1 failed; 344 tests passed, 1 failed.
- Fixed SDK: 19 suites, 329 tests passed.
- Fixed scheduler before the rebase: 60 suites, 357 tests passed.
- Rebased scheduler: 63 suites, 386 tests passed, including the new upstream
  TikTok account-options tests and the snapshot guard assertions.
- SDK distribution build passed; `yarn check` passed across all workspaces.
- CLI: 11 suites, 39 tests passed after allowing its localhost OAuth test
  listener outside the sandbox.
- External services are mocked in regression tests. They send no real social
  posts, contact messages, or billing requests.
- Database predicates and race outcomes are tested with mocks, not a live
  PostgreSQL instance. A disposable PostgreSQL concurrency suite is the highest
  value next verification improvement for C03/C04.
- This PR does not claim exactly-once delivery, a durable webhook outbox,
  distributed provider quotas, or safe shared-media garbage collection.

Recommended next implementation order: shared-media references (C07), durable
publish checkpoints/thread resumption (C09), then accurate distributed rate
budgeting (C08). The smaller SDK and
serialization fixes can be handled independently.
