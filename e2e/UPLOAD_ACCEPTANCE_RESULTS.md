# Upload acceptance results

Status on 2026-10-23: the combined changes are deployed to production. Live
acceptance is pending refreshed test-account authentication; no new social posts
have been submitted by this run.

## Release

- Aggregate PR: [#173](https://github.com/simple-post/core/pull/173), merged into
  `main` as `e74fa2565af6ac036d96e09b5e2c2b89e508d377`.
- Production promotion: [#174](https://github.com/simple-post/core/pull/174), merged
  into `release/prod` as `af095bd981d5557757b08fbb5dafb8f1dfd71702`.
- Coolify reported a successful production deployment. The running production
  container uses that release revision and the public app returned HTTP 200.
- The main and production release file trees match. No new migrations were added.
- Previous production revision, retained as the rollback anchor:
  `24feabbbf9b802bb4cd73d5c1393ca361f6980d0`.

The owner explicitly changed the plan to production testing after deployment.
No temporary change to the dev deployment's source branch was made.

## Completed checks

- Aggregate PR GitHub CI passed before the main merge.
- SDK: **916 tests passed** across 42 suites.
- Offline end-to-end harness: **681 checks passed**, including all 19 upload
  scenario contracts with the generated larger originals present (not skipped).
- SDK/CLI builds and end-to-end TypeScript/format checks passed.
- JPEG: 1,961,069 bytes, 1080×1080.
- MP4: 31,130,349 bytes, 720×1280, 30 seconds, H.264/AAC.

These offline checks do not establish live platform acceptance or recovery after
a real provider failure.

## Live readiness

A read-only request through the existing test user's CLI login confirmed all ten
configured social identities still belong to that same test user. Three saved
connection IDs were refreshed in the ignored manifest only after exact owner and
social-identity matching. The manifest retains the 19-post total cap, two posts
per platform (one for YouTube), and pause after the first failure per platform.

The saved app browser session returned HTTP 401. The normal installed-Chrome
authentication flow is open for the test user; the existing session file will be
replaced only after successful sign-in. X separately reports expired credentials
that cannot be refreshed and requires its normal reconnection flow before its
two cases can run.

Live results must retain the existing run journal and accepted provider IDs.
Verification failures require observing the saved post rather than submitting a
replacement. No live case is recorded as passed yet, and no rollback has been
performed.
